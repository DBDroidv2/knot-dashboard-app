const express = require('express');
const bcrypt = require('bcryptjs'); // Import bcrypt
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth'); // Import auth middleware

const router = express.Router();

// --- Protect all routes defined in this file ---
// Any request to /api/users/* will first pass through requireAuth
router.use(requireAuth);

// --- GET Logged-in User's Profile ---
// GET /api/users/me
router.get('/me', async (req, res) => {
  // req.user is attached by requireAuth middleware but might not have latest IP/timestamp
  // Fetch the latest user data including the login history and displayName
  try {
    // Select the loginHistory and displayName fields
    const user = await User.findById(req.user._id).select('_id email createdAt loginHistory displayName'); // Added displayName
    if (!user) {
       // Should not happen if requireAuth worked
       return res.status(404).json({ message: 'User not found.' });
    }
    res.status(200).json(user);
  } catch (error) {
     console.error('Get Profile Error:', error);
     res.status(500).json({ message: 'Server error fetching profile.' });
  }
});

// --- UPDATE Logged-in User's Profile ---
// PUT /api/users/me
router.put('/me', async (req, res) => {
  // Only allow updating specific, non-sensitive fields from the request body.
  const { email, displayName } = req.body; // Include displayName
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
  if (displayName !== undefined) { // Allow updating display name
     // Add validation if needed (e.g., length)
     updates.displayName = displayName.trim();
  }

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
    ).select('_id email createdAt loginHistory displayName'); // Added displayName to returned user

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

// --- CHANGE Logged-in User's Password ---
// PUT /api/users/change-password
router.put('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user._id; // Get user ID from authenticated request

  // --- Validation ---
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required.' });
  }
  if (newPassword.length < 8) { // Ensure minimum length (should match frontend validation)
    return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ message: 'New password cannot be the same as the current password.' });
  }

  try {
    // --- Fetch User with plain text password ---
    // Need to fetch the user again, this time including the plain password field
    const user = await User.findById(userId).select('+password'); // Select plain password field
    if (!user) {
      // Should not happen if requireAuth is working
      console.warn(`Change Password: User not found after auth check for ID: ${userId}`);
      return res.status(404).json({ message: 'User not found.' });
    }

    // !! INSECURE: Direct password comparison for experiment !!
    // --- Verify Current Password ---
    if (currentPassword !== user.password) {
      return res.status(401).json({ message: 'Incorrect current password.' });
    }
    // !! END INSECURE !!

    // !! INSECURE: Update plain text password !!
    // --- Update Password in Database ---
    user.password = newPassword; // Save new plain text password
    await user.save(); // Save the updated user document
    // !! END INSECURE !!

    res.status(200).json({ message: 'Password updated successfully (plain text).' });

  } catch (error) {
    console.error('Change Password Error:', error);
    res.status(500).json({ message: 'Server error during password update.' });
  }
});


module.exports = router;
