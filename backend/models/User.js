const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Use bcryptjs

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please use a valid email address'], // Basic email format validation
    index: true, // Index for faster lookups
  },
  // !! INSECURE: Storing plain text password for experiment !!
  password: {
    type: String,
    required: [true, 'Password is required'],
  },
  // !! END INSECURE !!
  loginHistory: [{
    ipAddress: { type: String },
    timestamp: { type: Date, default: Date.now },
    city: { type: String },
    region: { type: String },
    country: { type: String },
    // Add other geo fields if needed (e.g., ISP, coordinates)
  }],
  displayName: {
    type: String,
    trim: true,
    maxlength: 50, // Example length limit
    default: null,
  },
  watchlist: { // Added watchlist field
    type: [String], // Array of strings (stock symbols)
    default: [], // Default to an empty array
  },
  // Rate Limiting Fields for Alpha Vantage
  alphaVantageCallCount: {
      type: Number,
      default: 0,
      required: true
  },
  alphaVantageCountResetDate: {
      type: Date,
      default: null // Will be set on first call of the day
  },
  // Rate Limiting Fields for Alpha Vantage Key 2
  alphaVantageCallCount2: {
      type: Number,
      default: 0,
      required: true
  },
  alphaVantageCountResetDate2: {
      type: Date,
      default: null
  },
  // Rate Limiting Fields for Weather API
  weatherApiCallCount: {
      type: Number,
      default: 0,
      required: true
  },
  weatherApiCountResetDate: {
      type: Date,
      default: null
  },
  // Cached Weather Data
  cachedWeatherData: {
      type: mongoose.Schema.Types.Mixed, // Store the JSON response directly
      default: null
  },
  weatherCacheTimestamp: {
      type: Date,
      default: null
  },
  // Cached Stock Data (for last viewed symbol in StockWidget)
  cachedStockSymbol: {
      type: String,
      default: null
  },
  cachedStockData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
  },
  stockCacheTimestamp: {
      type: Date,
      default: null
  },
  // Cached Watchlist Stock Data (Map: Symbol -> { data: Mixed, timestamp: Date })
  cachedWatchlistData: {
      type: Map,
      of: new mongoose.Schema({
          data: mongoose.Schema.Types.Mixed,
          timestamp: Date
      }, { _id: false }), // Prevent _id generation for sub-documents
      default: {}
  }
  // Removed lastLoginIp and lastLoginAt
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps automatically
});

// --- Removed bcrypt comparePassword method ---


const User = mongoose.model('User', UserSchema);

module.exports = User;
