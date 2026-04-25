import express from "express";
import mongoose from "mongoose";
import Student from "../models/Students.js";
import Course from "../models/Course.js";
import StudentGamification from "../models/StudentGamification.js";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import GamificationEngine from "../services/GamificationEngine.js";
import { callN8N } from "../services/n8nService.js";
const router = express.Router();

// Helper to determine UI themes based on Course Code (as seen in your snippet)
const getDisplayProps = (courseCode) => {
    switch (courseCode) {
        case 'PF101': return { icon: '💻', color: 'from-blue-500 to-purple-500', instructor: 'Dr. Sarah Malik' };
        case 'DSA303': return { icon: '📊', color: 'from-green-500 to-teal-500', instructor: 'Dr. Ali Ahmed' };
        case 'WD202': return { icon: '🌐', color: 'from-orange-500 to-red-500', instructor: 'Dr. Rizwan Khan' };
        case 'DS404': return { icon: '🗃️', color: 'from-indigo-500 to-blue-500', instructor: 'Dr. Nida Shah' };
        default: return { icon: '📚', color: 'from-gray-400 to-gray-600', instructor: 'Staff' };
    }
};

/* =============================================================
   1. STUDENT DASHBOARD DATA
============================================================= */
router.get("/:studentId/dashboard-data", async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const student = await Student.findById(studentId).lean();
    if (!student) return res.status(404).json({ message: "Student not found" });

    // Find ALL courses where this student is enrolled in any class
    const allCourses = await Course.find({
      tenantId: student.tenantId,
      "classes.students": new mongoose.Types.ObjectId(studentId)
    }).populate("classes.teacher", "name").lean();

    if (!allCourses || allCourses.length === 0) {
      return res.json({ studentName: student.name, labs: [], enrolledCourses: [] });
    }

    let allLabs = [];
    const enrolledCourses = [];

    // Process each course the student is enrolled in
    for (const course of allCourses) {
      // Find the class(es) in this course where student is enrolled
      const studentClasses = course.classes.filter(c => 
        c.students.some(s => s.toString() === studentId)
      );

      for (const studentClass of studentClasses) {
        // Get active labs from this class
        const activeLabs = (studentClass.labs || []).filter(lab => lab.status === "Active");
        
        let completedLabsCount = 0;
        let totalXpEarned = 0;

        // Process each lab
        for (const lab of activeLabs) {
          const studentSubmission = lab.submissions?.find(
            sub => sub.studentId?.toString() === studentId
          );
          
          if (studentSubmission) {
            completedLabsCount++;
            totalXpEarned += studentSubmission.xp || 0;
          }

          // Format submission date/time
          let submittedDate = null;
          let submittedTime = null;
          if (studentSubmission?.submittedAt) {
            const subDate = new Date(studentSubmission.submittedAt);
            submittedDate = subDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            submittedTime = subDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          }

          // Determine lab status
          let labStatus = 'Pending';
          if (studentSubmission) {
            labStatus = studentSubmission.isLate ? 'Late Submitted' : 'Submitted';
          } else {
            // Check if deadline has passed
            const now = new Date();
            const dueDateTime = new Date(lab.dueDate);
            if (lab.dueTime) {
              const [hours, minutes] = lab.dueTime.split(':');
              dueDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            }
            if (now > dueDateTime) {
              labStatus = 'Expired';
            }
          }

          allLabs.push({
            _id: lab._id,
            title: lab.title,
            marks: lab.marks,
            dueDate: lab.dueDate,
            dueTime: lab.dueTime,
            course: course.title,
            courseCode: course.courseCode,
            hasSubmitted: !!studentSubmission,
            status: labStatus,
            submittedAt: studentSubmission?.submittedAt || null,
            submittedDate,
            submittedTime,
            score: studentSubmission?.averageScore || 0,
            xpEarned: studentSubmission?.xp || 0
          });
        }

        // Add this course to enrolled courses (avoid duplicates)
        if (!enrolledCourses.find(ec => ec._id.toString() === course._id.toString())) {
          enrolledCourses.push({
            _id: course._id,
            title: course.title,
            courseCode: course.courseCode,
            teacher: studentClass.teacher?.name || "Instructor",
            schedule: course.schedule || "TBD",
            xpProgress: totalXpEarned,
            xpTotal: 1000,
            labsCompleted: completedLabsCount,
            totalLabs: activeLabs.length
          });
        }
      }
    }

    res.json({
      studentName: student.name,
      xp: student.xp || 0,
      labs: allLabs,
      enrolledCourses
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ message: "Dashboard error" });
  }
});

router.get("/:studentId/achievements", async (req, res) => {
    try {
        const { studentId } = req.params;
        
        // Use GamificationEngine to get real achievement data
        const achievementData = await GamificationEngine.getStudentAchievements(studentId);
        
        res.json(achievementData);
    } catch (err) {
        console.error("Error fetching achievements:", err);
        res.status(500).json({ message: "Error fetching achievements" });
    }
});
/* -------------------------------------
   4. CHANGE PASSWORD
-------------------------------------- */
router.post("/:studentId/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const student = await Student.findById(req.params.studentId);

        if (!student) return res.status(404).json({ message: "Student not found" });

        // 1. Validate Complexity (8 chars, 1 Upper, 1 Digit, 1 Symbol)
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({ 
                message: "Complexity requirement not met: 8+ chars, 1 uppercase, 1 digit, and 1 symbol required." 
            });
        }

        // 2. Verify Current Password
        const isMatch = await bcrypt.compare(currentPassword, student.password);
        if (!isMatch) return res.status(400).json({ message: "Current password is incorrect" });

        // 3. Hash and Save
        const salt = await bcrypt.genSalt(10);
        student.password = await bcrypt.hash(newPassword, salt);
        await student.save();

        res.json({ message: "Password updated successfully" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
/* =============================================================
   2. UPDATE STUDENT ACADEMICS (XP & PROGRESS)
   This route is called when a student completes a lab
============================================================= */
router.post("/:studentId/update-stats", async (req, res) => {
    try {
        const { studentId } = req.params;
        const { xpEarned, newProgress } = req.body;

        // Update the central Student record
        const updatedStudent = await Student.findByIdAndUpdate(
            studentId,
            { 
                $inc: { xp: xpEarned },
                $set: { progress: newProgress }
            },
            { new: true }
        );

        res.json({ 
            message: "Academic stats updated", 
            currentXp: updatedStudent.xp 
        });
    } catch (err) {
        res.status(500).json({ message: "Error updating student stats" });
    }
});
router.get("/:studentId/courses", async (req, res) => {
  try {
    const student = await Student.findById(req.params.studentId).lean();
    if (!student) return res.status(404).json({ message: "Student not found" });

    // Find ALL courses where this student is in any class's students array
    const allCourses = await Course.find({
      tenantId: student.tenantId,
      "classes.students": new mongoose.Types.ObjectId(req.params.studentId)
    }).populate("classes.teacher", "name").lean();

    if (!allCourses || allCourses.length === 0) {
      return res.json([]);
    }

    const result = [];

    for (const course of allCourses) {
      // Find the class(es) where student is enrolled
      const studentClasses = course.classes.filter(c =>
        c.students.some(s => s.toString() === req.params.studentId)
      );

      for (const cls of studentClasses) {
        const activeLabs = (cls.labs || []).filter(lab => lab.status === "Active");
        let attemptedLabs = 0;
        
        // Count how many labs the student has submitted
        for (const lab of activeLabs) {
          const hasSubmitted = lab.submissions?.some(
            sub => sub.studentId?.toString() === req.params.studentId
          );
          if (hasSubmitted) attemptedLabs++;
        }

        // Calculate progress percentage
        const progress = activeLabs.length > 0 
          ? Math.round((attemptedLabs / activeLabs.length) * 100) 
          : 0;

        result.push({
          courseId: course._id,
          classId: cls._id,
          title: course.title,
          courseCode: course.courseCode,
          instructor: cls.teacher?.name || "Instructor",
          progress: progress,
          attemptedLabs: attemptedLabs,
          totalLabs: activeLabs.length
        });
      }
    }

    res.json(result);
  } catch (err) {
    console.error("Courses fetch error:", err);
    res.status(500).json({ message: "Courses fetch error" });
  }
});

router.get("/:studentId/courses/:courseId/labs", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    const student = await Student.findById(studentId).lean();
    const course = await Course.findById(courseId)
      .populate("classes.teacher", "name")
      .lean();

    if (!student || !course) return res.status(404).json({ message: "Data not found" });

    // Find the class where the student is enrolled in THIS course
    const studentClass = course.classes.find(c =>
      c.students.some(s => s.toString() === studentId)
    );

    if (!studentClass) return res.json({ active: [], history: [] });

    const active = [];
    const history = [];

    studentClass.labs.forEach(lab => {
      // Logic: Only show labs that are NOT "Draft"
      if (lab.status !== "Draft") {
        // Check if this student has submitted
        const studentSubmission = lab.submissions?.find(
          sub => sub.studentId?.toString() === studentId
        );

        const labData = {
          ...lab,
          createdBy: lab.createdBy?.name || studentClass.teacher?.name,
          tasks: lab.tasks || [],
          courseCode: course.courseCode,
          // Add student's submission status
          hasSubmitted: !!studentSubmission,
          status: studentSubmission 
            ? (studentSubmission.isLate ? 'Late Submitted' : 'Submitted')
            : 'Pending',
          submittedAt: studentSubmission?.submittedAt || null,
          score: studentSubmission?.averageScore || 0,
          performance: studentSubmission 
            ? Math.round((studentSubmission.averageScore / lab.marks) * 100) 
            : 0
        };

        // All non-draft labs go to active (frontend handles display based on status)
        active.push(labData);
      }
    });

    res.json({ active, history });
  } catch (err) {
    console.error("Error fetching labs:", err);
    res.status(500).json({ message: "Error fetching labs" });
  }
});
// Get specific lab details for the Lab Session page
// GET: Fetch full lab details for the session page
router.get("/lab-details/:labId", async (req, res) => {
  try {
    const { labId } = req.params;

    // Use MongoDB projection to find the specific course containing this lab
    const course = await Course.findOne(
      { "classes.labs._id": labId },
      { "classes.$": 1, "title": 1, "courseCode": 1 } // Only return the relevant class
    ).lean();

    if (!course) {
      return res.status(404).json({ message: "Lab not found in any courses." });
    }

    // Extract the specific lab from the returned class
    const targetClass = course.classes[0];
    const lab = targetClass.labs.find(l => l._id.toString() === labId);

    if (!lab) return res.status(404).json({ message: "Lab data corrupted." });

    // Respond with combined lab and course metadata
    res.json({
      ...lab,
      language: lab.language || 'python',
      courseTitle: course.title,
      courseCode: course.courseCode,
      teacherName: targetClass.teacher?.name || "Instructor"
    });

  } catch (err) {
    console.error("Backend Lab Fetch Error:", err);
    res.status(500).json({ message: "Internal server error fetching lab." });
  }
});
/* =============================================================
   3. GET STUDENT PROFILE (With Dynamic Stats)
============================================================= */
router.get("/:studentId/profile", async (req, res) => {
    try {
        const student = await Student.findById(req.params.studentId).select("-password").lean();
        if (!student) return res.status(404).json({ message: "Student not found" });

        // Find the course and class the student is in
        const course = await Course.findById(student.course).lean();
        
        let stats = {
            enrolledCourses: 0,
            completedLabs: 0,
            pendingLabs: 0
        };

        if (course) {
            stats.enrolledCourses = 1; // Student is enrolled in this course

            const studentClass = course.classes.find(
                c => c._id.toString() === student.classId?.toString()
            );

            if (studentClass) {
                const totalActiveLabs = studentClass.labs.filter(l => l.status === "Active");

                // Count completed by checking submissions on each active lab
                const studentId = req.params.studentId;
                stats.completedLabs = totalActiveLabs.filter(lab =>
                    lab.submissions?.some(sub => sub.studentId?.toString() === studentId)
                ).length;

                stats.pendingLabs = Math.max(0, totalActiveLabs.length - stats.completedLabs);
            }
        }

        // Return profile data combined with calculated stats
        res.json({
            ...student,
            stats // Sending calculated numbers to frontend
        });
    } catch (err) {
        res.status(500).json({ message: "Error fetching profile stats" });
    }
});

/* -------------------------------------
   STUDENT MFA & SECURITY ROUTES
-------------------------------------- */
/* -------------------------------------
   1. SETUP: Generate and PERSIST Secret
-------------------------------------- */
router.get("/:studentId/mfa/setup", async (req, res) => {
  const student = await Student.findById(req.params.studentId);
  if (!student) return res.status(404).json({ message: "Student not found" });

  let secret;

  if (!student.mfaSecret) {
    secret = speakeasy.generateSecret({
      name: `Codezy:${student.email}`,
      issuer: "Codezy"
    });

    student.mfaSecret = secret.base32;
    student.mfaEnabled = false;
    await student.save();
  } else {
    secret = {
      base32: student.mfaSecret,
      otpauth_url: speakeasy.otpauthURL({
        secret: student.mfaSecret,
        label: `Codezy:${student.email}`,
        issuer: "Codezy",
        encoding: "base32"
      })
    };
  }

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ qrCodeUrl });
});

/* -------------------------------------
   2. VERIFY: Retrieve and Compare
-------------------------------------- */
router.post("/:studentId/mfa/verify", async (req, res) => {
    try {
        const { token } = req.body;
        // Do NOT use .select("-password") here if it might interfere with other fields; 
        // Just fetch the document normally
        const student = await Student.findById(req.params.studentId);

        // This is where your current error "No secret found" is triggered
        if (!student || !student.mfaSecret) {
            return res.status(400).json({ 
                message: "No secret found in database. Please refresh and scan a new QR code." 
            });
        }

        const isVerified = speakeasy.totp.verify({
            secret: student.mfaSecret,
            encoding: 'base32',
            token: String(token).trim(),
            window: 2 // Margin for network/time sync issues
        });

        if (isVerified) {
            await Student.findByIdAndUpdate(req.params.studentId, { mfaEnabled: true });
            res.json({ message: "MFA Enabled successfully" });
        } else {
            res.status(400).json({ message: "Invalid code. Please try again." });
        }
    } catch (err) {
        res.status(500).json({ message: "Server error during verification" });
    }
});

// 3. DISABLE: Remove MFA
router.post("/:studentId/mfa/disable", async (req, res) => {
    try {
        const student = await Student.findById(req.params.studentId);
        if (!student) return res.status(404).json({ message: "Student not found" });

        student.mfaSecret = null;
        student.mfaEnabled = false;
        await student.save();
        res.json({ message: "MFA Disabled" });
    } catch (err) {
        res.status(500).json({ message: "Error disabling MFA" });
    }
});

/* =============================================================
   LAB RESULTS - Get task-wise scores for a submitted lab
============================================================= */
router.get("/:studentId/lab-results/:labId", async (req, res) => {
    try {
        const { studentId, labId } = req.params;

        // Find the course that contains this lab (labs are inside classes)
        const course = await Course.findOne({ "classes.labs._id": labId });
        if (!course) {
            return res.status(404).json({ message: "Lab not found" });
        }

        // Find the specific class and lab
        let lab = null;
        for (const cls of course.classes) {
            const foundLab = cls.labs.id(labId);
            if (foundLab) {
                lab = foundLab;
                break;
            }
        }

        if (!lab) {
            return res.status(404).json({ message: "Lab not found" });
        }

        // Find the student's submission
        const submission = lab.submissions.find(
            sub => sub.studentId && sub.studentId.toString() === studentId
        );

        if (!submission) {
            return res.status(404).json({ message: "No submission found for this lab" });
        }

        // Build task details with results
        const tasks = lab.tasks.map((task, index) => {
            // Find matching result for this task
            const result = submission.results.find(
                r => r.taskId && r.taskId.toString() === task._id.toString()
            );

            return {
                _id: task._id,
                title: task.title || `Task ${index + 1}`,
                description: task.description || '',
                marks: task.marks || 10,
                language: task.language || 'python',
                passed: result ? result.passed : false,
                score: result ? result.score : 0,
                code: result ? result.code : ''
            };
        });

        res.json({
            lab: {
                _id: lab._id,
                title: lab.title,
                marks: lab.marks || 100,
                courseCode: course.courseCode,
                courseName: course.title,
                deadline: lab.dueDate
            },
            submission: {
                averageScore: submission.averageScore || 0,
                xp: submission.xp || 0,
                submittedAt: submission.submittedAt,
                isLate: submission.isLate || false
            },
            tasks
        });
    } catch (err) {
        console.error("Error fetching lab results:", err);
        res.status(500).json({ message: "Failed to fetch lab results" });
    }
});

/* =============================================================
   MOBILE APP - Combined Dashboard Endpoint
   Returns profile, XP, streak, courses, and labs in one call
============================================================= */
router.get("/:studentId/mobile-dashboard", async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const student = await Student.findById(studentId).select("-password").lean();
    if (!student) return res.status(404).json({ message: "Student not found" });

    // Fetch gamification stats in parallel with courses
    const [gamification, allCourses] = await Promise.all([
      StudentGamification.findOne({ studentId }).lean(),
      Course.find({
        tenantId: student.tenantId,
        "classes.students": new mongoose.Types.ObjectId(studentId)
      }).populate("classes.teacher", "name").lean()
    ]);

    const streak = gamification?.submissionStreak?.current || 0;
    const weeklyXp = gamification?.weeklyXp || 0;

    if (!allCourses || allCourses.length === 0) {
      return res.json({
        profile: { name: student.name, email: student.email, rollNumber: student.rollNumber },
        xp: student.xp || 0,
        weeklyXp,
        streak,
        courses: [],
        labs: []
      });
    }

    let allLabs = [];
    const enrolledCourses = [];

    for (const course of allCourses) {
      const studentClasses = course.classes.filter(c =>
        c.students.some(s => s.toString() === studentId)
      );

      for (const studentClass of studentClasses) {
        const activeLabs = (studentClass.labs || []).filter(lab => lab.status === "Active");
        let completedLabsCount = 0;
        let totalXpEarned = 0;

        for (const lab of activeLabs) {
          const studentSubmission = lab.submissions?.find(
            sub => sub.studentId?.toString() === studentId
          );

          if (studentSubmission) {
            completedLabsCount++;
            totalXpEarned += studentSubmission.xp || 0;
          }

          let labStatus = "Pending";
          if (studentSubmission) {
            labStatus = studentSubmission.isLate ? "Late Submitted" : "Submitted";
          } else {
            const now = new Date();
            const dueDateTime = new Date(lab.dueDate);
            if (lab.dueTime) {
              const [hours, minutes] = lab.dueTime.split(":");
              dueDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            }
            if (now > dueDateTime) labStatus = "Expired";
          }

          allLabs.push({
            _id: lab._id,
            title: lab.title,
            marks: lab.marks,
            totalTasks: lab.tasks?.length || 0,
            dueDate: lab.dueDate,
            dueTime: lab.dueTime,
            courseId: course._id,
            course: course.title,
            courseCode: course.courseCode,
            hasSubmitted: !!studentSubmission,
            status: labStatus,
            submittedAt: studentSubmission?.submittedAt || null,
            score: studentSubmission?.averageScore || 0,
            xpEarned: studentSubmission?.xp || 0,
            performance: studentSubmission
              ? Math.round((studentSubmission.averageScore / lab.marks) * 100)
              : 0
          });
        }

        if (!enrolledCourses.find(ec => ec._id.toString() === course._id.toString())) {
          enrolledCourses.push({
            _id: course._id,
            title: course.title,
            courseCode: course.courseCode,
            teacher: studentClass.teacher?.name || "Instructor",
            xpProgress: totalXpEarned,
            labsCompleted: completedLabsCount,
            totalLabs: activeLabs.length,
            progress: activeLabs.length > 0
              ? Math.round((completedLabsCount / activeLabs.length) * 100)
              : 0
          });
        }
      }
    }

    res.json({
      profile: { name: student.name, email: student.email, rollNumber: student.rollNumber },
      xp: student.xp || 0,
      weeklyXp,
      streak,
      courses: enrolledCourses,
      labs: allLabs
    });
  } catch (err) {
    console.error("Mobile dashboard error:", err);
    res.status(500).json({ message: "Mobile dashboard error" });
  }
});

/* =============================================================
   FCM TOKEN MANAGEMENT (Mobile Push Notifications)
============================================================= */

/**
 * POST /api/students/:studentId/fcm-token
 * Register or refresh an FCM token for push notifications.
 * Body: { token: string, platform?: "android"|"ios"|"web" }
 */
router.post("/:studentId/fcm-token", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { token, platform } = req.body;

    if (!token) {
      return res.status(400).json({ message: "FCM token is required" });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Remove existing entry for this exact token (avoid duplicates)
    student.fcmTokens = student.fcmTokens.filter(
      (t) => t.token !== token
    );

    // Add/refresh the token
    student.fcmTokens.push({
      token,
      platform: platform || "android",
      device: req.headers["user-agent"] || "unknown",
      createdAt: new Date(),
      lastUsed: new Date(),
    });

    await student.save();
    res.json({ message: "FCM token registered" });
  } catch (err) {
    console.error("FCM token save error:", err);
    res.status(500).json({ message: "Failed to save FCM token" });
  }
});

/**
 * DELETE /api/students/:studentId/fcm-token
 * Remove an FCM token (on logout or token refresh).
 * Body: { token: string }
 */
router.delete("/:studentId/fcm-token", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "FCM token is required" });
    }

    await Student.findByIdAndUpdate(studentId, {
      $pull: { fcmTokens: { token } },
    });

    res.json({ message: "FCM token removed" });
  } catch (err) {
    console.error("FCM token remove error:", err);
    res.status(500).json({ message: "Failed to remove FCM token" });
  }
});

/* =============================================================
   AI CODE ANALYSIS
============================================================= */
router.post("/ai-analyze", async (req, res) => {
  try {
    const { code, language, taskTitle, taskDescription, codeConstraints, labTitle } = req.body;

    if (!code || !language) {
      return res.status(400).json({ message: "code and language are required" });
    }

    const n8nResult = await callN8N("analyze_code", {
      role: "student",
      code,
      student_code: code,   // n8n workflow may use this field name
      language,
      task_title: taskTitle || "",
      task_description: taskDescription || "",
      code_constraints: codeConstraints || [],
      lab_title: labTitle || ""
    });

    // Map n8n response fields to what the frontend expects
    const mapped = {
      overallAssessment: n8nResult.what_student_did_right || n8nResult.overallAssessment || null,
      hints: n8nResult.hint
        ? [n8nResult.hint]
        : Array.isArray(n8nResult.hints)
        ? n8nResult.hints
        : null,
      logicFeedback: n8nResult.guiding_question || n8nResult.logicFeedback || null,
      constraintFeedback: n8nResult.constraintFeedback || null,
      issues: Array.isArray(n8nResult.issues) ? n8nResult.issues : null,
      snippet: n8nResult.snippet || null,
    };

    res.json(mapped);
  } catch (err) {
    console.error("AI analyze error:", err.message);
    res.status(500).json({ message: "AI analysis failed", error: err.message });
  }
});

export default router;