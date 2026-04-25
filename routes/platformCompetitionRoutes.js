import express from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import PlatformCompetition from "../models/PlatformCompetition.js";
import Institution from "../models/Institution.js";
import User from "../models/User.js";
import Student from "../models/Students.js";
import { evaluateHTML } from "../services/htmlEvaluator.js";

const router = express.Router();
const EXECUTION_SERVICE_URL = process.env.EXECUTION_SERVICE_URL || "http://localhost:5001";

const verifySuperAdmin = (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) { const e = new Error("Unauthorized"); e.status = 401; throw e; }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "superadmin") { const e = new Error("Forbidden"); e.status = 403; throw e; }
    return decoded;
};

const verifyAuth = (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) { const e = new Error("Unauthorized"); e.status = 401; throw e; }
    return jwt.verify(token, process.env.JWT_SECRET);
};

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

// GET /api/platform-competitions/institutions
// Returns list of all institutions for the eligibility dropdown
router.get("/institutions", async (req, res) => {
    try {
        const list = await Institution.find(
            { type: "institution" },
            "_id name tenantId"
        ).lean();
        res.json(list);
    } catch (err) {
        console.error("Fetch institutions error:", err);
        res.status(500).json({ message: "Failed to fetch institutions" });
    }
});

// POST /api/platform-competitions  — create (superadmin only)
router.post("/", async (req, res) => {
    try {
        verifySuperAdmin(req);
        const comp = await PlatformCompetition.create(req.body);
        res.status(201).json({ message: "Competition created", data: comp });
    } catch (err) {
        console.error("Create platform competition error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// GET /api/platform-competitions  — list all (superadmin only)
router.get("/", async (req, res) => {
    try {
        verifySuperAdmin(req);
        const comps = await PlatformCompetition.find()
            .sort({ createdAt: -1 })
            .lean();
        res.json(comps);
    } catch (err) {
        console.error("Fetch platform competitions error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// GET /api/platform-competitions/learner  — list competitions eligible for the logged-in learner
router.get("/learner", async (req, res) => {
    try {
        const decoded = verifyAuth(req);
        if (decoded.role !== "individual_learner") {
            return res.status(403).json({ message: "Only individual learners can access this." });
        }

        const learner = await User.findById(decoded.userId).select("_id fullName xp tenantId").lean();
        if (!learner) return res.status(404).json({ message: "Learner not found." });

        const learnerXP = learner.xp || 0;
        const learnerTenantId = learner.tenantId?.toString();

        const now = new Date();
        const allComps = await PlatformCompetition.find({ status: "Active" })
            .sort({ startDate: -1 })
            .lean();

        const eligible = allComps.filter(comp => {
            const elig = comp.eligibility || {};

            // Individual learners are NOT institution members — the `institutions` field
            // controls which university students see the competition, not individual learners.
            // Only allowLearners + XP constraints apply here.
            if (!elig.allowLearners) return false;

            // XP checks (0 = no limit)
            if (elig.minLearnerXP > 0 && learnerXP < elig.minLearnerXP) return false;
            if (elig.maxLearnerXP > 0 && learnerXP > elig.maxLearnerXP) return false;

            return true;
        });

        // Enrich with submission status
        const enriched = eligible.map(comp => {
            const sub = (comp.submissions || []).find(
                s => s.learnerId?.toString() === decoded.userId
            );
            return {
                ...comp,
                hasSubmitted: !!sub,
                myScore: sub ? sub.score : null,
            };
        });

        res.json(enriched);
    } catch (err) {
        console.error("Learner competitions error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// GET /api/platform-competitions/student  — list platform competitions eligible for a student
router.get("/student", async (req, res) => {
    try {
        const decoded = verifyAuth(req);
        if (decoded.role !== "student") {
            return res.status(403).json({ message: "Only students can access this." });
        }

        const studentTenantId = decoded.tenantId?.toString();
        if (!studentTenantId) {
            return res.status(400).json({ message: "Student tenant information missing." });
        }

        // Find the institution that owns this student's tenantId.
        // This lets us match against BOTH Institution._id (old data) and
        // Institution.tenantId (new data after the frontend fix).
        const institution = await Institution.findOne({ tenantId: studentTenantId })
            .select("_id tenantId")
            .lean();
        const institutionObjId = institution?._id?.toString();

        const allComps = await PlatformCompetition.find({ status: "Active" })
            .sort({ startDate: -1 })
            .lean();

        const eligible = allComps.filter(comp => {
            const elig = comp.eligibility || {};
            if (elig.institutions === "none") return false;
            if (elig.institutions === "specific") {
                // Support both old (Institution._id) and new (Institution.tenantId) stored values
                return (elig.tenantIds || []).some(id => {
                    const idStr = id.toString();
                    return idStr === studentTenantId || (institutionObjId && idStr === institutionObjId);
                });
            }
            // 'all' — visible to all institution students
            return true;
        });

        const studentId = decoded.userId;
        const enriched = eligible.map(comp => {
            const sub = (comp.submissions || []).find(
                s => s.learnerId?.toString() === studentId
            );
            return {
                ...comp,
                hasSubmitted: !!sub,
                myScore: sub ? sub.score : null,
                isPlatformCompetition: true,
            };
        });

        res.json(enriched);
    } catch (err) {
        console.error("Student platform competitions error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// GET /api/platform-competitions/:id/learner-view  — single competition for learner/student (strips hidden test case outputs)
router.get("/:id/learner-view", async (req, res) => {
    try {
        const decoded = verifyAuth(req);
        const comp = await PlatformCompetition.findById(req.params.id).lean();
        if (!comp) return res.status(404).json({ message: "Competition not found." });

        // Strip hidden test case expected outputs
        const sanitized = {
            ...comp,
            tasks: (comp.tasks || []).map(task => ({
                ...task,
                testCases: (task.testCases || []).map(tc => ({
                    ...tc,
                    expectedOutput: tc.isHidden ? undefined : tc.expectedOutput
                }))
            }))
        };

        // Add submission status for the learner
        const sub = (comp.submissions || []).find(
            s => s.learnerId?.toString() === decoded.userId
        );
        sanitized.hasSubmitted = !!sub;
        sanitized.mySubmission = sub
            ? { score: sub.score, earnedMarks: sub.earnedMarks, totalMarks: sub.totalMarks }
            : null;

        res.json(sanitized);
    } catch (err) {
        console.error("Learner competition view error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// POST /api/platform-competitions/:id/run  — run code for a task (any authenticated user)
router.post("/:id/run", async (req, res) => {
    try {
        verifyAuth(req);
        const { taskId, code, language } = req.body;

        const comp = await PlatformCompetition.findById(req.params.id).lean();
        if (!comp) return res.status(404).json({ message: "Competition not found." });

        const task = comp.tasks.find(t => t._id?.toString() === taskId);
        if (!task) return res.status(404).json({ message: "Task not found." });

        const result = await executeTask(task, code, language || comp.language);
        res.json(result);
    } catch (err) {
        console.error("Platform competition run error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// POST /api/platform-competitions/:id/student-submit  — student submits their solution
router.post("/:id/student-submit", async (req, res) => {
    try {
        const decoded = verifyAuth(req);
        if (decoded.role !== "student") {
            return res.status(403).json({ message: "Only students can use this endpoint." });
        }

        const { taskSubmissions } = req.body;
        const studentId = decoded.userId;

        const comp = await PlatformCompetition.findById(req.params.id);
        if (!comp) return res.status(404).json({ message: "Competition not found." });

        // Prevent double submission
        const existing = comp.submissions.find(s => s.learnerId?.toString() === studentId);
        if (existing) {
            return res.status(409).json({ message: "You have already submitted this competition." });
        }

        const student = await Student.findById(studentId).select("_id name").lean();

        // Evaluate all tasks
        const taskResults = [];
        let earnedMarks = 0;

        for (const sub of taskSubmissions) {
            const task = comp.tasks.find(t => t._id?.toString() === sub.taskId);
            if (!task) continue;

            let result;
            try {
                result = await executeTask(task, sub.code, comp.language);
            } catch {
                result = { score: 0 };
            }

            const taskScore = result.score || 0;
            const taskEarned = (taskScore / 10) * task.marks;
            earnedMarks += taskEarned;

            taskResults.push({
                taskId: sub.taskId,
                code: sub.code,
                score: taskScore,
                passed: taskScore >= 7
            });
        }

        const scorePercent = comp.totalMarks > 0
            ? Math.round((earnedMarks / comp.totalMarks) * 100)
            : 0;

        comp.submissions.push({
            learnerId: studentId,
            learnerName: student?.name || "Student",
            score: scorePercent,
            totalMarks: comp.totalMarks,
            earnedMarks: Math.round(earnedMarks),
            submittedAt: new Date(),
            taskResults
        });

        await comp.save();

        res.json({
            message: "Submission successful.",
            score: scorePercent,
            earnedMarks: Math.round(earnedMarks),
            totalMarks: comp.totalMarks,
            taskResults
        });
    } catch (err) {
        console.error("Student submit error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// POST /api/platform-competitions/:id/learner-submit  — learner submits their solution
router.post("/:id/learner-submit", async (req, res) => {
    try {
        const decoded = verifyAuth(req);
        if (decoded.role !== "individual_learner") {
            return res.status(403).json({ message: "Only individual learners can submit." });
        }

        const { taskSubmissions } = req.body;
        const learnerId = decoded.userId;

        const comp = await PlatformCompetition.findById(req.params.id);
        if (!comp) return res.status(404).json({ message: "Competition not found." });

        // Prevent double submission
        const existing = comp.submissions.find(s => s.learnerId?.toString() === learnerId);
        if (existing) {
            return res.status(409).json({ message: "You have already submitted this competition." });
        }

        const learner = await User.findById(learnerId).select("_id fullName").lean();

        // Evaluate all tasks
        const taskResults = [];
        let earnedMarks = 0;

        for (const sub of taskSubmissions) {
            const task = comp.tasks.find(t => t._id?.toString() === sub.taskId);
            if (!task) continue;

            let result;
            try {
                result = await executeTask(task, sub.code, comp.language);
            } catch {
                result = { score: 0 };
            }

            const taskScore = result.score || 0;
            const taskEarned = (taskScore / 10) * task.marks;
            earnedMarks += taskEarned;

            taskResults.push({
                taskId: sub.taskId,
                code: sub.code,
                score: taskScore,
                passed: taskScore >= 7
            });
        }

        const scorePercent = comp.totalMarks > 0
            ? Math.round((earnedMarks / comp.totalMarks) * 100)
            : 0;

        comp.submissions.push({
            learnerId,
            learnerName: learner?.fullName || "Learner",
            score: scorePercent,
            totalMarks: comp.totalMarks,
            earnedMarks: Math.round(earnedMarks),
            submittedAt: new Date(),
            taskResults
        });

        await comp.save();

        res.json({
            message: "Submission successful.",
            score: scorePercent,
            earnedMarks: Math.round(earnedMarks),
            totalMarks: comp.totalMarks,
            taskResults
        });
    } catch (err) {
        console.error("Learner submit error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// GET /api/platform-competitions/:id/leaderboard  — ranked submissions (any authenticated user)
router.get("/:id/leaderboard", async (req, res) => {
    try {
        verifyAuth(req);
        const comp = await PlatformCompetition.findById(req.params.id)
            .select("title submissions totalMarks")
            .lean();
        if (!comp) return res.status(404).json({ message: "Competition not found." });

        // Resolve institution name + XP for each submitter
        const enriched = await Promise.all(
            (comp.submissions || []).map(async (s) => {
                const idStr = s.learnerId?.toString();
                let institutionLabel = "Individual Learner";
                let xp = 0;

                // Check Student collection first
                const student = await Student.findById(idStr).select("tenantId xp").lean();
                if (student) {
                    xp = student.xp || 0;
                    const inst = await Institution.findOne({ tenantId: student.tenantId })
                        .select("name").lean();
                    institutionLabel = inst?.name || "Institution";
                } else {
                    // Check User (individual learner)
                    const user = await User.findById(idStr).select("xp").lean();
                    if (user) xp = user.xp || 0;
                }

                return {
                    participantName: s.learnerName,
                    institutionLabel,
                    xp,
                    score: s.score,
                    earnedMarks: s.earnedMarks,
                    totalMarks: comp.totalMarks,
                    submittedAt: s.submittedAt
                };
            })
        );

        // Sort: score desc, then XP desc, then earlier submission first
        enriched.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.xp !== a.xp) return b.xp - a.xp;
            return new Date(a.submittedAt) - new Date(b.submittedAt);
        });

        const ranked = enriched.map((e, i) => ({ rank: i + 1, ...e }));

        res.json({
            competitionTitle: comp.title,
            totalParticipants: ranked.length,
            leaderboard: ranked
        });
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
});

// GET /api/platform-competitions/:id  — single (superadmin only)
router.get("/:id", async (req, res) => {
    try {
        verifySuperAdmin(req);
        const comp = await PlatformCompetition.findById(req.params.id).lean();
        if (!comp) return res.status(404).json({ message: "Not found" });
        res.json(comp);
    } catch (err) {
        console.error("Fetch single platform competition error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

// DELETE /api/platform-competitions/:id  — delete (superadmin only)
router.delete("/:id", async (req, res) => {
    try {
        verifySuperAdmin(req);
        await PlatformCompetition.findByIdAndDelete(req.params.id);
        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("Delete platform competition error:", err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

export default router;
