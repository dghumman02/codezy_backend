import express from "express";
import Course from "../models/Course.js";
import mongoose from "mongoose";
import Teacher from "../models/Teacher.js";
import Student from "../models/Students.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createLabNotifications } from "../services/notificationService.js";
import { callN8N } from "../services/n8nService.js";
import SharedLab from "../models/SharedLab.js";

const router = express.Router();

/* ========================
   AUTH CONTEXT
======================== */
const getAuthContext = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const token = authHeader.split(" ")[1];
  return jwt.verify(token, process.env.JWT_SECRET);
};


/* ========================
   TEACHER STATS (TENANT SAFE)
======================== */
const syncTeacherStats = async (teacherId, tenantId) => {
  if (!teacherId || !mongoose.Types.ObjectId.isValid(teacherId)) return;

  const stats = await Course.aggregate([
    { $match: { tenantId } },
    { $unwind: "$classes" },
    { $match: { "classes.teacher": new mongoose.Types.ObjectId(teacherId) } },
    {
      $group: {
        _id: "$classes.teacher",
        uniqueCourses: { $addToSet: "$_id" },
        classNames: { $addToSet: "$classes.name" },
        totalStudents: {
          $sum: { $size: { $ifNull: ["$classes.students", []] } }
        }
      }
    }
  ]);

  const payload = stats[0] || {
    uniqueCourses: [],
    classNames: [],
    totalStudents: 0
  };

  await Teacher.findByIdAndUpdate(teacherId, {
    courses: payload.uniqueCourses,
    classes: payload.classNames,
    courseLoad: payload.uniqueCourses.length,
    classesLoad: payload.classNames.length,
    students: payload.totalStudents
  });
};

/* ========================
   COURSES
======================== */


// CREATE LAB
router.post("/:courseId/classes/:classId/labs", async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const { tenantId, userId, name } = authContext;
    const { courseId, classId } = req.params;

    const courseBeforeUpdate = await Course.findOne({ 
      _id: courseId, 
      tenantId, 
      "classes._id": classId 
    }).populate("classes.students");

    if (!courseBeforeUpdate) {
      return res.status(404).json({ message: "Course or class not found" });
    }

    const classData = courseBeforeUpdate.classes.id(classId);
    if (!classData) {
      return res.status(404).json({ message: "Class not found" });
    }

    console.log("🔍 DEBUG - Class data students length:", classData.students?.length || 0);

    // ── AI TEST CASE VALIDATION ──
    const isPublishing = req.body.status === "Active";
    const hasTestCases = req.body.tasks && req.body.tasks.some(task => task.testCases && task.testCases.length > 0);
    
    let validationResult = null;
    console.log("🔍 isPublishing:", isPublishing);
    console.log("🔍 hasTestCases:", hasTestCases);

    if (isPublishing && hasTestCases) {
      try {
        const n8nResult = await callN8N("validate_lab", {
          teacherId: tenantId,
          teacher_id: tenantId,
          lab_id: "",
          problem_statement: req.body.tasks.map((task, i) => 
            `Task ${i + 1}: ${task.title} - ${task.description || ''}`
          ).join(' | ') || req.body.description || req.body.title || "",
          constraints: req.body.tasks.flatMap(task => task.codeConstraints || []),
          test_cases: req.body.tasks.flatMap(task =>
            (task.testCases || []).map(tc => ({
              input: tc.input,
              expected_output: tc.expectedOutput || tc.expected_output || tc.output || ""
            }))
          )
        });

        console.log("✅ n8nResult:", JSON.stringify(n8nResult));
        console.log("🔍 test_case_issues strings:", n8nResult.test_case_issues);

        // Build flat index map
        let flatIndex = 0;
        const taskTestCaseMap = [];
        req.body.tasks.forEach((task, taskIndex) => {
          (task.testCases || []).forEach((tc, tcIndex) => {
            taskTestCaseMap.push({ taskIndex, tcIndex, flatIndex });
            flatIndex++;
          });
        });

        validationResult = {
          summary: n8nResult.summary || "Validation completed",
          overall_valid: n8nResult.overall_valid,
          tasks: req.body.tasks.map((task, taskIndex) => ({
            title: task.title || `Task ${taskIndex + 1}`,
            testCases: (task.testCases || []).map((tc, tcIndex) => {
              const flatIdx = taskTestCaseMap.find(
                m => m.taskIndex === taskIndex && m.tcIndex === tcIndex
              )?.flatIndex;

              const normalize = (str) => (str || "").trim();

              const issueObj =
                n8nResult.test_case_issues?.find(issue =>
                  normalize(issue.input) === normalize(tc.input)
                ) ||
                n8nResult.test_case_issues?.[flatIdx];

              const issueText = issueObj?.issue;

              return {
                input: tc.input,
                expectedOutput: tc.expectedOutput || tc.expected_output,
                status: issueText ? "invalid" : "valid",
                feedback: issueText || "Looks correct"
              };
            }),
            constraints: (task.codeConstraints || []).map((c, cIndex) => ({
              type: c.type,
              construct: c.construct,
              status: n8nResult.constraint_issues?.length > 0 ? "warning" : "valid",
              feedback: n8nResult.constraint_issues?.[cIndex] || n8nResult.constraint_issues?.[0] || "Constraint looks good"
            }))
          }))
        };

        if (n8nResult.overall_valid === false) {
          return res.status(400).json({
            message: "Test case validation failed",
            validationResult
          });
        }

      } catch (aiErr) {
        console.warn("⚠️ AI validation failed:", aiErr.message);
      }
    }
    // ── END AI VALIDATION ──

    const course = await Course.findOneAndUpdate(
      { _id: courseId, tenantId, "classes._id": classId },
      { 
        $push: { 
          "classes.$.labs": { 
            ...req.body, 
            submissions: [],
            createdBy: {
              id: userId,
              name: name || "Teacher"
            }
          } 
        } 
      },
      { new: true }
    );

    if (!course) return res.status(404).json({ message: "Not found" });

    const updatedClass = course.classes.id(classId);
    const createdLab = updatedClass.labs[updatedClass.labs.length - 1];

    const studentIds = (classData.students || [])
      .filter(s => s?._id)
      .map(s => s._id.toString());

    console.log("📢 Lab created, sending notification to students:", studentIds);

    if (studentIds.length > 0) {
      const io = req.app.get("io");
      await createLabNotifications({
        courseId,
        classId,
        lab: createdLab,
        teacherName: name || "Your Teacher",
        io
      });
    }

    res.status(201).json({ message: "Lab added", lab: createdLab, validationResult });
  } catch (err) {
    console.error("Create Lab Error:", err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE LAB
router.put("/:courseId/classes/:classId/labs/:labId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, labId } = req.params;

    const course = await Course.findOne({ _id: courseId, tenantId });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = course.classes.id(classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const lab = cls.labs.id(labId);
    if (!lab) return res.status(404).json({ message: "Lab not found" });

    console.log("🔍 lab.status currently:", lab.status);
    console.log("🔍 req.body.status incoming:", req.body.status);

    // ── AI TEST CASE VALIDATION ──
    const isPublishing = req.body.status === "Active";
    const hasTestCases = req.body.tasks 
      ? req.body.tasks.some(task => task.testCases && task.testCases.length > 0)
      : lab.tasks.some(task => task.testCases && task.testCases.length > 0);

    let validationResult = null;

    if (isPublishing && hasTestCases) {
      try {
        const tasksToValidate = req.body.tasks || lab.tasks;

        const n8nResult = await callN8N("validate_lab", {
          teacherId: tenantId,
          teacher_id: tenantId,
          lab_id: labId,
          problem_statement: tasksToValidate.map((task, i) =>
          `Task ${i + 1}: ${task.title} - ${task.description || ''}`
        ).join(' | ') || req.body.description || req.body.title || "",
          constraints: tasksToValidate.flatMap(task => task.codeConstraints || []),
          test_cases: tasksToValidate.flatMap(task =>
            (task.testCases || []).map(tc => ({
              input: tc.input,
              expected_output: tc.expectedOutput || tc.expected_output || tc.output || ""
            }))
          )
        });

        console.log("✅ n8nResult:", JSON.stringify(n8nResult));
        console.log("🔍 test_case_issues strings:", n8nResult.test_case_issues);

        // Build flat index map
        let flatIndex = 0;
        const taskTestCaseMap = [];
        tasksToValidate.forEach((task, taskIndex) => {
          (task.testCases || []).forEach((tc, tcIndex) => {
            taskTestCaseMap.push({ taskIndex, tcIndex, flatIndex });
            flatIndex++;
          });
        });

        validationResult = {
          summary: n8nResult.summary || "Validation completed",
          overall_valid: n8nResult.overall_valid,
          tasks: tasksToValidate.map((task, taskIndex) => ({
            title: task.title || `Task ${taskIndex + 1}`,
            testCases: (task.testCases || []).map((tc, tcIndex) => {
              const flatIdx = taskTestCaseMap.find(
                m => m.taskIndex === taskIndex && m.tcIndex === tcIndex
              )?.flatIndex;

              const normalize = (str) => (str || "").trim();

              const issueObj =
                n8nResult.test_case_issues?.find(issue =>
                  normalize(issue.input) === normalize(tc.input)
                ) ||
                n8nResult.test_case_issues?.[flatIdx];

              const issueText = issueObj?.issue;

              return {
                input: tc.input,
                expectedOutput: tc.expectedOutput || tc.expected_output,
                status: issueText ? "invalid" : "valid",
                feedback: issueText || "Looks correct"
              };
            }),
            constraints: (task.codeConstraints || []).map((c, cIndex) => ({
              type: c.type,
              construct: c.construct,
              status: n8nResult.constraint_issues?.length > 0 ? "warning" : "valid",
              feedback: n8nResult.constraint_issues?.[cIndex] || n8nResult.constraint_issues?.[0] || "Constraint looks good"
            }))
          }))
        };

        if (n8nResult.overall_valid === false) {
          return res.status(400).json({
            message: "Test case validation failed",
            validationResult
          });
        }

      } catch (aiErr) {
        console.warn("⚠️ AI validation failed:", aiErr.message);
        Object.assign(lab, req.body);
        await course.save();
        return res.json({ 
          message: "Lab updated successfully", 
          lab,
          aiWarning: "AI validation is currently unavailable. Lab saved without validation."
        });
      }
    }
    // ── END AI VALIDATION ──

    Object.assign(lab, req.body);
    await course.save();

    res.json({ message: "Lab updated successfully", lab, ...(validationResult && { validationResult }) });
  } catch (err) {
    console.error("PUT Lab Error:", err);
    res.status(500).json({ message: err.message });
  }
});


/* ========================
   ADMIN PROGRESS ENDPOINTS
   (Must be BEFORE parameterized routes like /:id)
======================== */

// Admin Summary Stats
router.get("/progress/admin/summary", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const courses = await Course.find({ tenantId }).lean();
    const teachers = await Teacher.find({ tenantId }).lean();
    
    let totalClasses = 0;
    let totalStudentIds = new Set();
    let totalLabs = 0;

    courses.forEach(course => {
      (course.classes || []).forEach(cls => {
        totalClasses++;
        (cls.students || []).forEach(sid => totalStudentIds.add(sid.toString()));
        totalLabs += (cls.labs || []).length;
      });
    });

    res.json({
      totalStudents: totalStudentIds.size,
      totalFaculty: teachers.length,
      totalCourses: courses.length,
      totalClasses: totalClasses,
      totalLabs: totalLabs
    });
  } catch (err) {
    console.error("Admin summary error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Admin - Get all classes with progress data
router.get("/progress/admin/classes", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const courses = await Course.find({ tenantId }).lean();
    const teachers = await Teacher.find({ tenantId }).lean();
    
    const teacherMap = {};
    teachers.forEach(t => { teacherMap[t._id.toString()] = t.name; });

    const now = new Date();
    const classesData = [];

    for (const course of courses) {
      for (const cls of (course.classes || [])) {
        const studentIds = cls.students || [];
        const labs = cls.labs || [];
        
        let totalScore = 0;
        let totalMarks = 0;
        let totalSubmitted = 0;
        let totalPossibleSubmissions = studentIds.length * labs.length;

        labs.forEach(lab => {
          const labMarks = lab.marks || 10;
          (lab.submissions || []).forEach(sub => {
            if (studentIds.some(sid => sid.toString() === sub.studentId?.toString())) {
              totalSubmitted++;
              const avgScore = sub.averageScore || 0;
              totalScore += (avgScore / 10) * labMarks;
              totalMarks += labMarks;
            }
          });
        });

        labs.forEach(lab => {
          const dueDateTime = new Date(lab.dueDate);
          if (lab.dueTime) {
            const [dueHours, dueMinutes] = lab.dueTime.split(':');
            dueDateTime.setHours(parseInt(dueHours, 10), parseInt(dueMinutes, 10), 0, 0);
          }
          const isExpired = now > dueDateTime;

          if (isExpired) {
            const submittedStudentIds = (lab.submissions || []).map(s => s.studentId?.toString());
            studentIds.forEach(sid => {
              if (!submittedStudentIds.includes(sid.toString())) {
                totalMarks += lab.marks || 10;
              }
            });
          }
        });

        const avgScore = totalMarks > 0 ? ((totalScore / totalMarks) * 10).toFixed(1) : 0;
        const completionRate = totalPossibleSubmissions > 0 
          ? Math.round((totalSubmitted / totalPossibleSubmissions) * 100) 
          : 0;

        classesData.push({
          _id: cls._id,
          className: cls.name,
          courseId: course._id,
          courseName: course.title,
          courseCode: course.courseCode,
          teacherId: cls.teacher,
          teacherName: teacherMap[cls.teacher?.toString()] || 'Unassigned',
          totalStudents: studentIds.length,
          totalLabs: labs.length,
          avgScore: parseFloat(avgScore),
          completionRate: completionRate
        });
      }
    }

    res.json({ classes: classesData });
  } catch (err) {
    console.error("Admin classes error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Admin - Get reports for a specific course/class
router.get("/progress/admin/reports", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, labId, status, scoreFilter, scoreValue } = req.query;

    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = course.classes.find(c => c._id?.toString() === classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const studentIds = cls.students || [];
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    const StudentGamification = (await import("../models/StudentGamification.js")).default;
    const gamificationData = await StudentGamification.find({ studentId: { $in: studentIds } }).lean();

    const gamificationMap = {};
    gamificationData.forEach(g => { gamificationMap[g.studentId.toString()] = g; });

    const labs = cls.labs || [];
    const isSpecificLab = labId && labId !== 'all';
    const now = new Date();

    let reportData = [];

    if (isSpecificLab) {
      const lab = labs.find(l => l._id?.toString() === labId);
      if (!lab) return res.status(404).json({ message: "Lab not found" });

      reportData = students.map(student => {
        const submission = lab.submissions?.find(s => s.studentId?.toString() === student._id.toString());
        const score = submission ? (submission.averageScore || 0) : 0;
        const labStatus = submission ? (submission.isLate ? 'Late Submitted' : 'Submitted') : 'Not Submitted';

        return {
          studentId: student._id,
          rollNumber: student.rollNumber || '',
          name: student.name || '',
          score: score,
          xp: submission?.xp || 0,
          status: labStatus,
          submittedAt: submission?.submittedAt || null
        };
      });

      if (status && status !== 'all') {
        reportData = reportData.filter(r => {
          if (status === 'submitted') return r.status === 'Submitted' || r.status === 'Late Submitted';
          if (status === 'not_submitted') return r.status === 'Not Submitted';
          return true;
        });
      }

      if (scoreFilter && scoreFilter !== 'all') {
        const threshold = parseFloat(scoreValue) || 8.5;
        reportData = reportData.filter(r => {
          if (scoreFilter === 'greater') return r.score >= threshold;
          if (scoreFilter === 'less') return r.score < threshold;
          if (scoreFilter === 'perfect') return r.score === 10;
          return true;
        });
      }
    } else {
      reportData = students.map(student => {
        let totalScore = 0;
        let totalMarks = 0;
        let submittedCount = 0;
        let expiredCount = 0;
        let totalXp = 0;

        labs.forEach(lab => {
          const submission = lab.submissions?.find(s => s.studentId?.toString() === student._id.toString());
          const labMarks = lab.marks || 10;
          
          const dueDateTime = new Date(lab.dueDate);
          if (lab.dueTime) {
            const [dueHours, dueMinutes] = lab.dueTime.split(':');
            dueDateTime.setHours(parseInt(dueHours, 10), parseInt(dueMinutes, 10), 0, 0);
          }
          const isExpired = now > dueDateTime;

          if (submission) {
            submittedCount++;
            const avgScore = submission.averageScore || 0;
            const actualScore = (avgScore / 10) * labMarks;
            totalScore += actualScore;
            totalMarks += labMarks;
            totalXp += submission.xp || 0;
          } else if (isExpired) {
            expiredCount++;
            totalMarks += labMarks;
          }
        });

        const completion = labs.length > 0 ? Math.round((submittedCount / labs.length) * 100) : 0;
        const avgScore = totalMarks > 0 ? ((totalScore / totalMarks) * 100).toFixed(1) : 0;

        return {
          studentId: student._id,
          rollNumber: student.rollNumber || '',
          name: student.name || '',
          score: parseFloat(avgScore),
          xp: student.xp || totalXp || 0,
          completion: completion,
          submitted: submittedCount,
          expired: expiredCount,
          pending: labs.length - submittedCount - expiredCount
        };
      });

      if (scoreFilter && scoreFilter !== 'all') {
        const threshold = parseFloat(scoreValue) || 8.5;
        reportData = reportData.filter(r => {
          const scoreOn10 = r.score / 10;
          if (scoreFilter === 'greater') return scoreOn10 >= threshold;
          if (scoreFilter === 'less') return scoreOn10 < threshold;
          if (scoreFilter === 'perfect') return r.score === 100;
          return true;
        });
      }
    }

    const totalStudents = reportData.length;
    let avgScoreSum = 0;
    let submittedStudents = 0;

    reportData.forEach(r => {
      if (isSpecificLab) {
        avgScoreSum += r.score;
        if (r.status !== 'Not Submitted') submittedStudents++;
      } else {
        avgScoreSum += r.score;
        if (r.completion > 0) submittedStudents++;
      }
    });

    const averageScore = totalStudents > 0 ? (avgScoreSum / totalStudents).toFixed(1) : 0;
    const submissionRate = totalStudents > 0 ? Math.round((submittedStudents / totalStudents) * 100) : 0;

    const teacher = await Teacher.findById(cls.teacher).lean();

    res.json({
      isSpecificLab,
      labTitle: isSpecificLab ? labs.find(l => l._id?.toString() === labId)?.title : 'All Labs',
      courseName: course.title,
      className: cls.name,
      teacherName: teacher?.name || 'Unknown',
      summary: { averageScore: parseFloat(averageScore), submissionRate, totalStudents },
      students: reportData,
      labs: labs.map(l => ({ _id: l._id, title: l.title }))
    });
  } catch (err) {
    console.error("Admin reports error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Admin - Get analytics for a specific course/class
router.get("/progress/admin/analytics", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, labId } = req.query;

    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = course.classes.find(c => c._id?.toString() === classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const studentIds = cls.students || [];
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    const StudentGamification = (await import("../models/StudentGamification.js")).default;
    const gamificationData = await StudentGamification.find({ studentId: { $in: studentIds } }).lean();

    const gamificationMap = {};
    gamificationData.forEach(g => { gamificationMap[g.studentId.toString()] = g; });

    const labs = cls.labs || [];
    const now = new Date();

    const scoreRanges = [
      { label: '0-4', min: 0, max: 4, count: 0 },
      { label: '4-6', min: 4, max: 6, count: 0 },
      { label: '6-8', min: 6, max: 8, count: 0 },
      { label: '8-9', min: 8, max: 9, count: 0 },
      { label: '9-10', min: 9, max: 10, count: 0 }
    ];

    const labTrends = [];
    const labScores = [];

    labs.forEach((lab, index) => {
      const submissions = lab.submissions || [];
      const validSubmissions = submissions.filter(s => 
        studentIds.some(sid => sid.toString() === s.studentId?.toString())
      );

      const submissionRate = studentIds.length > 0 
        ? Math.round((validSubmissions.length / studentIds.length) * 100) 
        : 0;

      let totalScore = 0;
      validSubmissions.forEach(sub => { totalScore += sub.averageScore || 0; });
      const avgScore = validSubmissions.length > 0 ? (totalScore / validSubmissions.length).toFixed(1) : 0;

      labTrends.push({ labId: lab._id, labTitle: lab.title || `Lab ${index + 1}`, submissionRate });
      labScores.push({ labId: lab._id, labTitle: lab.title || `Lab ${index + 1}`, avgScore: parseFloat(avgScore) });

      validSubmissions.forEach(sub => {
        const score = sub.averageScore || 0;
        for (const range of scoreRanges) {
          if (score >= range.min && score < range.max) { range.count++; break; }
          if (range.label === '9-10' && score >= 9 && score <= 10) { range.count++; break; }
        }
      });
    });

    let submittedCount = 0;
    let lateCount = 0;
    let notSubmittedCount = 0;

    labs.forEach(lab => {
      const submissions = lab.submissions || [];
      const dueDateTime = new Date(lab.dueDate);
      if (lab.dueTime) {
        const [dueHours, dueMinutes] = lab.dueTime.split(':');
        dueDateTime.setHours(parseInt(dueHours, 10), parseInt(dueMinutes, 10), 0, 0);
      }
      const isExpired = now > dueDateTime;

      studentIds.forEach(sid => {
        const sub = submissions.find(s => s.studentId?.toString() === sid.toString());
        if (sub) {
          if (sub.isLate) lateCount++;
          else submittedCount++;
        } else if (isExpired) {
          notSubmittedCount++;
        }
      });
    });

    const totalSubmissions = submittedCount + lateCount + notSubmittedCount;
    const submissionStatus = [
      { label: 'On Time', value: submittedCount, percentage: totalSubmissions > 0 ? Math.round((submittedCount / totalSubmissions) * 100) : 0 },
      { label: 'Late', value: lateCount, percentage: totalSubmissions > 0 ? Math.round((lateCount / totalSubmissions) * 100) : 0 },
      { label: 'Missing', value: notSubmittedCount, percentage: totalSubmissions > 0 ? Math.round((notSubmittedCount / totalSubmissions) * 100) : 0 }
    ];

    const topPerformers = students
      .map(s => ({
        studentId: s._id,
        name: s.name,
        rollNumber: s.rollNumber,
        xp: gamificationMap[s._id.toString()]?.totalXP || s.xp || 0
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 5);

    const teacher = await Teacher.findById(cls.teacher).lean();

    res.json({
      courseName: course.title,
      className: cls.name,
      teacherName: teacher?.name || 'Unknown',
      scoreDistribution: scoreRanges,
      labTrends,
      labScores,
      submissionStatus,
      topPerformers,
      totalStudents: studentIds.length,
      totalLabs: labs.length
    });
  } catch (err) {
    console.error("Admin analytics error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Admin - Get top performers across all or filtered classes
router.get("/progress/admin/top-performers", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, limit = 10 } = req.query;

    const courses = await Course.find({ tenantId }).lean();
    const StudentGamification = (await import("../models/StudentGamification.js")).default;

    let targetStudentIds = new Set();
    let targetClasses = [];

    courses.forEach(course => {
      (course.classes || []).forEach(cls => {
        if (courseId && classId) {
          if (course._id.toString() === courseId && cls._id?.toString() === classId) {
            targetClasses.push({ ...cls, courseName: course.title, courseCode: course.courseCode });
            (cls.students || []).forEach(sid => targetStudentIds.add(sid.toString()));
          }
        } else if (courseId) {
          if (course._id.toString() === courseId) {
            targetClasses.push({ ...cls, courseName: course.title, courseCode: course.courseCode });
            (cls.students || []).forEach(sid => targetStudentIds.add(sid.toString()));
          }
        } else {
          targetClasses.push({ ...cls, courseName: course.title, courseCode: course.courseCode });
          (cls.students || []).forEach(sid => targetStudentIds.add(sid.toString()));
        }
      });
    });

    const studentIdsArray = Array.from(targetStudentIds);
    const students = await Student.find({ _id: { $in: studentIdsArray } }).lean();
    const gamificationData = await StudentGamification.find({ studentId: { $in: studentIdsArray } }).lean();

    const gamificationMap = {};
    gamificationData.forEach(g => { gamificationMap[g.studentId.toString()] = g; });

    const studentStats = students.map(student => {
      const gData = gamificationMap[student._id.toString()];
      
      let studentClass = null;
      for (const cls of targetClasses) {
        if ((cls.students || []).some(sid => sid.toString() === student._id.toString())) {
          studentClass = cls;
          break;
        }
      }

      let totalScore = 0;
      let totalMarks = 0;
      let submittedCount = 0;

      if (studentClass) {
        (studentClass.labs || []).forEach(lab => {
          const submission = (lab.submissions || []).find(s => s.studentId?.toString() === student._id.toString());
          if (submission) {
            submittedCount++;
            const avgScore = submission.averageScore || 0;
            const labMarks = lab.marks || 10;
            totalScore += (avgScore / 10) * labMarks;
            totalMarks += labMarks;
          }
        });
      }

      const avgScore = totalMarks > 0 ? ((totalScore / totalMarks) * 10).toFixed(1) : 0;

      return {
        studentId: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
        email: student.email,
        xp: gData?.totalXP || student.xp || 0,
        avgScore: parseFloat(avgScore),
        labsCompleted: submittedCount,
        className: studentClass?.name || 'Unknown',
        courseName: studentClass?.courseName || 'Unknown'
      };
    });

    const topPerformers = studentStats.sort((a, b) => b.xp - a.xp).slice(0, parseInt(limit));

    const coursesForFilter = courses.map(c => ({
      _id: c._id,
      title: c.title,
      courseCode: c.courseCode,
      classes: (c.classes || []).map(cls => ({ _id: cls._id, name: cls.name }))
    }));

    res.json({ topPerformers, courses: coursesForFilter });
  } catch (err) {
    console.error("Admin top performers error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ========================
//   ADMIN: LIGHTWEIGHT COURSE LIST (for eligibility dropdowns)
// ========================

// GET /courses/admin/all  – returns title, courseCode, and classes metadata only
router.get("/admin/all", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const courses = await Course.find({ tenantId })
      .select("title courseCode classes._id classes.name")
      .lean();

    // Return a clean array with just what the frontend needs
    const result = courses.map(c => ({
      _id: c._id,
      title: c.title,
      courseCode: c.courseCode,
      classes: (c.classes || []).map(cls => ({ _id: cls._id, name: cls.name }))
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========================
//   ORPHAN STUDENTS
// ========================

// GET all orphan students (students not enrolled in any class)
router.get("/orphan-students", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const courses = await Course.find({ tenantId }).select("classes.students");
    const enrolledIds = new Set();
    for (const course of courses) {
      for (const cls of course.classes) {
        for (const sid of cls.students) {
          enrolledIds.add(sid.toString());
        }
      }
    }

    const allStudents = await Student.find({ tenantId }).select("name email rollNumber course classId createdAt");
    const orphans = allStudents.filter(s => !enrolledIds.has(s._id.toString()));

    res.json({
      totalStudents: allStudents.length,
      orphanCount: orphans.length,
      orphans: orphans.map(s => ({
        _id: s._id,
        name: s.name,
        email: s.email,
        rollNumber: s.rollNumber,
        createdAt: s.createdAt
      }))
    });
  } catch (err) {
    console.error("Get orphan students error:", err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE all orphan students (students not enrolled in any class)
router.delete("/orphan-students", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const courses = await Course.find({ tenantId }).select("classes.students");
    const enrolledIds = new Set();
    for (const course of courses) {
      for (const cls of course.classes) {
        for (const sid of cls.students) {
          enrolledIds.add(sid.toString());
        }
      }
    }

    const allStudents = await Student.find({ tenantId }).select("_id");
    const orphanIds = allStudents
      .filter(s => !enrolledIds.has(s._id.toString()))
      .map(s => s._id);

    if (orphanIds.length === 0) {
      return res.json({ message: "No orphan students found", deletedCount: 0 });
    }

    const result = await Student.deleteMany({ _id: { $in: orphanIds }, tenantId });

    console.log(`[Orphan Cleanup] Deleted ${result.deletedCount} orphan students for tenant ${tenantId}`);

    res.json({
      message: `Deleted ${result.deletedCount} orphan student(s)`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error("Delete orphan students error:", err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE COURSE
router.put("/:id", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const courseId = req.params.id;

    const oldCourse = await Course.findOne({ _id: courseId, tenantId });
    if (!oldCourse) return res.status(404).json({ message: "Course not found" });

    const teachersBefore = [...new Set(oldCourse.classes.map(c => c.teacher?.toString()).filter(Boolean))];

    // Build merged classes array to preserve existing class data (labs, students)
    const incomingClasses = req.body.classes || [];
    const mergedClasses = incomingClasses.map(incoming => {
      if (incoming._id) {
        // Existing class — preserve labs, students, submissions, and other nested data
        const existing = oldCourse.classes.id(incoming._id);
        if (existing) {
          const existingObj = existing.toObject();
          return {
            ...existingObj,
            name: incoming.name !== undefined ? incoming.name : existingObj.name,
            teacher: incoming.teacher !== undefined ? incoming.teacher : existingObj.teacher,
          };
        }
      }
      // New class — use as-is
      return incoming;
    });

    // Update only safe top-level fields + merged classes
    oldCourse.title = req.body.title || oldCourse.title;
    oldCourse.courseCode = req.body.courseCode || oldCourse.courseCode;
    oldCourse.status = req.body.status || oldCourse.status;
    oldCourse.classes = mergedClasses;

    const updatedCourse = await oldCourse.save();

    const teachersAfter = [...new Set(updatedCourse.classes.map(c => c.teacher?.toString()).filter(Boolean))];
    const affected = [...new Set([...teachersBefore, ...teachersAfter])];

    for (const t of affected) {
      await syncTeacherStats(t, tenantId);
    }

    res.json(updatedCourse);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE COURSE
router.delete("/:id", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const course = await Course.findOne({ _id: req.params.id, tenantId });
    if (!course) return res.status(404).json({ message: "Course not found" });

    for (const cls of course.classes) {
      if (cls.teacher) {
        await syncTeacherStats(cls.teacher, tenantId);
      }
    }

    await Course.findOneAndDelete({ _id: req.params.id, tenantId });
    res.json({ message: "Course deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE CLASS (removes class from course, deletes all students if not in other classes)
router.delete("/:courseId/classes/:classId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId } = req.params;

    console.log("[Delete Class] Request received:", { courseId, classId, tenantId });

    // 1️⃣ Find the course and the class to be deleted
    const course = await Course.findOne({ _id: courseId, tenantId });
    if (!course) {
      console.log("[Delete Class] Course not found");
      return res.status(404).json({ message: "Course not found" });
    }

    console.log("[Delete Class] Course found with", course.classes?.length, "classes");
    console.log("[Delete Class] Class IDs in course:", course.classes?.map(c => c._id?.toString()));

    const classToDelete = course.classes.find(c => c._id?.toString() === classId);
    if (!classToDelete) {
      console.log("[Delete Class] Class not found in course");
      return res.status(404).json({ message: "Class not found" });
    }

    console.log("[Delete Class] Found class to delete:", classToDelete.name);

    // 2️⃣ Get the teacher and student IDs before deletion
    const teacherId = classToDelete.teacher;
    const studentIds = classToDelete.students || [];

    // 3️⃣ Remove the class from the course (convert classId to ObjectId)
    const classObjectId = new mongoose.Types.ObjectId(classId);
    const updateResult = await Course.updateOne(
      { _id: courseId, tenantId },
      { $pull: { classes: { _id: classObjectId } } }
    );
    
    console.log("[Delete Class] Update result:", updateResult);
    
    if (updateResult.modifiedCount === 0) {
      console.log("[Delete Class] No document modified - class may not have been removed");
    }

    // 4️⃣ For each student, check if they're in any other class - if not, delete them
    let deletedStudents = 0;
    for (const studentId of studentIds) {
      const studentObjectId = new mongoose.Types.ObjectId(studentId);
      const enrolledElsewhere = await Course.findOne({
        tenantId,
        "classes.students": studentObjectId
      });

      if (!enrolledElsewhere) {
        await Student.findOneAndDelete({ _id: studentId, tenantId });
        deletedStudents++;
        console.log(`[Class Deletion] Student ${studentId} deleted - not enrolled in any other class`);
      }
    }

    // 5️⃣ Sync teacher stats
    if (teacherId) {
      await syncTeacherStats(teacherId, tenantId);
    }

    res.json({ 
      message: "Class deleted successfully",
      studentsRemoved: studentIds.length,
      studentsDeleted: deletedStudents
    });
  } catch (err) {
    console.error("Delete class error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET ALL COURSES (with class averageScore calculated)
router.get("/", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    console.log("Tenant ID:", tenantId);
    const courses = await Course.find({ tenantId }).lean();
    
    // Debug: Log class IDs to verify they exist
    console.log("[GET Courses] Checking class IDs...");
    for (const course of courses) {
      console.log(`Course: ${course.title}, Class count: ${course.classes?.length}`);
      for (const cls of course.classes || []) {
        console.log(`  Class: ${cls.name}, _id: ${cls._id}`);
      }
    }
    
    // Calculate averageScore for each class based on lab submissions
    for (const course of courses) {
      for (const cls of course.classes || []) {
        let totalScore = 0;
        let submissionCount = 0;
        
        // Go through all labs in the class
        for (const lab of cls.labs || []) {
          console.log(`[Avg Score Debug] Lab "${lab.title}" has ${lab.submissions?.length || 0} submissions`);
          // Go through all submissions in the lab
          for (const submission of lab.submissions || []) {
            console.log(`[Avg Score Debug] Submission:`, { 
              averageScore: submission.averageScore, 
              results: submission.results?.map(r => ({ score: r.score, passed: r.passed }))
            });
            // Use averageScore if available, otherwise calculate from results
            if (submission.averageScore !== undefined && submission.averageScore !== null) {
              totalScore += submission.averageScore;
              submissionCount++;
            } else if (submission.results?.length > 0) {
              // Fallback: calculate from individual task results
              const taskScores = submission.results.filter(r => r.score !== undefined && r.score !== null);
              if (taskScores.length > 0) {
                const avgTaskScore = taskScores.reduce((sum, r) => sum + r.score, 0) / taskScores.length;
                totalScore += avgTaskScore;
                submissionCount++;
              }
            }
          }
        }
        
        // Calculate average (default to 0.0 if no submissions)
        cls.averageScore = submissionCount > 0 
          ? parseFloat((totalScore / submissionCount).toFixed(1)) 
          : 0.0;
        console.log(`[Avg Score Debug] Class "${cls.name}" - total: ${totalScore}, count: ${submissionCount}, avg: ${cls.averageScore}`);
      }
    }
    
    res.json(courses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE COURSE
router.post("/", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { title, courseCode, status, classes } = req.body;

    if (!title || !courseCode) {
      return res.status(400).json({ message: "Course name and code are required" });
    }

    const course = await Course.create({
      tenantId,
      title,
      courseCode,
      status: status || "Active",
      classes: (classes || []).map(cls => ({
        name: cls.name,
        teacher: cls.teacher
      }))
    });

    const teacherIds = [...new Set((classes || []).map(c => c.teacher).filter(Boolean))];
    for (const t of teacherIds) {
      await syncTeacherStats(t, tenantId);
    }

    res.status(201).json(course);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Course code already exists for this institution" });
    }
    res.status(500).json({ message: err.message });
  }
});

/* ========================
   TEACHER REPORTS ENDPOINT
   (Must be defined before dynamic routes like /:courseId)
======================== */
router.get("/reports/teacher/:teacherId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { teacherId } = req.params;
    const { courseId, classId, labId, status, scoreFilter, scoreValue } = req.query;

    console.log("Reports endpoint called:", { teacherId, courseId, classId, labId });

    // Get courses for this teacher
    const courses = await Course.find({
      tenantId,
      $or: [
        { "classes.teacher": new mongoose.Types.ObjectId(teacherId) },
        { "labs.teacher": new mongoose.Types.ObjectId(teacherId) }
      ]
    }).lean();

    // If no specific course selected, return course list for filters
    if (!courseId) {
      const teacherCourses = courses.map(c => ({
        _id: c._id,
        title: c.title,
        courseCode: c.courseCode,
        classes: c.classes.filter(cls => cls.teacher?.toString() === teacherId).map(cls => ({
          _id: cls._id,
          name: cls.name
        }))
      }));
      return res.json({ courses: teacherCourses });
    }

    // Find the specific course
    const course = courses.find(c => c._id.toString() === courseId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    // Get the class
    const cls = course.classes.find(c => c._id?.toString() === classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    // Get all student IDs in this class
    const studentIds = cls.students || [];
    
    // Fetch student data with gamification info
    const StudentGamification = (await import("../models/StudentGamification.js")).default;
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    const gamificationData = await StudentGamification.find({ 
      studentId: { $in: studentIds } 
    }).lean();

    // Create a map for quick gamification lookup
    const gamificationMap = {};
    gamificationData.forEach(g => {
      gamificationMap[g.studentId.toString()] = g;
    });

    const labs = cls.labs || [];
    const isSpecificLab = labId && labId !== 'all';

    let reportData = [];

    if (isSpecificLab) {
      // Specific lab report
      const lab = labs.find(l => l._id?.toString() === labId);
      if (!lab) return res.status(404).json({ message: "Lab not found" });

      reportData = students.map(student => {
        const submission = lab.submissions?.find(s => s.studentId?.toString() === student._id.toString());
        
        const score = submission ? (submission.averageScore || 0) : 0;
        const labStatus = submission ? 
          (submission.isLate ? 'Late Submitted' : 'Submitted') : 
          'Not Submitted';

        return {
          studentId: student._id,
          rollNumber: student.rollNumber || '',
          name: student.name || '',
          score: score,
          xp: submission?.xp || 0,
          status: labStatus,
          submittedAt: submission?.submittedAt || null
        };
      });

      // Apply status filter
      if (status && status !== 'all') {
        reportData = reportData.filter(r => {
          if (status === 'submitted') return r.status === 'Submitted' || r.status === 'Late Submitted';
          if (status === 'not_submitted') return r.status === 'Not Submitted';
          return true;
        });
      }

      // Apply score filter
      if (scoreFilter && scoreFilter !== 'all') {
        const threshold = parseFloat(scoreValue) || 8.5;
        reportData = reportData.filter(r => {
          if (scoreFilter === 'greater') return r.score >= threshold;
          if (scoreFilter === 'less') return r.score < threshold;
          if (scoreFilter === 'perfect') return r.score === 10;
          return true;
        });
      }
    } else {
      // All labs report - show aggregate data
      reportData = students.map(student => {
        let totalScore = 0;
        let totalMarks = 0;
        let submittedCount = 0;
        let expiredCount = 0;
        let totalXp = 0;

        const now = new Date();

        labs.forEach(lab => {
          const submission = lab.submissions?.find(s => s.studentId?.toString() === student._id.toString());
          const labMarks = lab.marks || 10;
          
          // Check if lab is expired
          const dueDateTime = new Date(lab.dueDate);
          if (lab.dueTime) {
            const [dueHours, dueMinutes] = lab.dueTime.split(':');
            dueDateTime.setHours(parseInt(dueHours, 10), parseInt(dueMinutes, 10), 0, 0);
          }
          const isExpired = now > dueDateTime;

          if (submission) {
            submittedCount++;
            const avgScore = submission.averageScore || 0;
            const actualScore = (avgScore / 10) * labMarks;
            totalScore += actualScore;
            totalMarks += labMarks;
            totalXp += submission.xp || 0;
          } else if (isExpired) {
            expiredCount++;
            totalScore += 0;
            totalMarks += labMarks;
          }
        });

        const completion = labs.length > 0 ? Math.round((submittedCount / labs.length) * 100) : 0;
        const avgScore = totalMarks > 0 ? ((totalScore / totalMarks) * 100).toFixed(1) : 0;

        return {
          studentId: student._id,
          rollNumber: student.rollNumber || '',
          name: student.name || '',
          score: parseFloat(avgScore),
          xp: student.xp || totalXp || 0,
          completion: completion,
          submitted: submittedCount,
          expired: expiredCount,
          pending: labs.length - submittedCount - expiredCount
        };
      });

      // Apply score filter for all labs view
      if (scoreFilter && scoreFilter !== 'all') {
        const threshold = parseFloat(scoreValue) || 8.5;
        reportData = reportData.filter(r => {
          // Convert to 0-10 scale for comparison
          const scoreOn10 = r.score / 10;
          if (scoreFilter === 'greater') return scoreOn10 >= threshold;
          if (scoreFilter === 'less') return scoreOn10 < threshold;
          if (scoreFilter === 'perfect') return r.score === 100;
          return true;
        });
      }
    }

    // Calculate summary stats
    const totalStudents = reportData.length;
    let avgScoreSum = 0;
    let submittedStudents = 0;
    let completionSum = 0;

    reportData.forEach(r => {
      if (isSpecificLab) {
        avgScoreSum += r.score;
        if (r.status !== 'Not Submitted') submittedStudents++;
      } else {
        avgScoreSum += r.score;
        completionSum += r.completion || 0;
      }
    });

    const averageScore = totalStudents > 0 ? (avgScoreSum / totalStudents).toFixed(1) : 0;
    const submissionRate = isSpecificLab
      ? (totalStudents > 0 ? Math.round((submittedStudents / totalStudents) * 100) : 0)
      : (totalStudents > 0 ? Math.round(completionSum / totalStudents) : 0);

    res.json({
      isSpecificLab,
      labTitle: isSpecificLab ? labs.find(l => l._id?.toString() === labId)?.title : 'All Labs',
      courseName: course.title,
      className: cls.name,
      summary: {
        averageScore: parseFloat(averageScore),
        submissionRate,
        totalStudents
      },
      students: reportData,
      labs: labs.map(l => ({ _id: l._id, title: l.title }))
    });
  } catch (err) {
    console.error("Reports error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ========================
   ANALYTICS ENDPOINT
======================== */
router.get("/analytics/teacher/:teacherId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { teacherId } = req.params;
    const { courseId, classId, labId } = req.query;

    // Get courses for this teacher
    const courses = await Course.find({
      tenantId,
      $or: [
        { "classes.teacher": new mongoose.Types.ObjectId(teacherId) },
        { "labs.teacher": new mongoose.Types.ObjectId(teacherId) }
      ]
    }).lean();

    // If no specific course selected, return course list for filters
    if (!courseId) {
      const teacherCourses = courses.map(c => ({
        _id: c._id,
        title: c.title,
        courseCode: c.courseCode,
        classes: c.classes.filter(cls => cls.teacher?.toString() === teacherId).map(cls => ({
          _id: cls._id,
          name: cls.name
        }))
      }));
      return res.json({ courses: teacherCourses });
    }

    // Find the specific course
    const course = courses.find(c => c._id.toString() === courseId);
    if (!course) return res.status(404).json({ message: "Course not found" });

    // Get teacher's classes for this course
    const teacherClasses = course.classes.filter(c => c.teacher?.toString() === teacherId);
    
    // Determine which classes to analyze
    let classesToAnalyze = [];
    if (classId && classId !== 'all') {
      const cls = course.classes.find(c => c._id?.toString() === classId);
      if (cls) classesToAnalyze = [cls];
    } else {
      classesToAnalyze = teacherClasses;
    }

    if (classesToAnalyze.length === 0) {
      return res.status(404).json({ message: "No classes found" });
    }

    // Collect all student IDs and labs
    const allStudentIds = [];
    const allLabsMap = new Map();
    
    classesToAnalyze.forEach(cls => {
      (cls.students || []).forEach(id => {
        if (!allStudentIds.includes(id.toString())) {
          allStudentIds.push(id.toString());
        }
      });
      (cls.labs || []).forEach(lab => {
        if (!allLabsMap.has(lab._id.toString())) {
          allLabsMap.set(lab._id.toString(), { ...lab, className: cls.name, classId: cls._id });
        }
      });
    });

    // Fetch student data with gamification info
    const StudentGamification = (await import("../models/StudentGamification.js")).default;
    const students = await Student.find({ _id: { $in: allStudentIds } }).lean();
    const gamificationData = await StudentGamification.find({ 
      studentId: { $in: allStudentIds } 
    }).lean();

    const gamificationMap = {};
    gamificationData.forEach(g => {
      gamificationMap[g.studentId.toString()] = g;
    });

    const allLabs = Array.from(allLabsMap.values());
    const now = new Date();

    // =====================
    // 1. Score Distribution (0-4, 4-6, 6-8, 8-9, 9-10)
    // =====================
    const scoreRanges = [
      { label: '0-4', min: 0, max: 4, count: 0 },
      { label: '4-6', min: 4, max: 6, count: 0 },
      { label: '6-8', min: 6, max: 8, count: 0 },
      { label: '8-9', min: 8, max: 9, count: 0 },
      { label: '9-10', min: 9, max: 10, count: 0 }
    ];

    // =====================
    // 2. Submission Rate Trend & 3. Average Score Per Lab
    // =====================
    const labTrends = [];
    const labScores = [];

    // Process by class for multi-class support
    const labDataByClass = {};
    
    classesToAnalyze.forEach(cls => {
      const classLabs = cls.labs || [];
      const classStudentIds = cls.students || [];
      
      classLabs.forEach((lab, index) => {
        const labKey = lab._id.toString();
        
        if (!labDataByClass[labKey]) {
          labDataByClass[labKey] = {
            labId: labKey,
            labTitle: lab.title,
            labNumber: index + 1,
            classes: []
          };
        }

        // Calculate submission rate and avg score for this class
        let totalStudents = classStudentIds.length;
        let submittedCount = 0;
        let totalScore = 0;

        classStudentIds.forEach(studentId => {
          const submission = lab.submissions?.find(s => s.studentId?.toString() === studentId.toString());
          if (submission) {
            submittedCount++;
            totalScore += submission.averageScore || 0;
          }
        });

        const submissionRate = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;
        const avgScore = submittedCount > 0 ? (totalScore / submittedCount).toFixed(1) : 0;

        labDataByClass[labKey].classes.push({
          className: cls.name,
          classId: cls._id.toString(),
          submissionRate,
          avgScore: parseFloat(avgScore),
          submittedCount,
          totalStudents
        });
      });
    });

    // Aggregate lab data
    Object.values(labDataByClass).forEach(labData => {
      const totalSubmissions = labData.classes.reduce((sum, c) => sum + c.submittedCount, 0);
      const totalStudents = labData.classes.reduce((sum, c) => sum + c.totalStudents, 0);
      const overallSubmissionRate = totalStudents > 0 ? Math.round((totalSubmissions / totalStudents) * 100) : 0;
      
      const totalScoreSum = labData.classes.reduce((sum, c) => sum + (c.avgScore * c.submittedCount), 0);
      const overallAvgScore = totalSubmissions > 0 ? (totalScoreSum / totalSubmissions).toFixed(1) : 0;

      labTrends.push({
        labNumber: `Lab ${labData.labNumber}`,
        labTitle: labData.labTitle,
        submissionRate: overallSubmissionRate,
        classes: labData.classes
      });

      labScores.push({
        labNumber: `Lab ${labData.labNumber}`,
        labTitle: labData.labTitle,
        avgScore: parseFloat(overallAvgScore),
        classes: labData.classes
      });
    });

    // =====================
    // 4-7. Calculate student-level metrics
    // =====================
    const studentMetrics = [];
    let highPerformers = 0;
    let mediumPerformers = 0;
    let lowPerformers = 0;
    let fullyCompleted = 0;
    let partiallyCompleted = 0;
    let noSubmissions = 0;
    const xpDistribution = [];

    students.forEach(student => {
      let totalScore = 0;
      let totalMarks = 0;
      let submittedCount = 0;
      let totalXp = 0;
      let relevantLabsCount = 0;

      // Find which class this student belongs to
      classesToAnalyze.forEach(cls => {
        if (!cls.students?.some(s => s.toString() === student._id.toString())) return;
        
        const labs = cls.labs || [];
        relevantLabsCount += labs.length;

        labs.forEach(lab => {
          // If specific lab filter applied
          if (labId && labId !== 'all' && lab._id?.toString() !== labId) return;
          
          const submission = lab.submissions?.find(s => s.studentId?.toString() === student._id.toString());
          const labMarks = lab.marks || 10;

          if (submission) {
            submittedCount++;
            const avgScore = submission.averageScore || 0;
            const actualScore = (avgScore / 10) * labMarks;
            totalScore += actualScore;
            totalMarks += labMarks;
            totalXp += submission.xp || 0;

            // Add to score distribution
            const range = scoreRanges.find(r => avgScore >= r.min && avgScore < r.max) || 
                          scoreRanges.find(r => avgScore >= r.min && avgScore <= r.max);
            if (range) range.count++;
          } else {
            totalMarks += labMarks;
          }
        });
      });

      const avgScore = totalMarks > 0 ? (totalScore / totalMarks) * 10 : 0;
      const completion = relevantLabsCount > 0 ? Math.round((submittedCount / relevantLabsCount) * 100) : 0;
      
      // Get total XP from gamification
      const gamification = gamificationMap[student._id.toString()];
      const studentXp = gamification?.totalXp || totalXp || student.xp || 0;

      studentMetrics.push({
        studentId: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
        avgScore: parseFloat(avgScore.toFixed(1)),
        xp: studentXp,
        completion,
        submittedCount 
      });

      // Performance classification
      if (avgScore >= 8.5) highPerformers++;
      else if (avgScore >= 6) mediumPerformers++;
      else lowPerformers++;

      // Completion classification
      if (completion === 100) fullyCompleted++;
      else if (completion > 0) partiallyCompleted++;
      else noSubmissions++;

      // XP distribution
      xpDistribution.push(studentXp);
    });

    // =====================
    // 4. Top Performers (70% score + 30% XP normalized)
    // =====================
    // Normalize XP to 0-10 scale based on max XP
    const maxXpValue = Math.max(...studentMetrics.map(s => s.xp), 1);
    const topPerformers = [...studentMetrics]
      .map(s => {
        const normalizedXp = (s.xp / maxXpValue) * 10;
        const combinedScore = (s.avgScore * 0.7) + (normalizedXp * 0.3);
        return { ...s, combinedScore: parseFloat(combinedScore.toFixed(2)) };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, 5);

    // =====================
    // 7. XP Distribution Histogram
    // =====================
    // Create XP buckets
    const maxXp = Math.max(...xpDistribution, 100);
    const bucketSize = Math.ceil(maxXp / 10) || 10;
    const xpBuckets = [];
    
    for (let i = 0; i < 10; i++) {
      const min = i * bucketSize;
      const max = (i + 1) * bucketSize;
      const count = xpDistribution.filter(xp => xp >= min && xp < max).length;
      xpBuckets.push({
        range: `${min}-${max}`,
        count
      });
    }

    // Determine if specific class is selected
    const isSpecificClass = classId && classId !== 'all';

    res.json({
      courseName: course.title,
      courseCode: course.courseCode,
      className: isSpecificClass ? classesToAnalyze[0]?.name : 'All Classes',
      totalStudents: students.length,
      totalLabs: allLabs.length,
      isSpecificClass,
      
      // Score distribution for bar chart
      scoreDistribution: scoreRanges,
      
      // Submission rate trend (line chart) - always return data, frontend decides when to show
      submissionRateTrend: labTrends,
      
      // Average score per lab (line/bar chart) - always return data, frontend decides when to show
      avgScorePerLab: labScores,
      
      // Top performers (horizontal bar chart)
      topPerformers,
      
      // Performance distribution (pie chart)
      performanceDistribution: {
        high: highPerformers,
        medium: mediumPerformers,
        low: lowPerformers
      },
      
      // Completion rate (doughnut chart)
      completionRate: {
        fullyCompleted,
        partiallyCompleted,
        noSubmissions
      },
      
      // XP distribution (histogram)
      xpDistribution: xpBuckets,
      
      // Classes info for filter
      classes: teacherClasses.map(c => ({ _id: c._id, name: c.name })),
      
      // Labs info for filter
      labs: allLabs.map(l => ({ _id: l._id, title: l.title }))
    });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ========================
   STUDENTS
======================== */

// ADD STUDENTS
router.post("/:courseId/classes/:classId/students", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId } = req.params;
    const { students } = req.body;

    const ids = [];

    for (const s of students) {
      const hashed = await bcrypt.hash(s.password || "123456", 10);

      const doc = await Student.findOneAndUpdate(
        { email: s.email, tenantId },
        {
          ...s,
          password: hashed,
          tenantId,
          course: courseId,
          classId
        },
        { upsert: true, new: true }
      );

      ids.push(doc._id);
    }
      console.log("Adding students to class:", {
        courseId,
        classId,
        tenantId,
        studentIds: ids
    });

    const updatedCourse = await Course.findOneAndUpdate(
      { _id: courseId, tenantId, "classes._id": classId },
      { $addToSet: { "classes.$.students": { $each: ids } } },
      { new: true }
    );
    
    console.log("Updated Course Result:", updatedCourse);
    res.json({ message: "Students added" });
  } catch (err) {
    console.error("Error in /students POST:", err);
    res.status(500).json({ message: err.message });
  }
});
// GET ALL LABS IN A COURSE (ACROSS ALL CLASSES)
router.get("/:courseId/all-labs", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId } = req.params;

    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const labs = [];

    for (const cls of course.classes || []) {
      for (const lab of cls.labs || []) {
        labs.push({
          ...lab,
          parentClassId: cls._id,
          originClass: cls.name
        });
      }
    }

    res.json(labs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET CLASS STUDENTS
router.get("/:courseId/classes/:classId/students", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const course = await Course.findOne({
      _id: req.params.courseId,
      tenantId
    }).populate("classes.students");

    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = course.classes.id(req.params.classId);
    res.json(cls?.students || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE SINGLE STUDENT
router.put("/:courseId/classes/:classId/students/:studentId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, studentId } = req.params;
    const updateData = req.body;

    // Ensure the student belongs to the tenant
    const student = await Student.findOne({ _id: studentId, tenantId });
    if (!student) return res.status(404).json({ message: "Student not found" });

    // If password is being updated, hash it
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    Object.assign(student, updateData);
    await student.save();

    res.json({ message: "Student updated", student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// DELETE SINGLE STUDENT (removes from class, deletes account if not in any other class)
router.delete("/:courseId/classes/:classId/students/:studentId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, studentId } = req.params;

    // 1️⃣ Verify the student exists in this tenant
    const student = await Student.findOne({ _id: studentId, tenantId });
    if (!student) return res.status(404).json({ message: "Student not found" });

    // 2️⃣ Remove student reference from the specified class
    await Course.updateOne(
      { _id: courseId, tenantId, "classes._id": classId },
      { $pull: { "classes.$.students": studentId } }
    );

    // 3️⃣ Check if student is still enrolled in ANY class across all courses in this tenant
    const studentObjectId = new mongoose.Types.ObjectId(studentId);
    const enrolledInOtherClasses = await Course.findOne({
      tenantId,
      "classes.students": studentObjectId
    });

    // 4️⃣ If student is not in any class, delete their account
    if (!enrolledInOtherClasses) {
      await Student.findOneAndDelete({ _id: studentId, tenantId });
      console.log(`[Student Cleanup] Student ${studentId} deleted - not enrolled in any class`);
      return res.json({ 
        message: "Student removed from class and account deleted (not enrolled in any other class)",
        accountDeleted: true
      });
    }

    res.json({ 
      message: "Student removed from class successfully",
      accountDeleted: false
    });
  } catch (err) {
    console.error("Delete student error:", err);
    res.status(500).json({ message: err.message });
  }
});

// FREEZE STUDENT
router.patch("/:courseId/classes/:classId/students/:studentId/freeze", async (req, res) => {
  try {
    const { tenantId, userId } = getAuthContext(req);
    const { studentId } = req.params;

    const student = await Student.findOne({ _id: studentId, tenantId });
    if (!student) return res.status(404).json({ message: "Student not found" });

    student.isFrozen = true;
    student.frozenAt = new Date();
    student.frozenBy = userId;
    await student.save();

    res.json({ message: "Student account frozen successfully", student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UNFREEZE STUDENT
router.patch("/:courseId/classes/:classId/students/:studentId/unfreeze", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { studentId } = req.params;

    const student = await Student.findOne({ _id: studentId, tenantId });
    if (!student) return res.status(404).json({ message: "Student not found" });

    student.isFrozen = false;
    student.frozenAt = null;
    student.frozenBy = null;
    await student.save();

    res.json({ message: "Student account unfrozen successfully", student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ========================
   TEACHER COURSES
======================== */
router.get("/teacher/:teacherId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const teacherId = req.params.teacherId;

    // Find all courses where this teacher is assigned to at least one class
    const courses = await Course.find({
      tenantId,
      "classes.teacher": teacherId
    }).lean();

    // Filter classes to only include those assigned to this teacher
    const filteredCourses = courses.map(course => ({
      ...course,
      classes: course.classes.filter(cls => 
        cls.teacher && cls.teacher.toString() === teacherId
      )
    })).filter(course => course.classes.length > 0); // Remove courses with no classes after filtering

    // Calculate averageScore for each class based on lab submissions
    for (const course of filteredCourses) {
      for (const cls of course.classes || []) {
        let totalScore = 0;
        let submissionCount = 0;
        
        for (const lab of cls.labs || []) {
          for (const submission of lab.submissions || []) {
            if (submission.averageScore !== undefined && submission.averageScore !== null) {
              totalScore += submission.averageScore;
              submissionCount++;
            } else if (submission.results?.length > 0) {
              const taskScores = submission.results.filter(r => r.score !== undefined && r.score !== null);
              if (taskScores.length > 0) {
                const avgTaskScore = taskScores.reduce((sum, r) => sum + r.score, 0) / taskScores.length;
                totalScore += avgTaskScore;
                submissionCount++;
              }
            }
          }
        }
        
        cls.averageScore = submissionCount > 0 
          ? parseFloat((totalScore / submissionCount).toFixed(1)) 
          : 0.0;
      }
    }

    res.json(filteredCourses);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
  }
});

/* ========================
   LABS & SUBMISSIONS
======================== */
// GET ALL LABS FOR A SPECIFIC CLASS
router.get("/:courseId/classes/:classId/labs", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId } = req.params;

    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = (course.classes || []).find(c => String(c._id) === String(classId));
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const labs = (cls.labs || []).map(lab => ({
      ...lab,
      parentClassId: cls._id,
      originClass: cls.name
    }));

    res.json(labs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET SINGLE LAB
router.get("/:courseId/classes/:classId/labs/:labId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId, classId, labId } = req.params;

    const course = await Course.findOne({ _id: courseId, tenantId });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = course.classes.id(classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const lab = cls.labs.id(labId);
    if (!lab) return res.status(404).json({ message: "Lab not found" });

    res.json(lab);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET SUBMISSIONS
router.get("/:courseId/classes/:classId/labs/:labId/submissions", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    const course = await Course.findOne({
      _id: req.params.courseId,
      tenantId
    }).populate("classes.students", "name rollNumber");

    if (!course) return res.status(404).json({ message: "Course not found" });

    const cls = course.classes.id(req.params.classId);
    const lab = cls.labs.id(req.params.labId);

    res.json(
      cls.students.map(st => {
        const sub = lab.submissions.find(s => s.studentId.equals(st._id));
        return {
          studentId: st._id,
          name: st.name,
          rollNumber: st.rollNumber,
          submitted: !!sub,
          xp: sub?.xp || 0,
          averageScore: sub?.averageScore || 0,
          status: sub?.status || "Not Submitted",
          isLate: sub?.isLate || false,
          submittedAt: sub?.submittedAt || null,
          results: sub?.results || []
        };
      })
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE LAB
router.post("/:courseId/classes/:classId/labs", async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const { tenantId, userId, name } = authContext;
    const { courseId, classId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: "Invalid course or class ID" });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const classObjectId = new mongoose.Types.ObjectId(classId);

    // Get the course
    const course = await Course.findOne({ 
      _id: courseObjectId, 
      tenantId
    });

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Get the specific class
    const targetClass = course.classes.id(classObjectId);
    if (!targetClass) {
      return res.status(404).json({ message: "Class not found in course" });
    }

    console.log(`Creating lab in class: ${targetClass.name} (${classId})`);

    // Create the lab
    const updatedCourse = await Course.findOneAndUpdate(
      { _id: courseObjectId, tenantId, "classes._id": classObjectId },
      { 
        $push: { 
          "classes.$.labs": { 
            ...req.body, 
            submissions: [],
            createdBy: {
              id: userId,
              name: name || "Teacher"
            }
          } 
        } 
      },
      { new: true }
    );

    if (!updatedCourse) {
      return res.status(404).json({ message: "Failed to create lab" });
    }

    // Get the created lab
    const updatedClass = updatedCourse.classes.id(classObjectId);
    const createdLab = updatedClass.labs[updatedClass.labs.length - 1];

    // If exported to course, also save as shared lab template
    console.log(`[Lab Export] isShared=${req.body.isShared}, title="${createdLab.title}"`);
    if (req.body.isShared) {
      try {
        const sharedDoc = await SharedLab.create({
          courseId: courseObjectId,
          title: createdLab.title,
          marks: createdLab.marks,
          description: createdLab.description || "",
          instructions: createdLab.instructions || "",
          language: createdLab.language || "python",
          difficulty: createdLab.difficulty || "Medium",
          authorId: userId,
          authorName: name || "Teacher",
          tasks: (createdLab.tasks || []).map(t => ({
            title: t.title,
            marks: t.marks || 0,
            description: t.description || "",
            language: t.language || "python",
            testCases: (t.testCases || []).map(tc => ({
              input: tc.input || "",
              expectedOutput: tc.expectedOutput || "",
              comparisonMode: tc.comparisonMode || "Exact",
              notes: tc.notes || "",
              isHidden: !!tc.isHidden
            })),
            codeConstraints: (t.codeConstraints || []).map(c => ({
              type: c.type,
              construct: c.construct,
              specifics: {
                minDepth: c.specifics?.minDepth || 0,
                maxDepth: c.specifics?.maxDepth || 0
              }
            })),
            htmlRequiredTags: (t.htmlRequiredTags || []).map(rt => ({
              tag: rt.tag,
              minCount: rt.minCount || 1,
              maxCount: rt.maxCount || 0,
              message: rt.message || ""
            })),
            htmlNestingConstraints: t.htmlNestingConstraints || []
          }))
        });
        console.log(`[Lab Created] Also exported to course shared labs, SharedLab ID: ${sharedDoc._id}`);
      } catch (sharedErr) {
        console.error("[Lab Created] Failed to export shared lab (class lab still created):", sharedErr.message);
        if (sharedErr.errors) console.error("[Lab Created] Validation errors:", JSON.stringify(sharedErr.errors));
      }
    }

    // Send notifications to all students in this class
    try {
      const io = req.app.get("io");
      const notificationResult = await createLabNotifications({
        courseId: courseId,
        classId: classId,
        lab: createdLab,
        teacherName: name || "Teacher",
        io: io
      });

      console.log(`[Lab Created] Notifications sent to ${notificationResult.notificationCount} students`);
    } catch (notifError) {
      // Log error but don't fail the lab creation
      console.error("[Lab Created] Notification error (lab still created):", notifError.message);
    }

    res.status(201).json({ message: "Lab created", lab: createdLab });
  } catch (err) {
    console.error("Create Lab Error:", err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE LAB
router.put("/:courseId/classes/:classId/labs/:labId", async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const { tenantId, userId, name } = authContext;
    const { courseId, classId, labId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(classId) || !mongoose.Types.ObjectId.isValid(labId)) {
      return res.status(400).json({ message: "Invalid course, class, or lab ID" });
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const classObjectId = new mongoose.Types.ObjectId(classId);
    const labObjectId = new mongoose.Types.ObjectId(labId);

    // Get the course
    const course = await Course.findOne({ 
      _id: courseObjectId, 
      tenantId
    });

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Get the specific class
    const targetClass = course.classes.id(classObjectId);
    if (!targetClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const lab = targetClass.labs.id(labObjectId);
    if (!lab) {
      return res.status(404).json({ message: "Lab not found" });
    }

    // Update the lab
    Object.assign(lab, req.body);
    await course.save();

    console.log(`Updated lab in class: ${targetClass.name} (${classId})`);

    // TODO: Re-implement notification system here

    res.json({ message: "Lab updated successfully", lab });
  } catch (err) {
    console.error("PUT Lab Error:", err);
    res.status(500).json({ message: err.message });
  }
});



// DELETE LAB
router.delete("/:courseId/classes/:classId/labs/:labId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);

    await Course.updateOne(
      { _id: req.params.courseId, tenantId, "classes._id": req.params.classId },
      { $pull: { "classes.$.labs": { _id: req.params.labId } } }
    );

    res.json({ message: "Lab deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
