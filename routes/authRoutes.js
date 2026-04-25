import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Teacher from "../models/Teacher.js";
import speakeasy from "speakeasy";
import Tenant from "../models/Tenant.js";
import Institution from "../models/Institution.js";
import crypto from "crypto";
import transporter from "../config/mailer.js";
import Student from "../models/Students.js";


const router = express.Router();

// ======================== LOGIN ========================
// ======================== LOGIN ========================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const searchEmail = email.toLowerCase();
    let user = null;
    let detectedRole = null;
    // 🚀 --- SUPER ADMIN BYPASS START ---
    // This allows you to log in without a database record
    if (searchEmail === "superadmin@codezy.com" && password === "admin123") {
      const payload = {
        userId: "000000000000000000000000", // Dummy MongoDB ID
        role: "superadmin",
        tenantId: null // SuperAdmin doesn't belong to a single tenant
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d"
      });

      return res.json({
        message: "SuperAdmin login successful",
        token,
        userId: "000000000000000000000000",
        fullName: "System Super Admin",
        email: searchEmail,
        role: "superadmin",
        subscriptionRequired: false
      });
    }
    // 1️⃣ Teacher
    user = await Teacher.findOne({ email: searchEmail });
    if (user) detectedRole = "teacher";

    // 2️⃣ Student
    if (!user) {
      user = await Student.findOne({ email: searchEmail });
      if (user) detectedRole = "student";
    }

    // 3️⃣ Individual Learner
    if (!user) {
      user = await User.findOne({ email: searchEmail });
      if (user) detectedRole = user.role; // individual_learner
    }

    // 4️⃣ Institution Admin
    if (!user) {
      user = await Institution
        .findOne({ adminEmail: searchEmail })
        .select("+password");
      if (user) detectedRole = "institution_admin";
    }

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.password) {
      return res.status(500).json({ message: "Authentication error" });
    }

    // Password check
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    // ========================
    // 🚫 FROZEN ACCOUNT CHECK
    // ========================
    if (user.isFrozen) {
      return res.status(403).json({ 
        message: "Your account has been frozen. Please contact your administrator.",
        accountFrozen: true
      });
    }

    // MFA check (teacher / student only)
    const isMfaEnabled =
      (detectedRole === "teacher" && user.isTwoFactorEnabled) ||
      (detectedRole === "student" && user.mfaEnabled);

    if (isMfaEnabled) {
      return res.json({ mfaRequired: true, userId: user._id });
    }

    // ========================
    // 🚨 HARD TENANT GUARD
    // ========================
    const rolesRequiringTenant = ["institution_admin", "teacher", "student"];

    if (rolesRequiringTenant.includes(detectedRole) && !user.tenantId) {
      return res.status(403).json({
        message: "Account is not linked to an institution. Contact support."
      });
    }

    // ========================
    // JWT
    // ========================
    const payload = {
      userId: user._id,
      role: detectedRole,
      tenantId: user.tenantId
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d"
    });

    // ========================
    // Subscription check
    // ========================
    let subscriptionRequired = false;
    if (
      detectedRole === "institution_admin" &&
      user.subscription?.status !== "active"
    ) {
      subscriptionRequired = true;
    }

    // ========================
    // Events / Notifications  
    // ========================
    // TODO: Re-implement notification system here
    const fullName = user.fullName || user.name || user.username || "User";

    // ========================
    // RESPONSE
    // ========================
    const response = {
      message: subscriptionRequired
        ? "Login successful, subscription pending"
        : "Login successful",
      token,
      userId: user._id,
      tenantId: user.tenantId || null,
      email:
        detectedRole === "institution_admin"
          ? user.adminEmail
          : user.email,
      fullName,
      role: detectedRole,
      subscriptionRequired
    };

    // Add classId for students so they can join class-specific rooms
    if (detectedRole === "student" && user.classId) {
      response.classId = user.classId;
      response.classIds = [user.classId.toString()];
    }

    res.json(response);

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// VERIFY 2FA
router.post("/verify-2fa", async (req, res) => {
  try {
    const { userId, token } = req.body;
    
    // Check both collections for the user
    let user = await Teacher.findById(userId) || await Student.findById(userId);
    
    if (!user) return res.status(404).json({ message: "User not found" });

    // Determine role and which secret to use
    const role = user.role || (user.mfaSecret ? "student" : "teacher");
    const secret = role === "student" ? user.mfaSecret : user.twoFactorSecret;

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token: token,
      window: 1 // Sync margin
    });

    if (!verified) return res.status(401).json({ message: "Invalid 2FA code" });

    // Generate JWT after successful MFA verification
    const jwtToken = jwt.sign(
      {
        userId: user._id,
        role: role,
        tenantId: user.tenantId || null
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const response = { 
      message: "Login successful", 
      token: jwtToken, 
      userId: user._id, 
      role: role,
      fullName: user.name || user.fullName,
      email: user.email,
      tenantId: user.tenantId || null
    };

    // Add classId for students
    if (role === "student" && user.classId) {
      response.classId = user.classId;
      response.classIds = [user.classId.toString()];
    }

    res.json(response);
  } catch (err) {
    console.error("2FA VERIFY ERROR:", err);
    res.status(500).json({ message: "2FA error" });
  }
});

// ======================== FORGOT PASSWORD ========================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // 1. Find user in the main collection
    const user = await User.findOne({ email: email.toLowerCase() });

    // For security, don't reveal if a user exists or not
    if (!user) {
      return res.json({ message: "If email exists, reset link sent" });
    }

    // 2. Generate Reset Token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // 3. Update user fields
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 mins

    // ✅ FIX: Use validateModifiedOnly to bypass the "tenantId is required" error
    await user.save({ validateModifiedOnly: true });

    // 4. Send Email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await transporter.sendMail({
        to: user.email,
        subject: "Password Reset Request - Codezy",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #4f46e5;">Reset Your Password</h2>
            <p>We received a request to reset your Codezy account password.</p>
            <p>Click the button below to proceed:</p>
            <a href="${resetUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">This link will expire in 15 minutes. If you did not request this, please ignore this email.</p>
          </div>
        `,
      });
      
      res.json({ message: "Password reset link sent" });
    } catch (mailError) {
      console.error("MAILER ERROR:", mailError);
      return res.status(500).json({ message: "Could not send email. Please check server configuration." });
    }

  } catch (err) {
    console.error("FORGOT PW ERROR:", err);
    res.status(500).json({ message: "Server error during password reset request" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;

  const hashedToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  user.password = await bcrypt.hash(password, 12);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save({ validateModifiedOnly: true });

  res.json({ message: "Password reset successful" });
});


router.post("/register", async (req, res) => {
  try {
    const { fullName, username, email, password } = req.body;

    if (!fullName || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const normalizedEmail = email.toLowerCase();

    // 1️⃣ Check if email or username exists
    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({ message: "Username or Email already exists" });
    }

    // 2️⃣ Create tenant for this individual learner
    const tenant = await Tenant.create({
      name: `${fullName}'s Workspace`
    });

    // 3️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Create user with tenantId
    const newUser = await User.create({
      fullName,
      username,
      email: normalizedEmail,
      password: hashedPassword,
      role: "individual_learner",
      tenantId: tenant._id
    });

    res.status(201).json({ message: "Registration successful", userId: newUser._id });
  } catch (err) {
    console.error("REGISTRATION ERROR:", err);
    res.status(500).json({ message: "Server error during registration" });
  }
});

router.post("/institution/check-email", async (req, res) => {
  try {
    const { adminEmail } = req.body;
    if (!adminEmail) return res.status(400).json({ message: "Email is required" });

    const existingInstitution = await Institution.findOne({ adminEmail: adminEmail.toLowerCase() });
    res.json({ exists: !!existingInstitution });
  } catch (err) {
    console.error("CHECK EMAIL ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/institution/register", async (req, res) => {
  try {
    const { name, adminEmail, password, contactPhone, metadata, plan } = req.body;

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    const existingInstitution = await Institution.findOne({
      adminEmail: adminEmail.toLowerCase()
    });
    if (existingInstitution) {
      return res.status(400).json({ message: "Admin email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const tenant = await Tenant.create({ name });
    const newInstitution = await Institution.create({
      tenantId: tenant._id,
      type: "institution",
      name,
      adminEmail: adminEmail.toLowerCase(),
      password: hashedPassword,
      contactPhone,
      metadata,
      subscription: {
        plan: plan || "free",
        status: "pending"
      }
    });

    res.status(201).json({
      message: "Institution registered successfully",
      tenantId: newInstitution.tenantId,
      institutionId: newInstitution._id
    });
  } catch (err) {
    console.error("INSTITUTION REGISTER ERROR:", err);
    res.status(500).json({ message: "Server error during institution registration" });
  }
});



export default router;