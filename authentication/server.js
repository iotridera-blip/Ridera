require("dotenv").config();

const admin = require("firebase-admin");

const serviceAccount = {
    projectId: process.env.FB_PROJECT_ID,
    privateKey: process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    clientEmail: process.env.FB_CLIENT_EMAIL
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FB_DATABASE_URL
});

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// ---------------- OTP GENERATOR ----------------
function generateOtp() {
    return Math.floor(
        100000 + Math.random() * 900000
    ).toString();
}

// ---------------- SEND EMAIL OTP ----------------
app.post("/send-email-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({
            success:false,
            message:"Email required"
        });
    }
    const otp = generateOtp();
    const key = email.replace(/\./g, "_");
    await admin.database().ref("otp/email/" + key).set({
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000
    });
    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender:{
                    name:"Ridera",
                    email:"iot.ridera@gmail.com"
                },
                to:[{ email }],
                subject:"Ridera Verification Code",
                htmlContent:`
                    <p>Your verification code is:</p>
                    <h2 style="letter-spacing:3px;">
                        ${otp}
                    </h2>
                    <p>This code is valid for 5 minutes.</p>
                    <p>If you did not request this code, please ignore this email.</p>
                `
            },
            {
                headers:{
                    "api-key":process.env.BREVO_API_KEY,
                    "Content-Type":"application/json"
                },
                timeout:10000
            }
        );
        console.log("Verification code sent to:", email);
        return res.json({
            success:true
        });
    } catch(error){
        console.log("BREVO ERROR:", error.response?.data || error.message);
        await admin.database().ref("otp/email/" + key).remove();
        return res.status(500).json({
            success:false,
            message:"Verification code send failed"
        });
    }
});


// ---------------- VERIFY EMAIL OTP ----------------
app.post("/verify-email-otp", async (req,res)=>{
    const { email, code } = req.body;
    if(!email || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = email.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/email/" + key).get();
    const data = snap.val();
    // invalid otp
    if (!data || data.code !== code) {
        return res.json({
            verified: false,
            message: "Invalid OTP"
        });
    }
    // valid but expired 
    if (Date.now() > data.expiresAt) {
        return res.json({
            verified: false,
            message: "OTP expired"
        });
    }
    // success
    await admin.database().ref("otp/email/" + key).remove();
    return res.json({
        verified: true
    });
});


// ---------------- SEND PHONE OTP (IPROG SMS) ----------------
app.post("/send-phone-otp", async (req,res)=>{
    const { phone } = req.body;
    if(!phone){
        return res.status(400).json({
            success:false,
            message:"Phone required"
        });
    }
    const otp = generateOtp();
    const key = phone.replace(/\./g, "_");
    await admin.database().ref("otp/phone/" + key).set({
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000
    });
    try{
        const message =
            encodeURIComponent(
                `Your Ridera Verification code is ${otp}. This code is valid for 5 minutes.`
            );
        const url =
            `https://www.iprogsms.com/api/v1/sms_messages` +
            `?api_token=${process.env.IPROG_API_TOKEN}` +
            `&message=${message}` +
            `&phone_number=${phone}`;
        // same as your curl uses POST
        await axios.post(
            url,
            null,
            {
                timeout:10000
            }
        );
        console.log("SMS Verification code sent:", phone);
        return res.json({
            success:true
        });
    }catch(error){
        console.log("IPROG SMS ERROR:", error.response?.data || error.message);
        await admin.database().ref("otp/phone/" + key).remove();
        return res.status(500).json({
            success:false
        });
    }
});


// ---------------- VERIFY PHONE OTP ----------------
app.post("/verify-phone-otp", async (req,res)=>{
    const { phone, code } = req.body;
    if(!phone || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = phone.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/phone/" + key).get();
    const data = snap.val();
    // invalid otp
    if (!data || data.code !== code) {
        return res.json({
            verified: false,
            message: "Invalid OTP"
        });
    }
    // valid but expired 
    if (Date.now() > data.expiresAt) {
        return res.json({
            verified: false,
            message: "OTP expired"
        });
    }
    // success
    await admin.database().ref("otp/phone/" + key).remove();
    return res.json({
        verified: true
    });
});

// ---------------- SEND FORGOT PASSWORD OTP ----------------
app.post("/send-forgot-password-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({
            success:false,
            message:"Email required"
        });
    }
    const otp = generateOtp();
    const key = email.replace(/\./g, "_");
    await admin.database().ref("otp/forgotPassword/" + key).set({
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000
    });

    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender:{
                    name:"Ridera",
                    email:"iot.ridera@gmail.com"
                },
                to:[{ email }],
                subject:"Account Password Reset Code",
                htmlContent:`
                    <p>Your account password reset code is:</p>
                    <h2 style="letter-spacing:3px;">
                        ${otp}
                    </h2>
                    <p>This code is valid for 5 minutes.</p>
                    <p>If you did not request this code, please ignore this email.</p>
                `
            },
            {
                headers:{
                    "api-key":process.env.BREVO_API_KEY,
                    "Content-Type":"application/json"
                },
                timeout:10000
            }
        );
        console.log("Password reset code sent to:", email);
        return res.json({
            success:true
        });
    } catch(error){
        console.log("BREVO ERROR:", error.response?.data || error.message);
        await admin.database().ref("otp/forgotPassword/" + key).remove();
        return res.status(500).json({
            success:false,
            message:"Password reset code send failed"
        });
    }
});


// ---------------- VERIFY FORGOT PASSWORD OTP ----------------
app.post("/verify-forgot-password-otp", async (req,res)=>{
    const { email, code } = req.body;
    if(!email || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = email.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/forgotPassword/" + key).get();
    const data = snap.val();
    // invalid otp
    if (!data || data.code !== code) {
        return res.json({
            verified: false,
            message: "Invalid OTP"
        });
    }
    // valid but expired 
    if (Date.now() > data.expiresAt) {
        return res.json({
            verified: false,
            message: "OTP expired"
        });
    }
    // success
    await admin.database().ref("otp/forgotPassword/" + key).remove();
    return res.json({
        verified: true
    });
});

// ---------------- RESET PASSWORD --------------
app.post("/reset-password", async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
        return res.status(400).json({
            success: false,
            message: "Missing fields"
        });
    }
    try {
        // TODO: Update password
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(user.uid, {
            password: newPassword
        });
        console.log("Reset password for:", email);
        // send email (success message)
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: "Ridera",
                    email: "iot.ridera@gmail.com"
                },
                to: [{ email }],
                subject: "Account Password Updated",
                htmlContent: `
                    <p>Your account password has been successfully updated.</p>
                    <p>If this wasn’t you, please secure your account immediately.</p>
                `
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            }
        );
        return res.json({
            success: true,
            message: "Password updated"
        });
    } catch (error) {
        console.log(error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Reset failed"
        });
    }
});

// ---------------- SEND CHANGE PASSWORD OTP ----------------
app.post("/send-change-password-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({
            success:false,
            message:"Email required"
        });
    }
    const otp = generateOtp();
    const key = email.replace(/\./g, "_");
    await admin.database().ref("otp/changePassword/" + key).set({
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000
    });
    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender:{
                    name:"Ridera",
                    email:"iot.ridera@gmail.com"
                },
                to:[{ email }],
                subject:"Account Password Change Code",
                htmlContent:`
                    <p>Your account password change code is:</p>
                    <h2 style="letter-spacing:3px;">
                        ${otp}
                    </h2>
                    <p>This code is valid for 5 minutes.</p>
                    <p>If you did not request this code, please ignore this email.</p>
                `
            },
            {
                headers:{
                    "api-key":process.env.BREVO_API_KEY,
                    "Content-Type":"application/json"
                },
                timeout:10000
            }
        );
        console.log("Password change code sent to:", email);
        return res.json({
            success:true
        });
    } catch(error){
        console.log("BREVO ERROR:", error.response?.data || error.message);
        await admin.database().ref("otp/changePassword/" + key).remove();
        return res.status(500).json({
            success:false,
            message:"Password change code send failed"
        });
    }
});

// ---------------- VERIFY CHANGE PASSWORD OTP ----------------
app.post("/verify-change-password-otp", async (req,res)=>{
    const { email, code } = req.body;
    if(!email || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = email.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/changePassword/" + key).get();
    const data = snap.val();
    // invalid otp
    if (!data || data.code !== code) {
        return res.json({
            verified: false,
            message: "Invalid OTP"
        });
    }
    // valid but expired 
    if (Date.now() > data.expiresAt) {
        return res.json({
            verified: false,
            message: "OTP expired"
        });
    }
    // success
    await admin.database().ref("otp/changePassword/" + key).remove();
    return res.json({
        verified: true
    });
});

// ---------------- CHANGE PASSWORD --------------
app.post("/change-password", async (req, res) => {
    const { email, currentPassword, newPassword } = req.body;
    if (!email || !currentPassword || !newPassword) {
        return res.status(400).json({
            success: false,
            message: "Missing fields"
        });
    }
    try {
        // TODO: Change password
        // verify current password
        await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FB_API_KEY}`,
            {
                email,
                password: currentPassword,
                returnSecureToken: true
            }
        );
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(user.uid, {
            password: newPassword
        });
        console.log("Password changed for:", email);
        // send email (success message)
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: "Ridera",
                    email: "iot.ridera@gmail.com"
                },
                to: [{ email }],
                subject: "Account Password Changed",
                htmlContent: `
                    <p>Your account password has been successfully changed.</p>
                    <p>If this wasn’t you, please secure your account immediately.</p>
                `
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            }
        );
        return res.json({
            success: true,
            message: "Password changed"
        });
    } catch (error) {
        console.log(error.response?.data || error.message);
        const msg = error.response?.data?.error?.message;
        // invalid current password case
        if (msg === "INVALID_LOGIN_CREDENTIALS" || msg === "INVALID_PASSWORD") {
            return res.status(401).json({
                success: false,
                message: "Current password is invalid"
            });
        }
        return res.status(500).json({
            success: false,
            message: "Change failed"
        });
    }
});

// ---------------- SEND WELCOME EMAIL ----------------
app.post("/send-welcome-email", async (req, res) => {
    const { email, name } = req.body;
    if (!email || !name) {
        return res.status(400).json({
            success:false,
            message:"Missing fields"
        });
    }
    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender:{
                    name:"Ridera",
                    email:"iot.ridera@gmail.com"
                },
                to:[{ email }],
                subject:"Welcome to Ridera",
                htmlContent:`
                    <p>Hello ${name},</p>
                    
                    <p>Your account has been successfully created.</p>
                    
                    <p>Ridera is now ready to connect to your device for real-time tracking and emergency response.</p>
                    
                    <br/>
                    <p>You’re all set. Ride safe.</p>
                `
            },
            {
                headers:{
                    "api-key":process.env.BREVO_API_KEY,
                    "Content-Type":"application/json"
                },
                timeout:10000
            }
        );
        console.log("Welcome sent to:", email);
        return res.json({
            success:true
        });

    } catch(error){
        console.log("BREVO ERROR:", error.response?.data || error.message);
        return res.status(500).json({
            success:false,
            message:"Welcome send failed"
        });
    }
});

// ---------------- HEALTH CHECK ----------------

app.get("/",(req,res)=>{
    res.send("Ridera Auth Server Running...");
});


// ---------------- START SERVER ----------------

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
    console.log(
        "Server running on port " + PORT
    );

});

/*
const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const otpStore = {};
const phoneOtpStore = {};

// ---------------- OTP GENERATOR ----------------

function generateOtp() {
    return Math.floor(
        100000 + Math.random() * 900000
    ).toString();
}


// ---------------- SEND OTP ----------------

app.post("/send-otp", async (req, res) => {

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success:false,
            message:"Email required"
        });
    }

    const otp = generateOtp();

    // save otp immediately
    otpStore[email] = otp;

    try {

        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender:{
                    name:"Ridera",
                    email:"iot.ridera@gmail.com"
                },

                to:[{ email }],

                subject:"Ridera OTP Code",

                htmlContent:`
                    <p>Your OTP code is:</p>
                    <h2 style="letter-spacing:3px;">
                        ${otp}
                    </h2>
                    <p>If you did not request this code,
                    please ignore this email.</p>
                `
            },
            {
                headers:{
                    "api-key":process.env.BREVO_API_KEY,
                    "Content-Type":"application/json"
                },

                // NEW: prevents hanging forever
                timeout:10000
            }
        );

        console.log("OTP sent to:", email);

        return res.json({
            success:true
        });

    } catch(error){

        console.log(
            "BREVO ERROR:",
            error.response?.data || error.message
        );

        // remove bad otp if email failed
        delete otpStore[email];

        return res.status(500).json({
            success:false,
            message:"OTP send failed"
        });

    }

});


// ---------------- VERIFY OTP ----------------

app.post("/verify-otp",(req,res)=>{

    const { email, code } = req.body;

    if(!email || !code){
        return res.status(400).json({
            verified:false
        });
    }

    if(otpStore[email] === code){

        // one-time use only
        delete otpStore[email];

        return res.json({
            verified:true
        });
    }

    return res.json({
        verified:false
    });

});

// ---------------- SEND PHONE OTP (NEW) ----------------

app.post("/send-phone-otp", async (req,res)=>{

    const { phone } = req.body;

    if(!phone){
        return res.status(400).json({
            success:false,
            message:"Phone required"
        });
    }

    const otp = generateOtp();

    // store phone otp
    phoneOtpStore[phone] = otp;

    try{

        await axios.post(
            "https://api.brevo.com/v3/transactionalSMS/send",
            {
                sender:"Ridera",
                recipient:phone, // format: +639xxxxxxxxx
                content:`Your Ridera OTP code is ${otp}`,
                type:"transactional"
            },
            {
                headers:{
                    "api-key":process.env.BREVO_API_KEY,
                    "Content-Type":"application/json"
                },
                timeout:10000
            }
        );

        console.log("SMS OTP sent:", phone);

        return res.json({
            success:true
        });

    }catch(error){

        console.log(
            "SMS ERROR:",
            error.response?.data || error.message
        );

        delete phoneOtpStore[phone];

        return res.status(500).json({
            success:false
        });

    }

});


// ---------------- VERIFY PHONE OTP (NEW) ----------------

app.post("/verify-phone-otp",(req,res)=>{

    const { phone, code } = req.body;

    if(!phone || !code){
        return res.status(400).json({
            verified:false
        });
    }

    if(phoneOtpStore[phone] === code){

        // one time use
        delete phoneOtpStore[phone];

        return res.json({
            verified:true
        });
    }

    return res.json({
        verified:false
    });

});


// ---------------- HEALTH CHECK ----------------
// helps Render stay alive / test endpoint

app.get("/",(req,res)=>{
    res.send("Ridera OTP Server Running");
});


// ---------------- START SERVER ----------------

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{

    console.log(
        "Server running on port " + PORT
    );

});
*/
