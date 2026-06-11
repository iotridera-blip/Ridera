/* ============================================================
   RIDERA ADMIN — ADMIN.JS
   CDRRMO Dasmariñas Admin Dashboard
   ============================================================ */

'use strict';

// ============================================================
// FIREBASE CONFIG — same project as responder dashboard
// ============================================================
const FIREBASE_CONFIG = {
    apiKey: 'PASTE_YOUR_API_KEY_HERE',
    authDomain: 'ridera-dg7.firebaseapp.com',
    databaseURL: 'https://ridera-dg7-default-rtdb.firebaseio.com',
    projectId: 'ridera-dg7',
    storageBucket: 'ridera-dg7.firebasestorage.app',
    messagingSenderId: 'PASTE_YOUR_MESSAGING_SENDER_ID_HERE',
    appId: 'PASTE_YOUR_APP_ID_HERE'
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}
const firebaseDB = typeof firebase !== 'undefined' ? firebase.database() : null;

// ============================================================
// STATE
// ============================================================
let allUsers = {};   // { userId:  userData  }
let allDevices = {};   // { deviceId: deviceData }
let allResponders = {};   // { responderId: responderData }

let usersPage = 1;
let devicesPage = 1;
const PER_PAGE = 10;

let currentPage = 'admin-dashboard';
let pendingSave = null;
let confirmCallback = null;

// Track which responder owns this admin session
const ADMIN_ID = localStorage.getItem('adminResponderId') || 'responder_001';

// ============================================================
// HELPERS
// ============================================================
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortDate(ts) {
    if (!ts) return '—';
    const d = new Date(typeof ts === 'string' && ts.includes('-') ? ts : ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d)) return String(ts);
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.round(hrs / 24)} d ago`;
}

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
            <div class="toast-title">${esc(title)}</div>
            ${message ? `<div class="toast-msg">${esc(message)}</div>` : ''}
        </div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
    const now = new Date();
    const dateEl = document.getElementById('headerDate');
    const timeEl = document.getElementById('headerTime');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ============================================================
// NAVIGATION — same pattern as responder dashboard
// ============================================================
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
});

document.querySelectorAll('[data-page]:not(.nav-item)').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.page));
});

function navigateTo(page) {
    if (!page) return;
    currentPage = page;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const nav = document.getElementById(`nav-${page}`);
    if (nav) nav.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    const target = document.getElementById(page.replace('admin-', 'admin') + 'Page')
        || document.getElementById(`${page.replace('-', '').replace('admin', '')}Page`);

    // Map page names to element IDs
    const pageMap = {
        'admin-dashboard': 'adminDashPage',
        'admin-users': 'adminUsersPage',
        'admin-devices': 'adminDevicesPage',
        'admin-responders': 'adminRespondersPage',
        'admin-settings': 'adminSettingsPage'
    };
    const el = document.getElementById(pageMap[page]);
    if (el) el.classList.add('active-page');

    document.getElementById('sidebar').classList.remove('open');
    closeAdminDrawer();

    if (page === 'admin-users') renderUsersTable();
    if (page === 'admin-devices') renderDevicesTable();
    if (page === 'admin-responders') renderRespondersTable();
    if (page === 'admin-settings') loadAdminSettings();
    if (page === 'admin-dashboard') renderDashboard();
}

document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// ============================================================
// CONNECTION STATUS
// ============================================================
function setConnectionStatus(online) {
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    if (online) {
        badge.className = 'status-badge online';
        badge.innerHTML = '<span class="status-dot"></span><span>CONNECTED</span>';
    } else {
        badge.className = 'status-badge offline';
        badge.innerHTML = '<span class="status-dot" style="background:#ef4444;"></span><span>OFFLINE</span>';
    }
}

// ============================================================
// FIREBASE REAL-TIME LISTENERS
// ============================================================
function listenToAll() {
    if (!firebaseDB) { showToast('Firebase Error', 'Firebase SDK not loaded.', 'error'); return; }

    // Users
    firebaseDB.ref('Ridera/users').on('value', snap => {
        allUsers = snap.val() || {};
        onDataChange();
    }, err => showToast('Users Error', err.message, 'error'));

    // Devices — filter out non-device nodes (e.g. 'config')
    firebaseDB.ref('Ridera/devices').on('value', snap => {
        const raw = snap.val() || {};
        allDevices = {};
        Object.entries(raw).forEach(([k, v]) => {
            if (v && typeof v === 'object' && v.device_id) allDevices[k] = v;
        });
        onDataChange();
    }, err => showToast('Devices Error', err.message, 'error'));

    // Responders — filter out non-responder nodes
    firebaseDB.ref('Ridera/authorized_emergency_responder').on('value', snap => {
        const raw = snap.val() || {};
        allResponders = {};
        Object.entries(raw).forEach(([k, v]) => {
            if (v && typeof v === 'object' && v.username) allResponders[k] = v;
        });
        onDataChange();
    }, err => showToast('Responders Error', err.message, 'error'));

    // Connection state
    firebaseDB.ref('.info/connected').on('value', snap => setConnectionStatus(snap.val() === true));
}

function onDataChange() {
    updateNavBadges();
    if (currentPage === 'admin-dashboard') renderDashboard();
    if (currentPage === 'admin-users') renderUsersTable();
    if (currentPage === 'admin-devices') renderDevicesTable();
    if (currentPage === 'admin-responders') renderRespondersTable();
}

function updateNavBadges() {
    const userCount = Object.keys(allUsers).length;
    const deviceCount = Object.keys(allDevices).length;
    const responderCount = Object.keys(allResponders).length;

    const ub = document.getElementById('usersBadge');
    const db = document.getElementById('devicesBadge');
    const rb = document.getElementById('respondersBadge');

    if (ub) { ub.textContent = userCount; ub.style.display = userCount ? 'inline-block' : 'none'; }
    if (db) { db.textContent = deviceCount; db.style.display = deviceCount ? 'inline-block' : 'none'; }
    if (rb) { rb.textContent = responderCount; rb.style.display = responderCount ? 'inline-block' : 'none'; }
}

// ============================================================
// DASHBOARD OVERVIEW
// ============================================================
function renderDashboard() {
    const users = Object.entries(allUsers);
    const devices = Object.entries(allDevices);
    const responders = Object.entries(allResponders);

    // Stat cards
    setEl('statTotalUsers', users.length);
    setEl('statTotalDevices', devices.length);
    setEl('statTotalResponders', responders.length);

    // Quick stats
    const onlineDevices = devices.filter(([, d]) => d.status?.state === 'Online').length;
    const boundUsers = users.filter(([, u]) => u.bound_device).length;
    const activeResp = responders.filter(([, r]) => r.is_active).length;
    const onDutyResp = responders.filter(([, r]) => r.on_duty).length;

    setEl('statOnlineDevices', onlineDevices);
    setEl('statBoundUsers', boundUsers);
    setEl('statActiveResponders', activeResp);
    setEl('statOnDutyResponders', onDutyResp);

    // Recent users (last 5 by joinedAt)
    const body = document.getElementById('recentUsersBody');
    if (!body) return;
    body.innerHTML = '';

    const sorted = [...users].sort((a, b) =>
        new Date(b[1].joinedAt || 0) - new Date(a[1].joinedAt || 0)
    ).slice(0, 5);

    if (sorted.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="empty-row"><i class="fas fa-users-slash"></i> No users yet</td></tr>`;
        return;
    }

    sorted.forEach(([id, user]) => {
        const tr = document.createElement('tr');
        const photoHtml = user.photo
            ? `<img src="${esc(user.photo)}" class="user-avatar-img" style="width:28px;height:28px;margin-right:8px;vertical-align:middle" onerror="this.style.display='none'" />`
            : `<span class="user-avatar" style="width:28px;height:28px;font-size:12px;margin-right:8px;display:inline-flex;vertical-align:middle"><i class="fas fa-user"></i></span>`;
        tr.innerHTML = `
            <td><div style="display:inline-flex;align-items:center">${photoHtml}<strong>${esc(user.name || '—')}</strong></div></td>
            <td>${esc(user.vehicle_model || '—')} · <span style="color:var(--text-muted)">${esc(user.vehicle_plate || '—')}</span></td>
            <td>${user.bound_device ? `<span class="badge badge-low" style="font-size:10px">${esc(user.bound_device)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="color:var(--text-muted)">${shortDate(user.joinedAt)}</td>`;
        body.appendChild(tr);
    });
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ============================================================
// USER MANAGEMENT
// ============================================================
function renderUsersTable() {
    const search = (document.getElementById('userSearch')?.value || '').toLowerCase();
    const filter = document.getElementById('userStatusFilter')?.value || '';
    const body = document.getElementById('usersTableBody');
    if (!body) return;

    let entries = Object.entries(allUsers).filter(([, u]) => {
        if (!u || typeof u !== 'object') return false;
        if (filter === 'bound' && !u.bound_device) return false;
        if (filter === 'unbound' && u.bound_device) return false;
        if (search) {
            const hay = `${u.name} ${u.phone} ${u.vehicle_plate} ${u.email} ${u.vehicle_model}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    entries.sort((a, b) => new Date(b[1].joinedAt || 0) - new Date(a[1].joinedAt || 0));

    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    usersPage = Math.max(1, Math.min(usersPage, pages));
    const slice = entries.slice((usersPage - 1) * PER_PAGE, usersPage * PER_PAGE);

    body.innerHTML = '';
    if (slice.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="empty-row"><i class="fas fa-users-slash"></i> No users found</td></tr>`;
        renderPagination('usersPagination', 1, 1, () => { });
        return;
    }

    slice.forEach(([id, user]) => {
        const tr = document.createElement('tr');
        const photo = user.photo
            ? `<img src="${esc(user.photo)}" class="user-avatar-img" onerror="this.src='';this.style.display='none'" />`
            : `<span class="user-avatar"><i class="fas fa-user"></i></span>`;
        tr.innerHTML = `
            <td>
                <div class="td-user">
                    ${photo}
                    <div>
                        <strong>${esc(user.name || '—')}</strong>
                        <div class="td-sub">${esc(user.email || '')}</div>
                    </div>
                </div>
            </td>
            <td>${esc(user.phone || '—')}</td>
            <td>${esc(user.vehicle_type || '')} ${esc(user.vehicle_model || '—')}</td>
            <td><strong>${esc(user.vehicle_plate || '—')}</strong></td>
            <td>${user.bound_device ? `<span class="badge badge-low" style="font-size:10px">${esc(user.bound_device)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="color:var(--text-muted)">${shortDate(user.joinedAt)}</td>
            <td>
                <div class="tbl-actions">
                    <button class="btn-icon" data-action="view-user" data-id="${esc(id)}" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" data-action="edit-user" data-id="${esc(id)}" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon btn-icon-danger" data-action="del-user" data-id="${esc(id)}" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </td>`;
        body.appendChild(tr);
    });

    renderPagination('usersPagination', usersPage, pages, p => { usersPage = p; renderUsersTable(); });
}

document.getElementById('userSearch').addEventListener('input', () => { usersPage = 1; renderUsersTable(); });
document.getElementById('userStatusFilter').addEventListener('change', () => { usersPage = 1; renderUsersTable(); });

document.getElementById('usersTableBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'view-user') viewUser(id);
    else if (action === 'edit-user') editUser(id);
    else if (action === 'del-user') confirmDelete(`Delete User`, `This will permanently remove "${allUsers[id]?.name || id}" from the system.`, () => deleteUser(id));
});

function viewUser(id) {
    const u = allUsers[id];
    if (!u) return;
    const photo = u.photo
        ? `<img src="${esc(u.photo)}" class="detail-photo" onerror="this.style.display='none'" />`
        : `<span class="user-avatar" style="width:72px;height:72px;font-size:26px"><i class="fas fa-user"></i></span>`;
    openAdminDrawer(`
        <div class="drawer-title"><i class="fas fa-user" style="color:var(--text-muted);font-size:15px"></i> User Profile</div>
        <div class="detail-photo-wrap">
            ${photo}
            <div class="detail-photo-info">
                <strong>${esc(u.name || '—')}</strong>
                <span>${esc(u.email || '—')}</span>
                <div style="margin-top:6px">${u.bound_device ? `<span class="badge badge-low">Bound · ${esc(u.bound_device)}</span>` : '<span style="color:var(--text-muted);font-size:12px">No device bound</span>'}</div>
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-user"></i> Personal Information</div>
            <div class="drawer-fields">
                ${drawerField('Full Name', u.name)}
                ${drawerField('Phone', u.phone)}
                ${drawerField('Sex', u.sex)}
                ${drawerField('Address', u.address)}
                ${drawerField('Joined', shortDate(u.joinedAt))}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-motorcycle"></i> Vehicle Information</div>
            <div class="drawer-fields">
                ${drawerField('Type', u.vehicle_type)}
                ${drawerField('Model', u.vehicle_model)}
                ${drawerField('Plate', u.vehicle_plate)}
                ${drawerField('Color', u.vehicle_color)}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-microchip"></i> Device Binding</div>
            <div class="drawer-fields">
                ${drawerField('Bound Device', u.bound_device || 'None')}
                ${drawerField('UID', u.uid)}
            </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn btn-ghost" style="flex:1" onclick="editUser('${esc(id)}')"><i class="fas fa-pen"></i> Edit</button>
            <button class="btn btn-danger" style="flex:1" onclick="confirmDelete('Delete User','Remove this user permanently?',()=>deleteUser('${esc(id)}'))"><i class="fas fa-trash"></i> Delete</button>
        </div>`);
}

function editUser(id) {
    const u = allUsers[id] || {};
    openAdminDrawer(`
        <div class="drawer-title"><i class="fas fa-pen" style="color:var(--text-muted);font-size:15px"></i> Edit User · <small style="font-weight:500;color:var(--text-muted)">${esc(id)}</small></div>
        <div class="drawer-section">
            <div class="drawer-section-title">Personal Information</div>
            <div style="display:flex;flex-direction:column;gap:12px">
                ${inputField('eu-name', 'Full Name', u.name)}
                ${inputField('eu-phone', 'Phone', u.phone)}
                <div class="form-row">
                    ${selectField('eu-sex', 'Sex', ['Male', 'Female', 'Other'], u.sex)}
                    ${inputField('eu-address', 'Address', u.address)}
                </div>
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title">Vehicle Information</div>
            <div style="display:flex;flex-direction:column;gap:12px">
                <div class="form-row">
                    ${inputField('eu-vtype', 'Vehicle Type', u.vehicle_type)}
                    ${inputField('eu-vmodel', 'Vehicle Model', u.vehicle_model)}
                </div>
                <div class="form-row">
                    ${inputField('eu-vplate', 'Plate Number', u.vehicle_plate)}
                    ${inputField('eu-vcolor', 'Vehicle Color', u.vehicle_color)}
                </div>
            </div>
        </div>
        <div class="form-actions">
            <button class="btn btn-ghost" onclick="closeAdminDrawer()">Cancel</button>
            <button class="btn btn-danger" id="adminSaveBtn"><i class="fas fa-floppy-disk"></i> Save Changes</button>
        </div>`);

    pendingSave = () => saveEditUser(id);
    document.getElementById('adminSaveBtn').addEventListener('click', () => pendingSave && pendingSave());
}

function saveEditUser(id) {
    const updates = {
        name: val('eu-name'),
        phone: val('eu-phone'),
        sex: val('eu-sex'),
        address: val('eu-address'),
        vehicle_type: val('eu-vtype'),
        vehicle_model: val('eu-vmodel'),
        vehicle_plate: val('eu-vplate'),
        vehicle_color: val('eu-vcolor')
    };
    firebaseDB.ref(`Ridera/users/${id}`).update(updates)
        .then(() => { closeAdminDrawer(); showToast('User Updated', `${updates.name} saved successfully.`); })
        .catch(e => showToast('Save Failed', e.message, 'error'));
}

function deleteUser(id) {
    const name = allUsers[id]?.name || id;
    firebaseDB.ref(`Ridera/users/${id}`).remove()
        .then(() => showToast('User Deleted', `${name} has been removed.`, 'warn'))
        .catch(e => showToast('Delete Failed', e.message, 'error'));
}

// ============================================================
// DEVICE MANAGEMENT
// ============================================================
function renderDevicesTable() {
    const search = (document.getElementById('deviceSearch')?.value || '').toLowerCase();
    const filter = document.getElementById('deviceStatusFilter')?.value || '';
    const body = document.getElementById('devicesTableBody');
    if (!body) return;

    // Build bound-user lookup: deviceId → user
    const deviceUserMap = {};
    Object.entries(allUsers).forEach(([uid, u]) => {
        if (u.bound_device) deviceUserMap[u.bound_device] = u;
    });

    let entries = Object.entries(allDevices).filter(([k, d]) => {
        const isOnline = d.status?.state === 'Online';
        const isBound = !!d.binding?.uid;
        if (filter === 'online' && !isOnline) return false;
        if (filter === 'offline' && isOnline) return false;
        if (filter === 'bound' && !isBound) return false;
        if (filter === 'unbound' && isBound) return false;
        if (search) {
            const boundUser = deviceUserMap[k]?.name || '';
            const hay = `${k} ${d.device_id} ${boundUser}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    devicesPage = Math.max(1, Math.min(devicesPage, pages));
    const slice = entries.slice((devicesPage - 1) * PER_PAGE, devicesPage * PER_PAGE);

    body.innerHTML = '';
    if (slice.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="empty-row"><i class="fas fa-microchip"></i> No devices found</td></tr>`;
        renderPagination('devicesPagination', 1, 1, () => { });
        return;
    }

    slice.forEach(([id, d]) => {
        const isOnline = d.status?.state === 'Online';
        const isBound = !!d.binding?.uid;
        const boundUser = deviceUserMap[id];
        const loc = d.telematics?.location;
        const locText = loc ? `${loc.city || ''}, ${loc.province || ''}`.replace(/^,\s*/, '') || '—' : '—';
        const speedText = loc?.speed_kmph != null ? `${loc.speed_kmph} km/h` : '—';
        const lastSeen = d.status?.last_seen ? timeAgo(d.status.last_seen) : '—';

        const statusHtml = isOnline
            ? `<span class="badge badge-low"><i class="fas fa-circle" style="font-size:7px"></i> Online</span>`
            : `<span class="badge badge-high"><i class="fas fa-circle" style="font-size:7px"></i> Offline</span>`;
        const bindHtml = isBound
            ? `<span class="badge badge-low" style="font-size:10px">${boundUser ? esc(boundUser.name) : 'Bound'}</span>`
            : `<span style="color:var(--text-muted)">Unbound</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(id)}</strong></td>
            <td>${statusHtml}</td>
            <td>${bindHtml}</td>
            <td style="color:var(--text-muted)">${lastSeen}</td>
            <td style="color:var(--text-muted)">${esc(locText)}</td>
            <td style="color:${loc?.speed_kmph > 0 ? 'var(--medium)' : 'var(--text-muted)'}">${speedText}</td>
            <td>
                <div class="tbl-actions">
                    <button class="btn-icon" data-action="view-device" data-id="${esc(id)}" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" data-action="edit-device" data-id="${esc(id)}" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon btn-icon-danger" data-action="del-device" data-id="${esc(id)}" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </td>`;
        body.appendChild(tr);
    });

    renderPagination('devicesPagination', devicesPage, pages, p => { devicesPage = p; renderDevicesTable(); });
}

document.getElementById('deviceSearch').addEventListener('input', () => { devicesPage = 1; renderDevicesTable(); });
document.getElementById('deviceStatusFilter').addEventListener('change', () => { devicesPage = 1; renderDevicesTable(); });

document.getElementById('devicesTableBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'view-device') viewDevice(id);
    else if (action === 'edit-device') editDevice(id);
    else if (action === 'del-device') confirmDelete('Delete Device', `Remove device "${id}" from the system?`, () => deleteDevice(id));
});

function viewDevice(id) {
    const d = allDevices[id];
    if (!d) return;
    const loc = d.telematics?.location;
    const boundUser = Object.values(allUsers).find(u => u.bound_device === id);

    openAdminDrawer(`
        <div class="drawer-title"><i class="fas fa-microchip" style="color:var(--text-muted);font-size:15px"></i> Device Details · <small style="font-weight:500;color:var(--text-muted)">${esc(id)}</small></div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-info-circle"></i> Device Info</div>
            <div class="drawer-fields">
                ${drawerField('Device ID', d.device_id)}
                ${drawerField('State', d.status?.state || '—')}
                ${drawerField('Last Seen', d.status?.last_seen ? formatDate(d.status.last_seen) : '—')}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-link"></i> Binding</div>
            <div class="drawer-fields">
                ${drawerField('Binding State', d.binding?.state || '—')}
                ${drawerField('Bound UID', d.binding?.uid || 'None')}
                ${drawerField('Bound Rider', boundUser?.name || '—')}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-wifi"></i> Network Config</div>
            <div class="drawer-fields">
                ${drawerField('WiFi SSID', d.config?.wifi_ssid || '—')}
                ${drawerField('IP Address', d.config?.ip || '—')}
            </div>
        </div>
        ${loc ? `
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-map-pin"></i> Last Known Location</div>
            <div class="drawer-fields">
                ${drawerField('City', loc.city)}
                ${drawerField('Province', loc.province)}
                ${drawerField('Country', loc.country)}
                ${drawerField('Coordinates', loc.latitude ? `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : '—')}
                ${drawerField('Speed', loc.speed_kmph != null ? `${loc.speed_kmph} km/h` : '—')}
                ${drawerField('WiFi Signal', loc.wifi_status || '—')}
                ${drawerField('Satellites', loc.satellite || '—')}
                ${drawerField('Date / Time', `${loc.date || ''} ${loc.time || ''}`.trim() || '—')}
            </div>
        </div>` : ''}
        <div style="margin-top:18px">
            <button class="btn btn-ghost" style="width:100%" onclick="editDevice('${esc(id)}')"><i class="fas fa-pen"></i> Edit Device</button>
        </div>`);
}

function editDevice(id) {
    const d = allDevices[id] || {};
    openAdminDrawer(`
        <div class="drawer-title"><i class="fas fa-pen" style="color:var(--text-muted);font-size:15px"></i> Edit Device · <small style="font-weight:500;color:var(--text-muted)">${esc(id)}</small></div>
        <div class="drawer-section">
            <div class="drawer-section-title">Network Config</div>
            <div style="display:flex;flex-direction:column;gap:12px">
                ${inputField('ed-ssid', 'WiFi SSID', d.config?.wifi_ssid)}
                ${inputField('ed-ip', 'IP Address', d.config?.ip)}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title">Binding</div>
            <div style="display:flex;flex-direction:column;gap:12px">
                ${selectField('ed-bstate', 'Binding State', ['bound', 'unbound'], d.binding?.state)}
                ${inputField('ed-buid', 'Bound User UID', d.binding?.uid)}
            </div>
        </div>
        <div class="form-actions">
            <button class="btn btn-ghost" onclick="closeAdminDrawer()">Cancel</button>
            <button class="btn btn-danger" id="adminSaveBtn"><i class="fas fa-floppy-disk"></i> Save Changes</button>
        </div>`);

    pendingSave = () => saveEditDevice(id);
    document.getElementById('adminSaveBtn').addEventListener('click', () => pendingSave && pendingSave());
}

function saveEditDevice(id) {
    const updates = {
        'config/wifi_ssid': val('ed-ssid'),
        'config/ip': val('ed-ip'),
        'binding/state': val('ed-bstate'),
        'binding/uid': val('ed-buid')
    };
    firebaseDB.ref(`Ridera/devices/${id}`).update(updates)
        .then(() => { closeAdminDrawer(); showToast('Device Updated', `${id} saved successfully.`); })
        .catch(e => showToast('Save Failed', e.message, 'error'));
}

function deleteDevice(id) {
    firebaseDB.ref(`Ridera/devices/${id}`).remove()
        .then(() => showToast('Device Deleted', `${id} has been removed.`, 'warn'))
        .catch(e => showToast('Delete Failed', e.message, 'error'));
}

// ============================================================
// RESPONDER MANAGEMENT
// ============================================================
function renderRespondersTable() {
    const search = (document.getElementById('responderSearch')?.value || '').toLowerCase();
    const body = document.getElementById('respondersTableBody');
    if (!body) return;

    let entries = Object.entries(allResponders).filter(([, r]) => {
        if (search) {
            const hay = `${r.username} ${r.agency_name} ${r.station_name} ${r.role}`.toLowerCase();
            return hay.includes(search);
        }
        return true;
    });

    entries.sort((a, b) => a[0].localeCompare(b[0]));
    body.innerHTML = '';

    if (entries.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="empty-row"><i class="fas fa-user-slash"></i> No responders found</td></tr>`;
        return;
    }

    entries.forEach(([id, r]) => {
        const activeBadge = r.is_active
            ? '<span class="badge badge-low" style="font-size:10px">Active</span>'
            : '<span class="badge badge-high" style="font-size:10px">Inactive</span>';
        const dutyBadge = r.on_duty
            ? '<span class="badge badge-low" style="font-size:10px">On Duty</span>'
            : '<span style="color:var(--text-muted);font-size:12px">Off Duty</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(r.username || '—')}</strong></td>
            <td>${esc(r.agency_name || '—')}</td>
            <td>${esc(r.station_name || '—')}</td>
            <td><span class="badge" style="background:rgba(59,130,246,.14);color:#93c5fd;border:1px solid rgba(59,130,246,.3)">${esc(r.role || '—')}</span></td>
            <td>${activeBadge}</td>
            <td>${dutyBadge}</td>
            <td>
                <div class="tbl-actions">
                    <button class="btn-icon" data-action="view-resp" data-id="${esc(id)}" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" data-action="edit-resp" data-id="${esc(id)}" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon btn-icon-danger" data-action="del-resp" data-id="${esc(id)}" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </td>`;
        body.appendChild(tr);
    });
}

document.getElementById('responderSearch').addEventListener('input', renderRespondersTable);

document.getElementById('respondersTableBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'view-resp') viewResponder(id);
    else if (action === 'edit-resp') responderForm(id, false);
    else if (action === 'del-resp') confirmDelete('Delete Responder', `Remove "${allResponders[id]?.username || id}"? They will lose dashboard access.`, () => deleteResponder(id));
});

document.getElementById('addResponderBtn').addEventListener('click', () => responderForm(null, true));

function viewResponder(id) {
    const r = allResponders[id];
    if (!r) return;
    openAdminDrawer(`
        <div class="drawer-title"><i class="fas fa-user-shield" style="color:var(--text-muted);font-size:15px"></i> Responder Profile</div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-user"></i> Account</div>
            <div class="drawer-fields">
                ${drawerField('Username', r.username)}
                ${drawerField('Role', r.role)}
                ${drawerField('Active', r.is_active ? 'Yes' : 'No')}
                ${drawerField('On Duty', r.on_duty ? 'Yes' : 'No')}
                ${drawerField('Last Login', r.last_login ? formatDate(r.last_login) : '—')}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-building"></i> Agency</div>
            <div class="drawer-fields">
                ${drawerField('Agency', r.agency_name)}
                ${drawerField('Station', r.station_name)}
                ${drawerField('Coverage Area', r.coverage_area)}
                ${drawerField('Address', r.address)}
                ${drawerField('Phone', r.phone)}
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title"><i class="fas fa-map-pin"></i> Location</div>
            <div class="drawer-fields">
                ${drawerField('Latitude', r.latitude)}
                ${drawerField('Longitude', r.longitude)}
            </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn btn-ghost" style="flex:1" onclick="responderForm('${esc(id)}', false)"><i class="fas fa-pen"></i> Edit</button>
            <button class="btn btn-danger" style="flex:1" onclick="confirmDelete('Delete Responder','Remove this responder?',()=>deleteResponder('${esc(id)}'))"><i class="fas fa-trash"></i> Delete</button>
        </div>`);
}

function responderForm(id, isAdd) {
    const r = (!isAdd && id) ? (allResponders[id] || {}) : {};
    const title = isAdd ? 'Add New Responder' : `Edit Responder · ${esc(id)}`;

    openAdminDrawer(`
        <div class="drawer-title"><i class="fas fa-user-shield" style="color:var(--text-muted);font-size:15px"></i> ${title}</div>
        <div class="drawer-section">
            <div class="drawer-section-title">Account Credentials</div>
            <div style="display:flex;flex-direction:column;gap:12px">
                <div class="form-row">
                    ${inputField('rp-username', 'Username', r.username, 'text', isAdd)}
                    ${inputField('rp-password', isAdd ? 'Password' : 'New Password (blank = no change)', '', 'password', isAdd)}
                </div>
                <div class="form-row">
                    ${selectField('rp-role', 'Role', ['dispatcher', 'admin', 'supervisor'], r.role)}
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
                            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                                <input type="checkbox" id="rp-active" ${r.is_active ? 'checked' : ''} style="accent-color:var(--low)"> Active
                            </label>
                            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                                <input type="checkbox" id="rp-duty" ${r.on_duty ? 'checked' : ''} style="accent-color:var(--low)"> On Duty
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title">Agency Information</div>
            <div style="display:flex;flex-direction:column;gap:12px">
                ${inputField('rp-agency', 'Agency Name', r.agency_name)}
                ${inputField('rp-station', 'Station Name', r.station_name)}
                ${inputField('rp-coverage', 'Coverage Area', r.coverage_area)}
                ${inputField('rp-address', 'Address', r.address)}

                <!-- Phone + OTP verification -->
                <div class="form-group">
                    <label class="form-label" for="rp-phone">Phone (must be verified) *</label>
                    <div style="display:flex;gap:8px">
                        <input id="rp-phone" class="admin-input" type="text" value="${esc(r.phone || '')}" placeholder="09171234567" style="flex:1" />
                        <button type="button" class="btn btn-ghost" id="rp-send-otp" style="white-space:nowrap">
                            <i class="fas fa-paper-plane"></i> Send OTP
                        </button>
                    </div>
                </div>
                <div class="form-group" id="rp-otp-group" style="display:none">
                    <label class="form-label" for="rp-otp">Enter 6-digit code sent via SMS</label>
                    <div style="display:flex;gap:8px">
                        <input id="rp-otp" class="admin-input" type="text" maxlength="6" placeholder="••••••" style="flex:1;letter-spacing:4px;text-align:center;font-weight:700" />
                        <button type="button" class="btn btn-danger" id="rp-verify-otp" style="white-space:nowrap">
                            <i class="fas fa-check"></i> Verify
                        </button>
                    </div>
                </div>
                <div id="rp-phone-status" style="font-size:12px;display:flex;align-items:center;gap:6px;color:var(--text-muted)">
                    ${r.phone_verified ? '<i class="fas fa-circle-check" style="color:var(--low)"></i> <span style="color:var(--low)">Phone verified</span>' : '<i class="fas fa-circle-info"></i> Phone not yet verified'}
                </div>
            </div>
        </div>
        <div class="drawer-section">
            <div class="drawer-section-title">Station Coordinates</div>
            <div class="form-row">
                ${inputField('rp-lat', 'Latitude', r.latitude)}
                ${inputField('rp-lng', 'Longitude', r.longitude)}
            </div>
        </div>
        <div class="form-actions">
            <button class="btn btn-ghost" onclick="closeAdminDrawer()">Cancel</button>
            <button class="btn btn-danger" id="adminSaveBtn">
                <i class="fas fa-${isAdd ? 'plus' : 'floppy-disk'}"></i> ${isAdd ? 'Add Responder' : 'Save Changes'}
            </button>
        </div>`);

    pendingSave = () => saveResponder(id, isAdd);
    document.getElementById('adminSaveBtn').addEventListener('click', () => pendingSave && pendingSave());

    // ---- OTP wiring ----
    // Verified state: existing responder with unchanged phone counts as verified
    window._otpVerifiedPhone = (!isAdd && r.phone_verified) ? normalizePhoneJS(r.phone || '') : null;

    const sendBtn = document.getElementById('rp-send-otp');
    const verifyBtn = document.getElementById('rp-verify-otp');
    const otpGroup = document.getElementById('rp-otp-group');
    const statusEl = document.getElementById('rp-phone-status');
    const phoneEl = document.getElementById('rp-phone');

    // If phone changes after verification, invalidate it
    phoneEl.addEventListener('input', () => {
        if (window._otpVerifiedPhone && normalizePhoneJS(phoneEl.value) !== window._otpVerifiedPhone) {
            window._otpVerifiedPhone = null;
            statusEl.innerHTML = '<i class="fas fa-circle-info"></i> Phone changed — verification required';
        }
    });

    sendBtn.addEventListener('click', async () => {
        const phone = phoneEl.value.trim();
        if (!phone) { showToast('Validation', 'Enter a phone number first.', 'warn'); return; }

        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

        try {
            const resp = await fetch('/api/send-phone-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await resp.json();

            if (data.success) {
                otpGroup.style.display = 'flex';
                statusEl.innerHTML = '<i class="fas fa-paper-plane" style="color:var(--info)"></i> <span style="color:var(--info)">Code sent! Check SMS.</span>';
                showToast('OTP Sent', `Verification code sent to ${data.phone}.`);
                // 60s resend cooldown
                let secs = 60;
                sendBtn.innerHTML = `Resend (${secs}s)`;
                const timer = setInterval(() => {
                    secs--;
                    if (secs <= 0) {
                        clearInterval(timer);
                        sendBtn.disabled = false;
                        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Resend OTP';
                    } else {
                        sendBtn.innerHTML = `Resend (${secs}s)`;
                    }
                }, 1000);
            } else {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send OTP';
                showToast('OTP Failed', data.message || 'Could not send SMS.', 'error');
            }
        } catch (e) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send OTP';
            showToast('Network Error', e.message, 'error');
        }
    });

    verifyBtn.addEventListener('click', async () => {
        const phone = phoneEl.value.trim();
        const code = document.getElementById('rp-otp').value.trim();
        if (!code || code.length !== 6) { showToast('Validation', 'Enter the 6-digit code.', 'warn'); return; }

        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const resp = await fetch('/api/verify-phone-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, code })
            });
            const data = await resp.json();

            verifyBtn.disabled = false;
            verifyBtn.innerHTML = '<i class="fas fa-check"></i> Verify';

            if (data.verified) {
                window._otpVerifiedPhone = data.phone;
                otpGroup.style.display = 'none';
                statusEl.innerHTML = '<i class="fas fa-circle-check" style="color:var(--low)"></i> <span style="color:var(--low)">Phone verified!</span>';
                showToast('Phone Verified', 'This number is confirmed.');
            } else {
                statusEl.innerHTML = `<i class="fas fa-circle-xmark" style="color:var(--high)"></i> <span style="color:var(--high)">${esc(data.message || 'Invalid OTP')}</span>`;
                showToast('Verification Failed', data.message || 'Invalid OTP', 'error');
            }
        } catch (e) {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = '<i class="fas fa-check"></i> Verify';
            showToast('Network Error', e.message, 'error');
        }
    });
}

// Same normalization as server: 0917... → 63917...
function normalizePhoneJS(phone) {
    let p = String(phone).replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '63' + p.slice(1);
    if (!p.startsWith('63')) p = '63' + p;
    return p;
}

function saveResponder(id, isAdd) {
    const username = val('rp-username');
    const password = val('rp-password');
    const phone = val('rp-phone');
    if (!username) { showToast('Validation', 'Username is required.', 'warn'); return; }
    if (isAdd && !password) { showToast('Validation', 'Password is required for new responder.', 'warn'); return; }
    if (!phone) { showToast('Validation', 'Phone number is required.', 'warn'); return; }

    // BLOCK save if phone is not OTP-verified
    if (!window._otpVerifiedPhone || normalizePhoneJS(phone) !== window._otpVerifiedPhone) {
        showToast('Phone Not Verified', 'Send and verify the OTP first before saving.', 'warn');
        return;
    }

    const data = {
        username,
        role: val('rp-role') || 'dispatcher',
        agency_name: val('rp-agency'),
        station_name: val('rp-station'),
        coverage_area: val('rp-coverage'),
        address: val('rp-address'),
        phone: normalizePhoneJS(phone),
        phone_verified: true,
        latitude: parseFloat(val('rp-lat')) || 0,
        longitude: parseFloat(val('rp-lng')) || 0,
        is_active: document.getElementById('rp-active')?.checked ?? true,
        on_duty: document.getElementById('rp-duty')?.checked ?? false
    };

    if (password) data.password = password;
    if (isAdd) data.created_at = Date.now();

    const targetId = isAdd ? `responder_${Date.now()}` : id;

    const op = isAdd
        ? firebaseDB.ref(`Ridera/authorized_emergency_responder/${targetId}`).set(data)
        : firebaseDB.ref(`Ridera/authorized_emergency_responder/${id}`).update(data);

    op.then(() => {
        closeAdminDrawer();
        showToast(isAdd ? 'Responder Added' : 'Responder Updated', `${username} saved successfully.`);
    }).catch(e => showToast('Save Failed', e.message, 'error'));
}

function deleteResponder(id) {
    const name = allResponders[id]?.username || id;
    firebaseDB.ref(`Ridera/authorized_emergency_responder/${id}`).remove()
        .then(() => showToast('Responder Deleted', `${name} has been removed.`, 'warn'))
        .catch(e => showToast('Delete Failed', e.message, 'error'));
}

// ============================================================
// DRAWER — same open/close pattern as responder dashboard
// ============================================================
function openAdminDrawer(html) {
    document.getElementById('adminDrawerContent').innerHTML = html;
    document.getElementById('adminDrawer').classList.add('show');
    document.getElementById('adminDrawerOverlay').classList.add('show');
}

function closeAdminDrawer() {
    document.getElementById('adminDrawer').classList.remove('show');
    document.getElementById('adminDrawerOverlay').classList.remove('show');
    pendingSave = null;
}

document.getElementById('adminCloseDrawer').addEventListener('click', closeAdminDrawer);
document.getElementById('adminDrawerOverlay').addEventListener('click', closeAdminDrawer);

// ============================================================
// CONFIRM DIALOG
// ============================================================
function confirmDelete(title, message, callback) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOverlay').classList.add('show');
    confirmCallback = callback;
}

document.getElementById('confirmOk').addEventListener('click', () => {
    document.getElementById('confirmOverlay').classList.remove('show');
    if (confirmCallback) { confirmCallback(); confirmCallback = null; }
});
document.getElementById('confirmCancel').addEventListener('click', () => {
    document.getElementById('confirmOverlay').classList.remove('show');
    confirmCallback = null;
});

// ============================================================
// ACCOUNT SETTINGS
// ============================================================
function loadAdminSettings() {
    const r = allResponders[ADMIN_ID];
    if (!r) {
        // Try first available responder
        const first = Object.entries(allResponders)[0];
        if (!first) return;
        populateSettings(first[1]);
    } else {
        populateSettings(r);
    }
}

function populateSettings(r) {
    setInput('settUsername', r.username);
    setInput('settPhone', r.phone);
    setInput('settAgency', r.agency_name);
    setInput('settStation', r.station_name);
    setInput('settCoverage', r.coverage_area);
    setInput('settAddress', r.address);
    const roleEl = document.getElementById('settRole');
    if (roleEl) roleEl.value = r.role || 'dispatcher';
}

document.getElementById('saveProfileBtn').addEventListener('click', () => {
    const targetId = allResponders[ADMIN_ID] ? ADMIN_ID : Object.keys(allResponders)[0];
    if (!targetId) { showToast('Error', 'No admin record found.', 'error'); return; }

    const updates = {
        username: val('settUsername'),
        phone: val('settPhone'),
        agency_name: val('settAgency'),
        station_name: val('settStation'),
        coverage_area: val('settCoverage'),
        address: val('settAddress'),
        role: val('settRole')
    };

    firebaseDB.ref(`Ridera/authorized_emergency_responder/${targetId}`).update(updates)
        .then(() => showToast('Profile Updated', 'Your profile has been saved.'))
        .catch(e => showToast('Save Failed', e.message, 'error'));
});

document.getElementById('changePasswordBtn').addEventListener('click', () => {
    const targetId = allResponders[ADMIN_ID] ? ADMIN_ID : Object.keys(allResponders)[0];
    if (!targetId) { showToast('Error', 'No admin record found.', 'error'); return; }

    const current = val('settCurrentPw');
    const newPw = val('settNewPw');
    const confirm = val('settConfirmPw');
    const r = allResponders[targetId];

    if (!current || !newPw || !confirm) { showToast('Validation', 'All password fields are required.', 'warn'); return; }
    if (r && r.password && r.password !== current) { showToast('Wrong Password', 'Current password is incorrect.', 'error'); return; }
    if (newPw !== confirm) { showToast('Mismatch', 'New passwords do not match.', 'warn'); return; }
    if (newPw.length < 6) { showToast('Too Short', 'Password must be at least 6 characters.', 'warn'); return; }

    firebaseDB.ref(`Ridera/authorized_emergency_responder/${targetId}/password`).set(newPw)
        .then(() => {
            showToast('Password Changed', 'Your password has been updated.');
            ['settCurrentPw', 'settNewPw', 'settConfirmPw'].forEach(id => setInput(id, ''));
        })
        .catch(e => showToast('Failed', e.message, 'error'));
});

// ============================================================
// LOGOUT
// ============================================================
[document.getElementById('logoutBtn'), document.getElementById('settLogout')].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
        if (confirm('Sign out of Ridera Admin?')) {
            localStorage.removeItem('adminResponderId');
            window.location.href = '/api/logout';
        }
    });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    showToast('Refreshed', 'Data is synced with Firebase in real-time.', 'info');
});

// ============================================================
// PAGINATION — same style as responder dashboard
// ============================================================
function renderPagination(containerId, current, total, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (total <= 1) return;

    const makeBtn = (label, page, isActive) => {
        const btn = document.createElement('button');
        btn.className = `page-btn${isActive ? ' active' : ''}`;
        btn.textContent = label;
        btn.addEventListener('click', () => callback(page));
        container.appendChild(btn);
    };

    if (current > 1) makeBtn('‹', current - 1, false);
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) {
        makeBtn(i, i, i === current);
    }
    if (current < total) makeBtn('›', current + 1, false);
}

// ============================================================
// DRAWER BUILDER HELPERS — same .drawer-field pattern
// ============================================================
function drawerField(label, value) {
    return `
        <div class="drawer-field">
            <div class="drawer-field-label">${esc(label)}</div>
            <div class="drawer-field-value">${esc(value || '—')}</div>
        </div>`;
}

function inputField(id, label, value, type = 'text', required = false) {
    return `
        <div class="form-group">
            <label class="form-label" for="${esc(id)}">${esc(label)}${required ? ' *' : ''}</label>
            <input id="${esc(id)}" class="admin-input" type="${type}" value="${esc(value || '')}" placeholder="${esc(label)}" />
        </div>`;
}

function selectField(id, label, options, current) {
    const opts = options.map(o =>
        `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(o)}</option>`
    ).join('');
    return `
        <div class="form-group">
            <label class="form-label" for="${esc(id)}">${esc(label)}</label>
            <select id="${esc(id)}" class="admin-input select">${opts}</select>
        </div>`;
}

function val(id) {
    return (document.getElementById(id)?.value || '').trim();
}

function setInput(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
}

// ============================================================
// INIT — Start Firebase listeners
// ============================================================
listenToAll();