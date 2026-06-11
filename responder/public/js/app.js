/* ============================================================
RIDERA RESPONDER — APP.JS
CDRRMO Dasmariñas Emergency Operations Dashboard
(LOW priority removed — HIGH & MEDIUM only)
============================================================ */

'use strict';

// ============================================================
// AUTH GUARD — must be logged in via login.html
// Session is created by login.html after verifying the account
// against Ridera/authorized_emergency_responder in Firebase.
// Supports both sessionStorage (normal login — clears on browser
// close) and localStorage (Remember Me — valid for 30 days).
// ============================================================
const RESPONDER_SESSION = (() => {
    try {
        const raw =
            sessionStorage.getItem('ridera_responder') ||
            localStorage.getItem('ridera_responder');
        if (!raw) return null;

        const s = JSON.parse(raw);

        // Expired Remember Me session → treat as logged out
        if (s && s.expiresAt && Date.now() > s.expiresAt) {
            sessionStorage.removeItem('ridera_responder');
            localStorage.removeItem('ridera_responder');
            return null;
        }
        return s;
    } catch (e) {
        return null;
    }
})();

if (!RESPONDER_SESSION || !RESPONDER_SESSION.username) {
    window.location.replace('login.html');
    throw new Error('Not authenticated — redirecting to login.');
}

function logoutResponder() {
    const redirect = () => {
        sessionStorage.removeItem('ridera_responder');
        localStorage.removeItem('ridera_responder');
        window.location.replace('login.html');
    };

    // Best effort: mark this responder offline before leaving.
    // (onDisconnect() also covers this server-side as a fallback.)
    try {
        if (firebaseDB && RESPONDER_SESSION.key) {
            firebaseDB
                .ref(`Ridera/authorized_emergency_responder/${RESPONDER_SESSION.key}`)
                .update({
                    is_online: false,
                    last_seen: Date.now()
                })
                .finally(redirect);

            // Safety net in case the write hangs (e.g. no connection)
            setTimeout(redirect, 800);
            return;
        }
    } catch (e) { }

    redirect();
}

// ============================================================
// FIREBASE CONFIG
// Kunin mo ito sa: Firebase Console → Project Settings
//                 → Your apps → SDK setup and configuration
// ============================================================
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDCPjdmPjhjeCWXJnsX_b8HEBlwRrEGZM8",
    authDomain: "ridera-dg7.firebaseapp.com",
    databaseURL: "https://ridera-dg7-default-rtdb.firebaseio.com",
    projectId: "ridera-dg7",
    storageBucket: "ridera-dg7.firebasestorage.app",
    messagingSenderId: "139828355676",
    appId: "1:139828355676:web:fb8de1c261db813130bc99"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}
const firebaseDB = typeof firebase !== 'undefined' ? firebase.database() : null;

// ============================================================
// SOCKET.IO (optional — kept for backward compat / server auth)
// ============================================================
const socket = (typeof io !== 'undefined') ? io() : { on: () => { } };

let incidents = [];
let map = null;
let mapMarkers = [];
let mapPulseTimers = [];   // intervals animating HIGH priority markers
let directionsRenderer = null;
let drawerMapInstance = null;
let drawerMapMarker = null;
let soundEnabled = true;
let alertAudioCtx = null;
let currentDrawerIncidentId = null;

const highAudio = new Audio("audio/ambulance.mp3");
const mediumAudio = new Audio("audio/monitor.mp3");

mediumAudio.preload = "auto";

highAudio.preload = "auto";
highAudio.volume = 1.0;
highAudio.loop = false;

let autoRefreshTimer = null;
let historyPage = 1;
const HISTORY_PER_PAGE = 10;
let historyData = [];

// CDRRMO Station location — update to exact coordinates
const RESPONDER_LOCATION = { lat: 14.332069, lng: 121.033255 };

// Dark map style matching the dashboard theme
const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#13131a' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a9a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0d10' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#26262e' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#32323c' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0d14' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#16161e' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#26262e' }] },
    { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
];

// Single source of truth for message classification (used across nav badges,
// the updates page, and the incident drawer).
const URGENT_WORDS = ['HELP', 'INJURED', 'NEED ASSISTANCE', 'BLEEDING', 'CANNOT MOVE'];
const SAFE_WORDS = ['OKAY', 'SAFE', 'FALSE ALARM', 'OK'];

// ============================================================
// CLOCK
// ============================================================

function updateClock() {
    const now = new Date();
    const dateEl = document.getElementById('headerDate');
    const timeEl = document.getElementById('headerTime');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-PH', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

setInterval(updateClock, 1000);
updateClock();

// Show who's logged in (station name under the brand in the sidebar)
(function showResponderIdentity() {
    const sub = document.querySelector('.brand-sub');
    if (sub) {
        sub.textContent =
            RESPONDER_SESSION.station_name ||
            RESPONDER_SESSION.agency_name ||
            RESPONDER_SESSION.username;
    }
})();

// ============================================================
// PAGE NAVIGATION
// ============================================================

const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const PAGE_IDS = {
    dashboard: 'dashboardPage',
    map: 'mapPage',
    alerts: 'alertsPage',
    history: 'historyPage',
    updates: 'updatesPage',
    settings: 'settingsPage'
};

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const page = item.dataset.page;
        navigateTo(page);
    });
});

// Buttons outside the sidebar that also navigate (e.g. "View all", "Respond now")
document.querySelectorAll('[data-page]:not(.nav-item)').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.page));
});

// Active-alerts priority filter tabs
document.querySelectorAll('#alertFilters .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#alertFilters .filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        alertFilter = tab.dataset.filter || 'ALL';
        renderAlerts(incidents);
    });
});

function navigateTo(page) {
    navItems.forEach(n => n.classList.remove('active'));
    const nav = document.getElementById(`nav-${page}`);
    if (nav) nav.classList.add('active');

    pages.forEach(p => p.classList.remove('active-page'));
    const target = document.getElementById(PAGE_IDS[page]);
    if (target) target.classList.add('active-page');

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    if (page === 'map') {
        setTimeout(() => {
            initMap();
            renderMap(incidents);
            if (map && typeof google !== 'undefined') {
                google.maps.event.trigger(map, 'resize');
                // Fit the view so ALL active incidents are visible
                fitMapToIncidents();
            }
        }, 100);
    }

    if (page === 'history') {
        buildHistory();
    }

    if (page === 'updates') {
        renderUpdates(incidents);
    }
}

// Mobile menu toggle
document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// ============================================================
// TOAST
// ============================================================

function showToast(title, message = '', type = '') {
    const container = document.getElementById('toastContainer');
    const icons = { error: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const icon = icons[type] || 'fa-circle-check';
    const cls = type ? `toast-${type}` : '';

    const toast = document.createElement('div');
    toast.className = `toast ${cls}`;
    toast.innerHTML = `
        <i class="fas ${icon} toast-icon"></i>
        <div class="toast-text">
            <div class="toast-title">${title}</div>
            ${message ? `<div class="toast-msg">${message}</div>` : ''}
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ============================================================
// ALERT SOUND (Web Audio API — no file needed)
// ============================================================

function initAudio() {
    if (alertAudioCtx) return;
    try {
        alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { }
}

// Browsers start the AudioContext "suspended" until a user gesture happens.
// Resume it on the first interaction so the alarm can actually sound.
document.addEventListener('click', () => {
    initAudio();

    if (alertAudioCtx &&
        alertAudioCtx.state === 'suspended') {

        alertAudioCtx.resume()
            .then(() => {
                console.log("Audio unlocked");
            })
            .catch(() => {});
    }

}, { once: true });

function playHighSiren() {

    if (!soundEnabled) return;

    highAudio.currentTime = 0;

    highAudio.play().catch(err => {
        console.log("Audio blocked:", err);
    });
}

function playMediumSound() {

    if (!soundEnabled) return;

    mediumAudio.currentTime = 0;

    mediumAudio.play().catch(err => {
        console.log(err);
    });
}

function playPrioritySound(priority) {

    switch(priority) {

        case "HIGH":
            playHighSiren();
            break;

        case "MEDIUM":
            playMediumSound();
            break;
    }
}

function playAlertSound() {
    if (!soundEnabled) return;
    const audio = document.getElementById('alertSound');
    if (audio && audio.src && !audio.src.includes('audio/ambulance.mp3')) {
        audio.play().catch(() => { });
        return;
    }
    // Fallback: synthesize alert tone via Web Audio API
    initAudio();
    if (!alertAudioCtx) return;
    try {
        const osc = alertAudioCtx.createOscillator();
        const gain = alertAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(alertAudioCtx.destination);
        osc.frequency.setValueAtTime(880, alertAudioCtx.currentTime);
        osc.frequency.setValueAtTime(660, alertAudioCtx.currentTime + 0.15);
        osc.frequency.setValueAtTime(880, alertAudioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.4, alertAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, alertAudioCtx.currentTime + 0.6);
        osc.start(alertAudioCtx.currentTime);
        osc.stop(alertAudioCtx.currentTime + 0.6);
    } catch (e) { }
}

let soundLoopInterval = null;
let mediumLoopInterval = null;

function startSoundLoop() {

    if (!soundEnabled) return;

    playHighSiren();

    if (!soundLoopInterval) {

        soundLoopInterval = setInterval(() => {

            playHighSiren();

        }, 16000);
    }
}

function stopSoundLoop() {

    if (soundLoopInterval) {
        clearInterval(soundLoopInterval);
        soundLoopInterval = null;
    }

    highAudio.pause();
    highAudio.currentTime = 0;
}

function startMediumLoop() {

    if (!soundEnabled) return;

    playMediumSound();

    if (!mediumLoopInterval) {

        mediumLoopInterval = setInterval(() => {

            playMediumSound();

        }, 3000);

    }
}

function stopMediumLoop() {

    if (mediumLoopInterval) {

        clearInterval(mediumLoopInterval);

        mediumLoopInterval = null;
    }

    mediumAudio.pause();
    mediumAudio.currentTime = 0;
}

// ============================================================
// FETCH INCIDENTS
// ============================================================

// Guarantee priority/status are always valid uppercase strings so every
// downstream `.toLowerCase()` call is safe and one bad record can't blank
// out the whole dashboard.
function normalizeIncident(raw) {
    const inc = { ...raw };
    if (!inc || typeof inc !== 'object') return inc;

    // ── Keep Firebase path keys for updates ──────────────────
    inc._userId = inc.userId || inc._userId;
    inc._crashId = inc.crashId || inc._crashId;

    // ── ID ────────────────────────────────────────────────────
    if (!inc.id) inc.id = inc.crashId || inc._crashId;

    // ── Rider info ───────────────────────────────────────────
    if (!inc.riderName) inc.riderName = inc.name || '—';

    // ── Emergency Contacts ───────────────────────────────────
    inc.contacts = [];

    if (inc.alert_contacts) {

        inc.contacts = Object.values(
            inc.alert_contacts
        );

    }

    // ── Vehicle ──────────────────────────────────────────────
    if (!inc.vehicle) inc.vehicle = inc.vehicle_model || '—';
    if (!inc.vehicleType) inc.vehicleType = inc.vehicle_type || '—';
    if (!inc.plateNumber) inc.plateNumber = inc.vehicle_plate || '—';

    // ── Location ─────────────────────────────────────────────
    if (!inc.lat && inc.latitude) inc.lat = inc.latitude;
    if (!inc.lng && inc.longitude) inc.lng = inc.longitude;

    // ── Timestamp ─────────────────────────────────────────────
    // Firebase `time` field is a time-only string ("12:44:09").
    // Use `createdAt` (ms timestamp) for all time calculations.
    // Crash time
    inc.reportedTime =
        inc.createdAt ||
        inc.time ||
        null;

    // Last rider update time
    inc.updateTime =
        inc.updatedAt ||
        inc.createdAt ||
        inc.time ||
        null;

    // Backward compatibility
    inc.time = inc.reportedTime;

    // ── Message / rider note ─────────────────────────────────
    if (!inc.message) inc.message = inc.rider_note || '';
    inc.riderStatus = (inc.rider_status || '').toUpperCase();

    // ── Priority ─────────────────────────────────────────────
    inc.priority = (inc.priority || 'LOW').toUpperCase();

    // ── Status mapping ────────────────────────────────────────
    // Firebase uses lowercase incident_status values.
    // Dashboard uses uppercase workflow statuses.
    const statusMap = {
        active: 'ACTIVE',
        acknowledged: 'ACKNOWLEDGED',
        dispatched: 'DISPATCHED',
        arrived: 'ARRIVED',
        safe: 'SAFE',
        resolved: 'RESOLVED'
    };
    if (!inc.status) {
        inc.status = statusMap[(inc.incident_status || 'active').toLowerCase()] || 'ACTIVE';
    }
    inc.status = inc.status.toUpperCase();

    // ── Severity — Firebase stores lowercase ─────────────────
    if (inc.severity) {
        inc.severity = inc.severity.charAt(0).toUpperCase() + inc.severity.slice(1).toLowerCase();
    }

    // ── Crash type display ───────────────────────────────────
    if (!inc.type || inc.type === 'motorcycle_crash') inc.type = 'Motorcycle Crash';
    if (!inc.type || inc.type === 'motorcycle_fall') inc.type = 'Motorcycle Fall';
    if (!inc.type || inc.type === 'stationary_impact') inc.type = 'Stationary Impact';

    // ── Speed ────────────────────────────────────────────────
    if (inc.speed === undefined || inc.speed === null) inc.speed = 0;

    // ── Alarm pattern label ──────────────────────────────────
    if (!inc.alarmLabel && inc.alarm_type) {
        inc.alarmLabel = inc.alarm_type === 'repeating' ? 'Sustained Impact' : 'Single Impact';
    }

    // ── Convert updates object → sorted array ────────────────
    if (inc.updates && typeof inc.updates === 'object' && !Array.isArray(inc.updates)) {
        inc._updates = Object.values(inc.updates).sort((a, b) => (a.time || 0) - (b.time || 0));
    } else if (Array.isArray(inc.updates)) {
        inc._updates = inc.updates;
    } else {
        inc._updates = [];
    }
    if (inc._updates.length === 0 && inc.message) {
        inc._updates = [{ message: inc.message, time: inc.time }];
    }

    return inc;
}

// ============================================================
// FIREBASE REAL-TIME LISTENER
// ============================================================

function listenToIncidents() {
    if (!firebaseDB) {
        showToast('Firebase Error', 'Firebase SDK not loaded.', 'error');
        return;
    }

    const usersRef = firebaseDB.ref('Ridera/users');

    usersRef.on('value', snapshot => {
        const data = snapshot.val();
        if (!data) { incidents = []; renderAll(incidents); return; }

        // Flatten crash_alerts from all users into a single array
        const allIncidents = [];
        Object.entries(data).forEach(([userId, user]) => {

            if (!user.crash_alerts) return;

            Object.entries(user.crash_alerts).forEach(([crashId, alert]) => {

                allIncidents.push({
                    ...alert,
                    userId,
                    crashId,
                    alert_contacts: user.alert_contacts || {}
                });

            });

        });

        // Detect genuinely new HIGH incidents to play alarm
        const prevIds = new Set(incidents.map(i => i.id));

        // LOW priority is excluded entirely — only HIGH & MEDIUM remain.
        incidents = allIncidents
            .map(normalizeIncident)
            .filter(inc => inc.priority !== 'LOW');

        incidents.sort((a, b) => (b.time || 0) - (a.time || 0));

        incidents.forEach(inc => {
            if (
                !prevIds.has(inc.id) &&
                inc.status === "ACTIVE"
            ) {

                showToast(
                    `${priorityLabel(inc.priority)} PRIORITY`,
                    `${inc.riderName} — ${inc.type}`
                );

                const hasActiveHigh = incidents.some(
                    i => i.priority === "HIGH" &&
                        i.status === "ACTIVE"
                );

                if (hasActiveHigh) {

                    if (inc.priority === "HIGH") {
                        playHighSiren();
                    }

                } else {

                    playPrioritySound(inc.priority);

                }
            }

        });

        renderAll(incidents);

    }, error => {
        showToast('Firebase Error', error.message, 'error');
        setConnectionStatus(false);
    });

    // Firebase connection status → System Status indicator
    firebaseDB.ref('.info/connected').on('value', snap => {
        setConnectionStatus(snap.val() === true);
    });
}

function setConnectionStatus(online) {
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    if (online) {
        badge.className = 'status-badge online';
        badge.innerHTML = '<span class="status-dot"></span><span>ONLINE</span>';
    } else {
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span class="status-dot" style="background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.18);"></span><span>OFFLINE</span>';
    }
}

// Kept for compatibility — Firebase listener replaces HTTP polling
async function loadIncidents() {
    // No-op: Firebase onValue handles all data loading and real-time updates.
    // Called in some places (e.g. after updateStatus) but Firebase will
    // re-fire onValue automatically whenever data changes.
}

function renderAll(data) {
    updateHeaderCounters(data);
    renderDashboard(data);
    renderAlerts(data);
    updateNavBadges(data);
    checkHighPriorityBanner(data);
    if (document.getElementById('mapPage').classList.contains('active-page')) {
        renderMap(data);
        fitMapToIncidents();
    }
    if (document.getElementById('updatesPage').classList.contains('active-page')) {
        renderUpdates(data);
    }
    if (currentDrawerIncidentId) {
        const updated = data.find(
            i => i.id === currentDrawerIncidentId
        );

        if (updated) {

            document.getElementById(
                'drawerContent'
            ).innerHTML = buildDrawerContent(updated);

            setupWorkflowButtons(updated);

            setTimeout(() => {

                initDrawerMap(updated);

            }, 100);
        }
    }
}

// ============================================================
// HEADER COUNTERS
// ============================================================

function updateHeaderCounters(data) {
    const active = data.filter(i => i.status !== 'RESOLVED' && i.status !== 'SAFE');
    const high = active.filter(i => i.priority === 'HIGH').length;
    const medium = active.filter(i => i.priority === 'MEDIUM').length;

    setEl('highCount', high);
    setEl('mediumCount', medium);
}

function updateNavBadges(data) {
    const active = data.filter(i => i.status !== 'RESOLVED' && i.status !== 'SAFE');
    const badge = document.getElementById('alertsBadge');
    if (badge) {
        if (active.length > 0) { badge.style.display = 'inline-block'; badge.textContent = active.length; }
        else { badge.style.display = 'none'; }
    }

    // Urgent updates
    const updateCount = data.filter(i =>
        (i.message && i.message.trim()) ||
        (i.riderStatus && i.riderStatus.trim())
    ).length;

    const ubadge = document.getElementById('updatesBadge');

    if (ubadge) {
        if (updateCount > 0) {
            ubadge.style.display = 'inline-block';
            ubadge.textContent = updateCount;
        } else {
            ubadge.style.display = 'none';
        }
    }
}

// ============================================================
// HIGH PRIORITY BANNER
// ============================================================

function checkHighPriorityBanner(data) {

    const activeHigh = data.some(
        i => i.priority === "HIGH" &&
            i.status === "ACTIVE"
    );

    const activeMedium = data.some(
        i => i.priority === "MEDIUM" &&
            i.status === "ACTIVE"
    );

    const banner = document.getElementById('highBanner');
    const highCard = document.getElementById('dashHighCard');

    if (activeHigh) {

        if (banner) banner.style.display = 'flex';
        if (highCard) highCard.classList.add('flashing');

        stopMediumLoop();
        startSoundLoop();

    } else {

        stopSoundLoop();

        if (banner) banner.style.display = 'none';
        if (highCard) highCard.classList.remove('flashing');

        if (activeMedium) {
            startMediumLoop();
        } else {
            stopMediumLoop();
        }
    }
}

// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard(data) {
    const active = data.filter(i => i.status !== 'RESOLVED' && i.status !== 'SAFE');
    const high = active.filter(i => i.priority === 'HIGH').length;
    const medium = active.filter(i => i.priority === 'MEDIUM').length;
    const resolved = data.filter(i => i.status === 'RESOLVED').length;

    setEl('dashboardHigh', high);
    setEl('dashboardMedium', medium);
    setEl('statTotalToday', data.length);
    setEl('statActive', active.length);
    setEl('statResolved', resolved);
    //setEl('statAvgResponse', active.length > 0 ? '—' : (resolved > 0 ? '~6 min' : '—'));
    setEl('activeIncidentCount', `${active.length} Active`);
    setEl('statUnackedHigh', active.filter(i => i.priority === 'HIGH' && i.status === 'ACTIVE').length);

    // Recent alerts list (sorted: high first, then newest)
    const container = document.getElementById('recentAlerts');
    container.innerHTML = '';

    if (active.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shield-check"></i>
                <p>No active incidents</p>
            </div>`;
        return;
    }

    const sorted = [...active].sort((a, b) => {
        const pMap = { HIGH: 3, MEDIUM: 2 };
        return (pMap[b.priority] || 0) - (pMap[a.priority] || 0);
    });

    sorted.forEach(inc => {
        const colorMap = { HIGH: 'var(--high)', MEDIUM: 'var(--medium)' };
        const color = colorMap[inc.priority] || 'var(--medium)';
        const row = document.createElement('div');
        row.className = 'incident-row';
        row.innerHTML = `
            <div class="incident-row-priority" style="background:${color};"></div>
            <div class="incident-row-info">
                <div class="incident-row-name">${esc(inc.riderName)}</div>
                <div class="incident-row-meta">${esc(inc.type)} · ${esc(inc.vehicle || inc.vehicleType || '')} · ${inc.speed} km/h</div>
            </div>
            <div class="incident-row-right">
                <span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">${priorityLabel(inc.priority)}</span>
                <span class="status-tag status-${inc.status.toLowerCase()}">${formatStatus(inc.status)}</span>
            </div>
        `;
        row.addEventListener('click', () => showDetails(inc.id));
        container.appendChild(row);
    });
}

// ============================================================
// ACTIVE ALERTS PAGE
// ============================================================

let alertFilter = 'ALL';

function renderAlerts(data) {
    const container = document.getElementById('alertsContainer');
    container.innerHTML = '';

    let active = data.filter(i => i.status !== 'RESOLVED' && i.status !== 'SAFE');
    setEl('alertsActiveCount', active.length);

    if (alertFilter !== 'ALL') {
        active = active.filter(i => i.priority === alertFilter);
    }

    if (active.length === 0) {
        container.innerHTML = `
            <div class="empty-state full-width">
                <i class="fas fa-shield-check"></i>
                <p>No active incidents at this time</p>
            </div>`;
        return;
    }

    const groups = { HIGH: [], MEDIUM: [] };
    active.forEach(i => { if (groups[i.priority]) groups[i.priority].push(i); });

    Object.entries(groups).forEach(([priority, items]) => {
        if (items.length === 0) return;

        // Group label
        const labelColors = { HIGH: 'var(--high)', MEDIUM: 'var(--medium)' };
        const label = document.createElement('div');
        label.className = 'priority-group-label';
        label.style.color = labelColors[priority];
        label.innerHTML = `<i class="fas fa-circle" style="font-size:8px;"></i> ${priorityLabel(priority)} PRIORITY (${items.length})`;
        container.appendChild(label);

        // Sort newest first within group
        items.sort((a, b) => new Date(b.time) - new Date(a.time));

        items.forEach(inc => {
            const card = buildAlertCard(inc);
            container.appendChild(card);
        });
    });
}

function buildAlertCard(inc) {
    const card = document.createElement('div');
    card.className = `alert-card priority-${(inc.priority || 'MEDIUM').toLowerCase()}`;
    card.innerHTML = `
        <div class="alert-card-header">
            <div class="alert-card-title">
                <span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">
                    <i class="fas fa-circle-exclamation"></i> ${priorityLabel(inc.priority)}
                </span>
                <div class="alert-card-type">
                    <i class="fas fa-motorcycle" style="color:var(--text-muted);font-size:13px;margin-right:6px;"></i>
                    ${esc(inc.type)}
                </div>
            </div>
            <span class="status-tag status-${inc.status.toLowerCase()}">${formatStatus(inc.status)}</span>
        </div>

        <div class="alert-card-body">
            <div class="alert-data-row">
                <span class="alert-data-label">Rider Name</span>
                <span class="alert-data-value">${esc(inc.riderName)}</span>
            </div>
            <div class="alert-data-row">
                <span class="alert-data-label">Contact</span>
                <span class="alert-data-value">${esc(inc.phone || '—')}</span>
            </div>
            <div class="alert-data-row">
                <span class="alert-data-label">Rider Status</span>

                <span class="alert-data-value">

                    ${
                        inc.riderStatus === "HELP"
                            ? '<span class="badge badge-high">HELP</span>'
                            : inc.riderStatus === "SAFE"
                            ? '<span class="badge badge-low">SAFE</span>'
                            : 'No Response'
                    }

                </span>
            </div>
            <div class="alert-data-row">
                <span class="alert-data-label">Vehicle</span>
                <span class="alert-data-value">${esc(inc.vehicle || inc.vehicleType || '—')}</span>
            </div>
            <div class="alert-data-row">
                <span class="alert-data-label">Plate Number</span>
                <span class="alert-data-value">${esc(inc.plateNumber || '—')}</span>
            </div>
            <div class="alert-data-row">
                <span class="alert-data-label">Speed</span>
                <span class="alert-data-value" style="color:${speedColor(inc.speed)};">
                    ${inc.speed} km/h
                </span>
            </div>
            <div class="alert-data-row">
                <span class="alert-data-label">Severity</span>
                <span class="alert-data-value">${esc(inc.severity || '—')}</span>
            </div>
        </div>

        <div class="alert-card-footer">
            <span class="alert-time">
                <i class="fas fa-clock"></i> ${formatTime(inc.time)}
            </span>
            <button class="view-details-btn" data-id="${esc(inc.id)}">
                <i class="fas fa-eye"></i> View Details
            </button>
        </div>
    `;

    card.querySelector('.view-details-btn').addEventListener('click', () => showDetails(inc.id));
    return card;
}

// ============================================================
// LIVE MAP
// ============================================================

function initMap() {
    if (map) return;
    if (typeof google === 'undefined') {
        // Google Maps SDK not yet loaded — retry shortly
        setTimeout(initMap, 400);
        return;
    }

    const isDark = !document.body.classList.contains('light-mode');

    map = new google.maps.Map(document.getElementById('map'), {
        center: RESPONDER_LOCATION,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: isDark ? DARK_MAP_STYLE : []
    });

    // Route renderer (CDRRMO station → incident) — was never
    // initialized before, so showRoute() silently did nothing.
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: true,   // keep our own incident markers
        preserveViewport: true,  // don't fight fitBounds
        polylineOptions: {
            strokeColor: '#3b82f6',
            strokeOpacity: 0.85,
            strokeWeight: 5
        }
    });
}

// Fit the map so the CDRRMO station + ALL active incidents are visible.
function fitMapToIncidents() {
    if (!map || typeof google === 'undefined') return;

    const active = incidents.filter(i =>
        i.status !== 'RESOLVED' &&
        i.status !== 'SAFE' &&
        i.lat && i.lng
    );

    if (active.length === 0) {
        map.setCenter(RESPONDER_LOCATION);
        map.setZoom(14);
        return;
    }

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(RESPONDER_LOCATION);
    active.forEach(i => bounds.extend({ lat: Number(i.lat), lng: Number(i.lng) }));

    map.fitBounds(bounds, 70); // 70px padding so markers don't hug the edge

    // Don't over-zoom when there's only 1 nearby incident
    google.maps.event.addListenerOnce(map, 'idle', () => {
        if (map.getZoom() > 16) map.setZoom(16);
    });
}

function clearMapPulses() {
    mapPulseTimers.forEach(t => clearInterval(t));
    mapPulseTimers = [];
}

function renderMap(data) {
    initMap();
    if (!map || typeof google === 'undefined') return;

    // Clear previous markers/circles + pulse animations
    clearMapPulses();
    mapMarkers.forEach(m => m.setMap(null));
    mapMarkers = [];

    const active = data.filter(i => i.status !== 'RESOLVED' && i.status !== 'SAFE');

    active.forEach(inc => {
        if (!inc.lat || !inc.lng) return;

        const pos = { lat: Number(inc.lat), lng: Number(inc.lng) };
        const isHigh = inc.priority === 'HIGH';
        const colorMap = { HIGH: '#ef4444', MEDIUM: '#f59e0b' };
        const color = colorMap[inc.priority] || '#f59e0b';

        // Main colored circle marker
        const marker = new google.maps.Marker({
            position: pos,
            map: map,
            title: inc.riderName,
            zIndex: isHigh ? 10 : 5,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 13,
                fillColor: color,
                fillOpacity: 0.95,
                strokeColor: '#ffffff',
                strokeWeight: 2.5
            }
        });

        // ── HIGH priority: animated pulsing ring + blinking marker ──
        if (isHigh) {
            const ring = new google.maps.Circle({
                center: pos,
                radius: 30,
                map: map,
                strokeColor: '#ef4444',
                strokeOpacity: 0.6,
                strokeWeight: 2,
                fillColor: '#ef4444',
                fillOpacity: 0.12,
                clickable: false
            });
            mapMarkers.push(ring);

            let radius = 30;
            let tick = 0;

            const timer = setInterval(() => {
                // Expanding + fading ring (sonar/radar effect)
                radius += 6;
                if (radius > 150) radius = 30;

                const progress = (radius - 30) / 120; // 0 → 1
                ring.setRadius(radius);
                ring.setOptions({
                    strokeOpacity: Math.max(0, 0.6 * (1 - progress)),
                    fillOpacity: Math.max(0, 0.12 * (1 - progress))
                });

                // Blink the marker itself every ~0.5s
                tick++;
                if (tick % 8 === 0) {
                    const icon = marker.getIcon();
                    const dim = icon.fillOpacity < 0.9;
                    marker.setIcon({
                        ...icon,
                        fillOpacity: dim ? 0.95 : 0.35,
                        scale: dim ? 13 : 15
                    });
                }
            }, 60);

            mapPulseTimers.push(timer);
        }

        // InfoWindow with full incident details
        const infoWindow = new google.maps.InfoWindow({
            content: buildMapPopup(inc),
            maxWidth: 300
        });

        marker.addListener('click', () => {
            // Close any other open info windows
            mapMarkers.forEach(m => { if (m._iw && m._iw !== infoWindow) m._iw.close(); });
            infoWindow.open({ anchor: marker, map });

            // Wire the "View Full Incident" button + show route once DOM is ready
            google.maps.event.addListenerOnce(infoWindow, 'domready', () => {
                const iwRoot = document.querySelector('.gm-style-iw-d');
                const btn = iwRoot && iwRoot.querySelector('.map-popup-btn');
                if (btn) btn.onclick = () => showDetails(inc.id);

                // Show driving route from CDRRMO station to this incident
                showRoute(inc);
            });
        });

        marker._iw = infoWindow;
        mapMarkers.push(marker);
    });

    renderMapList(active);
}

function showRoute(inc) {
    if (!directionsRenderer || !inc.lat || !inc.lng || typeof google === 'undefined') return;

    new google.maps.DirectionsService().route({
        origin: RESPONDER_LOCATION,
        destination: { lat: Number(inc.lat), lng: Number(inc.lng) },
        travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
        }
    });
}

function renderMapList(active) {
    const list = document.getElementById('mapIncidentList');
    if (!list) return;
    list.innerHTML = '';

    if (active.length === 0) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-shield-check"></i><p>No active incidents</p></div>`;
        return;
    }

    const pMap = { HIGH: 3, MEDIUM: 2 };
    [...active].sort((a, b) => (pMap[b.priority] || 0) - (pMap[a.priority] || 0)).forEach(inc => {
        const item = document.createElement('div');
        item.className = `map-list-item mli-${(inc.priority || 'MEDIUM').toLowerCase()}`;
        item.innerHTML = `
            <div class="map-list-top">
                <span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">${priorityLabel(inc.priority)}</span>
                <span class="map-list-name">${esc(inc.riderName)}</span>
            </div>
            <div class="map-list-meta">${esc(inc.type)} · ${inc.speed} km/h · ${timeAgo(inc.time)}</div>
        `;
        item.addEventListener('click', () => {
            // Center the map on this incident when clicked from the list
            if (map && inc.lat && inc.lng) {
                map.panTo({ lat: Number(inc.lat), lng: Number(inc.lng) });
                if (map.getZoom() < 15) map.setZoom(15);
            }
            showDetails(inc.id);
        });
        list.appendChild(item);
    });
}

function buildMapPopup(inc) {
    return `
        <div class="map-popup">
            <div class="map-popup-header">
                <span class="map-popup-name">${esc(inc.riderName)}</span>
                <span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">${priorityLabel(inc.priority)}</span>
            </div>
            <div class="map-popup-grid">
                <div class="map-popup-item">
                    <label>Phone</label>
                    <span>${esc(inc.phone || '—')}</span>
                </div>
                <div class="map-popup-item">
                    <label>Vehicle</label>
                    <span>${esc(inc.vehicle || '—')}</span>
                </div>
                <div class="map-popup-item">
                    <label>Plate</label>
                    <span>${esc(inc.plateNumber || '—')}</span>
                </div>
                <div class="map-popup-item">
                    <label>Speed</label>
                    <span style="color:${speedColor(inc.speed)};">${inc.speed} km/h</span>
                </div>
                <div class="map-popup-item">
                    <label>Severity</label>
                    <span>${esc(inc.severity || '—')}</span>
                </div>
                <div class="map-popup-item">
                    <label>Status</label>
                    <span>${formatStatus(inc.status)}</span>
                </div>
            </div>
            ${inc.message ? `<p style="font-size:12px;color:#aaa;margin-bottom:10px;"><i class="fas fa-comment"></i> ${esc(inc.message)}</p>` : ''}
            <button class="map-popup-btn" data-id="${esc(inc.id)}">
                <i class="fas fa-file-medical"></i> View Full Incident
            </button>
        </div>
    `;
}

// ============================================================
// RIDER UPDATES PAGE
// ============================================================

function renderUpdates(data) {
    const container = document.getElementById('updatesContainer');
    container.innerHTML = '';

    const withMessages = data.filter(i =>
        (i.message && i.message.trim()) ||
        (i.riderStatus && i.riderStatus.trim())
    );

    if (withMessages.length === 0) {
        container.innerHTML = `
            <div class="empty-state full-width">
                <i class="fas fa-comment-slash"></i>
                <p>No rider updates yet</p>
            </div>`;
        return;
    }

    // Urgents first
    const urgents = withMessages.filter(i => URGENT_WORDS.some(w => i.message.toUpperCase().includes(w)));
    const safes = withMessages.filter(i => !urgents.includes(i) && SAFE_WORDS.some(w => i.message.toUpperCase().includes(w)));
    const others = withMessages.filter(i => !urgents.includes(i) && !safes.includes(i));

    const sorted = [...urgents, ...others, ...safes];

    sorted.forEach(inc => {
        const isUrgent =
            inc.riderStatus === "HELP" ||
            URGENT_WORDS.some(w =>
                (inc.message || '').toUpperCase().includes(w)
            );

        const isSafe =
            inc.riderStatus === "SAFE" ||
            SAFE_WORDS.some(w =>
                (inc.message || '').toUpperCase().includes(w)
            );
        const cls = isUrgent ? 'urgent' : isSafe ? 'safe' : '';
        const icon = isUrgent ? 'fa-circle-exclamation' : isSafe ? 'fa-circle-check' : 'fa-comment';
        const iconColor = isUrgent ? 'var(--high)' : isSafe ? 'var(--low)' : 'var(--text-muted)';

        const card = document.createElement('div');
        card.className = `update-card ${cls}`;
        card.innerHTML = `
            <div class="update-card-header">
                <div>
                    <div class="update-rider-name">
                        ${esc(inc.riderName)}

                        ${
                            inc.riderStatus === "HELP"
                            ? '<span class="badge badge-high">HELP</span>'
                            : inc.riderStatus === "SAFE"
                            ? '<span class="badge badge-low">SAFE</span>'
                            : ''
                        }
                    </div>
                    <div class="update-incident-meta">${esc(inc.type)} · <span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">${priorityLabel(inc.priority)}</span></div>
                </div>
                <i class="fas ${icon}" style="color:${iconColor}; font-size:20px;"></i>
            </div>
            <div class="update-message">
                <i class="fas fa-walkie-talkie" style="color:${iconColor};"></i>
                ${esc(inc.message)}
            </div>
            <div class="update-timestamp">
                <i class="fas fa-clock"></i> ${formatTime(inc.updateTime)}
            </div>
        `;
        card.addEventListener('click', () => showDetails(inc.id));
        container.appendChild(card);
    });
}

// ============================================================
// ALERT HISTORY PAGE
// ============================================================

function buildHistory() {
    // Separate resolved incidents
    historyData = incidents.filter(
        i =>
            i.status === 'RESOLVED' ||
            i.status === 'SAFE'
    );

    applyHistoryFilters();
}

function applyHistoryFilters() {
    const search = document.getElementById('historySearch').value.toLowerCase();
    const priority = document.getElementById('filterPriority').value;
    const type = document.getElementById('filterType').value;

    let filtered = historyData.filter(i => {
        const name = (i.riderName || '').toLowerCase();
        const itype = (i.type || '').toLowerCase();
        if (search && !name.includes(search) && !itype.includes(search)) return false;
        if (priority && i.priority !== priority) return false;
        if (type && i.type !== type) return false;
        return true;
    });

    renderHistoryTable(filtered);
}

function renderHistoryTable(data) {
    const body = document.getElementById('historyBody');
    body.innerHTML = '';

    if (data.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="empty-row"><i class="fas fa-inbox"></i> No records found</td></tr>`;
        renderHistoryPagination(0);
        return;
    }

    const start = (historyPage - 1) * HISTORY_PER_PAGE;
    const end = start + HISTORY_PER_PAGE;
    const paginated = data.slice(start, end);

    paginated.forEach(inc => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatTime(inc.time)}</td>
            <td><strong>${esc(inc.riderName)}</strong></td>
            <td>${esc(inc.type)}</td>
            <td><span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">${priorityLabel(inc.priority)}</span></td>
            <td>
                <span class="status-tag ${
                    inc.status === 'SAFE'
                        ? 'status-safe'
                        : 'status-resolved'
                }">
                    ${
                        inc.status === 'SAFE'
                            ? 'Marked Safe'
                            : 'Resolved'
                    }
                </span>
            </td>
            <td><button class="table-action-btn" data-id="${esc(inc.id)}"><i class="fas fa-eye"></i> View</button></td>
        `;
        tr.querySelector('.table-action-btn').addEventListener('click', () => showDetails(inc.id));
        body.appendChild(tr);
    });

    renderHistoryPagination(data.length);
}

function renderHistoryPagination(total) {
    const container = document.getElementById('historyPagination');
    container.innerHTML = '';
    const pages = Math.ceil(total / HISTORY_PER_PAGE);
    if (pages <= 1) return;

    for (let i = 1; i <= pages; i++) {
        const btn = document.createElement('button');
        btn.className = `page-btn${i === historyPage ? ' active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => { historyPage = i; applyHistoryFilters(); });
        container.appendChild(btn);
    }
}

// History filter listeners
document.getElementById('historySearch').addEventListener('input', () => { historyPage = 1; applyHistoryFilters(); });
document.getElementById('filterPriority').addEventListener('change', () => { historyPage = 1; applyHistoryFilters(); });
document.getElementById('filterType').addEventListener('change', () => { historyPage = 1; applyHistoryFilters(); });

// ============================================================
// INCIDENT DETAILS DRAWER
// ============================================================

window.showDetails = function (id) {
    currentDrawerIncidentId = id;
    const inc = incidents.find(i => i.id === id);
    if (!inc) { showToast('Not Found', 'Incident not found.', 'error'); return; }

    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawerOverlay');
    const content = document.getElementById('drawerContent');

    content.innerHTML = buildDrawerContent(inc);
    drawer.classList.add('show');
    overlay.classList.add('show');

    // Setup workflow buttons
    setupWorkflowButtons(inc);

    // Mini map in drawer
    setTimeout(() => initDrawerMap(inc), 200);
};

function buildDrawerContent(inc) {
    const statusOrder = ['ACTIVE', 'ACKNOWLEDGED', 'DISPATCHED', 'ARRIVED', 'RESOLVED'];
    const currentIdx =
        inc.status === 'SAFE'
            ? statusOrder.length
            : statusOrder.indexOf(inc.status);

    const stepsHtml = statusOrder.map((s, i) => {
        const done = i < currentIdx;
        const current = i === currentIdx;
        const icons = ['fa-bell', 'fa-thumbs-up', 'fa-truck-fast', 'fa-location-dot', 'fa-circle-check'];
        const connector = i < statusOrder.length - 1
            ? `<div class="step-connector${done ? ' done' : ''}"></div>`
            : '';
        return `
            <div class="workflow-step">
                <div class="step-circle${done ? ' done' : current ? ' current' : ''}">
                    <i class="fas ${icons[i]}"></i>
                </div>
                <span class="step-label">${s.charAt(0) + s.slice(1).toLowerCase()}</span>
            </div>
            ${connector}
        `;
    }).join('');

    const riderReportedSafe =
        inc.riderStatus === "SAFE" ||
        (
            inc.message &&
            SAFE_WORDS.some(w =>
                inc.message.toUpperCase().includes(w)
            )
        );

    const actionBtn = buildWorkflowActionBtn(inc);

    const safeBadge =
        inc.status === "SAFE"
            ? `
                <div style="
                    margin-bottom:16px;
                    padding:12px;
                    border-radius:10px;
                    background:rgba(34,197,94,.12);
                    border:1px solid rgba(34,197,94,.35);
                    color:#22c55e;
                    font-weight:600;
                ">
                    <i class="fas fa-shield-check"></i>
                    Rider Reported Safe
                </div>
            `
            : '';

    const msgClass = inc.message
        ? (URGENT_WORDS.some(w => (inc.message || '').toUpperCase().includes(w)) ? 'urgent'
            : SAFE_WORDS.some(w => (inc.message || '').toUpperCase().includes(w)) ? 'safe' : '')
        : '';

    const contactsHtml =
        inc.contacts?.length
            ? inc.contacts.map((contact, index) => `

                <div class="drawer-field">
                    <div class="drawer-field-label">
                        Contact ${index + 1}
                    </div>
                    <div class="drawer-field-value">
                        ${esc(contact.contact_name)}
                    </div>
                </div>

                <div class="drawer-field">
                    <div class="drawer-field-label">
                        Relationship
                    </div>
                    <div class="drawer-field-value">
                        ${esc(contact.contact_relationship)}
                    </div>
                </div>

                <div class="drawer-field">
                    <div class="drawer-field-label">
                        Phone Number
                    </div>
                    <div class="drawer-field-value">
                        ${esc(contact.contact_phone)}
                    </div>
                </div>
            `).join('')

            : `
                <div class="drawer-field">
                    <div class="drawer-field-label">
                        Status
                    </div>
                    <div class="drawer-field-value">
                        No emergency contacts available
                    </div>
                </div>
            `;

    const riderStatusBadge =
        inc.riderStatus === "HELP"
            ? '<span class="badge badge-high">HELP REQUESTED</span>'
            : inc.riderStatus === "SAFE"
            ? '<span class="badge badge-low">SAFE</span>'
            : '<span class="badge">NO RESPONSE</span>';

    const timelineHtml = `
        <div class="timeline">

            <div class="timeline-item">

                <div class="timeline-content">

                    <div style="margin-bottom:10px;">
                        <strong>Rider Status:</strong>
                        ${riderStatusBadge}
                    </div>

                    ${
                        inc.message
                            ? `
                                <div class="timeline-message">
                                    ${esc(inc.message)}
                                </div>
                            `
                            : `
                                <div class="timeline-message">
                                    No rider notes available.
                                </div>
                            `
                    }

                    <div class="timeline-time">
                        <i class="fas fa-clock"></i>
                        ${formatTime(inc.updateTime)}
                    </div>

                </div>

            </div>

        </div>
    `;

    return `
        <!-- Title header -->
        <div class="drawer-title">
            <span class="badge badge-${(inc.priority || 'MEDIUM').toLowerCase()}">${priorityLabel(inc.priority)}</span>
            <span>${esc(inc.id)} · ${esc(inc.type)}</span>
        </div>

        <!-- Rider Information -->
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-user"></i> Rider Information</div>
            <div class="drawer-fields">
                <div class="drawer-field">
                    <div class="drawer-field-label">Full Name</div>
                    <div class="drawer-field-value">${esc(inc.riderName)}</div>
                </div>
                <div class="drawer-field">
                    <div class="drawer-field-label">Phone Number</div>
                    <div class="drawer-field-value">${esc(inc.phone || '—')}</div>
                </div>
            </div>
        </div>

        <!-- Vehicle Information -->
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-motorcycle"></i> Vehicle Information</div>
            <div class="drawer-fields">
                <div class="drawer-field">
                    <div class="drawer-field-label">Vehicle Type</div>
                    <div class="drawer-field-value">${esc(inc.vehicle || inc.vehicleType || '—')}</div>
                </div>
                <div class="drawer-field">
                    <div class="drawer-field-label">Plate Number</div>
                    <div class="drawer-field-value">${esc(inc.plateNumber || '—')}</div>
                </div>
            </div>
        </div>

        <!-- Emergency Contacts -->
            <div class="drawer-section">
                <div class="drawer-section-title">
                    <i class="fas fa-phone"></i> Emergency Contacts
                </div>

                <div class="drawer-fields">
                    ${contactsHtml}
                </div>
            </div>

        <!-- Incident Information -->
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-circle-exclamation"></i> Incident Information</div>
            <div class="drawer-fields">
                <div class="drawer-field">
                    <div class="drawer-field-label">Crash Type</div>
                    <div class="drawer-field-value">${esc(inc.type)}</div>
                </div>
                <div class="drawer-field">
                    <div class="drawer-field-label">Speed</div>
                    <div class="drawer-field-value" style="color:${speedColor(inc.speed)};">${inc.speed} km/h</div>
                </div>
                <div class="drawer-field">
                    <div class="drawer-field-label">Severity</div>
                    <div class="drawer-field-value">${esc(inc.severity || '—')}</div>
                </div>
                <div class="drawer-field">
                    <div class="drawer-field-label">Time Reported</div>
                    <div class="drawer-field-value">
                        ${formatTime(inc.reportedTime)}
                    </div>
                </div>
            </div>
        </div>

        <!-- Incident Location -->
        ${inc.lat && inc.lng ? `
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-map-pin"></i> Incident Location</div>
            <div id="drawerMap" class="drawer-mini-map"></div>
        </div>` : ''}

        <!-- Rider Updates -->
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-comments"></i> Rider Updates</div>
            ${timelineHtml}
        </div>

        <!-- Workflow -->
            <div class="workflow-section">

                ${safeBadge}

                <div class="workflow-title">
                    <i class="fas fa-list-check"></i>
                    Incident Workflow
                </div>

                <div class="workflow-steps">
                    ${stepsHtml}
                </div>

                <div class="workflow-actions" id="workflowActions">
                    ${actionBtn}
                </div>

            </div>
    `;
}

function buildWorkflowActionBtn(inc) {

    const flow = ['ACTIVE', 'ACKNOWLEDGED', 'DISPATCHED', 'ARRIVED', 'RESOLVED'];
    const currentIdx = flow.indexOf(inc.status);
    const next = getNextStatus(inc.status);

    const riderReportedSafe =
    inc.riderStatus === "SAFE" ||

    (
        inc.message &&
        SAFE_WORDS.some(w =>
            inc.message.toUpperCase().includes(w)
        )
    );

    let buttons = '';

    if (
        riderReportedSafe &&
        inc.status !== 'SAFE' &&
        inc.status !== 'RESOLVED'
    ) {
        buttons += `
            <button
                class="workflow-btn btn-safe"
                data-id="${esc(inc.id)}"
                data-status="SAFE"
            >
                <i class="fas fa-shield-check"></i>
                Mark as Safe
            </button>
        `;
    }

    const config = {
        ACKNOWLEDGED: { cls: 'btn-acknowledge', icon: 'fa-thumbs-up', label: 'Acknowledge' },
        DISPATCHED: { cls: 'btn-dispatch', icon: 'fa-truck-fast', label: 'Dispatch' },
        ARRIVED: { cls: 'btn-arrived', icon: 'fa-location-dot', label: 'Arrived' },
        RESOLVED: { cls: 'btn-resolve', icon: 'fa-circle-check', label: 'Resolve' }
    };

    buttons += Object.entries(config).map(([status, c]) => {
        const stepIdx = flow.indexOf(status);
        const done = currentIdx >= stepIdx;
        const isNext = status === next;
        const disabled = isNext ? '' : 'disabled';

        return `
            <button
                class="workflow-btn ${c.cls}"
                data-id="${esc(inc.id)}"
                data-status="${status}"
                ${disabled}
            >
                <i class="fas ${done ? 'fa-check' : c.icon}"></i>
                ${c.label}
            </button>
        `;
    }).join('');

    return buttons;
}
function setupWorkflowButtons(inc) {

    document.querySelectorAll('[data-id][data-status]').forEach(btn => {

        btn.addEventListener('click', async () => {

            const id = btn.dataset.id;
            const status = btn.dataset.status;

            await updateStatus(id, status);

        });

    });

}

function getNextStatus(current) {
    const flow = ['ACTIVE', 'ACKNOWLEDGED', 'DISPATCHED', 'ARRIVED', 'RESOLVED'];
    const idx = flow.indexOf(current);
    return idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
}

// ============================================================
// DRAWER MINI MAP
// ============================================================

function initDrawerMap(inc) {

    const container = document.getElementById('drawerMap');

    if (!container || !inc.lat || !inc.lng || typeof google === 'undefined')
        return;

    const pos = {
        lat: Number(inc.lat),
        lng: Number(inc.lng)
    };

    const colorMap = {
        HIGH: '#ef4444',
        MEDIUM: '#f59e0b'
    };

    const color = colorMap[inc.priority] || '#f59e0b';

    drawerMapInstance = new google.maps.Map(container, {
        center: pos,
        zoom: 16,
        mapTypeControl: false,
        streetViewControl: false,
        zoomControl: true
    });

    drawerMapMarker = new google.maps.Marker({
        position: pos,
        map: drawerMapInstance,
        title: inc.riderName,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 11,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
        }
    });

}
// ============================================================
// CLOSE DRAWER
// ============================================================

document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);

function closeDrawer() {

    currentDrawerIncidentId = null;

    document.getElementById('drawer').classList.remove('show');
    document.getElementById('drawerOverlay').classList.remove('show');
}

// ============================================================
// STATUS UPDATE
// ============================================================

window.updateStatus = async function (id, status) {
    const inc = incidents.find(i => i.id === id);
    if (!inc) { showToast('Error', 'Incident not found.', 'error'); return; }

    const userId = inc._userId || inc.userId;
    const crashId = inc._crashId || inc.crashId;

    if (!userId || !crashId || !firebaseDB) {
        showToast('Error', 'Cannot locate incident in Firebase.', 'error');
        return;
    }

    const path = `Ridera/users/${userId}/crash_alerts/${crashId}`;
    const now = Date.now();

    // Map dashboard workflow status → Firebase incident_status + timestamps
    const updateMap = {
        ACKNOWLEDGED: { incident_status: 'acknowledged', acknowledged_at: now },
        DISPATCHED: { incident_status: 'dispatched', dispatched_at: now },
        ARRIVED: { incident_status: 'arrived', arrived_at: now },
        SAFE: {
            incident_status: 'safe',
            mark_as_safe_at: now
        },
        RESOLVED: {
            incident_status: 'resolved',
            resolved_at: now,
            responseTimeMin: Math.max(1, Math.round((now - (inc.time || now)) / 60000))
        }
    };

    const updates = updateMap[status];
    if (!updates) { showToast('Error', 'Unknown status.', 'error'); return; }

    try {
        await firebaseDB.ref(path).update(updates);
        closeDrawer();
        const labels = {
            ACKNOWLEDGED: 'Incident Acknowledged',
            DISPATCHED: 'Responder Dispatched',
            ARRIVED: 'Responder Arrived',
            SAFE: 'Incident Marked Safe',
            RESOLVED: 'Incident Resolved'
        };
        showToast(labels[status] || 'Updated', `${inc.riderName} → ${status}`);
        // Firebase onValue will automatically re-fire with the new data
    } catch (err) {
        showToast('Update Failed', err.message, 'error');
    }
};

// ============================================================
// REFRESH
// ============================================================

document.getElementById('refreshBtn').addEventListener('click', () => {
    loadIncidents();
    showToast('Refreshed', 'Incident data updated.', 'info');
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    if (confirm('Sign out of Ridera Responder?')) {
        logoutResponder();
    }
});

// ============================================================
// SETTINGS
// ============================================================

document.getElementById('toggleSound').addEventListener('change', function () {
    soundEnabled = this.checked;
    if (!soundEnabled) {
        stopSoundLoop();
        stopMediumLoop();
    }
    showToast('Alert Sound ' + (soundEnabled ? 'Enabled' : 'Disabled'), '', soundEnabled ? '' : 'warn');
});

document.getElementById('toggleDark').addEventListener('change', function () {

    const isDark = this.checked;

    document.body.classList.toggle('light-mode', !isDark);

    if (map) {
        map.setOptions({
            styles: isDark ? DARK_MAP_STYLE : []
        });
    }

    showToast(
        'Theme Changed',
        isDark ? 'Dark mode enabled' : 'Light mode enabled',
        'info'
    );

});

document.getElementById('refreshInterval').addEventListener('change', function () {
    setAutoRefresh(parseInt(this.value));
    showToast('Auto Refresh', `Refresh interval set to ${this.value} seconds.`, 'info');
});

document.getElementById('settingsLogout').addEventListener('click', () => {
    if (confirm('Sign out of Ridera Responder?')) logoutResponder();
});

function setAutoRefresh(seconds) {
    // Firebase real-time listener handles live updates automatically.
    // No HTTP polling needed — this is intentionally a no-op.
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
}

// Start default auto-refresh (no-op now, kept for settings UI compat)
setAutoRefresh(30);

// Socket.IO handlers — kept for backward compat with server.js events
// Primary real-time data now comes from Firebase onValue listener above.
socket.on('connect', () => setConnectionStatus(true));
socket.on('disconnect', () => setConnectionStatus(false));

// These fire if server.js still emits them (e.g. push from hardware events)
socket.on('initialData', data => {
    if (!firebaseDB && Array.isArray(data)) {
        incidents = data.map(normalizeIncident).filter(inc => inc.priority !== 'LOW');
        renderAll(incidents);
    }
});

socket.on('incidentUpdated', updatedIncident => {
    if (!firebaseDB) {
        const norm = normalizeIncident(updatedIncident);
        if (norm.priority === 'LOW') return;
        const idx = incidents.findIndex(i => i.id === norm.id);
        if (idx !== -1) incidents[idx] = norm;
        else incidents.push(norm);
        renderAll(incidents);
    }
});

socket.on('newIncident', incident => {
    if (!firebaseDB) {
        const norm = normalizeIncident(incident);
        if (norm.priority === 'LOW') return;
        incidents.push(norm);
        renderAll(incidents);
        const isHigh = norm.priority === 'HIGH';
        showToast(
            isHigh ? '🚨 HIGH PRIORITY INCIDENT' : 'New Incident Detected',
            `${norm.riderName} — ${norm.type}`,
            isHigh ? 'error' : 'warn'
        );
        playAlertSound();
    }
});

// ============================================================
// RESPONDER PRESENCE — online/offline status visible to admin
// Uses Firebase .info/connected + onDisconnect() so the server
// itself flips is_online to false kahit biglang mawalan ng
// internet/kuryente (hindi lang pag nag-Sign Out).
// ============================================================

function setupPresence() {
    if (!firebaseDB || !RESPONDER_SESSION.key) return;

    const meRef = firebaseDB.ref(
        `Ridera/authorized_emergency_responder/${RESPONDER_SESSION.key}`
    );

    firebaseDB.ref('.info/connected').on('value', snap => {
        if (snap.val() !== true) return;

        // Register the server-side "will" FIRST: kapag naputol ang
        // connection (close tab, crash, brownout), Firebase server
        // mismo ang magse-set ng offline + last_seen.
        meRef.onDisconnect()
            .update({
                is_online: false,
                last_seen: firebase.database.ServerValue.TIMESTAMP
            })
            .then(() => {
                // Then mark as online for this session
                meRef.update({
                    is_online: true,
                    last_seen: firebase.database.ServerValue.TIMESTAMP
                });
            });
    });
}

// ============================================================
// INITIAL LOAD — Start Firebase listener
// ============================================================
listenToIncidents();
setupPresence();

function priorityLabel(p) {
    // Display-only: the MEDIUM tier is shown as "LOW" text.
    // The underlying value, CSS class, color, sound and logic stay MEDIUM.
    return (p === 'MEDIUM') ? 'LOW' : (p || 'LOW');
}

function setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function speedColor(speed) {
    if (speed >= 30) return 'var(--high)';
    if (speed < 30) return 'var(--medium)';
    return 'var(--low)';
}

function formatStatus(status) {
    if (!status) return '';
    return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatTime(t) {
    if (!t) return '—';
    const d = new Date(t);
    if (isNaN(d)) return String(t);
    return d.toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function timeAgo(t) {
    if (!t) return '—';
    const d = new Date(t);
    if (isNaN(d)) return String(t);
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.round(hrs / 24)} d ago`;
}

// ============================================================
// INITIAL LOAD
// ============================================================

loadIncidents();
