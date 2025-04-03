const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { WebSocketServer } = require('ws'); // Import WebSocketServer
const { spawn } = require('child_process'); // Import spawn
const url = require('url'); // To parse URL query parameters
const jwt = require('jsonwebtoken'); // To verify JWT
const User = require('./models/User'); // To find user from token
const cors = require('cors'); // Import cors middleware

// Removed: Shell determination and activeShells object

// Basic configuration (consider moving to environment variables later)
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/knot_dashboard';

// Initialize Express app
const app = express();
const server = http.createServer(app); // Keep http server for consistency, though Express can run directly

// JWT Secret (Should be in ENV VARS!)
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_REALLY_SECRET_KEY_CHANGE_ME';

// Removed Simple Request Logger Middleware
// app.use((req, res, next) => {
//   console.log(`[Request Logger] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
//   next(); // Pass control to the next middleware
// });

// Middleware
app.use(cors({ // Enable CORS for the frontend origin
    origin: 'http://localhost:3000',
    methods: ["GET", "POST", "PUT", "DELETE"],
}));
app.use(express.json()); // for parsing application/json


// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => { /* console.log('MongoDB connected successfully.'); */ }) // Removed log
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit if DB connection fails
  });

// Basic Route (for testing)
app.get('/', (req, res) => {
  res.send('Knot Dashboard Backend API is running!');
});

// --- API Routes ---
const authRoutes = require('./routes/auth'); // Import auth routes
const userRoutes = require('./routes/users'); // Import user routes
const weatherRoutes = require('./routes/weather'); // Import weather routes
app.use('/auth', authRoutes); // Mount auth routes under /auth path
app.use('/api/users', userRoutes); // Mount user routes under /api/users path
app.use('/api/weather', weatherRoutes); // Mount weather routes under /api/weather path

// --- WebSocket Terminal Setup ---
const wss = new WebSocketServer({ noServer: true }); // Don't attach directly, handle upgrade manually

const activeShells = new Map(); // Store active shells per WebSocket connection

wss.on('connection', (ws, req, user) => { // Receive user object from upgrade handler
  console.log(`[WebSocket Server] Connection established for user: *** (ID: ${user._id})`); // Masked email

  // Spawn PowerShell process
  // Use -NoExit to keep the shell running interactively
  // Consider security implications of running PowerShell directly
  const shellProcess = spawn('powershell.exe', ['-NoLogo', '-NoExit'], { // Removed '-Command', '-'
      cwd: process.env.USERPROFILE || 'C:\\', // Start in user's home directory
      stdio: ['pipe', 'pipe', 'pipe'], // Pipe stdin, stdout, stderr
      windowsHide: true,
  });

  activeShells.set(ws, shellProcess); // Store the process
  console.log(`[WebSocket Server] Spawned PowerShell process PID: ${shellProcess.pid} for user: ***`); // Masked email

  // Send data from shell to WebSocket client
  shellProcess.stdout.on('data', (data) => {
    const output = data.toString();
    // console.log(`[PID:${shellProcess.pid}] stdout: ${output.substring(0, 100)}${output.length > 100 ? '...' : ''}`); // Removed stdout log
    ws.send(output);
  });
  shellProcess.stderr.on('data', (data) => {
    const errorOutput = data.toString();
    console.error(`[PID:${shellProcess.pid}] stderr: ${errorOutput}`);
    // Prefix stderr to distinguish it, or handle differently on frontend
    ws.send(`stderr: ${errorOutput}`);
  });

  // Handle data received from WebSocket client (commands)
  ws.on('message', (message) => {
    try {
        // Ensure message is a string before writing
        const command = message.toString();
        // console.log(`[PID:${shellProcess.pid}] Received command from user: *** : ${command.trim()}`); // Removed received command log
        shellProcess.stdin.write(command);
        // Add newline if necessary, depending on how frontend sends commands
        if (!command.endsWith('\n')) {
            shellProcess.stdin.write('\n');
        }
    } catch (error) {
        console.error('Error writing to shell stdin:', error);
        ws.send(`Error processing command: ${error.message}\n`);
    }
  });

  // Handle shell process exit
  shellProcess.on('exit', (code, signal) => {
    console.log(`[PID:${shellProcess.pid}] Shell process exited with code ${code}, signal ${signal} for user: ***`); // Masked email
    activeShells.delete(ws);
    if (ws.readyState === ws.OPEN) {
      ws.send(`\n[Process exited with code ${code}]`);
      ws.close();
    }
  });

  // Handle shell process errors (e.g., spawn error)
  shellProcess.on('error', (err) => {
    console.error(`[PID:${shellProcess.pid}] Shell process error for user: *** :`, err); // Masked email
    activeShells.delete(ws);
     if (ws.readyState === ws.OPEN) {
        ws.send(`\n[Shell process error: ${err.message}]`);
        ws.close();
     }
  });

  // Handle WebSocket client closing connection
  ws.on('close', () => {
    console.log(`[WebSocket Server] Connection closed for user: ***`); // Masked email
    if (shellProcess && !shellProcess.killed) {
      console.log(`[WebSocket Server] Terminating shell process PID: ${shellProcess.pid} due to WebSocket close.`);
      // Use taskkill on Windows for more forceful termination if needed
      // process.kill(shellProcess.pid); // May not be enough for child shells
      spawn('taskkill', ['/pid', shellProcess.pid, '/f', '/t']); // Force kill process tree
      console.log(`Killed shell process PID: ${shellProcess.pid}`);
    }
    activeShells.delete(ws);
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
      console.error(`[WebSocket Server] WebSocket error for user: *** :`, error); // Masked email
      // Attempt to clean up shell if connection drops unexpectedly
      if (shellProcess && !shellProcess.killed) {
          console.log(`[WebSocket Server] Terminating shell process PID: ${shellProcess.pid} due to WebSocket error.`);
          spawn('taskkill', ['/pid', shellProcess.pid, '/f', '/t']);
      }
      activeShells.delete(ws);
  });

  // Send initial prompt or welcome message if desired
  // shellProcess.stdin.write('Write-Host "Welcome to PowerShell via WebSocket!"\n');
});


// --- Authentication Logic for WebSocket Upgrade ---
async function authenticateWebSocket(request, socket, head, callback) {
  const { pathname, query } = url.parse(request.url, true);
  const remoteAddress = request.socket.remoteAddress ? '***' : 'N/A'; // Mask client IP

  console.log(`[WebSocket Auth] Upgrade request received for path: ${pathname} from ${remoteAddress}`);

  if (pathname === '/terminal') {
    const token = query.token; // Get token from query parameter

    if (!token) {
      console.log(`[WebSocket Auth] Upgrade failed: No token provided from ${remoteAddress}.`); // IP already masked
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('_id email'); // Fetch necessary user info

      if (!user) {
        console.log(`[WebSocket Auth] Upgrade failed: User not found for token ID: ${decoded.id} from ${remoteAddress}.`); // IP already masked
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      console.log(`[WebSocket Auth] Authentication successful for user: *** from ${remoteAddress}. Proceeding with upgrade.`); // Masked email, IP already masked
      // Authentication successful, proceed with WebSocket upgrade
      // Pass user object to the 'connection' handler via callback
      callback(null, user);

    } catch (error) {
      console.error(`[WebSocket Auth] Upgrade auth error for ${remoteAddress}:`, error.message);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  } else {
    // If not the /terminal path, destroy the socket or handle differently
    console.log(`[WebSocket Auth] Upgrade failed: Path not supported: ${pathname} from ${remoteAddress}.`); // IP already masked
    socket.destroy();
  }
}

// --- Attach WebSocket Server to HTTP Server ---
server.on('upgrade', (request, socket, head) => {
  authenticateWebSocket(request, socket, head, (err, user) => {
    if (err || !user) {
      // Authentication failed in authenticateWebSocket, socket already handled/destroyed
      return;
    }

    // Authentication successful, let wss handle the upgrade
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, user); // Emit connection event with user object
    });
  });
});


// Start the server
server.listen(PORT, () => {
  // console.log(`Backend server listening on http://localhost:${PORT}`); // Removed log
  // console.log(`WebSocket terminal endpoint available at ws://localhost:${PORT}/terminal`); // Removed log
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing MongoDB connection and server.');
  await mongoose.connection.close();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
