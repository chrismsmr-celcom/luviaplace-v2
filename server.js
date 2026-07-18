const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// Configuration Nuitee Connect
const API_BASE_URL = 'https://api.liteapi.travel/v3.0';
const BOOK_BASE_URL = 'https://book.liteapi.travel/v3.0';

// Clés API
const prod_apiKey = process.env.PROD_API_KEY;
const sandbox_apiKey = process.env.SAND_API_KEY || "sand_c0155ab8-c683-4f26-8f94-b5e92c5797b9";

// Helper pour les appels API
async function callNuiteeAPI(endpoint, method = 'GET', data = null, apiKey, isBook = false) {
  const baseURL = isBook ? BOOK_BASE_URL : API_BASE_URL;
  const url = `${baseURL}${endpoint}`;
  
  try {
    const config = {
      method: method,
      url: url,
      headers: {
        'X-API-Key': apiKey,
        'accept': 'application/json',
        'content-type': 'application/json'
      }
    };
    
    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    } else if (data && method === 'GET') {
      config.params = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`Nuitee API error (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// 1. RECHERCHE DE LIEUX (Places Autocomplete)
// ============================================
app.get("/api/search-places", async (req, res) => {
  const { query, environment = "sandbox" } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  try {
    const response = await callNuiteeAPI(`/data/places?textQuery=${encodeURIComponent(query)}`, 'GET', null, apiKey);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error searching places:", error);
    res.status(500).json({ success: false, error: "Failed to search places" });
  }
});

// ============================================
// 2. RECHERCHE DE TARIFS HÔTELIERS
// ============================================
app.post("/api/search-rates", async (req, res) => {
  console.log("Search rates endpoint hit");
  const { 
    checkin, checkout, adults = 2, 
    placeId, hotelIds, aiSearch,
    currency = "USD", 
    guestNationality = "US",
    environment = "sandbox",
    maxRatesPerHotel = 1
  } = req.body;
  
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  // Construire le payload
  const payload = {
    occupancies: [{ adults: parseInt(adults, 10) }],
    currency,
    guestNationality,
    checkin,
    checkout,
    roomMapping: true,
    maxRatesPerHotel: parseInt(maxRatesPerHotel, 10),
    includeHotelData: true
  };
  
  // Ajouter soit placeId, soit hotelIds, soit aiSearch
  if (placeId) {
    payload.placeId = placeId;
  } else if (hotelIds && Array.isArray(hotelIds)) {
    payload.hotelIds = hotelIds;
  } else if (aiSearch) {
    payload.aiSearch = aiSearch;
  } else {
    return res.status(400).json({ 
      success: false, 
      error: "Missing search parameter: placeId, hotelIds, or aiSearch" 
    });
  }
  
  try {
    const response = await callNuiteeAPI('/hotels/rates', 'POST', payload, apiKey);
    res.json({ success: true, data: response });
  } catch (error) {
    console.error("Error searching rates:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to search rates",
      details: error.response?.data || error.message 
    });
  }
});

// ============================================
// 3. PRÉ-RÉSERVATION (Prebook)
// ============================================
app.post("/api/prebook", async (req, res) => {
  console.log("Prebook endpoint hit");
  const { offerId, environment = "sandbox" } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  if (!offerId) {
    return res.status(400).json({ success: false, error: "offerId is required" });
  }
  
  try {
    const payload = {
      usePaymentSdk: true,
      offerId: offerId
    };
    
    const response = await callNuiteeAPI('/rates/prebook', 'POST', payload, apiKey, true);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error during prebook:", error);
    res.status(500).json({ 
      success: false, 
      error: "Prebook failed",
      details: error.response?.data || error.message 
    });
  }
});

// ============================================
// 4. RÉSERVATION FINALE (Book)
// ============================================
app.post("/api/book", async (req, res) => {
  console.log("Book endpoint hit");
  const { 
    prebookId, 
    transactionId,
    guestFirstName,
    guestLastName,
    guestEmail,
    environment = "sandbox"
  } = req.body;
  
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  if (!prebookId || !transactionId) {
    return res.status(400).json({ 
      success: false, 
      error: "prebookId and transactionId are required" 
    });
  }
  
  try {
    const payload = {
      prebookId: prebookId,
      holder: {
        firstName: guestFirstName || "John",
        lastName: guestLastName || "Doe",
        email: guestEmail || "guest@example.com"
      },
      payment: {
        method: "TRANSACTION_ID",
        transactionId: transactionId
      },
      guests: [{
        occupancyNumber: 1,
        firstName: guestFirstName || "John",
        lastName: guestLastName || "Doe",
        email: guestEmail || "guest@example.com"
      }]
    };
    
    const response = await callNuiteeAPI('/rates/book', 'POST', payload, apiKey, true);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error during booking:", error);
    res.status(500).json({ 
      success: false, 
      error: "Booking failed",
      details: error.response?.data || error.message 
    });
  }
});

// ============================================
// 5. DÉTAILS D'UN HÔTEL
// ============================================
app.get("/api/hotel-details", async (req, res) => {
  const { hotelId, environment = "sandbox", timeout = 4 } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  if (!hotelId) {
    return res.status(400).json({ success: false, error: "hotelId is required" });
  }
  
  try {
    const response = await callNuiteeAPI(`/data/hotel?hotelId=${hotelId}&timeout=${timeout}`, 'GET', null, apiKey);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error fetching hotel details:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch hotel details" 
    });
  }
});

// ============================================
// 6. CONFIGURATION POUR LE PAYMENT SDK
// ============================================
app.get("/api/payment-config", (req, res) => {
  const { secretKey, environment = "sandbox", returnUrl } = req.query;
  
  res.json({
    success: true,
    data: {
      publicKey: environment === "sandbox" ? "sandbox" : "live",
      secretKey: secretKey,
      returnUrl: returnUrl || `${req.protocol}://${req.get('host')}/booking-confirmation`,
      targetElement: "#payment-element"
    }
  });
});

// ============================================
// SERVEUR
// ============================================
const port = process.env.PORT || 3000;

// Servir le frontend si présent
app.use(express.static(path.join(__dirname, "../client")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Using sandbox key: ${sandbox_apiKey ? 'Yes' : 'No'}`);
});
