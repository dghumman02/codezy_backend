import express from "express";
import Teacher from "../models/Teacher.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import Papa from "papaparse";
import Course from "../models/Course.js";
import Student from "../models/Students.js";
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/* ========================
   AUTH HELPERS
======================== */
const getAuthContext = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.split(" ")[1];
    return jwt.verify(token, process.env.JWT_SECRET); // returns object with tenantId
};

/* ========================
   TEACHER STATS HELPER
======================== */
const getTeacherStats = async (teacherIds = [], tenantId) => {
    // Convert tenantId to ObjectId if it's a string
    const tenantObjectId = typeof tenantId === 'string' 
        ? new mongoose.Types.ObjectId(tenantId) 
        : tenantId;
        
    const matchStage = teacherIds.length > 0
        ? { $match: { tenantId: tenantObjectId, "classes.teacher": { $in: teacherIds.map(id => new mongoose.Types.ObjectId(id)) } } }
        : { $match: { tenantId: tenantObjectId, "classes.teacher": { $exists: true } } };

    const stats = await Course.aggregate([
        { $unwind: "$classes" },
        matchStage,
        {
            $group: {
                _id: "$classes.teacher",
                courseIds: { $addToSet: "$_id" },
                classNames: { $addToSet: "$classes.name" },
                studentCount: { $sum: { $size: { $ifNull: ["$classes.students", []] } } }
            }
        }
    ]);
    return stats;
};

/* ========================
   GET ALL TEACHERS
======================== */
router.get("/", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        
        // Convert tenantId to ObjectId if it's a string
        const tenantObjectId = typeof tenantId === 'string' 
            ? new mongoose.Types.ObjectId(tenantId) 
            : tenantId;

        const teachers = await Teacher.find({ tenantId: tenantObjectId }).sort({ createdAt: -1 }).select("-password").lean();
        const stats = await getTeacherStats([], tenantId);

        const enrichedTeachers = teachers.map(t => {
            const teacherStat = stats.find(s => s._id.toString() === t._id.toString());
            return {
                ...t,
                courseLoad: teacherStat ? teacherStat.courseIds.length : 0,
                classesLoad: teacherStat ? teacherStat.classNames.length : 0,
                students: teacherStat ? teacherStat.studentCount : 0,
                courses: teacherStat ? teacherStat.courseIds : [],
                classes: teacherStat ? teacherStat.classNames : []
            };
        });

        res.json(enrichedTeachers);
    } catch (err) {
        console.error("Error in GET /teachers:", err);
        res.status(500).json({ message: err.message });
    }
});

/* ========================
   GET SINGLE TEACHER
======================== */
router.get("/:id", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);

        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId }).select("-password").lean();
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });

        const stats = await getTeacherStats([teacher._id], tenantId);
        const s = stats[0] || { courseIds: [], classNames: [], studentCount: 0 };

        res.json({
            ...teacher,
            courseLoad: s.courseIds.length,
            classesLoad: s.classNames.length,
            students: s.studentCount,
            courses: s.courseIds,
            classes: s.classNames
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ========================
   CREATE SINGLE TEACHER
======================== */
router.post("/", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const { name, email, role, department, password, status } = req.body;

        const existing = await Teacher.findOne({ email: email.toLowerCase(), tenantId });
        if (existing) return res.status(400).json({ message: "Email already exists" });

        const teacher = new Teacher({
            name,
            email: email.toLowerCase(),
            role,
            status: status || "Active",
            department: Array.isArray(department) ? department : department?.split(',').map(d => d.trim()),
            password: password || crypto.randomBytes(6).toString("hex"),
            tenantId
        });

        await teacher.save();
        res.status(201).json({ message: "Teacher created" });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

/* ========================
   UPDATE TEACHER
======================== */
router.put("/:id", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId });
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });

        const { password, ...updateData } = req.body;
        Object.assign(teacher, updateData);

        if (password && password.trim() !== "") teacher.password = password;

        await teacher.save();
        res.json({ message: "Updated successfully" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ========================
   BULK TEACHERS UPLOAD
======================== */
router.post("/bulk", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "CSV file is required" });
        const { tenantId } = getAuthContext(req);

        const csvString = req.file.buffer.toString("utf-8");
        const { data: items } = Papa.parse(csvString, { header: true, skipEmptyLines: true });

        const prepared = items.map(t => ({
            name: t.Name?.trim() || "",
            email: t.Email?.trim().toLowerCase() || "",
            role: t.Role?.trim() || "",
            status: "Active",
            department: t.Department ? t.Department.split(',').map(d => d.trim()).filter(Boolean) : [],
            password: t.Password?.trim() || crypto.randomBytes(6).toString("hex"),
            tenantId
        }));

        const unique = prepared.filter((t, index, self) =>
            t.email && self.findIndex(prev => prev.email === t.email && prev.tenantId === t.tenantId) === index
        );

        const teachersToCreate = unique.map(t => new Teacher(t));
        await Promise.all(teachersToCreate.map(t => t.save()));

        res.json({ message: `Successfully imported ${unique.length} teachers.` });
    } catch (err) {
        console.error("Bulk upload error:", err);
        res.status(500).json({ message: "Bulk upload failed", error: err.message });
    }
});

/* ========================
   FREEZE TEACHER
======================== */
router.patch("/:id/freeze", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const tenantObjectId = typeof tenantId === 'string' 
            ? new mongoose.Types.ObjectId(tenantId) 
            : tenantId;

        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId: tenantObjectId });
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        teacher.isFrozen = true;
        teacher.frozenAt = new Date();
        teacher.frozenBy = tenantObjectId;
        teacher.status = "Frozen";
        await teacher.save();

        res.json({ message: "Teacher account frozen successfully", teacher });
    } catch (err) {
        console.error("Error freezing teacher:", err);
        res.status(500).json({ message: err.message });
    }
});

/* ========================
   UNFREEZE TEACHER
======================== */
router.patch("/:id/unfreeze", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const tenantObjectId = typeof tenantId === 'string' 
            ? new mongoose.Types.ObjectId(tenantId) 
            : tenantId;

        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId: tenantObjectId });
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        teacher.isFrozen = false;
        teacher.frozenAt = null;
        teacher.frozenBy = null;
        teacher.status = "Active";
        await teacher.save();

        res.json({ message: "Teacher account unfrozen successfully", teacher });
    } catch (err) {
        console.error("Error unfreezing teacher:", err);
        res.status(500).json({ message: err.message });
    }
});

/* ========================
   DELETE TEACHER (with checks)
======================== */
router.delete("/:id", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const tenantObjectId = typeof tenantId === 'string' 
            ? new mongoose.Types.ObjectId(tenantId) 
            : tenantId;
        const teacherId = new mongoose.Types.ObjectId(req.params.id);

        // Check if teacher has any assigned courses/classes
        const assignedCourses = await Course.find({
            tenantId: tenantObjectId,
            "classes.teacher": teacherId
        }).lean();

        if (assignedCourses.length > 0) {
            const courseNames = assignedCourses.map(c => c.title || c.courseCode).join(", ");
            return res.status(400).json({ 
                message: "Cannot delete teacher with assigned courses/classes. Please reassign or remove them first.",
                assignedCourses: courseNames,
                canDelete: false
            });
        }

        await Teacher.findOneAndDelete({ _id: req.params.id, tenantId: tenantObjectId });
        res.json({ message: "Teacher deleted successfully" });
    } catch (err) {
        console.error("Error deleting teacher:", err);
        res.status(500).json({ message: err.message });
    }
});
///* ========================
//   TEACHER OVERVIEW
//======================== */
router.get('/:id/overview', async (req, res) => {
  try {
    const teacherId = new mongoose.Types.ObjectId(req.params.id);

    // 1️⃣ Find courses that have classes assigned to this teacher
    const courses = await Course.find({
      "classes.teacher": teacherId
    }).lean();

    console.log("Found courses for teacher:", courses.length);

    // 2️⃣ Extract classes managed by this teacher with full details
    let allClasses = [];
    let courseStudentMap = {}; // Track students per course
    let courseLabMap = {}; // Track labs per course
    let courseScoreMap = {}; // Track scores per course

    const now = new Date();

    courses.forEach(course => {
      const courseId = course._id.toString();
      courseStudentMap[courseId] = new Set();
      courseLabMap[courseId] = 0;
      courseScoreMap[courseId] = { scoreSum: 0, studentCount: 0 };

      // Filter classes where this teacher is assigned
      const teacherClasses = (course.classes || []).filter(
        c => c.teacher?.toString() === teacherId.toString()
      );

      console.log(`Course: ${course.title}, Teacher classes: ${teacherClasses.length}`);

      teacherClasses.forEach(cls => {
        // Get student IDs for this class
        const classStudentIds = (cls.students || []).map(sid => sid.toString());
        classStudentIds.forEach(sid => courseStudentMap[courseId].add(sid));
        
        // Labs are inside each class
        const classLabs = cls.labs || [];
        courseLabMap[courseId] += classLabs.length;
        
        // Calculate average score using SAME logic as Reports endpoint
        // For each student: calculate weighted score across all labs
        let classScoreSum = 0;
        
        classStudentIds.forEach(studentId => {
          let studentTotalScore = 0;
          let studentTotalMarks = 0;
          
          classLabs.forEach(lab => {
            const labMarks = lab.marks || 10;
            const submission = (lab.submissions || []).find(
              s => s.studentId?.toString() === studentId
            );
            
            // Check if lab is expired
            const dueDateTime = new Date(lab.dueDate);
            if (lab.dueTime) {
              const [dueHours, dueMinutes] = lab.dueTime.split(':');
              dueDateTime.setHours(parseInt(dueHours, 10), parseInt(dueMinutes, 10), 0, 0);
            }
            const isExpired = now > dueDateTime;
            
            if (submission) {
              const avgScore = submission.averageScore || 0;
              const actualScore = (avgScore / 10) * labMarks;
              studentTotalScore += actualScore;
              studentTotalMarks += labMarks;
            } else if (isExpired) {
              // Expired but not submitted - counts as 0
              studentTotalScore += 0;
              studentTotalMarks += labMarks;
            }
          });
          
          // Calculate this student's percentage score
          const studentAvgScore = studentTotalMarks > 0 
            ? (studentTotalScore / studentTotalMarks) * 100 
            : 0;
          
          classScoreSum += studentAvgScore;
        });
        
        // Class average = sum of student scores / number of students
        const classAvgScore = classStudentIds.length > 0 
          ? Math.round(classScoreSum / classStudentIds.length) 
          : 0;
        
        // Add to course totals
        courseScoreMap[courseId].scoreSum += classScoreSum;
        courseScoreMap[courseId].studentCount += classStudentIds.length;

        allClasses.push({
          _id: cls._id,
          name: cls.name,
          courseId: course._id,
          courseName: course.title || 'Untitled Course',
          courseCode: course.courseCode || '',
          studentCount: classStudentIds.length,
          labCount: classLabs.length,
          avgScore: classAvgScore
        });

        console.log(`  Class: ${cls.name}, Students: ${classStudentIds.length}, Labs: ${classLabs.length}, AvgScore: ${classAvgScore}%`);
      });
    });

    // 3️⃣ Prepare courses summary with totals
    const courseSummary = courses.map(c => {
      const courseId = c._id.toString();
      const studentCount = courseStudentMap[courseId]?.size || 0;
      const labCount = courseLabMap[courseId] || 0;
      const scoreData = courseScoreMap[courseId] || { scoreSum: 0, studentCount: 0 };
      const avgScore = scoreData.studentCount > 0 
        ? Math.round(scoreData.scoreSum / scoreData.studentCount) 
        : 0;

      const teacherClasses = (c.classes || []).filter(
        cls => cls.teacher?.toString() === teacherId.toString()
      );
      
      return {
        _id: c._id,
        name: c.title || 'Untitled Course',
        courseCode: c.courseCode || '',
        classCount: teacherClasses.length,
        studentCount: studentCount,
        labCount: labCount,
        avgScore: avgScore
      };
    });

    console.log("Course summary:", JSON.stringify(courseSummary, null, 2));
    console.log("Classes:", JSON.stringify(allClasses, null, 2));

    res.json({
      courses: courseSummary,
      classes: allClasses,
      totalStudents: allClasses.reduce((sum, c) => sum + c.studentCount, 0)
    });
  } catch (err) {
    console.error("Overview error:", err);
    res.status(500).send("Server Error");
  }
});

/* ========================
   2FA SETUP / VERIFY / DISABLE
======================== */
router.get("/:id/2fa/setup", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId });
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });

        const secret = speakeasy.generateSecret({ name: `Codezy:${teacher.email}` });
        teacher.twoFactorSecret = secret.base32;
        await teacher.save();

        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        res.json({ qrCodeUrl, secret: secret.base32 });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post("/:id/2fa/verify", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const { token } = req.body;
        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId });
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });

        const verified = speakeasy.totp.verify({
            secret: teacher.twoFactorSecret,
            encoding: 'base32',
            token
        });

        if (verified) {
            teacher.isTwoFactorEnabled = true;
            await teacher.save();
            res.json({ message: "2FA enabled successfully" });
        } else {
            res.status(400).json({ message: "Invalid code." });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post("/:id/2fa/disable", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const teacher = await Teacher.findOne({ _id: req.params.id, tenantId });
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });

        teacher.twoFactorSecret = null;
        teacher.isTwoFactorEnabled = false;
        await teacher.save();
        res.json({ message: "2FA disabled successfully" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
