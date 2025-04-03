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
  }
  // Removed lastLoginIp and lastLoginAt
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps automatically
});

// --- Removed bcrypt comparePassword method ---


const User = mongoose.model('User', UserSchema);

module.exports = User;
