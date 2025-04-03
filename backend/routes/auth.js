const express = require('express');
const bcrypt = require('bcryptjs'); // Use bcryptjs
const jwt = require('jsonwebtoken');
const axios = require('axios'); // Import axios for geolocation
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
  // Log request body but mask email and password
  const { email, password, ...restOfBody } = req.body;
  console.log("[Auth Route] Request Body (Masked):", { ...restOfBody, email: '***', password: '***' });

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
    console.log(`[Auth Route] Checking if user exists for email: ***`); // Masked email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log(`[Auth Route] User already exists for email: ***`); // Masked email
      return res.status(409).json({ message: 'Email already in use.' }); // 409 Conflict
    }

    // !! INSECURE: Saving plain text password for experiment !!
    // Create new user with the plain text password
    console.log(`[Auth Route] Creating new user for email (plain text password): ***`); // Masked email
    const newUser = new User({ email, password }); // Save plain password
    await newUser.save();
    console.log(`[Auth Route] New user saved successfully for email: ***, ID: ${newUser._id}`); // Masked email
    // !! END INSECURE !!

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
  // Log request body but mask email, password, and IP
  const { email, password, ipAddress, ...restOfBody } = req.body;
  console.log("[Auth Route] Login Request Body (Masked):", { ...restOfBody, email: '***', password: '***', ipAddress: ipAddress ? '***' : undefined }); // Mask IP

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' }); // Use generic message for security
    }

    // !! INSECURE: Direct password comparison for experiment !!
    // Compare plain text password
    if (password !== user.password) {
      console.log(`[Auth Route] Incorrect password attempt for email: ***`); // Masked email
      return res.status(401).json({ message: 'Invalid credentials.' }); // Generic message
    }
    // !! END INSECURE !!

    // --- Login successful, fetch geo data and update history ---
    const loginIp = ipAddress || req.ip; // Use provided IP, fallback to req.ip
    let geoData = { ipAddress: loginIp, timestamp: new Date() }; // Start with IP and time

    if (loginIp && loginIp !== '::1' && loginIp !== '127.0.0.1') { // Avoid geolocating local IPs
      try {
        console.log(`[Auth Route] Attempting geolocation for IP: ***`); // Masked IP
        const geoUrl = `http://ip-api.com/json/${loginIp}?fields=status,message,city,regionName,country`;
        const geoResponse = await axios.get(geoUrl, { timeout: 3000 });

        if (geoResponse.data && geoResponse.data.status === 'success') {
          geoData.city = geoResponse.data.city;
          geoData.city = geoResponse.data.city;
          geoData.region = geoResponse.data.regionName;
          geoData.country = geoResponse.data.country;
          console.log(`[Auth Route] Geolocation successful for IP: ***`); // Masked IP
        } else {
          console.warn(`[Auth Route] Geolocation failed for IP: ***. Status: ${geoResponse.data?.status}, Message: ${geoResponse.data?.message}`); // Masked IP
        }
      } catch (geoError) {
        console.error(`[Auth Route] Geolocation error for IP ${loginIp}:`, geoError.message);
        // Proceed without geo data if lookup fails
      }
    } else {
        console.log(`[Auth Route] Skipping geolocation for local IP: ***`); // Masked IP
    }

    // Add the new entry to the beginning of the history array
    user.loginHistory.unshift(geoData);

    // Optional: Limit history size (e.g., keep last 10 entries)
    // user.loginHistory = user.loginHistory.slice(0, 10);

    await user.save(); // Save the updated user document
    console.log(`[Auth Route] Added login history entry for user: ***`); // Masked email

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
