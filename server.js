const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const liteApi = require("liteapi-node-sdk");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

// ============================================
// CORS - Autoriser toutes les origines pour le moment
// ============================================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    credentials: true
  })
);

app.options("*", cors());

const prod_apiKey = process.env.PROD_API_KEY;
const sandbox_apiKey = process.env.SAND_API_KEY;

app.use(bodyParser.json());

// ============================================
// LOG MIDDLEWARE
// ============================================
app.use((req, res, next) => {
  console.log(`\n📥 ${req.method} ${req.url}`);
  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    console.log(`📦 Body:`, JSON.stringify(req.body, null, 2).substring(0, 500));
  }
  if (req.method === 'GET' && req.query && Object.keys(req.query).length > 0) {
    console.log(`📦 Query:`, req.query);
  }
  next();
});

// ============================================
// RECHERCHE DE LIEUX (via API directe)
// ============================================
app.get("/search-places", async (req, res) => {
  console.log("\n📍 ===== SEARCH PLACES ===== 📍");
  const { query, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;

  console.log(`🔍 Recherche: "${query}"`);

  if (!query || query.length < 2) {
    return res.json({ success: true, data: [] });
  }

  try {
    // Appel direct à l'API LiteAPI pour les places
    const response = await axios.get(
      `https://api.liteapi.travel/v3.0/data/places?textQuery=${encodeURIComponent(query)}`,
      {
        headers: {
          'X-API-Key': apiKey,
          'accept': 'application/json'
        }
      }
    );

    const places = response.data?.data || [];
    console.log(`✅ ${places.length} lieux trouvés`);

    res.json({ 
      success: true, 
      data: places 
    });
  } catch (error) {
    console.error("❌ Error searching places:", error.message);
    res.status(500).json({ 
      success: false,
      error: "Failed to search places",
      message: error.message
    });
  }
});

// ============================================
// RECHERCHE HÔTELS
// ============================================
app.get("/search-hotels", async (req, res) => {
  console.log("\n🔍 ===== SEARCH HOTELS ===== 🔍");
  const { checkin, checkout, adults, city, countryCode, environment, limit = 200 } = req.query;
  const apiKey = environment == "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  console.log(`📍 Ville: ${city}, Pays: ${countryCode}`);
  console.log(`📅 Arrivée: ${checkin}, Départ: ${checkout}`);
  console.log(`👤 Adultes: ${adults}`);

  try {
    const response = await sdk.getFullRates({
      countryCode: countryCode,
      cityName: city,
      checkin: checkin,
      checkout: checkout,
      currency: "USD",
      guestNationality: "US",
      occupancies: [{ adults: parseInt(adults, 10) }],
      limit: parseInt(limit),
      maxRatesPerHotel: 1,
      timeout: 8,
      includeHotelData: true
    });

    const data = response.data || [];
    console.log(`✅ ${data.length} hôtels avec tarifs trouvés`);

    const hotels = data.map(function(hotel) {
      const bestRate = hotel.roomTypes?.[0]?.rates?.[0];
      return {
        id: hotel.hotelId,
        name: hotel.hotel?.name || 'Hôtel sans nom',
        address: hotel.hotel?.address || '',
        city: hotel.hotel?.city || city,
        country: hotel.hotel?.country || countryCode,
        main_photo: hotel.hotel?.main_photo || '',
        rating: hotel.hotel?.rating || 0,
        reviewCount: hotel.hotel?.reviewCount || 0,
        starRating: hotel.hotel?.starRating || 0,
        minPrice: bestRate?.retailRate?.total?.[0]?.amount || 0,
        currency: bestRate?.retailRate?.total?.[0]?.currency || 'USD',
        offerId: hotel.roomTypes?.[0]?.offerId || null,
        roomName: bestRate?.name || 'Chambre standard',
        refundable: bestRate?.cancellationPolicies?.refundableTag === 'RFN'
      };
    });

    res.json({ 
      success: true,
      hotels: hotels,
      total: hotels.length
    });
  } catch (error) {
    console.error("❌ Error searching for hotels:", error);
    res.status(500).json({ 
      success: false,
      error: "Internal server error", 
      message: error.message
    });
  }
});

// ============================================
// TARIFS DÉTAILLÉS HÔTEL
// ============================================
app.get("/search-rates", async (req, res) => {
  console.log("\n💰 ===== SEARCH RATES ===== 💰");
  const { checkin, checkout, adults, hotelId, placeId, aiSearch, environment, maxRates = 20 } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  console.log(`🏨 Hotel ID: ${hotelId || 'non fourni'}`);
  console.log(`📍 Place ID: ${placeId || 'non fourni'}`);
  console.log(`🔍 AI Search: ${aiSearch || 'non utilisé'}`);
  console.log(`📅 Arrivée: ${checkin}, Départ: ${checkout}`);
  console.log(`👤 Adultes: ${adults}`);

  try {
    let rates;

    // Cas 1: Recherche par hotelId
    if (hotelId) {
      console.log(`⏳ Récupération des tarifs pour l'hôtel ${hotelId}...`);
      const response = await sdk.getFullRates({
        hotelIds: [hotelId],
        occupancies: [{ adults: parseInt(adults, 10) }],
        currency: "USD",
        guestNationality: "US",
        checkin: checkin,
        checkout: checkout,
        maxRatesPerHotel: parseInt(maxRates),
        roomMapping: true,
        includeHotelData: true,
        timeout: 8
      });
      rates = response.data || [];
    }
    // Cas 2: Recherche par placeId ou aiSearch
    else if (placeId || aiSearch) {
      console.log(`⏳ Récupération des tarifs par ${placeId ? 'placeId' : 'aiSearch'}...`);
      
      const requestBody = {
        occupancies: [{ adults: parseInt(adults, 10) }],
        currency: "USD",
        guestNationality: "US",
        checkin: checkin,
        checkout: checkout,
        maxRatesPerHotel: parseInt(maxRates),
        roomMapping: true,
        includeHotelData: true,
        timeout: 8
      };

      if (placeId) {
        requestBody.placeId = placeId;
      } else if (aiSearch) {
        requestBody.aiSearch = aiSearch;
      }

      const response = await sdk.getFullRates(requestBody);
      rates = response.data || [];
    }
    // Cas 3: Aucun critère
    else {
      console.error("❌ Aucun critère de recherche fourni");
      return res.status(400).json({
        success: false,
        error: "Missing search criteria: hotelId, placeId or aiSearch required"
      });
    }

    console.log(`✅ ${rates.length} hôtels dans la réponse`);

    if (rates.length === 0) {
      return res.json({ 
        success: false,
        error: "No availability found",
        message: "Aucun hôtel trouvé pour ces critères"
      });
    }

    // Prendre le premier hôtel (ou le meilleur)
    const hotel = rates[0];
    const hotelInfo = hotel.hotel || {};

    // Extraire les informations des chambres
    const rateInfo = (hotel.roomTypes || []).flatMap(function(roomType) {
      return (roomType.rates || []).map(function(rate) {
        return {
          rateName: rate.name,
          offerId: roomType.offerId,
          board: rate.boardName,
          boardType: rate.boardType,
          refundableTag: rate.cancellationPolicies?.refundableTag || 'NRFN',
          retailRate: rate.retailRate?.total?.[0]?.amount || 0,
          originalRate: rate.retailRate?.suggestedSellingPrice?.[0]?.amount || null,
          maxOccupancy: rate.maxOccupancy || 0,
          adultCount: rate.adultCount || 0,
          childCount: rate.childCount || 0,
          mappedRoomId: rate.mappedRoomId || null
        };
      });
    });

    let minPrice = null;
    rateInfo.forEach(function(r) {
      if (r.retailRate > 0 && (minPrice === null || r.retailRate < minPrice)) {
        minPrice = r.retailRate;
      }
    });

    console.log(`💰 ${rateInfo.length} tarifs disponibles, prix min: $${minPrice}`);

    res.json({ 
      success: true,
      hotelInfo: {
        id: hotel.hotelId,
        name: hotelInfo.name,
        address: hotelInfo.address,
        city: hotelInfo.city,
        country: hotelInfo.country,
        starRating: hotelInfo.starRating,
        rating: hotelInfo.rating,
        reviewCount: hotelInfo.reviewCount,
        main_photo: hotelInfo.main_photo
      },
      rateInfo: rateInfo,
      minPrice: minPrice,
      totalRates: rateInfo.length
    });
  } catch (error) {
    console.error("❌ Error fetching rates:", error);
    console.error("📝 Message:", error.message);
    if (error.response) {
      console.error("📄 Response data:", error.response.data);
    }
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch rates",
      message: error.message,
      details: error.response?.data || null
    });
  }
});

// ============================================
// PRÉ-RÉSERVATION HÔTEL
// ============================================
app.post("/prebook", async (req, res) => {
  console.log("\n📋 ===== PREBOOK ===== 📋");
  const { offerId, environment, voucherCode } = req.body;
  
  if (!offerId) {
    return res.status(400).json({ 
      success: false,
      error: "offerId is required" 
    });
  }

  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  console.log(`🔑 Offer ID: ${offerId}`);

  const bodyData = {
    offerId: offerId,
    usePaymentSdk: true,
  };

  if (voucherCode) {
    bodyData.voucherCode = voucherCode;
  }

  try {
    const response = await sdk.preBook(bodyData);
    res.json({ 
      success: true, 
      data: response.data 
    });
  } catch (err) {
    console.error("❌ Prebook error:", err);
    res.status(500).json({ 
      success: false,
      error: "Prebook failed",
      message: err.message
    });
  }
});

// ============================================
// RÉSERVATION FINALE HÔTEL
// ============================================
app.post("/book", async (req, res) => {
  console.log("\n📝 ===== BOOK ===== 📝");
  const { 
    prebookId, 
    guestFirstName, 
    guestLastName, 
    guestEmail, 
    guestPhone,
    transactionId, 
    environment 
  } = req.body;

  if (!prebookId) {
    return res.status(400).json({ 
      success: false,
      error: "prebookId is required" 
    });
  }
  if (!guestFirstName || !guestLastName || !guestEmail) {
    return res.status(400).json({ 
      success: false,
      error: "guestFirstName, guestLastName and guestEmail are required" 
    });
  }
  if (!transactionId) {
    return res.status(400).json({ 
      success: false,
      error: "transactionId is required" 
    });
  }

  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  const bodyData = {
    prebookId: prebookId,
    holder: {
      firstName: guestFirstName,
      lastName: guestLastName,
      email: guestEmail,
      phone: guestPhone || '+1234567890'
    },
    payment: {
      method: "TRANSACTION_ID",
      transactionId: transactionId
    },
    guests: [
      {
        occupancyNumber: 1,
        remarks: "",
        firstName: guestFirstName,
        lastName: guestLastName,
        email: guestEmail
      }
    ]
  };

  try {
    const response = await sdk.book(bodyData);
    res.json({ 
      success: true, 
      data: response.data 
    });
  } catch (err) {
    console.error("❌ Error during booking:", err);
    res.status(500).json({ 
      success: false,
      error: "Booking failed",
      message: err.message
    });
  }
});

// ============================================
// RECHERCHE VOLS
// ============================================
app.post("/search-flights", async (req, res) => {
  console.log("\n✈️ ===== SEARCH FLIGHTS ===== ✈️");
  const { legs, adults, children, infants, currency, country, cabinClass, environment } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  console.log(`📍 Itinéraire:`, JSON.stringify(legs, null, 2));

  try {
    const response = await sdk.searchFlights({
      legs: legs,
      adults: adults || 1,
      children: children || 0,
      infants: infants || 0,
      currency: currency || "USD",
      country: country || "US",
      cabinClass: cabinClass || "ECONOMY"
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Error searching flights:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to search flights",
      message: error.message
    });
  }
});

// ============================================
// VÉRIFICATION VOL
// ============================================
app.post("/verify-flight", async (req, res) => {
  console.log("\n🔎 ===== VERIFY FLIGHT ===== 🔎");
  const { offerId, environment } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const response = await sdk.verifyFlight({ offerId });
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Error verifying flight:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to verify flight",
      message: error.message
    });
  }
});

// ============================================
// PRÉ-RÉSERVATION VOL
// ============================================
app.post("/prebook-flight", async (req, res) => {
  console.log("\n📋 ===== PREBOOK FLIGHT ===== 📋");
  const { offerId, contact, passengers, usePaymentSdk, environment } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const response = await sdk.prebookFlight({
      offerId: offerId,
      usePaymentSdk: usePaymentSdk !== undefined ? usePaymentSdk : true,
      contact: contact,
      passengers: passengers
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Error prebooking flight:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to prebook flight",
      message: error.message
    });
  }
});

// ============================================
// RÉSERVATION FINALE VOL
// ============================================
app.post("/book-flight", async (req, res) => {
  console.log("\n📝 ===== BOOK FLIGHT ===== 📝");
  const { prebookId, transactionId, method, environment } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const response = await sdk.bookFlight({
      prebookId: prebookId,
      payment: {
        method: method || "TRANSACTION_ID",
        transactionId: transactionId
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Error booking flight:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to book flight",
      message: error.message
    });
  }
});

// ============================================
// DÉTAILS HÔTEL
// ============================================
app.get("/hotel-details", async (req, res) => {
  console.log("\n🏨 ===== HOTEL DETAILS ===== 🏨");
  const { hotelId, timeout = 8, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const response = await sdk.getHotelDetails(hotelId, timeout);
    const hotel = response.data;

    const rooms = (hotel.rooms || []).map(function(room) {
      return {
        id: room.id,
        roomName: room.roomName || 'Chambre sans nom',
        description: room.description || '',
        maxOccupancy: room.maxOccupancy || 0,
        maxAdults: room.maxAdults || 0,
        maxChildren: room.maxChildren || 0,
        roomSizeSquare: room.roomSizeSquare || 0,
        bedTypes: room.bedTypes || [],
        roomAmenities: (room.roomAmenities || []).map(function(a) { return a.name; }),
        photos: (room.photos || []).map(function(p) {
          return {
            url: p.hd_url || p.url || '',
            mainPhoto: p.mainPhoto || false
          };
        })
      };
    });

    res.json({ 
      success: true, 
      data: {
        ...hotel,
        rooms: rooms
      }
    });
  } catch (error) {
    console.error("❌ Error getting hotel details:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to get hotel details",
      message: error.message
    });
  }
});

// ============================================
// AVIS HÔTEL
// ============================================
app.get("/hotel-reviews", async (req, res) => {
  console.log("\n⭐ ===== HOTEL REVIEWS ===== ⭐");
  const { hotelId, timeout = 8, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const response = await sdk.getHotelReviews(hotelId, timeout);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Error getting hotel reviews:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to get hotel reviews",
      message: error.message
    });
  }
});

// ============================================
// SERVEUR - SERVIR LES FICHIERS STATIQUES
// ============================================

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/resultats-hebergement.html", (req, res) => {
  res.sendFile(path.join(__dirname, "resultats-hebergement.html"));
});

app.get("/resultats-vols.html", (req, res) => {
  res.sendFile(path.join(__dirname, "resultats-vols.html"));
});

app.get("/hotel-detail.html", (req, res) => {
  res.sendFile(path.join(__dirname, "hotel-detail.html"));
});

// ============================================
// PORT
// ============================================
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`\n🚀 ===== LUVIA PLACE SERVER ===== 🚀`);
  console.log(`📡 Server running on http://localhost:${port}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 API Key (prod): ${prod_apiKey ? '✅' : '❌'}`);
  console.log(`🔑 API Key (sandbox): ${sandbox_apiKey ? '✅' : '❌'}`);
  console.log(`\n📋 ENDPOINTS:`);
  console.log(`   📍 GET  /search-places     - Autocomplete de lieux (API directe)`);
  console.log(`   🔍 GET  /search-hotels     - Hôtels`);
  console.log(`   💰 GET  /search-rates      - Tarifs détaillés`);
  console.log(`   📋 POST /prebook           - Pré-réservation hôtel`);
  console.log(`   📝 POST /book              - Réservation hôtel`);
  console.log(`   🏨 GET  /hotel-details     - Détails hôtel`);
  console.log(`   ⭐ GET  /hotel-reviews     - Avis hôtel`);
  console.log(`   ✈️ POST /search-flights    - Recherche vols`);
  console.log(`   ✈️ POST /prebook-flight    - Pré-réservation vol`);
  console.log(`   ✈️ POST /book-flight       - Réservation vol`);
  console.log(`\n✅ Serveur prêt !\n`);
});
