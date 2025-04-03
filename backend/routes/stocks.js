const express = require('express');
const axios = require('axios');
const requireAuth = require('../middleware/requireAuth');
const rateLimitAlphaVantage = require('../middleware/rateLimitAlphaVantage'); // Import rate limit middleware
const User = require('../models/User'); // Import User model

const router = express.Router();

// IMPORTANT: API keys are now handled by the middleware
// const ALPHA_VANTAGE_API_KEY = 'NCSZF0SH7KWV3XNV'; // Removed
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const STOCK_CACHE_DURATION_MS = 15 * 60 * 1000; // Cache stock data for 15 minutes

// Middleware to ensure user is authenticated for stock routes
router.use(requireAuth); // Apply auth to all stock routes first

// Apply rate limiting middleware specifically to routes calling Alpha Vantage
// Note: Order matters. requireAuth runs first, then rateLimitAlphaVantage.

// Route to get daily stock data
router.get('/daily', rateLimitAlphaVantage, async (req, res) => { // Add rate limit middleware
    const { symbol, outputsize = 'compact' } = req.query; // Removed interval parameter
    const userId = req.user._id; // Get userId from authenticated request
    const forceRefresh = req.query.forceRefresh === 'true'; // Check for forceRefresh flag
    const requestedSymbol = symbol ? symbol.trim().toUpperCase() : null;

    if (!requestedSymbol) {
        return res.status(400).json({ error: 'Stock symbol is required' });
    }

    // --- Check Cache (Logic added in next step) ---


    // --- Fetch Fresh Data ---
    try {
        // --- Check Cache ---
        if (!forceRefresh) {
            try {
                // Select watchlist cache field as well
                const user = await User.findById(userId).select('cachedStockSymbol cachedStockData stockCacheTimestamp cachedWatchlistData');
                // 1. Check main cache
                if (
                    user?.cachedStockData &&
                    user?.stockCacheTimestamp &&
                    user?.cachedStockSymbol === requestedSymbol
                ) {
                    const now = new Date();
                    const cacheAge = now.getTime() - user.stockCacheTimestamp.getTime();

                    if (cacheAge < STOCK_CACHE_DURATION_MS) {
                        console.log(`[Stock Route /daily] Returning MAIN cached stock data for ${requestedSymbol} for user ${userId}. Age: ${Math.round(cacheAge / 60000)} min`);
                        req.incrementAlphaVantageCount = false; // Prevent increment
                        return res.status(200).json(user.cachedStockData);
                    } else {
                        console.log(`[Stock Route /daily] Main cache expired for ${requestedSymbol} for user ${userId}. Age: ${Math.round(cacheAge / 60000)} min`);
                    }
                }

                // 2. Check watchlist cache for the specific symbol if main cache missed or expired
                const watchlistCacheEntry = user?.cachedWatchlistData?.get(requestedSymbol);
                if (watchlistCacheEntry?.data && watchlistCacheEntry?.timestamp) {
                    const now = new Date();
                    const cacheAge = now.getTime() - watchlistCacheEntry.timestamp.getTime();
                    if (cacheAge < STOCK_CACHE_DURATION_MS) { // Use same duration
                        console.log(`[Stock Route /daily] Returning WATCHLIST cached stock data for ${requestedSymbol} for user ${userId}. Age: ${Math.round(cacheAge / 60000)} min`);
                        req.incrementAlphaVantageCount = false; // Prevent increment
                        return res.status(200).json(watchlistCacheEntry.data);
                    } else {
                         console.log(`[Stock Route /daily] Watchlist cache expired for ${requestedSymbol} for user ${userId}. Age: ${Math.round(cacheAge / 60000)} min`);
                    }
                }

            } catch (cacheError) {
                console.error(`[Stock Route /daily] Error checking cache for user ${userId}:`, cacheError);
                // Proceed to fetch fresh data
            }
        } else {
             console.log(`[Stock Route /daily] Force refresh requested for ${requestedSymbol} for user ${userId}.`);
        }
        // --- End Cache Check ---


        // Actual API call
        const response = await axios.get(ALPHA_VANTAGE_BASE_URL, {
            params: {
                function: 'TIME_SERIES_DAILY',
                symbol: symbol, // Use original symbol from query for API call
                apikey: req.apiKeyToUse, // Use the key determined by middleware
                outputsize: outputsize,
                // Add other optional parameters here if needed
            }
        });

        // Check if Alpha Vantage returned an error (e.g., invalid symbol, API limit)
        if (response.data['Error Message']) {
            return res.status(400).json({ error: `Alpha Vantage API error: ${response.data['Error Message']}` });
        }
        if (response.data['Note']) {
             // Handle API call frequency limits gracefully
             console.warn(`Alpha Vantage API Note: ${response.data['Note']}`);
             // Depending on the note, you might want to return a specific status or message
             // For now, we'll still return the data if available, but log the warning
        }

        // --- Update Cache and Increment Count (only if middleware marked for increment) ---
        if (req.incrementAlphaVantageCount) {
            try {
                const now = new Date();
                const updateFields = {
                    // Main cache update
                    cachedStockSymbol: requestedSymbol,
                    cachedStockData: response.data,
                    stockCacheTimestamp: now,
                    // Watchlist cache update
                    [`cachedWatchlistData.${requestedSymbol}`]: {
                        data: response.data,
                        timestamp: now
                    }
                };

                // Determine which rate limit count/date to update based on key used
                if (req.apiKeyIndexUsed === 1) {
                    updateFields.alphaVantageCallCount = req.currentAlphaVantageCount + 1;
                    if (req.keyNeedsReset) { // Only update reset date if it was actually reset
                        updateFields.alphaVantageCountResetDate = req.currentAlphaVantageResetDate;
                    }
                } else if (req.apiKeyIndexUsed === 2) {
                    updateFields.alphaVantageCallCount2 = req.currentAlphaVantageCount + 1;
                     if (req.keyNeedsReset) {
                        updateFields.alphaVantageCountResetDate2 = req.currentAlphaVantageResetDate;
                    }
                }

                await User.findByIdAndUpdate(userId, { $set: updateFields });
                console.log(`[Stock Route /daily] Used Key ${req.apiKeyIndexUsed}. Cached ${requestedSymbol} & incremented count for user ${userId}. New count: ${req.currentAlphaVantageCount + 1}`);
            } catch (updateError) {
                console.error(`[Stock Route /daily] Failed to update cache/count for user ${userId}:`, updateError);
                // Don't fail the request, just log the error
            }
        } else {
             console.log(`[Stock Route /daily] Skipping count increment for user ${userId} (likely cache hit or forceRefresh).`);
        }

        res.status(200).json(response.data);

    } catch (error) {
        console.error('Error fetching stock data:', error.message);
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Error data:', error.response.data);
            console.error('Error status:', error.response.status);
            res.status(error.response.status).json({ error: 'Failed to fetch stock data from Alpha Vantage' });
        } else if (error.request) {
            // The request was made but no response was received
            console.error('Error request:', error.request);
            res.status(504).json({ error: 'No response received from Alpha Vantage API' });
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error message:', error.message);
            res.status(500).json({ error: 'Internal server error while fetching stock data' });
        }
    }
});

// Route to search for stock symbols
router.get('/search', rateLimitAlphaVantage, async (req, res) => { // Add rate limit middleware
    const { keywords } = req.query;

    if (!keywords) {
        return res.status(400).json({ error: 'Keywords are required for symbol search' });
    }

    try {
        const response = await axios.get(ALPHA_VANTAGE_BASE_URL, {
            params: {
                function: 'SYMBOL_SEARCH',
                keywords: keywords,
                apikey: req.apiKeyToUse, // Use the key determined by middleware
                // datatype: 'json' // Default is json
            }
        });

        // --- Increment Count for Search (only if middleware marked for increment) ---
         if (req.incrementAlphaVantageCount) {
            try {
                const updateFields = {};
                 // Determine which rate limit count/date to update based on key used
                if (req.apiKeyIndexUsed === 1) {
                    updateFields.alphaVantageCallCount = req.currentAlphaVantageCount + 1;
                    if (req.keyNeedsReset) {
                        updateFields.alphaVantageCountResetDate = req.currentAlphaVantageResetDate;
                    }
                } else if (req.apiKeyIndexUsed === 2) {
                    updateFields.alphaVantageCallCount2 = req.currentAlphaVantageCount + 1;
                     if (req.keyNeedsReset) {
                        updateFields.alphaVantageCountResetDate2 = req.currentAlphaVantageResetDate;
                    }
                }
                await User.findByIdAndUpdate(userId, { $set: updateFields });
                 console.log(`[Stock Route /search] Used Key ${req.apiKeyIndexUsed}. Incremented count for user ${userId}. New count: ${req.currentAlphaVantageCount + 1}`);
            } catch (updateError) {
                console.error(`[Stock Route /search] Failed to update count for user ${userId}:`, updateError);
            }
        } else {
             console.log(`[Stock Route /search] Skipping count increment for user ${userId} (likely cache hit or forceRefresh - though search isn't cached).`);
        }

        // Check for API errors
        if (response.data['Error Message']) {
            return res.status(400).json({ error: `Alpha Vantage API error: ${response.data['Error Message']}` });
        }
         if (response.data['Note']) {
             console.warn(`Alpha Vantage API Note (Search): ${response.data['Note']}`);
         }

        // Return the search results (usually in response.data['bestMatches'])
        res.status(200).json(response.data);

    } catch (error) {
        console.error('Error searching stock symbols:', error.message);
        if (error.response) {
            console.error('Error data:', error.response.data);
            console.error('Error status:', error.response.status);
            res.status(error.response.status).json({ error: 'Failed to search symbols via Alpha Vantage' });
        } else if (error.request) {
            console.error('Error request:', error.request);
            res.status(504).json({ error: 'No response received from Alpha Vantage API during search' });
        } else {
            console.error('Error message:', error.message);
            res.status(500).json({ error: 'Internal server error while searching symbols' });
        }
    }
});

module.exports = router;
