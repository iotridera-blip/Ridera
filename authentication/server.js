require("dotenv").config();

const admin = require("firebase-admin");

const serviceAccount = {
    projectId: process.env.FB_PROJECT_ID,
    privateKey: process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    clientEmail: process.env.FB_CLIENT_EMAIL
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FB_DATABASE_URL,
    storageBucket: process.env.FB_STORAGE_BUCKET
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
        await axios.post(
            "https://api.semaphore.co/api/v4/otp",
            {
                apikey: process.env.SEMAPHORE_API_KEY,
                number: phone,
                message: `Your Ridera Verification code is {otp}. This code is valid for 5 minutes.`,
                code: otp,
                sendername: "RIDERA"
            },
            {
                headers:{
                "Content-Type":"application/json"
            },
                timeout:10000
            }
        );
        console.log("SMS Verification code sent:", phone);
        return res.json({
            success:true
        });
    }catch(error){
        console.log("SEMAPHORE ERROR:", error.response?.data || error.message);
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

// ---------------- SEND CHANGE EMAIL OTP ----------------
app.post("/send-change-email-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({
            success:false,
            message:"Email required"
        });
    }
    const otp = generateOtp();
    const key = email.replace(/\./g, "_");
    await admin.database().ref("otp/changeEmail/" + key).set({
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
                subject:"Account Email Change Code",
                htmlContent:`
                    <p>Your account email change code is:</p>
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
        await admin.database().ref("otp/changeEmail/" + key).remove();
        return res.status(500).json({
            success:false,
            message:"Verification code send failed"
        });
    }
});


// ---------------- VERIFY CHANGE EMAIL OTP ----------------
app.post("/verify-change-email-otp", async (req,res)=>{
    const { email, code } = req.body;
    if(!email || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = email.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/changeEmail/" + key).get();
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
    await admin.database().ref("otp/changeEmail/" + key).remove();
    return res.json({
        verified: true
    });
});

// ---------------- CHANGE EMAIL ----------------
app.post("/change-email", async (req, res) => {
    const { uid, newEmail } = req.body;

    if (!uid || !newEmail) {
        return res.status(400).json({
            success: false,
            message: "Missing fields"
        });
    }

    try {
        // 1. get old email
        const userRecord = await admin.auth().getUser(uid);
        const oldEmail = userRecord.email;

        // 2. update auth email
        await admin.auth().updateUser(uid, {
            email: newEmail
        });

        // 3. update database email
        const usersRef = admin.database().ref("Ridera/users");

        const snapshot = await usersRef
            .orderByChild("uid")
            .equalTo(uid)
            .get();

            if (snapshot.exists()) {
                snapshot.forEach(async (child) => {
                    await child.ref.update({
                    email: newEmail
                });
            });
        }

        // success message (old & new email)
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: "Ridera",
                    email: "iot.ridera@gmail.com"
                },
                to: [{ email: oldEmail }],
                subject: "Account Email Changed",
                htmlContent: `
                    <p>Your account email was recently changed.</p>
                    <p><b>New Email:</b> ${newEmail}</p>
                    <br/>
                    <p>If this wasn't you, please secure your account immediately.</p>
                `
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: "Ridera",
                    email: "iot.ridera@gmail.com"
                },
                to: [{ email: newEmail }],
                subject: "Account Email Updated",
                htmlContent: `
                    <p>Your account email address has been successfully updated.</p>
                    
                    <p>You can now use this email to sign in to your account.</p>
                `
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("EMAIL UPDATED:", uid, oldEmail, "->", newEmail);

        return res.json({
            success: true,
            message: "Email updated"
        });

    } catch (error) {
        console.log("CHANGE EMAIL ERROR:");
        console.log(error.response?.data || error.message || error);
        return res.status(500).json({
            success: false,
            message: "Email update failed"
        });
    }
});

// ---------------- SEND CHANGE PHONE OTP (IPROG SMS) ----------------
app.post("/send-change-phone-otp", async (req,res)=>{
    const { phone } = req.body;
    if(!phone){
        return res.status(400).json({
            success:false,
            message:"Phone required"
        });
    }
    const otp = generateOtp();
    const key = phone.replace(/\./g, "_");
    await admin.database().ref("otp/changePhone/" + key).set({
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000
    });
    try{
        await axios.post(
            "https://api.semaphore.co/api/v4/otp",
            {
                apikey: process.env.SEMAPHORE_API_KEY,
                number: phone,
                message: `Your Ridera change phone number verification code is {otp}. This code is valid for 5 minutes.`,
                code: otp,
                sendername: "RIDERA"
            },
            {
                headers:{
                "Content-Type":"application/json"
            },
                timeout:10000
            }
        );
        console.log("SMS Verification code sent:", phone);
        return res.json({
            success:true
        });
    }catch(error){
        console.log("SEMAPHORE ERROR:", error.response?.data || error.message);
        await admin.database().ref("otp/changePhone/" + key).remove();
        return res.status(500).json({
            success:false
        });
    }
});


// ---------------- VERIFY CHANGE PHONE OTP ----------------
app.post("/verify-change-phone-otp", async (req,res)=>{
    const { phone, code } = req.body;
    if(!phone || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = phone.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/changePhone/" + key).get();
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
    await admin.database().ref("otp/changePhone/" + key).remove();
    return res.json({
        verified: true
    });
});

// ---------------- CHANGE PHONE ----------------
app.post("/change-phone", async (req, res) => {
    const { uid, oldPhone, newPhone } = req.body;
    if (!uid || !newPhone) {
        return res.status(400).json({
            success: false,
            message: "Missing fields"
        });
    }
    try {
        const usersRef = admin.database().ref("Ridera/users");
        const snapshot = await usersRef
            .orderByChild("uid")
            .equalTo(uid)
            .get();
        let previousPhone = null;
        if (snapshot.exists()) {
            const updates = [];
            snapshot.forEach((child) => {
                previousPhone = child.val().phone;
                updates.push(
                    child.ref.update({
                        phone: newPhone
                    })
                );

            });
            await Promise.all(updates);
        }
        // ---------------- SMS TO OLD NUMBER ----------------
        if (previousPhone) {
            await axios.post(
                "https://api.semaphore.co/api/v4/priority",
                {
                    apikey: process.env.SEMAPHORE_API_KEY,
                    number: previousPhone,
                    message: `Your Ridera phone number was changed to ${newPhone}. If this wasn't you, secure your account immediately.`,
                    sendername: "RIDERA"
                },
                {
                    headers:{
                        "Content-Type":"application/json"
                    },
                    timeout:10000
                }
            );
        }
        // ---------------- SMS TO NEW NUMBER ----------------
        await axios.post(
            "https://api.semaphore.co/api/v4/priority",
            {
                apikey: process.env.SEMAPHORE_API_KEY,
                number: newPhone,
                message: `Your Ridera phone number has been updated successfully.`,
                sendername: "RIDERA"
            },
            {
                headers:{
                    "Content-Type":"application/json"
                },
                timeout:10000
            }
        );
        console.log("PHONE UPDATED + SMS SENT:", uid);
        return res.json({
            success: true,
            message: "Phone updated"
        });
    } catch (error) {
        console.log(
            "CHANGE PHONE ERROR:",
            error.response?.data || error.message || error
        );
        return res.status(500).json({
            success: false,
            message: "Phone update failed"
        });
    }
});

// ---------------- SEND CHANGE PASSWORD OTP ----------------3
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

// ---------------- SEND DELETE ACCOUNT OTP ----------------
app.post("/send-delete-account-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({
            success:false,
            message:"Email required"
        });
    }
    const otp = generateOtp();
    const key = email.replace(/\./g, "_");
    await admin.database().ref("otp/deleteAccount/" + key).set({
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
                subject:"Account Deletion Verification Code",
                htmlContent:`
                    <p>You requested to delete your account.</p>
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
        await admin.database().ref("otp/deleteAccount/" + key).remove();
        return res.status(500).json({
            success:false,
            message:"Verification code send failed"
        });
    }
});


// ---------------- VERIFY DELETE ACCOUNT OTP ----------------
app.post("/verify-delete-account-otp", async (req,res)=>{
    const { email, code } = req.body;
    if(!email || !code){
        return res.status(400).json({
            verified:false
        });
    }
    const key = email.replace(/\./g, "_");
    const snap = await admin.database().ref("otp/deleteAccount/" + key).get();
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
    await admin.database().ref("otp/deleteAccount/" + key).remove();
    return res.json({
        verified: true
    });
});

// ---------------- DELETE ACCOUNT ----------------
app.post("/delete-account", async (req, res) => {

    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({
            success: false,
            message: "UID required"
        });
    }

    try {

        // ---------------- GET USER ----------------
        const userRecord = await admin.auth().getUser(uid);

        const email = userRecord.email || "";
        const phone = userRecord.phoneNumber || "";

        // ---------------- FIND USER IN DATABASE ----------------
        const usersRef = admin.database().ref("Ridera/users");

        const snapshot = await usersRef
            .orderByChild("uid")
            .equalTo(uid)
            .get();

        let profileImageUrl = "";

        if (snapshot.exists()) {

            const updates = [];

            snapshot.forEach((child) => {

                const userData = child.val();

                profileImageUrl = userData.photo || "";

                // delete user node
                updates.push(
                    child.ref.remove()
                );

            });

            await Promise.all(updates);
        }

        // ---------------- DELETE PROFILE IMAGE ----------------
        try {

            if (
                profileImageUrl &&
                profileImageUrl.trim() !== "" &&
                profileImageUrl.includes("/o/")
            ) {

                const decodedUrl =
                    decodeURIComponent(profileImageUrl);

                const path =
                    decodedUrl
                        .split("/o/")[1]
                        ?.split("?")[0];

                if (path) {

                    await admin
                        .storage()
                        .bucket()
                        .file(path)
                        .delete();

                    console.log(
                        "PROFILE IMAGE DELETED:",
                        path
                    );
                }
            }

        } catch (storageError) {

            console.log(
                "PROFILE IMAGE DELETE ERROR:",
                storageError.message
            );
        }

        // ---------------- DELETE USER OTPS ONLY ----------------
        const otpRef = admin.database().ref("otp");

        const otpSnap = await otpRef.get();

        if (otpSnap.exists()) {

            const otpData = otpSnap.val();

            const emailKey =
                email.replace(/\./g, "_");

            const phoneKey =
                phone.replace(/\./g, "_");

            const otpTypes = [
                "email",
                "phone",
                "changeEmail",
                "changePhone",
                "changePassword",
                "forgotPassword",
                "deleteAccount"
            ];

            const deleteTasks = [];

            otpTypes.forEach((type) => {

                // email based otp
                if (
                    otpData[type] &&
                    otpData[type][emailKey]
                ) {

                    deleteTasks.push(
                        otpRef
                            .child(type)
                            .child(emailKey)
                            .remove()
                    );
                }

                // phone based otp
                if (
                    otpData[type] &&
                    otpData[type][phoneKey]
                ) {

                    deleteTasks.push(
                        otpRef
                            .child(type)
                            .child(phoneKey)
                            .remove()
                    );
                }

            });

            await Promise.all(deleteTasks);

            console.log(
                "USER OTPS DELETED:",
                uid
            );
        }

        // ---------------- SEND EMAIL ----------------
        if (email) {

            try {

                await axios.post(
                    "https://api.brevo.com/v3/smtp/email",
                    {
                        sender: {
                            name: "Ridera",
                            email: "iot.ridera@gmail.com"
                        },

                        to: [{ email }],

                        subject: "Account Deleted",

                        htmlContent: `
                            <p>Your Ridera account has been permanently deleted.</p>
                            <p>All associated account information has been removed from our system.</p>
                            <br/>
                            <p>Thank you for using Ridera.</p>
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

            } catch (emailError) {

                console.log(
                    "DELETE EMAIL ERROR:",
                    emailError.response?.data ||
                    emailError.message
                );
            }
        }

        // ---------------- DELETE FIREBASE AUTH USER ----------------
        await admin.auth().deleteUser(uid);

        console.log(
            "ACCOUNT DELETED:",
            uid
        );

        return res.json({
            success: true,
            message: "Account Deleted"
        });

    } catch (error) {

        console.log(
            "DELETE ACCOUNT ERROR:",
            error.response?.data ||
            error.message ||
            error
        );

        return res.status(500).json({
            success: false,
            message: "Delete account failed"
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
