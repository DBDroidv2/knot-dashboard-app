const express = require('express');
const axios = require('axios');
const requireAuth = require('../middleware/requireAuth'); // Import auth middleware

const router = express.Router();

// Protect this route
router.use(requireAuth);

// Use OpenWeather API key from environment variables
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = 'London'; // Default city as fallback

// GET /weather?ip=...
router.get('/', async (req, res) => {
  let city = DEFAULT_CITY;
  const userIp = req.query.ip; // Get IP from query param

  // --- Determine City from IP (if provided) ---
  if (userIp) {
    try {
      // console.log(`[Weather Route] Attempting geolocation for IP: ${userIp}`); // Removed log
      // Use http as ip-api.com often redirects https to http for free tier
      const geoUrl = `http://ip-api.com/json/${userIp}?fields=status,message,city`;
      const geoResponse = await axios.get(geoUrl, { timeout: 3000 }); // Add timeout

      if (geoResponse.data && geoResponse.data.status === 'success' && geoResponse.data.city) {
        city = geoResponse.data.city;
        // console.log(`[Weather Route] Geolocation successful. City set to: ${city}`); // Removed log
      } else {
        // console.warn(`[Weather Route] Geolocation failed or city not found for IP ${userIp}. Status: ${geoResponse.data?.status}, Message: ${geoResponse.data?.message}. Falling back to default.`); // Removed log
      }
    } catch (geoError) { // Removed ': any' type annotation
      console.error(`[Weather Route] Geolocation error for IP ${userIp}:`, geoError.message, `Falling back to default.`);
      // Don't stop execution, just use default city
    }
  } else {
     // console.log(`[Weather Route] No IP provided in query. Using default city: ${DEFAULT_CITY}`); // Removed log
  }

  // --- Fetch Weather Data ---
  if (!OPENWEATHER_API_KEY) {
    console.error("[Weather Route] OpenWeather API key is missing.");
    return res.status(500).json({ message: 'Server configuration error: Weather API key missing.' });
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${OPENWEATHER_API_KEY}&units=metric`;

  try {
    // console.log(`[Weather Route] Fetching weather for city: ${city}`); // Removed log
    const response = await axios.get(url);
    const weatherData = response.data;

    // Extract relevant data
    const result = {
      city: weatherData.name,
      temperature: weatherData.main.temp,
      description: weatherData.weather[0].description,
      icon: weatherData.weather[0].icon, // Icon code from OpenWeather
      country: weatherData.sys.country,
    };
    // console.log(`[Weather Route] Weather data fetched successfully for ${city}`); // Removed log
    res.status(200).json(result);

  } catch (error) {
    console.error('[Weather Route] Error fetching weather data:', error.response?.data || error.message);
    if (error.response) {
      // Forward error from OpenWeather API if possible
      res.status(error.response.status).json({ message: error.response.data?.message || 'Error fetching weather data.' });
    } else {
      res.status(500).json({ message: 'Server error while fetching weather data.' });
    }
  }
});

module.exports = router;
