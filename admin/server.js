/* ============================================================
   RIDERA RESPONDER — SERVER.JS
   Node.js + Express + Socket.IO + Firebase Admin
   CDRRMO Dasmariñas Emergency Operations Backend
   ============================================================ */

const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const axios = require('axios');
require('dotenv').config();

// OTP generator — 6-digit code
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// ============================================================
// FIREBASE ADMIN SDK INIT
// ============================================================
// Gunagamit ang service account key mula sa environment variable o file
// Get service account key: Firebase Console → Project Settings → Service Accounts → Generate new private key
// I-save sa .env: FIREBASE_SERVICE_ACCOUNT_KEY=<path_to_json> o environment variable
// Or i-set ang FIREBASE_PROJECT_ID, etc. separately

let db = null;

try {
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || './serviceAccountKey.json';
    const serviceAccount = require(path.resolve(keyPath));

    // Auto-derive database URL from project_id (no .env needed)
    const databaseURL = process.env.FIREBASE_DATABASE_URL
        || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });

    db = admin.database();
    console.log('✓ Firebase Admin SDK initialized');
    console.log('  Project:', serviceAccount.project_id);
    console.log('  Database:', databaseURL);
} catch (err) {
    console.error('✗ Firebase Admin SDK init failed:', err.message);
    console.log('  Check that serviceAccountKey.json exists and is valid JSON.');
    process.exit(1);
}

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// Session store (in-memory; use Redis for production)
const sessionStore = new session.MemoryStore();
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'ridera-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
});

app.use(sessionMiddleware);

// Static files — serve public directory
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login.html');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Access denied. Admin role required.');
    }
    next();
}

// ============================================================
// ROUTES
// ============================================================

// Login Page — serve if not authenticated
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        // Load responder from Firebase
        const snapshot = await db.ref('Ridera/authorized_emergency_responder').get();
        const responders = snapshot.val() || {};

        let foundResponder = null;
        let responderId = null;

        // Find responder by username
        for (const [id, responder] of Object.entries(responders)) {
            if (responder && responder.username === username) {
                foundResponder = responder;
                responderId = id;
                break;
            }
        }

        if (!foundResponder) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Check password (support both plaintext and bcrypt hashed)
        let passwordValid = false;
        if (foundResponder.password.startsWith('$2')) {
            // Bcrypt hashed
            passwordValid = await bcrypt.compare(password, foundResponder.password);
        } else {
            // Plaintext (legacy) — upgrade to bcrypt!
            passwordValid = foundResponder.password === password;
        }

        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Update last_login
        await db.ref(`Ridera/authorized_emergency_responder/${responderId}/last_login`).set(Date.now());

        // Store in session
        req.session.user = {
            id: responderId,
            username: foundResponder.username,
            role: foundResponder.role || 'dispatcher',
            agency: foundResponder.agency_name,
            isAdmin: foundResponder.role === 'admin'
        };

        res.json({
            success: true,
            user: req.session.user,
            redirectTo: foundResponder.role === 'admin' ? '/admin.html' : '/index.html'
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout endpoint
app.get('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Logout failed');
        res.redirect('/login.html');
    });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
    if (!req.session.user) {
        return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user: req.session.user });
});

// Responder Dashboard
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin Dashboard
app.get('/admin.html', requireAuth, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).send('Access denied. Admin role required.');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API: Get current user
app.get('/api/user', requireAuth, (req, res) => {
    res.json(req.session.user);
});

// API: Get incidents (responder dashboard still uses this if not direct Firebase)
app.get('/api/incidents', requireAuth, async (req, res) => {
    try {
        const snapshot = await db.ref('Ridera/users').get();
        const users = snapshot.val() || {};
        const incidents = [];

        // Flatten crash_alerts from all users
        Object.entries(users).forEach(([userId, user]) => {
            if (user.crash_alerts) {
                Object.entries(user.crash_alerts).forEach(([crashId, alert]) => {
                    incidents.push({
                        ...alert,
                        userId,
                        crashId,
                        id: crashId
                    });
                });
            }
        });

        // Sort by createdAt descending
        incidents.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        res.json(incidents);
    } catch (err) {
        console.error('Incidents API error:', err);
        res.status(500).json({ error: err.message });
    }
});

// API: Update incident status (responder actions)
app.put('/api/incidents/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
        return res.status(400).json({ error: 'ID and status required' });
    }

    try {
        // Find the incident to get userId and crashId
        const snapshot = await db.ref('Ridera/users').get();
        const users = snapshot.val() || {};

        let found = false;
        for (const [userId, user] of Object.entries(users)) {
            if (user.crash_alerts && user.crash_alerts[id]) {
                const path = `Ridera/users/${userId}/crash_alerts/${id}/incident_status`;
                await db.ref(path).set(status.toLowerCase());
                found = true;
                break;
            }
        }

        if (!found) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        res.json({ success: true, message: 'Status updated' });
    } catch (err) {
        console.error('Status update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// PHONE OTP VERIFICATION (Semaphore SMS — PH provider)
// Used in Add/Edit Responder to prove phone ownership
// ============================================================

// Normalize PH numbers: 09171234567 / +639171234567 / 639171234567 → 639171234567
function normalizePhone(phone) {
    let p = String(phone).replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '63' + p.slice(1);
    if (!p.startsWith('63')) p = '63' + p;
    return p;
}

// SEND PHONE OTP
app.post('/api/send-phone-otp', requireAuth, async (req, res) => {
    // Only admins can trigger OTP (it's an admin-panel feature)
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone required' });
    }

    const normalized = normalizePhone(phone);
    if (!/^639\d{9}$/.test(normalized)) {
        return res.status(400).json({ success: false, message: 'Invalid PH mobile number' });
    }

    const key = normalized;

    // Rate limit: max 1 OTP per number per 60 seconds
    const existing = (await db.ref('otp/phone/' + key).get()).val();
    if (existing && existing.sentAt && Date.now() - existing.sentAt < 60 * 1000) {
        const wait = Math.ceil((60 * 1000 - (Date.now() - existing.sentAt)) / 1000);
        return res.status(429).json({ success: false, message: `Please wait ${wait}s before resending` });
    }

    const otp = generateOtp();

    await db.ref('otp/phone/' + key).set({
        code: otp,
        sentAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0
    });

    try {
        await axios.post(
            'https://api.semaphore.co/api/v4/otp',
            {
                apikey: process.env.SEMAPHORE_API_KEY,
                number: normalized,
                message: 'Your Ridera verification code is {otp}. Valid for 5 minutes.',
                code: otp,
                sendername: process.env.SEMAPHORE_SENDER_NAME || 'RIDERA'
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        console.log('✓ OTP sent to:', normalized);
        return res.json({ success: true, phone: normalized });
    } catch (error) {
        console.log('✗ SEMAPHORE ERROR:', error.response?.data || error.message);
        await db.ref('otp/phone/' + key).remove();
        return res.status(500).json({ success: false, message: 'SMS sending failed. Check Semaphore credits/API key.' });
    }
});

// VERIFY PHONE OTP
app.post('/api/verify-phone-otp', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ verified: false, message: 'Admin only' });
    }

    const { phone, code } = req.body;
    if (!phone || !code) {
        return res.status(400).json({ verified: false, message: 'Phone and code required' });
    }

    const key = normalizePhone(phone);
    const ref = db.ref('otp/phone/' + key);
    const snap = await ref.get();
    const data = snap.val();

    if (!data) {
        return res.json({ verified: false, message: 'No OTP found. Please request a new code.' });
    }

    // Expired
    if (Date.now() > data.expiresAt) {
        await ref.remove();
        return res.json({ verified: false, message: 'OTP expired. Please request a new code.' });
    }

    // Brute-force guard: max 5 wrong attempts
    if ((data.attempts || 0) >= 5) {
        await ref.remove();
        return res.json({ verified: false, message: 'Too many attempts. Please request a new code.' });
    }

    // Wrong code
    if (String(data.code) !== String(code).trim()) {
        await ref.child('attempts').set((data.attempts || 0) + 1);
        return res.json({ verified: false, message: 'Invalid OTP' });
    }

    // Success — consume OTP and mark phone as verified
    await ref.remove();
    await db.ref('otp/verified_phones/' + key).set({
        verifiedAt: Date.now(),
        verifiedBy: req.session.user.username
    });

    return res.json({ verified: true, phone: key });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'Ridera Responder Server' });
});

// 404 fallback
app.use((req, res) => {
    if (req.session.user) {
        // Logged in — redirect to dashboard based on role
        return res.redirect(req.session.user.isAdmin ? '/admin.html' : '/');
    }
    res.redirect('/login.html');
});

// ============================================================
// SOCKET.IO REAL-TIME
// ============================================================

// Attach session middleware to Socket.IO
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on('connection', socket => {
    const user = socket.request.session?.user;

    if (!user) {
        console.log('⚠ Socket connection attempt without auth — disconnecting');
        socket.disconnect(true);
        return;
    }

    console.log(`✓ Socket connected: ${user.username} (${user.role})`);

    // Initial data load
    socket.on('requestInitialData', async () => {
        try {
            const snapshot = await db.ref('Ridera/users').get();
            const users = snapshot.val() || {};
            const incidents = [];

            Object.entries(users).forEach(([userId, user]) => {
                if (user.crash_alerts) {
                    Object.entries(user.crash_alerts).forEach(([crashId, alert]) => {
                        incidents.push({ ...alert, userId, crashId, id: crashId });
                    });
                }
            });

            incidents.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            socket.emit('initialData', incidents);
        } catch (err) {
            console.error('Initial data error:', err);
            socket.emit('error', { message: err.message });
        }
    });

    // Incident status update via Socket
    socket.on('updateIncidentStatus', async (data) => {
        const { incidentId, status } = data;
        if (!incidentId || !status) return;

        try {
            const snapshot = await db.ref('Ridera/users').get();
            const users = snapshot.val() || {};

            for (const [userId, user] of Object.entries(users)) {
                if (user.crash_alerts && user.crash_alerts[incidentId]) {
                    const path = `Ridera/users/${userId}/crash_alerts/${incidentId}/incident_status`;
                    await db.ref(path).set(status.toLowerCase());

                    // Broadcast to all connected clients
                    io.emit('incidentUpdated', { id: incidentId, incident_status: status.toLowerCase() });
                    return;
                }
            }
        } catch (err) {
            socket.emit('error', { message: err.message });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`✗ Socket disconnected: ${user.username}`);
    });
});

// ============================================================
// FIREBASE REAL-TIME LISTENERS (for pushing to all sockets)
// ============================================================

// Listen for new incidents and broadcast
let lastIncidentCount = 0;

db.ref('Ridera/users').on('value', snapshot => {
    const users = snapshot.val() || {};
    let totalIncidents = 0;

    Object.values(users).forEach(user => {
        if (user.crash_alerts) totalIncidents += Object.keys(user.crash_alerts).length;
    });

    // If new incident detected, emit to all sockets
    if (totalIncidents > lastIncidentCount) {
        // Find the new incident(s)
        // (simplified — in production, track which is new more carefully)
        console.log(`📍 New incident detected (total: ${totalIncidents})`);
        io.emit('newIncidentAlert', { totalIncidents });
    }

    lastIncidentCount = totalIncidents;
}, err => {
    console.error('Firebase listener error:', err);
});

// ============================================================
// SERVER START
// ============================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  Ridera Responder Server                               ║
║  Admin Emergency Operations Backend                    ║
║                                                        ║
║  ✓ Server running on port ${PORT}                       ║
║  ✓ Firebase Admin SDK initialized                      ║
║  ✓ Session management enabled                          ║
║  ✓ Socket.IO real-time active                          ║
║                                                        ║
║  Access:                                               ║
║  - Dashboard: http://localhost:${PORT}                  ║
║  - Admin: http://localhost:${PORT}/admin.html           ║
║  - Login: http://localhost:${PORT}/login.html           ║
╚════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n✓ Shutting down gracefully...');
    server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, io };