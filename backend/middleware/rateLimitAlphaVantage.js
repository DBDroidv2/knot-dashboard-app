const User = require('../models/User');

const ALPHA_VANTAGE_DAILY_LIMIT = 25;
// Define the two API keys (Consider moving to .env for better security)
const API_KEY_1 = 'NCSZF0SH7KWV3XNV';
const API_KEY_2 = '5IDDO75IWPAEGJ32';

const rateLimitAlphaVantage = async (req, res, next) => {
    const userId = req.user?._id;

    if (!userId) {
        // This shouldn't happen if requireAuth is used before this middleware
        console.error('[Rate Limit] Error: User ID not found on request.');
        return res.status(401).json({ message: 'Authentication required.' });
    }

    try {
        // Fetch user with rate limit fields for BOTH keys
        const user = await User.findById(userId).select(
            'alphaVantageCallCount alphaVantageCountResetDate alphaVantageCallCount2 alphaVantageCountResetDate2'
        );

        if (!user) {
            console.error(`[AV Rate Limit] Error: User not found in DB for ID: ${userId}`);
            return res.status(404).json({ message: 'User not found.' });
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let key1CallCount = user.alphaVantageCallCount;
        let key1ResetDate = user.alphaVantageCountResetDate;
        let key2CallCount = user.alphaVantageCallCount2;
        let key2ResetDate = user.alphaVantageCountResetDate2;
        let key1NeedsReset = false;
        let key2NeedsReset = false;

        // Check/Reset Key 1
        if (!key1ResetDate || key1ResetDate < todayStart) {
            console.log(`[AV Rate Limit] Resetting count for Key 1 for user ${userId}.`);
            key1CallCount = 0;
            key1ResetDate = todayStart;
            key1NeedsReset = true; // Flag that this needs saving later if key 1 is used
        }

        // Check/Reset Key 2
        if (!key2ResetDate || key2ResetDate < todayStart) {
            console.log(`[AV Rate Limit] Resetting count for Key 2 for user ${userId}.`);
            key2CallCount = 0;
            key2ResetDate = todayStart;
            key2NeedsReset = true; // Flag that this needs saving later if key 2 is used
        }

        // Determine which key to use
        let useKey1 = key1CallCount < ALPHA_VANTAGE_DAILY_LIMIT;
        let useKey2 = !useKey1 && (key2CallCount < ALPHA_VANTAGE_DAILY_LIMIT);

        if (useKey1) {
            console.log(`[AV Rate Limit] Using Key 1 for user ${userId}. Count: ${key1CallCount}`);
            req.apiKeyToUse = API_KEY_1;
            req.apiKeyIndexUsed = 1; // To identify which count to increment later
            req.incrementAlphaVantageCount = true; // Mark for increment
            req.currentAlphaVantageCount = key1CallCount;
            req.currentAlphaVantageResetDate = key1ResetDate;
            req.keyNeedsReset = key1NeedsReset; // Pass reset status
            next();
        } else if (useKey2) {
            console.log(`[AV Rate Limit] Key 1 limit hit, using Key 2 for user ${userId}. Count: ${key2CallCount}`);
            req.apiKeyToUse = API_KEY_2;
            req.apiKeyIndexUsed = 2;
            req.incrementAlphaVantageCount = true;
            req.currentAlphaVantageCount = key2CallCount;
            req.currentAlphaVantageResetDate = key2ResetDate;
            req.keyNeedsReset = key2NeedsReset;
            next();
        } else {
            // Both keys have hit the limit
            console.warn(`[AV Rate Limit] User ${userId} exceeded daily limit on BOTH keys.`);
            const tomorrowStart = new Date(todayStart);
            tomorrowStart.setDate(todayStart.getDate() + 1);
            const timeUntilReset = tomorrowStart.getTime() - now.getTime();
            const hoursUntilReset = Math.floor(timeUntilReset / (1000 * 60 * 60));
            const minutesUntilReset = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));

            res.set('Retry-After', Math.ceil(timeUntilReset / 1000).toString());

            return res.status(429).json({
                message: `Alpha Vantage API daily limit (${ALPHA_VANTAGE_DAILY_LIMIT} per key) exceeded on all available keys. Please try again in approximately ${hoursUntilReset}h ${minutesUntilReset}m.`,
                limit: ALPHA_VANTAGE_DAILY_LIMIT,
                resetDate: tomorrowStart.toISOString()
            });
        }

    } catch (error) {
        console.error('[AV Rate Limit] Middleware Error:', error);
        res.status(500).json({ message: 'Server error during API rate limit check.' });
    }
};

module.exports = rateLimitAlphaVantage;
