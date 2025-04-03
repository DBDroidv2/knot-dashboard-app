const express = require('express');
const bcrypt = require('bcryptjs'); // Use bcryptjs
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Adjust path if necessary

const router = express.Router();

// Placeholder for JWT secret (MOVE TO ENV VARIABLE IN PRODUCTION!)
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_REALLY_SECRET_KEY_CHANGE_ME';
const JWT_EXPIRES_IN = '1d'; // Token expiry time (e.g., 1 day)

// --- Helper Function to Generate JWT ---
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email }, // Payload
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// --- Signup Route ---
// POST /auth/signup
router.post('/signup', async (req, res) => {
  console.log(`[Auth Route] Received POST /signup request at ${new Date().toISOString()}`);
  console.log("[Auth Route] Request Body:", req.body);
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    console.log("[Auth Route] Signup validation failed: Missing email or password.");
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  if (password.length < 6) { // Example: minimum password length
     return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  try {
    // Check if user already exists
    console.log(`[Auth Route] Checking if user exists for email: ${email}`);
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log(`[Auth Route] User already exists for email: ${email}`);
      return res.status(409).json({ message: 'Email already in use.' }); // 409 Conflict
    }

    // Create new user (passwordHash is hashed by pre-save hook in model)
    console.log(`[Auth Route] Creating new user for email: ${email}`);
    const newUser = new User({ email, passwordHash: password });
    await newUser.save();
    console.log(`[Auth Route] New user saved successfully for email: ${email}, ID: ${newUser._id}`);

    // Generate token
    console.log(`[Auth Route] Generating token for user ID: ${newUser._id}`);
    const token = generateToken(newUser);

    // Send response (exclude password hash)
    res.status(201).json({
      token,
      user: {
        id: newUser._id,
        email: newUser.email,
        createdAt: newUser.createdAt
      }
    });

  } catch (error) {
    // Handle potential validation errors from Mongoose schema
    if (error.name === 'ValidationError') {
        let messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: messages.join('. ') });
    }
    console.error('[Auth Route] Signup Error Details:', error); // Log the full error
    res.status(500).json({ message: 'Server error during signup.' });
  }
});

// --- Login Route ---
// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' }); // Use generic message for security
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' }); // Generic message
    }

    // Generate token
    const token = generateToken(user);

    // Send response
    res.status(200).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        createdAt: user.createdAt
        // Add other non-sensitive fields as needed
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login.' });
  }
});


module.exports = router;
