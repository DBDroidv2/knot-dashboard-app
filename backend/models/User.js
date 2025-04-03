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
  passwordHash: {
    type: String,
    required: [true, 'Password is required'],
  },
  // Add profile/settings fields here later as needed
  // e.g., displayName: String, themePreference: { type: String, enum: ['light', 'dark'], default: 'light' }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps automatically
});

// --- Password Hashing ---

// Method to hash password before saving (using pre-save hook)
UserSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('passwordHash')) return next();

  try {
    const salt = await bcrypt.genSalt(10); // Generate salt (cost factor 10)
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (err) {
    next(err); // Pass error to the next middleware
  }
});

// Method to compare candidate password with stored hash
UserSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.passwordHash);
  } catch (err) {
    throw err; // Re-throw error for handling in controller/route
  }
};


const User = mongoose.model('User', UserSchema);

module.exports = User;
