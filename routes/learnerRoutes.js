// routes/learner.js
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import GlobalCourse from "../models/GlobalCourse.js";
import Enrollment from "../models/Enrollment.js";
import LearnerProgress from "../models/LearnerProgress.js";
import LearnerCourseProgress from "../models/LearnerCourseProgress.js";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import uploadVideo from "../middleware/uploadVideo.js";
import { uploadToCloudinary } from "../config/cloudinary.js";

const router = express.Router();

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&()[\]{}#^<>.,;:'"~`+=_-]).{8,}$/;


// PUT Update Profile
router.put("/profile/:userId", async (req, res) => {
  try {
    const { fullName, email, bio } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: { fullName, email, bio } },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updatedUser);
  } catch (err) {
    console.error("Update DB Error:", err);
    res.status(500).json({ message: "Error saving to database" });
  }
});

// GET Profile Data
router.get("/profile/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

/* ======================================================
   DASHBOARD DATA
====================================================== */
// routes/learner.js — dashboard-data/:userId
router.get("/dashboard-data/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("xp streak lastLoginDate").lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // Populate courseId + its childCourses
    const enrollments = await Enrollment.find({ userId })
      .populate({
        path: 'courseId',
        populate: { path: 'childCourses' }
      })
      .lean();

    const recommended = await GlobalCourse.find({ isPublished: true })
      .populate('childCourses')
      .sort({ createdAt: -1 })
      .lean();

    // Get learner progress for accurate stats
    const learnerProgress = await LearnerProgress.findOne({ learnerId: userId }).lean();
    
    // Calculate XP earned this week
    let xpThisWeek = 0;
    if (learnerProgress?.completedLabs) {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      xpThisWeek = learnerProgress.completedLabs
        .filter(lab => new Date(lab.completedAt) >= oneWeekAgo)
        .reduce((sum, lab) => sum + (lab.xpEarned || 0), 0);
    }

    const stats = {
      totalXp: user.xp || 0,
      learningStreak: learnerProgress?.streak?.current || user.streak || 0,
      completedLabs: learnerProgress?.totalLabsCompleted || 0,
      xpThisWeek: xpThisWeek
    };

    // Format enrolled same way as enrolled-courses route
    const courseIds = enrollments.filter(e => e.courseId).map(e => e.courseId._id);
    const allProgress = await LearnerCourseProgress.find({
      learnerId: userId,
      courseId: { $in: courseIds }
    }).lean();
    const progressMap = {};
    for (const p of allProgress) {
      progressMap[p.courseId.toString()] = p;
    }

    const enrolled = enrollments
      .filter(e => e.courseId)
      .map(e => {
        const course = e.courseId;
        const moduleCount = course.isSpecialization
          ? (course.childCourses?.reduce((acc, c) => acc + (c.modules?.length || 0), 0) || 0)
          : (course.modules?.length || 0);

        let progress = 0;
        const cp = progressMap[course._id.toString()];
        if (cp) {
          if (cp.isCompleted) {
            progress = 100;
          } else if (course.isSpecialization && cp.childCourses?.length) {
            const totalChildCourses = course.childCourses?.length || cp.childCourses.length;
            const completedChildCourses = cp.childCourses.filter(c => c.isCompleted).length;
            progress = Math.round((completedChildCourses / totalChildCourses) * 100);
          } else if (cp.modules?.length) {
            const totalLessons = cp.modules.reduce((sum, m) => sum + (m.totalLabs || 0) + (m.totalQuizzes || 0), 0);
            const completedLessons = cp.modules.reduce((sum, m) => sum + (m.completedLabs || 0) + (m.completedQuizzes || 0), 0);
            progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
          }
        }

        return {
          enrollmentId: e._id,
          courseId: course._id,
          _id: course._id,
          progress,
          title: course.title,
          thumbnail: course.thumbnail,
          instructor: course.instructor,
          difficulty: course.difficulty,
          duration: course.duration,
          price: course.price,
          isSpecialization: course.isSpecialization || false,
          specializationTitle: course.isSpecialization ? course.title : null,
          moduleCount,
          enrollmentCount: course.enrollmentCount || 0,
          modules: course.modules || [],
          childCourses: course.childCourses || [],
          description: course.description || "",
        };
      });

    const enrolledCourseIds = enrolled.map(e => String(e._id));

    res.json({ enrolled, recommended, stats, enrolledCourseIds });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ message: "Error loading dashboard" });
  }
});

router.post("/upload-video", uploadVideo.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "codezy/videos",
      resource_type: "video",
    });

    res.json({ videoUrl: result.secure_url });
  } catch (err) {
    console.error("Video upload error:", err);
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
});

router.post("/chatbot", async (req, res) => {
  try {
    const { question, context, conversationHistory } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ message: "Question is required" });
    }

    console.log("📤 Incoming question:", question);

    const result = await callN8N("chatbot", {
      user_id: context?.userId || "learner",
      role: "individual_learner",
      question: question,
      new_message: question,
      conversation_history: conversationHistory || [],
      dashboard_context: {
        name: context?.userName || "Learner",
        enrolled_courses: context?.enrolledCourses || [],
        completed_labs: context?.stats?.completedLabs || 0,
        pending_labs: context?.stats?.pendingLabs || 0,
        subscription_plan: context?.plan || "individual",
        badges: context?.badges || [],
        recent_activity: context?.recentActivity || [],
        account_created: context?.accountCreated || ""
      },
      context: context || {}
    });

    console.log("📦 Final result:", JSON.stringify(result, null, 2));

    res.json({
      reply: result.reply || "Sorry, no response.",
      conversationHistory: result.updated_conversation_history || []
    });

  } catch (err) {
    console.error("❌ Chatbot error:", err.message);
    res.json({
      reply: "AI is currently unavailable.",
      conversationHistory: []
    });
  }
});
/* ======================================================
   ACCOUNT SECURITY
====================================================== */

// CHANGE PASSWORD (WITH STRONG VALIDATION)
// PUT Change Password
router.put("/change-password/:userId", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Strong password regex
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&()[\]{}#^<>.,;:'"~`+=_-]).{8,}$/;

    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character"
      });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json({ message: "New password must be different" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // ✅ IMPORTANT FIX (NO FULL VALIDATION)
    await User.updateOne(
      { _id: req.params.userId },
      { $set: { password: hashedPassword } }
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Password Update Error:", err);
    res.status(500).json({ message: "Server error during password update" });
  }
});

router.get("/enrolled-courses/:userId", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ userId: req.params.userId })
      .populate({
        path: 'courseId',
        populate: { path: 'childCourses' }
      })
      .lean();

    // Fetch all progress records for this learner in one query
    const courseIds = enrollments.filter(e => e.courseId).map(e => e.courseId._id);
    const allProgress = await LearnerCourseProgress.find({
      learnerId: req.params.userId,
      courseId: { $in: courseIds }
    }).lean();
    const progressMap = {};
    for (const p of allProgress) {
      progressMap[p.courseId.toString()] = p;
    }

    const formatted = enrollments
      .filter(enroll => enroll.courseId)
      .map(enroll => {
        const course = enroll.courseId;
        const moduleCount = course.isSpecialization
          ? (course.childCourses?.reduce((acc, c) => acc + (c.modules?.length || 0), 0) || 0)
          : (course.modules?.length || 0);

        // Compute progress percentage from LearnerCourseProgress
        let progress = 0;
        const cp = progressMap[course._id.toString()];
        if (cp) {
          if (cp.isCompleted) {
            progress = 100;
          } else if (course.isSpecialization && cp.childCourses?.length) {
            const totalChildCourses = course.childCourses?.length || cp.childCourses.length;
            const completedChildCourses = cp.childCourses.filter(c => c.isCompleted).length;
            progress = Math.round((completedChildCourses / totalChildCourses) * 100);
          } else if (cp.modules?.length) {
            const totalLessons = cp.modules.reduce((sum, m) => sum + (m.totalLabs || 0) + (m.totalQuizzes || 0), 0);
            const completedLessons = cp.modules.reduce((sum, m) => sum + (m.completedLabs || 0) + (m.completedQuizzes || 0), 0);
            progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
          }
        }

        return {
          enrollmentId: enroll._id,
          courseId: course._id,
          progress,
          _id: course._id,
          title: course.title,
          thumbnail: course.thumbnail,
          instructor: course.instructor,
          level: course.difficulty,
          duration: course.duration,
          price: course.price,
          category: course.domain,
          isSpecialization: course.isSpecialization || false,
          specializationTitle: course.isSpecialization ? course.title : null,
          moduleCount,
          enrollmentCount: course.enrollmentCount || 0,
          modules: course.modules || [],
          childCourses: course.childCourses || [],
          description: course.description || "",
        };
      });

    res.json(formatted);
  } catch (err) {
    console.error("Enrolled courses error:", err);
    res.status(500).json({ message: "Error fetching enrolled courses" });
  }
});

// GET: Full Course Content for Learner
router.get("/course-content/:enrollmentId", async (req, res) => {
  try {
    const enrollment = await Enrollment.findById(req.params.enrollmentId)
      .populate("courseId").lean();

    if (!enrollment)
      return res.status(404).json({ message: "Enrollment not found" });

    res.json({
      progress: enrollment.progress,
      course: enrollment.courseId
    });

  } catch (err) {
    console.error("Course content error:", err);
    res.status(500).json({ message: "Error loading course content" });
  }
});


/* ======================================================
   MFA (TWO-FACTOR AUTHENTICATION)
====================================================== */

// Toggle MFA
router.put("/toggle-mfa/:userId", async (req, res) => {
  try {
    const { enabled } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { mfaEnabled: enabled },
      { new: true }
    ).select("mfaEnabled");

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error updating security settings" });
  }
});

// Setup MFA
router.post("/setup-mfa/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    const secret = speakeasy.generateSecret({
      name: `Codezy:${user.email}`
    });

    user.mfaSecret = secret.base32;
    await user.save();

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({ qrCodeUrl });
  } catch (err) {
    res.status(500).json({ message: "Error setting up MFA" });
  }
});

// Verify & Activate MFA
router.post("/verify-mfa/:userId", async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.params.userId);

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: "base32",
      token
    });

    if (!verified) {
      return res.status(400).json({ message: "Invalid 6-digit code" });
    }

    user.mfaEnabled = true;
    await user.save();

    res.json({ message: "MFA activated successfully", mfaEnabled: true });
  } catch (err) {
    res.status(500).json({ message: "Verification failed" });
  }
});

// Disable MFA
router.put("/disable-mfa/:userId", async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, {
      mfaEnabled: false,
      mfaSecret: null
    });

    res.json({ mfaEnabled: false });
  } catch (err) {
    res.status(500).json({ message: "Error disabling MFA" });
  }
});

export default router;
