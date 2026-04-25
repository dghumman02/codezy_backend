import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import axios from "axios";
import Competition from "../models/Competition.js";
import Course from "../models/Course.js";
import Student from "../models/Students.js";
import { evaluateHTML } from "../services/htmlEvaluator.js";

const router = express.Router();
const EXECUTION_SERVICE_URL = process.env.EXECUTION_SERVICE_URL || "http://localhost:5001";

/* ─── helpers ─────────────────────────────────────────────── */
const getAuthContext = (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        const e = new Error("Unauthorized"); e.status = 401; throw e;
    }
    return jwt.verify(token, process.env.JWT_SECRET);
};

/* ─── execute one task (shared by run & submit) ───────────── */
const executeTask = async (task, code, language) => {
    if (language === "html") {
        return evaluateHTML(
            code,
            task.htmlRequiredTags || [],
            task.htmlNestingConstraints || [],
            task.marks || 10
        );
    }
    const resp = await axios.post(`${EXECUTION_SERVICE_URL}/api/execute`, {
        code,
        language,
        testCases: task.testCases || [],
        structuralConstraints: task.codeConstraints || [],
        taskMarks: task.marks || 10
    });
    return resp.data;
};

/* ═══════════════════════════════════════════════════════════
   ADMIN ENDPOINTS
═══════════════════════════════════════════════════════════ */

// POST /api/competitions  – create competition
router.post("/", async (req, res) => {
    try {
        const { tenantId, role } = getAuthContext(req);
        if (role !== "institution_admin") {
            return res.status(403).json({ message: "Only institution admins can create competitions." });
        }

        const {
            title, description, instructions, language, difficulty,
            totalMarks, startDate, dueDate, eligibility, tasks, status
        } = req.body;

        const competition = await Competition.create({
            tenantId,
            title,
            description: description || "",
            instructions: instructions || "",
            language: language || "python",
            difficulty: difficulty || "Medium",
            totalMarks,
            startDate,
            dueDate,
            status: status || "Active",
            eligibility: {
                courseIds: eligibility?.courseIds || [],
                courseNames: eligibility?.courseNames || [],
                classIds: eligibility?.classIds || [],
                classNames: eligibility?.classNames || []
            },
            tasks,
            createdBy: { id: req.body.adminId || null, name: req.body.adminName || "" }
        });

        res.status(201).json(competition);
    } catch (err) {
        console.error("Create competition error:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/competitions/admin  – list all competitions for tenant (admin)
router.get("/admin", async (req, res) => {
    try {
        const { tenantId, role } = getAuthContext(req);
        if (role !== "institution_admin") {
            return res.status(403).json({ message: "Forbidden" });
        }

        const competitions = await Competition.find({ tenantId })
            .select("-submissions -tasks.testCases -tasks.codeConstraints")
            .sort({ createdAt: -1 })
            .lean();

        res.json(competitions);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   STUDENT ENDPOINTS
═══════════════════════════════════════════════════════════ */

// GET /api/competitions/student/:studentId  – competitions the student is eligible for
router.get("/student/:studentId", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const { studentId } = req.params;

        // Find what course & class this student belongs to
        const student = await Student.findById(studentId).lean();
        if (!student) return res.status(404).json({ message: "Student not found." });

        const studentCourses = await Course.find({
            tenantId,
            "classes.students": new mongoose.Types.ObjectId(studentId)
        }).lean();

        // Build a set of { courseId, classId } the student is in
        const studentEnrollments = new Set();
        const studentCourseIds = new Set();
        for (const course of studentCourses) {
            studentCourseIds.add(course._id.toString());
            for (const cls of course.classes) {
                if (cls.students.some(s => s.toString() === studentId)) {
                    studentEnrollments.add(`${course._id}::${cls._id}`);
                }
            }
        }

        // Fetch active competitions for this tenant
        const now = new Date();
        const allCompetitions = await Competition.find({
            tenantId,
            status: "Active"
        }).select("-tasks.testCases -tasks.codeConstraints").lean();

        // Filter by eligibility
        const eligible = allCompetitions.filter(comp => {
            const elig = comp.eligibility || {};

            // No eligibility restriction → open to all
            if (!elig.courseIds || elig.courseIds.length === 0) return true;

            // Student must be in at least one of the eligible courses
            const matchedCourseId = elig.courseIds.find(id => studentCourseIds.has(id.toString()));
            if (!matchedCourseId) return false;

            // No specific classes → all classes in those courses
            if (!elig.classIds || elig.classIds.length === 0) return true;

            // Check if student is in one of the specified classes (under any matched course)
            return elig.courseIds.some(courseId =>
                studentCourseIds.has(courseId.toString()) &&
                elig.classIds.some(cid =>
                    studentEnrollments.has(`${courseId}::${cid}`)
                )
            );
        });

        // Add hasSubmitted flag for each competition
        const enriched = eligible.map(comp => {
            const submission = (comp.submissions || []).find(
                s => s.studentId?.toString() === studentId
            );
            return {
                ...comp,
                hasSubmitted: !!submission,
                myScore: submission ? submission.score : null
            };
        });

        res.json(enriched);
    } catch (err) {
        console.error("Student competitions error:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/competitions/:id  – get single competition (with tasks but without hidden test cases)
router.get("/:id", async (req, res) => {
    try {
        getAuthContext(req);
        const competition = await Competition.findById(req.params.id).lean();
        if (!competition) return res.status(404).json({ message: "Competition not found." });

        // Strip hidden test case expected outputs for students
        const sanitized = {
            ...competition,
            tasks: (competition.tasks || []).map(task => ({
                ...task,
                testCases: (task.testCases || []).map(tc => ({
                    ...tc,
                    expectedOutput: tc.isHidden ? undefined : tc.expectedOutput
                }))
            }))
        };

        res.json(sanitized);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/competitions/:id/run  – run code for a single competition task (no save)
router.post("/:id/run", async (req, res) => {
    try {
        getAuthContext(req);
        const { taskId, code, language } = req.body;

        const competition = await Competition.findById(req.params.id).lean();
        if (!competition) return res.status(404).json({ message: "Competition not found." });

        const task = competition.tasks.find(t => t._id?.toString() === taskId);
        if (!task) return res.status(404).json({ message: "Task not found." });

        const result = await executeTask(task, code, language || competition.language);
        res.json(result);
    } catch (err) {
        console.error("Competition run error:", err);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/competitions/:id/submit  – student submits competition solution
router.post("/:id/submit", async (req, res) => {
    try {
        const { tenantId } = getAuthContext(req);
        const { studentId, taskSubmissions } = req.body;

        const competition = await Competition.findById(req.params.id);
        if (!competition) return res.status(404).json({ message: "Competition not found." });

        // Prevent double submission
        const existing = competition.submissions.find(
            s => s.studentId?.toString() === studentId
        );
        if (existing) {
            return res.status(409).json({ message: "You have already submitted this competition." });
        }

        const student = await Student.findById(studentId).lean();

        // Evaluate all tasks
        const taskResults = [];
        let earnedMarks = 0;

        for (const sub of taskSubmissions) {
            const task = competition.tasks.find(t => t._id?.toString() === sub.taskId);
            if (!task) continue;

            let result;
            try {
                result = await executeTask(task, sub.code, competition.language);
            } catch (e) {
                result = { score: 0, passed: false };
            }

            const taskScore = result.score || 0;           // 0-10
            const taskEarned = (taskScore / 10) * task.marks;
            earnedMarks += taskEarned;

            taskResults.push({
                taskId: sub.taskId,
                code: sub.code,
                score: taskScore,
                passed: taskScore >= 7
            });
        }

        const scorePercent = competition.totalMarks > 0
            ? Math.round((earnedMarks / competition.totalMarks) * 100)
            : 0;

        competition.submissions.push({
            studentId,
            studentName: student?.name || "",
            rollNumber: student?.rollNumber || "",
            score: scorePercent,
            totalMarks: competition.totalMarks,
            earnedMarks: Math.round(earnedMarks),
            submittedAt: new Date(),
            taskResults
        });

        await competition.save();

        res.json({
            message: "Submission successful.",
            score: scorePercent,
            earnedMarks: Math.round(earnedMarks),
            totalMarks: competition.totalMarks,
            taskResults
        });
    } catch (err) {
        console.error("Competition submit error:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/competitions/:id/admin-stats  – full detail for admin (eligible count, leaderboard with email/courses, non-participants)
router.get("/:id/admin-stats", async (req, res) => {
    try {
        const { tenantId, role } = getAuthContext(req);
        if (role !== "institution_admin") {
            return res.status(403).json({ message: "Forbidden" });
        }

        const competition = await Competition.findById(req.params.id).lean();
        if (!competition) return res.status(404).json({ message: "Competition not found." });

        const elig = competition.eligibility || {};

        // ── Step 1: Collect eligible student IDs from course/class enrollment ──
        const eligibleStudentIds = new Set();
        const studentEnrollmentMap = new Map(); // studentIdStr → { courses: Set, classes: Set }

        const allTenantCourses = await Course.find({ tenantId })
            .select("_id title courseCode classes._id classes.name classes.students")
            .lean();

        const hasCoursesFilter = elig.courseIds && elig.courseIds.length > 0;
        const eligCourseIdStrs = hasCoursesFilter ? elig.courseIds.map(id => id.toString()) : [];
        const eligClassIdStrs = (elig.classIds || []).map(id => id.toString());

        for (const course of allTenantCourses) {
            const courseIncluded = !hasCoursesFilter || eligCourseIdStrs.includes(course._id.toString());
            if (!courseIncluded) continue;

            for (const cls of course.classes) {
                const classIncluded = eligClassIdStrs.length === 0 ||
                    eligClassIdStrs.includes(cls._id.toString());
                if (!classIncluded) continue;

                for (const sid of cls.students) {
                    const key = sid.toString();
                    eligibleStudentIds.add(key);
                    if (!studentEnrollmentMap.has(key)) {
                        studentEnrollmentMap.set(key, { courses: new Set(), classes: new Set() });
                    }
                    studentEnrollmentMap.get(key).courses.add(course.title);
                    studentEnrollmentMap.get(key).classes.add(cls.name);
                }
            }
        }

        // ── Step 2: Fetch student docs (name, email, rollNumber) ──
        const studentDocs = await Student.find({ _id: { $in: [...eligibleStudentIds] } })
            .select("_id name email rollNumber")
            .lean();
        const studentDocMap = new Map(studentDocs.map(s => [s._id.toString(), s]));

        // ── Step 3: Submitted student IDs ──
        const submittedIds = new Set((competition.submissions || []).map(s => s.studentId?.toString()));

        // ── Step 4: Non-participants ──
        const nonParticipants = [];
        for (const sid of eligibleStudentIds) {
            if (!submittedIds.has(sid)) {
                const doc = studentDocMap.get(sid);
                if (!doc) continue;
                const enrollment = studentEnrollmentMap.get(sid);
                nonParticipants.push({
                    _id: doc._id,
                    name: doc.name,
                    email: doc.email,
                    rollNumber: doc.rollNumber,
                    enrolledCourses: enrollment ? [...enrollment.courses] : [],
                    enrolledClasses: enrollment ? [...enrollment.classes] : [],
                });
            }
        }
        nonParticipants.sort((a, b) => a.name.localeCompare(b.name));

        // ── Step 5: Enriched leaderboard ──
        const leaderboard = [...(competition.submissions || [])]
            .sort((a, b) => b.score !== a.score ? b.score - a.score : new Date(a.submittedAt) - new Date(b.submittedAt))
            .map((s, i) => {
                const sid = s.studentId?.toString();
                const doc = studentDocMap.get(sid);
                const enrollment = studentEnrollmentMap.get(sid);
                return {
                    rank: i + 1,
                    studentId: s.studentId,
                    name: s.studentName || doc?.name || "Unknown",
                    rollNumber: s.rollNumber || doc?.rollNumber || "N/A",
                    email: doc?.email || "N/A",
                    score: s.score,
                    earnedMarks: s.earnedMarks,
                    totalMarks: competition.totalMarks,
                    submittedAt: s.submittedAt,
                    enrolledCourses: enrollment ? [...enrollment.courses] : [],
                    enrolledClasses: enrollment ? [...enrollment.classes] : [],
                };
            });

        res.json({
            competition: {
                _id: competition._id,
                title: competition.title,
                language: competition.language,
                difficulty: competition.difficulty,
                totalMarks: competition.totalMarks,
                startDate: competition.startDate,
                dueDate: competition.dueDate,
                status: competition.status,
                eligibility: competition.eligibility,
                description: competition.description,
            },
            eligibleCount: eligibleStudentIds.size,
            participantCount: submittedIds.size,
            nonParticipantCount: nonParticipants.length,
            leaderboard,
            nonParticipants,
        });
    } catch (err) {
        console.error("Admin competition stats error:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/competitions/:id/leaderboard  – ranked submissions
router.get("/:id/leaderboard", async (req, res) => {
    try {
        getAuthContext(req);
        const competition = await Competition.findById(req.params.id)
            .select("title submissions totalMarks")
            .lean();
        if (!competition) return res.status(404).json({ message: "Competition not found." });

        const ranked = [...(competition.submissions || [])]
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return new Date(a.submittedAt) - new Date(b.submittedAt); // earlier = better rank
            })
            .map((s, i) => ({
                rank: i + 1,
                studentId: s.studentId,
                studentName: s.studentName,
                rollNumber: s.rollNumber,
                score: s.score,
                earnedMarks: s.earnedMarks,
                totalMarks: competition.totalMarks,
                submittedAt: s.submittedAt
            }));

        res.json({
            competitionTitle: competition.title,
            totalParticipants: ranked.length,
            leaderboard: ranked
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
