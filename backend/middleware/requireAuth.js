const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Adjust path if models are elsewhere

// Re-use JWT secret (MOVE TO ENV VARIABLE!)
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_REALLY_SECRET_KEY_CHANGE_ME';

const requireAuth = async (req, res, next) => {
  // Verify authentication
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ message: 'Authorization token required.' });
  }

  // Token format is typically "Bearer <token>"
  const token = authorization.split(' ')[1];

  if (!token) {
     return res.status(401).json({ message: 'Malformed authorization header.' });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Find the user based on token payload (e.g., user ID)
    // Select only necessary fields, exclude passwordHash
    const user = await User.findById(decoded.id).select('_id email createdAt'); // Add more fields as needed

    if (!user) {
      console.warn(`Auth Middleware: User not found for token ID: ${decoded.id}`);
      return res.status(401).json({ message: 'Request is not authorized.' });
    }

    // Attach user object (without sensitive info) to the request object
    req.user = user;
    next(); // Proceed to the next middleware or route handler

  } catch (error) {
    console.error('Auth Middleware Error:', error.message);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Request is not authorized. Invalid or expired token.' });
    }
    res.status(500).json({ message: 'Server error during authentication.' });
  }
};

module.exports = requireAuth;
