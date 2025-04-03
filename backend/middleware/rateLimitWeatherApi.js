const User = require('../models/User');

const WEATHER_API_DAILY_LIMIT = 25;

const rateLimitWeatherApi = async (req, res, next) => {
    const userId = req.user?._id; // User should be attached by requireAuth middleware

    if (!userId) {
        console.error('[Weather Rate Limit] Error: User ID not found on request.');
        return res.status(401).json({ message: 'Authentication required.' });
    }

    try {
        // Fetch user with weather rate limit fields
        const user = await User.findById(userId).select('weatherApiCallCount weatherApiCountResetDate');

        if (!user) {
            console.error(`[Weather Rate Limit] Error: User not found in DB for ID: ${userId}`);
            return res.status(404).json({ message: 'User not found.' });
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today (00:00:00)

        let callCount = user.weatherApiCallCount;
        let resetDate = user.weatherApiCountResetDate;
        let needsSave = false;

        // Check if the reset date is in the past (or null)
        if (!resetDate || resetDate < todayStart) {
            console.log(`[Weather Rate Limit] Resetting count for user ${userId}. Old date: ${resetDate}, Today: ${todayStart}`);
            callCount = 0;
            resetDate = todayStart;
            needsSave = true;
        }

        // Check if limit is exceeded
        if (callCount >= WEATHER_API_DAILY_LIMIT) {
            console.warn(`[Weather Rate Limit] User ${userId} exceeded daily limit of ${WEATHER_API_DAILY_LIMIT}. Count: ${callCount}`);
            // Calculate time until next reset (start of tomorrow)
            const tomorrowStart = new Date(todayStart);
            tomorrowStart.setDate(todayStart.getDate() + 1);
            const timeUntilReset = tomorrowStart.getTime() - now.getTime();
            const hoursUntilReset = Math.floor(timeUntilReset / (1000 * 60 * 60));
            const minutesUntilReset = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));

            res.set('Retry-After', Math.ceil(timeUntilReset / 1000).toString());

            return res.status(429).json({
                message: `Weather API daily limit (${WEATHER_API_DAILY_LIMIT}) exceeded. Please try again in approximately ${hoursUntilReset}h ${minutesUntilReset}m.`,
                limit: WEATHER_API_DAILY_LIMIT,
                resetDate: tomorrowStart.toISOString()
            });
        }

        // Store the count to increment *after* the actual API call succeeds in the route handler
        // This prevents counting failed attempts or cached responses against the limit.
        req.incrementWeatherApiCount = true;
        req.currentWeatherApiCount = callCount; // Pass current count for potential saving
        req.currentWeatherApiResetDate = resetDate; // Pass current reset date

        // Proceed to the next middleware or route handler (which will handle incrementing)
        next();

    } catch (error) {
        console.error('[Weather Rate Limit] Middleware Error:', error);
        res.status(500).json({ message: 'Server error during weather API rate limit check.' });
    }
};

module.exports = rateLimitWeatherApi;
