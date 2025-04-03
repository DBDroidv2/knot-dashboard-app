const express = require('express');
const axios = require('axios');
const requireAuth = require('../middleware/requireAuth'); // Import auth middleware
const rateLimitWeatherApi = require('../middleware/rateLimitWeatherApi'); // Import weather rate limit middleware
const User = require('../models/User'); // Import User model for caching/incrementing

const router = express.Router();

// Protect this route and apply rate limiting
router.use(requireAuth);

// Use OpenWeather API key from environment variables
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = 'London'; // Default city as fallback
const CACHE_DURATION_MS = 60 * 60 * 1000; // Cache weather for 1 hour

// GET /weather?ip=...&forceRefresh=true (optional)
// Apply rate limiter *before* the main handler
router.get('/', rateLimitWeatherApi, async (req, res) => {
  const userId = req.user._id;
  const forceRefresh = req.query.forceRefresh === 'true';
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

  // --- Check Cache ---
  if (!forceRefresh) {
      try {
          const user = await User.findById(userId).select('cachedWeatherData weatherCacheTimestamp');
          if (user?.cachedWeatherData && user?.weatherCacheTimestamp) {
              const now = new Date();
              const cacheAge = now.getTime() - user.weatherCacheTimestamp.getTime();
              if (cacheAge < CACHE_DURATION_MS) {
                  console.log(`[Weather Route] Returning cached weather data for user ${userId}. Age: ${Math.round(cacheAge / 60000)} min`);
                  // IMPORTANT: Do NOT increment count when returning cached data
                  req.incrementWeatherApiCount = false; // Prevent increment in this case
                  return res.status(200).json(user.cachedWeatherData);
              } else {
                  console.log(`[Weather Route] Cache expired for user ${userId}. Age: ${Math.round(cacheAge / 60000)} min`);
              }
          }
      } catch (cacheError) {
          console.error(`[Weather Route] Error checking cache for user ${userId}:`, cacheError);
          // Proceed to fetch fresh data, don't block request
      }
  } else {
      console.log(`[Weather Route] Force refresh requested for user ${userId}. Skipping cache check.`);
  }


  // --- Fetch Fresh Weather Data ---
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

    // --- Update Cache and Increment Count (only if middleware marked for increment) ---
    if (req.incrementWeatherApiCount) {
        try {
            const updateData = {
                cachedWeatherData: result,
                weatherCacheTimestamp: new Date(),
                weatherApiCallCount: req.currentWeatherApiCount + 1, // Increment count
                weatherApiCountResetDate: req.currentWeatherApiResetDate // Ensure reset date is saved if it was reset
            };
            await User.findByIdAndUpdate(userId, { $set: updateData });
            console.log(`[Weather Route] Cached weather and incremented count for user ${userId}. New count: ${updateData.weatherApiCallCount}`);
        } catch (updateError) {
            console.error(`[Weather Route] Failed to update cache/count for user ${userId}:`, updateError);
            // Don't fail the request, just log the error
        }
    } else {
         console.log(`[Weather Route] Skipping count increment for user ${userId} (likely due to cache hit or forceRefresh).`);
    }

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
