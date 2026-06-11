/* ============================================================
   RIDERA RESPONDER — SERVER.JS
   Express + Socket.IO server for the responder dashboard.
   Serves static files from /public and provides the Socket.IO
   endpoint referenced by index.html.
   ============================================================ */

'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());

// Serve everything inside /public (index.html, login.html, css, js, audio)
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────

// Dashboard (auth guard sa app.js ang magre-redirect sa login
// kung walang session)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login page (optional pretty URL: /login)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health check — useful para makita kung buhay yung Render service
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Ridera Responder',
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// ── Socket.IO ────────────────────────────────────────────────
// Primary data flow is Firebase RTDB (client-side listeners).
// Socket.IO is kept for backward compatibility and future
// server-pushed events (e.g. direct ESP32 → server → dashboard).
io.on('connection', socket => {
    console.log(`[socket.io] responder connected: ${socket.id}`);

    socket.on('disconnect', reason => {
        console.log(`[socket.io] responder disconnected: ${socket.id} (${reason})`);
    });
});

// ── 404 fallback ─────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).send('Not found');
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`✅ Ridera Responder server running on port ${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}/`);
    console.log(`   Login:     http://localhost:${PORT}/login.html`);
});
