const express = require('express');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth'); // Import auth middleware

const router = express.Router();

// --- Protect all routes defined in this file ---
// Any request to /api/users/* will first pass through requireAuth
router.use(requireAuth);

// --- GET Logged-in User's Profile ---
// GET /api/users/me
router.get('/me', (req, res) => {
  // req.user is attached by requireAuth middleware
  // Return only non-sensitive data attached in middleware
  res.status(200).json(req.user);
});

// --- UPDATE Logged-in User's Profile ---
// PUT /api/users/me
router.put('/me', async (req, res) => {
  // Only allow updating specific, non-sensitive fields from the request body.
  // Password updates should have a dedicated, more secure endpoint.
  const { email /*, displayName */ } = req.body; // Add other updatable fields here
  const userId = req.user._id; // Get user ID from authenticated request (attached by requireAuth)

  // --- Build Updates Object ---
  const updates = {};
  if (email) {
    // Basic email format check (could use a library like validator.js for robustness)
    if (!/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ message: 'Invalid email format provided.' });
    }
    updates.email = email.trim().toLowerCase();
  }
  // if (displayName !== undefined) { // Example: allow updating display name
  //    updates.displayName = displayName.trim();
  // }

  if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update.' });
  }

  // --- Perform Update ---
  try {
     // Check if the new email (if provided) is already taken by ANOTHER user
     if (updates.email && updates.email !== req.user.email) {
         const existingUser = await User.findOne({ email: updates.email, _id: { $ne: userId } }); // Check other users
         if (existingUser) {
             return res.status(409).json({ message: 'Email address is already in use by another account.' });
         }
     }

    // Find user by ID and update with the validated fields
    // Use { new: true } to return the modified document instead of the original
    // Use runValidators: true to ensure schema validations are run on update
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates }, // Use $set to apply updates
      { new: true, runValidators: true }
    ).select('_id email createdAt'); // Select only non-sensitive fields to return

    if (!updatedUser) {
      // This case should ideally not be reached if requireAuth works correctly
      console.warn(`Update Profile: User not found after auth check for ID: ${userId}`);
      return res.status(404).json({ message: 'User not found.' });
    }

    // Return the updated user profile data (without password hash)
    res.status(200).json(updatedUser);

  } catch (error) {
     // Handle potential validation errors from Mongoose schema
    if (error.name === 'ValidationError') {
        let messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: messages.join('. ') });
    }
    // Handle potential unique constraint errors (e.g., if email check somehow failed)
    if (error.code === 11000) {
         return res.status(409).json({ message: 'Update failed due to conflicting data (e.g., email already exists).' });
    }
    console.error('Update Profile Error:', error);
    res.status(500).json({ message: 'Server error during profile update.' });
  }
});

module.exports = router;
