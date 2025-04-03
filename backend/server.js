const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws'); // Import WebSocket too
const { spawn } = require('child_process');
const url = require('url');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const cors = require('cors');

// Basic configuration
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/knot_dashboard';
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_REALLY_SECRET_KEY_CHANGE_ME';

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// --- Middleware ---
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ["GET", "POST", "PUT", "DELETE"],
}));
app.use(express.json());

// --- MongoDB Connection ---
mongoose.connect(MONGODB_URI)
  .then(() => { /* console.log('MongoDB connected successfully.'); */ }) // Log removed
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// --- Basic Route ---
app.get('/', (req, res) => {
  res.send('Knot Dashboard Backend API is running!');
});

// --- API Routes ---
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const weatherRoutes = require('./routes/weather');
app.use('/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/weather', weatherRoutes);

// --- WebSocket Terminal Setup ---
const wss = new WebSocketServer({ noServer: true });

// Map to store user sessions: userId (string) -> { process: ChildProcess | null, ws: WebSocket | null, historyBuffer: string[] }
const userShells = new Map();
const MAX_HISTORY_LINES = 1000; // Limit buffer size

// Helper function to terminate a user's session process
// DEFINED EARLIER TO BE IN SCOPE FOR SIGINT HANDLER
function terminateUserProcess(userIdString) {
    const existingSession = userShells.get(userIdString);
    if (existingSession?.process && !existingSession.process.killed) {
        const pid = existingSession.process.pid;
        console.log(`[WebSocket Server] Terminating session process PID: ${pid} for user ID: ${userIdString}`);
        try {
            // Force kill process tree using taskkill on Windows
            spawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
            console.log(`[WebSocket Server] Sent kill signal to PID: ${pid}`);
        } catch (killError) {
            console.error(`[WebSocket Server] Error sending kill signal to PID ${pid}:`, killError);
        }
        // Mark process as null after attempting kill - process might take time to die
        existingSession.process = null;
    }
    // Always remove from map after attempting termination
    if (userShells.has(userIdString)) {
        userShells.delete(userIdString);
        console.log(`[WebSocket Server] Removed session entry for user ID: ${userIdString}`);
    }
}

// --- WebSocket Connection Handler ---
wss.on('connection', (ws, request, user) => {
  const userIdString = user._id.toString();
  console.log(`[WebSocket Server] Connection attempt for user: *** (ID: ${userIdString})`);

  let currentSession = userShells.get(userIdString);
  let shellProcess = null;
  let isResuming = false;

  if (currentSession) {
      // Session exists
      if (currentSession.ws === null) {
          // Disconnected session found, try to resume it
          shellProcess = currentSession.process;
          if (shellProcess && !shellProcess.killed) {
              console.log(`[WebSocket Server] Resuming disconnected session for user ID: ${userIdString}, PID: ${shellProcess.pid}`);
              // Send history buffer to the new client FIRST
              if (ws.readyState === WebSocket.OPEN) {
                  console.log(`[WebSocket Server] Sending ${currentSession.historyBuffer?.length || 0} history lines to resuming client.`);
                  currentSession.historyBuffer?.forEach(line => {
                      ws.send(line);
                  });
                  // Optionally send a resume marker?
                  // ws.send("\n--- Session Resumed ---\n");
              }
              currentSession.ws = ws; // Attach new WebSocket
              isResuming = true;
          } else {
              console.log(`[WebSocket Server] Found session entry for user ${userIdString}, but process was dead. Starting new.`);
              userShells.delete(userIdString); // Clean up dead entry
              currentSession = null;
          }
      } else {
          // Session exists and is already actively connected (e.g., another tab)
          console.log(`[WebSocket Server] User ${userIdString} already has an active session. Terminating old, starting new.`);
          terminateUserProcess(userIdString); // Kill the old process
          userShells.delete(userIdString); // Clean up map entry fully
          currentSession = null;
      }
  }

  // If no session exists OR if we need to start a new one after termination/dead process cleanup
  if (!isResuming) {
      try {
          shellProcess = spawn('powershell.exe', ['-NoLogo', '-NoExit'], {
              cwd: process.env.USERPROFILE || 'C:\\',
              stdio: ['pipe', 'pipe', 'pipe'],
              windowsHide: true,
          });
          console.log(`[WebSocket Server] Spawned new PowerShell process PID: ${shellProcess.pid} for user: *** (ID: ${userIdString})`);

          // Store the new session information
          const newSession = { process: shellProcess, ws: ws, historyBuffer: [] };
          userShells.set(userIdString, newSession);
          currentSession = newSession; // Update currentSession reference

          // --- Attach Event Handlers ONLY for the NEW process ---
          const handleOutput = (data) => { // Removed type annotation
              const output = data.toString();
              const session = userShells.get(userIdString);
              if (session) {
                  session.historyBuffer.push(output);
                  if (session.historyBuffer.length > MAX_HISTORY_LINES) {
                      session.historyBuffer.shift();
                  }
                  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                      session.ws.send(output);
                  }
              }
          };

          const handleErrorOutput = (data) => { // Removed type annotation
               const errorOutput = data.toString();
               console.error(`[PID:${shellProcess.pid}] stderr: ${errorOutput}`);
               const session = userShells.get(userIdString);
               if (session) {
                   const prefixedError = `stderr: ${errorOutput}`;
                   session.historyBuffer.push(prefixedError);
                   if (session.historyBuffer.length > MAX_HISTORY_LINES) {
                       session.historyBuffer.shift();
                   }
                   if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                       session.ws.send(prefixedError);
                   }
               }
          };

          shellProcess.stdout.on('data', handleOutput);
          shellProcess.stderr.on('data', handleErrorOutput);

          shellProcess.on('exit', (code, signal) => {
              console.log(`[PID:${shellProcess.pid}] Shell process exited with code ${code}, signal ${signal} for user: *** (ID: ${userIdString})`);
              const session = userShells.get(userIdString);
              if (session?.process === shellProcess) {
                  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                      session.ws.close(1011, `Shell process exited (code: ${code})`);
                  }
                  userShells.delete(userIdString);
                  console.log(`[WebSocket Server] Cleaned up session map on process exit for user ID: ${userIdString}`);
              }
          });

          shellProcess.on('error', (err) => {
              console.error(`[PID:${shellProcess.pid || 'N/A'}] Shell process error for user: *** (ID: ${userIdString}):`, err);
              const session = userShells.get(userIdString);
              if (session?.process === shellProcess) {
                  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                      session.ws.close(1011, `Shell process error: ${err.message}`);
                  }
                  userShells.delete(userIdString);
                  console.log(`[WebSocket Server] Cleaned up session map on process error for user ID: ${userIdString}`);
              }
          });

      } catch (spawnError) {
          console.error(`[WebSocket Server] Failed to spawn shell for user ${userIdString}:`, spawnError);
          ws.close(1011, "Failed to start terminal process.");
          return;
      }
  }

  // --- Setup Event Handlers for the CURRENT WebSocket (ws) ---
  // These run regardless of whether it's a new or resumed session

  ws.on('message', (message) => {
    try {
        const command = message.toString();
        const session = userShells.get(userIdString); // Get the potentially updated session
        if (session?.process && !session.process.killed) {
            // Add command to history buffer as well? Optional.
            // session.historyBuffer.push(`cmd: ${command}`); // Example prefix
            // if (session.historyBuffer.length > MAX_HISTORY_LINES) { session.historyBuffer.shift(); }

            session.process.stdin.write(command);
            if (!command.endsWith('\n')) {
                session.process.stdin.write('\n');
            }
        } else {
             console.warn(`[WebSocket Server] Received message for user ${userIdString}, but no active process found.`);
             if(ws.readyState === WebSocket.OPEN) ws.close(1011, "Terminal process not found or ended.");
        }
    } catch (error) {
        console.error(`[WebSocket Server] Error writing to shell stdin for user ${userIdString}:`, error);
        if(ws.readyState === WebSocket.OPEN) ws.send(`Error processing command: ${error.message}\n`);
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket Server] WebSocket connection closed for user: *** (ID: ${userIdString})`);
    const session = userShells.get(userIdString);
    // If the closing WS is the one currently associated with the session, mark as disconnected
    if (session && session.ws === ws) {
        session.ws = null; // Keep process running, just mark WS as disconnected
        console.log(`[WebSocket Server] Marked session as disconnected for user ID: ${userIdString}, process PID: ${session.process?.pid} continues running.`);
    } else {
         console.log(`[WebSocket Server] Closed WebSocket was not the primary for user ID: ${userIdString} or session already ended.`);
    }
  });

  ws.on('error', (error) => {
      console.error(`[WebSocket Server] WebSocket error for user: *** (ID: ${userIdString}):`, error);
      // Attempt to mark as disconnected, similar to 'close'
      const session = userShells.get(userIdString);
      if (session && session.ws === ws) {
          session.ws = null;
          console.error(`[WebSocket Server] Marked session as disconnected due to WS error for user ID: ${userIdString}.`);
      }
  });
});


// --- Authentication Logic for WebSocket Upgrade ---
async function authenticateWebSocket(request, socket, head, callback) {
  const { pathname, query } = url.parse(request.url, true);
  const remoteAddress = request.socket.remoteAddress ? '***' : 'N/A'; // Mask client IP

  // console.log(`[WebSocket Auth] Upgrade request received for path: ${pathname} from ${remoteAddress}`); // Reduced logging

  if (pathname === '/terminal') {
    const token = query.token;
    if (!token) {
      console.log(`[WebSocket Auth] Upgrade failed: No token provided from ${remoteAddress}.`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('_id email'); // Need _id and email
      if (!user) {
        console.log(`[WebSocket Auth] Upgrade failed: User not found for token ID: ${decoded.id} from ${remoteAddress}.`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      // console.log(`[WebSocket Auth] Authentication successful for user: *** (ID: ${user._id}) from ${remoteAddress}. Proceeding with upgrade.`); // Reduced logging
      callback(null, user); // Pass user object
    } catch (error) {
      console.error(`[WebSocket Auth] Upgrade auth error for ${remoteAddress}:`, error.message);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    console.log(`[WebSocket Auth] Upgrade failed: Path not supported: ${pathname} from ${remoteAddress}.`);
    socket.destroy();
  }
}

// --- Attach WebSocket Server to HTTP Server ---
server.on('upgrade', (request, socket, head) => {
  authenticateWebSocket(request, socket, head, (err, user) => {
    if (err || !user) {
      // Auth failed or error occurred, socket already handled/destroyed in authenticateWebSocket
      return;
    }
    // Auth successful, proceed with upgrade
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, user); // Pass user object to 'connection' handler
    });
  });
});

// --- Start Server ---
server.listen(PORT, () => {
  // console.log(`Backend server listening on http://localhost:${PORT}`); // Log removed
  // console.log(`WebSocket terminal endpoint available at ws://localhost:${PORT}/terminal`); // Log removed
});

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing MongoDB connection and server.');
  // Terminate all active shell processes before closing server
  console.log('[Shutdown] Terminating active shell processes...');
  for (const userIdString of userShells.keys()) { // Iterate using the correct key type
      terminateUserProcess(userIdString); // Call the helper function (now defined above)
  }
  await mongoose.connection.close();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
