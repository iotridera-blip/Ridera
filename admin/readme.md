# 🚨 Ridera Admin — Ridera Team

**Emergency Response Dashboard with Real-Time Motorcycle Crash Monitoring**

---

## 📋 Project Structure

```
ridera-admin/
├── server.js                          # Main Express server
├── package.json                       # Dependencies
├── .env                               # Environment variables (create from .env.example)
├── .env.example                       # Environment template
├── README.md                          # This file
│
├── public/                            # Frontend — served by Express
│   ├── index.html                     # Responder Dashboard
│   ├── admin.html                     # Admin Dashboard
│   ├── login.html                     # Login Page
│   ├── js/
│   │   ├── app.js                     # Responder dashboard logic
│   │   └── admin.js                   # Admin dashboard logic
│   └── css/
│       └── style.css                  # Shared styling (both dashboards)
│
└── serviceAccountKey.json             # Firebase Admin SDK key (create — DON'T commit!)
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** v16+ installed ([nodejs.org](https://nodejs.org))
- **Firebase Project** set up ([Firebase Console](https://console.firebase.google.com))
- **Git** for version control

### 2. Clone & Install

```bash
# Clone or download the project
git clone <your-repo-url> ridera-admin
cd ridera-admin

# Install dependencies
npm install

# Or with Yarn
yarn install
```

### 3. Firebase Setup

#### Get Your Service Account Key:
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your **ridera-dg7** project
3. Click **⚙️ Project Settings** (top-left)
4. Go to **Service Accounts** tab
5. Click **Generate New Private Key**
6. Save the downloaded JSON file

#### Add Key to Project:
```bash
# Save the key in project root
mv ~/Downloads/ridera-dg7-xxxxx.json ./serviceAccountKey.json

# Update .env file
cp .env.example .env
# Edit .env and set:
FIREBASE_SERVICE_ACCOUNT_KEY=./serviceAccountKey.json
```

### 4. Environment Setup

Edit `.env` with your values:

```env
# Server
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-secure-random-string-here

# Firebase
FIREBASE_SERVICE_ACCOUNT_KEY=./serviceAccountKey.json
```

Generate a secure session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Run Server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

You should see:
```
╔════════════════════════════════════════════════════════╗
║  Ridera Responder Server                               ║
║  CDRRMO Dasmariñas Emergency Operations Backend         ║
║                                                        ║
║  ✓ Server running on port 3000                         ║
║  ✓ Firebase Admin SDK initialized                      ║
║  ✓ Session management enabled                          ║
║  ✓ Socket.IO real-time active                          ║
║                                                        ║
║  Access:                                               ║
║  - Dashboard: http://localhost:3000                     ║
║  - Admin: http://localhost:3000/admin.html             ║
║  - Login: http://localhost:3000/login.html             ║
╚════════════════════════════════════════════════════════╝
```

### 6. Login

Visit **http://localhost:3000** and log in:

**Demo Credentials:**
- Username: `responder_001`
- Password: (Check your Firebase `authorized_emergency_responder` node)

---

## 🔐 Security Setup

### CRITICAL: Before Production

1. **Change Admin Password:**
   ```bash
   # Hash your password with bcrypt
   node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('YourSecurePassword123', 10, (err, hash) => console.log(hash));"
   ```
   Then update in Firebase:
   ```
   Ridera/authorized_emergency_responder/responder_001/password = <hashed_value>
   ```

2. **Rotate Exposed Credentials:**
   - WiFi passwords in `Ridera/devices/config/`
   - Plaintext passwords in responder records
   - API keys (Google Maps, Firebase)

3. **Firebase Security Rules:**
   Set in [Firebase Console](https://console.firebase.google.com) → Realtime Database → Rules:

   ```json
   {
     "rules": {
       "Ridera": {
         ".read": "auth != null",
         ".write": "auth != null",
         "users": {
           ".write": "root.child('authorized_emergency_responder').child(auth.uid).exists()",
           "crash_alerts": {
             ".write": "auth.uid == $user_id"
           }
         },
         "devices": {
           ".write": "root.child('authorized_emergency_responder').child(auth.uid).child('role').val() === 'admin'",
           "config": {
             ".read": false,
             ".write": false
           }
         },
         "authorized_emergency_responder": {
           ".write": "root.child('authorized_emergency_responder').child(auth.uid).child('role').val() === 'admin'",
           "$responder": {
             "password": { ".read": false }
           }
         }
       }
     }
   }
   ```

4. **Environment Variables:**
   - Use secure random secrets
   - Store in `.env` (never in code)
   - Use Render/Heroku environment variable UI for production
   - Don't commit `.env` to Git

5. **HTTPS:**
   - Enable in production
   - Use Let's Encrypt (free SSL)
   - Set `NODE_ENV=production`

---

## 📊 Features

### Responder Dashboard (`/index.html`)
- **Real-time Incident Map** — Google Maps with crash pins
- **Incident Cards** — Priority badges, status tracking
- **Quick Actions** — Acknowledge, Dispatch, Arrive, Resolve
- **Incident History** — Filterable table, response times
- **Rider Updates** — Crash impact reports, updates
- **System Status** — Device connections, responder availability

### Admin Dashboard (`/admin.html`)
- **System Overview** — User/device/responder stats
- **User Management** — View, edit, delete riders
- **Device Management** — Monitor hardware status, binding
- **Responder Management** — Add/edit/manage dispatchers
- **Account Settings** — Profile, password, logout

### Authentication
- **Session-based** — Express-session with 24-hour TTL
- **Role-based Access** — Admin vs Responder views
- **Password Hashing** — bcryptjs support
- **Secure Cookies** — HttpOnly, SameSite

### Real-Time Features
- **Socket.IO** — Live incident updates to all responders
- **Firebase Listeners** — Automatic sync with database
- **Status Badges** — Online/offline hardware status
- **Toast Notifications** — User actions, confirmations

---

## 🗄️ Firebase Database Schema

### `/Ridera/users/{userId}`
```json
{
  "name": "Juan dela Cruz",
  "email": "juan@example.com",
  "phone": "09171234567",
  "sex": "Male",
  "address": "123 Main St",
  "vehicle_type": "Sport Bike",
  "vehicle_model": "Honda CB 500F",
  "vehicle_plate": "ABC 1234",
  "vehicle_color": "Black",
  "bound_device": "Ridera-001",
  "fcmToken": "xxxx...",
  "uid": "user_id_123",
  "joinedAt": "2026-01-15T10:30:00Z",
  "photo": "https://...",
  "crash_alerts": {
    "crash_001": {
      "id": "crash_001",
      "riderName": "Juan",
      "lat": 14.3295,
      "lng": 120.9360,
      "severity": "high",
      "priority": "HIGH",
      "message": "Hit a pothole",
      "time": "12:44:09",
      "createdAt": 1610000000000,
      "incident_status": "new",
      "vehicle": "Honda CB 500F",
      "plateNumber": "ABC 1234"
    }
  }
}
```

### `/Ridera/devices/{deviceId}`
```json
{
  "device_id": "Ridera-001",
  "device_key": "XXXX-XXXX",
  "status": {
    "state": "Online",
    "last_seen": 1610000000000
  },
  "binding": {
    "state": "bound",
    "uid": "user_id_123"
  },
  "config": {
    "wifi_ssid": "MyNetwork",
    "ip": "192.168.1.100"
  },
  "telematics": {
    "location": {
      "latitude": 14.3295,
      "longitude": 120.9360,
      "city": "Dasmariñas",
      "province": "Cavite",
      "country": "Philippines",
      "speed_kmph": 45,
      "wifi_status": "Good",
      "satellite": "12"
    }
  }
}
```

### `/Ridera/authorized_emergency_responder/{responderId}`
```json
{
  "username": "responder_001",
  "password": "$2a$10$...", // bcrypt hashed
  "role": "admin",
  "agency_name": "CDRRMO Dasmariñas",
  "station_name": "Main Dispatch Center",
  "coverage_area": "Dasmariñas City",
  "address": "123 Admin St",
  "phone": "09171234567",
  "latitude": 14.3295,
  "longitude": 120.9360,
  "is_active": true,
  "on_duty": true,
  "fcm_token": "xxxx...",
  "last_login": 1610000000000,
  "created_at": 1610000000000
}
```

---

## 📡 API Endpoints

### Authentication
- `POST /api/login` — Login (username/password)
- `GET /api/logout` — Logout
- `GET /api/auth/status` — Check auth status
- `GET /api/user` — Get current user info

### Incidents
- `GET /api/incidents` — Fetch all incidents
- `PUT /api/incidents/:id/status` — Update incident status

### Health
- `GET /health` — Server health check

---

## 🔌 Socket.IO Events

**Client → Server:**
- `requestInitialData` — Get all incidents
- `updateIncidentStatus` — Update incident status
- `disconnect` — Client disconnected

**Server → Client:**
- `initialData` — All current incidents
- `incidentUpdated` — Incident status changed
- `newIncidentAlert` — New incident detected
- `error` — Error message

---

## 🐛 Troubleshooting

### Firebase SDK Not Initialized
```
✗ Firebase Admin SDK init failed
```
**Solution:** Check service account key path in `.env`
```bash
# Verify file exists
ls -la ./serviceAccountKey.json
# Ensure valid JSON
cat ./serviceAccountKey.json | jq .
```

### Port Already in Use
```
Error: listen EADDRINUSE :::3000
```
**Solution:** Change port in `.env` or kill the process:
```bash
# On macOS/Linux
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9

# On Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Socket.IO Connection Failed
**Ensure Socket.IO files are in:**
```bash
public/
```
Check browser console for errors. Verify CORS settings in `server.js`.

### Login Not Working
1. Check responder exists in Firebase:
   - Firebase Console → Realtime Database → `Ridera/authorized_emergency_responder`
2. Verify password is correct (can be plaintext or bcrypt hashed)
3. Check browser console for network errors
4. Verify server is running: `curl http://localhost:3000/health`

---

## 🚀 Deployment

### Render (Recommended)
1. Push to GitHub
2. Create new Web Service on [Render](https://render.com)
3. Connect GitHub repo
4. Environment variables:
   - Copy all from `.env.example` and fill in
   - For `FIREBASE_SERVICE_ACCOUNT_KEY`, paste the entire JSON content
5. Deploy

### Heroku
```bash
heroku create ridera-admin
git push heroku main
heroku config:set FIREBASE_SERVICE_ACCOUNT_KEY='<json_content>'
heroku logs --tail
```

### VPS (Self-hosted)
```bash
# SSH to server
ssh user@your-server

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repo
git clone <url> ridera-admin
cd ridera-admin

# Install PM2 (process manager)
npm install -g pm2

# Start with PM2
pm2 start server.js --name ridera
pm2 startup
pm2 save

# Setup Nginx reverse proxy
sudo nano /etc/nginx/sites-available/ridera
# Proxy to http://localhost:3000
```

---

## 📝 Notes for Joshua

### Next Steps
1. ✅ Fill Firebase config in `admin.js` (apiKey, messagingSenderId, appId)
2. ✅ Get Google Maps API key → update `admin.html`
3. ✅ Set CDRRMO station coordinates in `app.js` → `RESPONDER_LOCATION`
4. ✅ Update admin responder record with actual credentials
5. ✅ Test login flow end-to-end
6. ✅ Review and update Firebase Security Rules
7. ✅ Set up SSL/HTTPS for production
8. ✅ Configure backup strategy for Firebase data

### Security Checklist
- [ ] Change all default passwords
- [ ] Hash existing plaintext passwords
- [ ] Remove hardcoded credentials from code
- [ ] Set Firebase Security Rules
- [ ] Enable HTTPS
- [ ] Set up rate limiting
- [ ] Configure CORS properly
- [ ] Regular security audits

### Monitoring
- Set up error tracking (Sentry, DataDog)
- Monitor Firebase costs
- Set up uptime monitoring
- Review logs regularly
- Track incident response times

---

## 📞 Support

For issues or questions:
1. Check troubleshooting section above
2. Review Firebase documentation
3. Check browser console for errors
4. Check server logs: `npm run dev` to see detailed output

---

**Made with 🚨 for CDRRMO Dasmariñas**  
Version 1.0.0 | January 2026