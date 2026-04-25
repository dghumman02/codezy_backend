import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Notification from "../models/Notification.js";
import Course from "../models/Course.js";
import Student from "../models/Students.js";
import Teacher from "../models/Teacher.js";

const router = express.Router();

/* ── helpers ─────────────────────────────────────────────── */
const getAuthContext = (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) { const e = new Error("Unauthorized"); e.status = 401; throw e; }
    return jwt.verify(token, process.env.JWT_SECRET);
};

const ANNOUNCEMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ── helper: emit via socket to a list of user IDs ────────── */
const emitToUsers = (io, userIds, notification) => {
    if (!io) return;
    for (const uid of userIds) {
        io.to(uid.toString()).emit("new_notification", notification);
    }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/announcements
   Admin sends an announcement to students, teachers, or both
═══════════════════════════════════════════════════════════ */
router.post("/", async (req, res) => {
    try {
        const { tenantId, role, userId: adminId } = getAuthContext(req);

        if (role !== "institution_admin") {
            return res.status(403).json({ message: "Only institution admins can make announcements." });
        }

        const {
            title,
            subject,
            body,
            targetAudience,   // "students" | "teachers" | "both"
            courseId,         // optional – restrict to a specific course
            classId,          // optional – restrict to a specific class within the course
            senderName,
        } = req.body;

        if (!title?.trim() || !subject?.trim() || !body?.trim()) {
            return res.status(400).json({ message: "title, subject, and body are required." });
        }
        if (!targetAudience || !["students", "teachers", "both"].includes(targetAudience)) {
            return res.status(400).json({ message: "targetAudience must be 'students', 'teachers', or 'both'." });
        }

        const expiresAt = new Date(Date.now() + ANNOUNCEMENT_TTL_MS);
        const io = req.app.get("io");

        const recipientDocs = []; // { recipientId, recipientType }

        /* ── Collect student recipients ─────────────────────── */
        if (targetAudience === "students" || targetAudience === "both") {
            let studentIds = [];

            if (courseId && classId) {
                // specific class
                const course = await Course.findOne({ _id: courseId, tenantId }).select("classes").lean();
                const cls = (course?.classes || []).find(c => c._id.toString() === classId);
                studentIds = (cls?.students || []).map(s => s.toString());

            } else if (courseId) {
                // all classes in a course
                const course = await Course.findOne({ _id: courseId, tenantId }).select("classes").lean();
                const allStudents = new Set();
                (course?.classes || []).forEach(cls => {
                    (cls.students || []).forEach(s => allStudents.add(s.toString()));
                });
                studentIds = [...allStudents];

            } else {
                // all students in tenant
                const students = await Student.find({ tenantId }).select("_id").lean();
                studentIds = students.map(s => s._id.toString());
            }

            studentIds.forEach(id => recipientDocs.push({ recipientId: id, recipientType: "Student" }));
        }

        /* ── Collect teacher recipients ─────────────────────── */
        if (targetAudience === "teachers" || targetAudience === "both") {
            let teacherIds = [];

            if (courseId) {
                // teachers assigned to this course
                const course = await Course.findOne({ _id: courseId, tenantId }).select("classes.teacher").lean();
                const teacherSet = new Set();
                (course?.classes || []).forEach(cls => {
                    if (cls.teacher) teacherSet.add(cls.teacher.toString());
                });
                teacherIds = [...teacherSet];
            } else {
                // all teachers in tenant
                const teachers = await Teacher.find({ tenantId }).select("_id").lean();
                teacherIds = teachers.map(t => t._id.toString());
            }

            teacherIds.forEach(id => recipientDocs.push({ recipientId: id, recipientType: "Teacher" }));
        }

        if (recipientDocs.length === 0) {
            return res.status(400).json({ message: "No recipients found for the given criteria." });
        }

        /* ── Build and bulk insert notification documents ────── */
        const courseObjectId = courseId ? new mongoose.Types.ObjectId(courseId) : null;
        const classObjectId  = classId  ? new mongoose.Types.ObjectId(classId)  : null;

        const notifDocs = recipientDocs.map(({ recipientId, recipientType }) => ({
            recipient:        new mongoose.Types.ObjectId(recipientId),
            recipientType,
            title,
            message:          subject,   // short preview in dropdown
            subject,
            announcementBody: body,
            senderName:       senderName || "Institution Admin",
            type:             "ANNOUNCEMENT",
            course:           courseObjectId,
            class:            classObjectId,
            isRead:           false,
            expiresAt,
        }));

        const inserted = await Notification.insertMany(notifDocs);

        /* ── Real-time delivery ─────────────────────────────── */
        const emitPayload = {
            title,
            message: subject,
            subject,
            announcementBody: body,
            senderName: senderName || "Institution Admin",
            type: "ANNOUNCEMENT",
            isRead: false,
            createdAt: new Date(),
        };
        emitToUsers(io, recipientDocs.map(r => r.recipientId), emitPayload);

        res.status(201).json({
            message: `Announcement sent to ${inserted.length} recipient(s).`,
            recipientCount: inserted.length,
        });

    } catch (err) {
        console.error("Announcement error:", err);
        res.status(500).json({ message: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   GET /api/announcements/teacher
   Fetch announcements for the authenticated teacher
═══════════════════════════════════════════════════════════ */
router.get("/teacher", async (req, res) => {
    try {
        const { userId } = getAuthContext(req);

        const notifications = await Notification.find({
            recipient: new mongoose.Types.ObjectId(userId),
            recipientType: "Teacher",
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        res.json({ success: true, count: notifications.length, notifications });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   GET /api/announcements/teacher/unread-count
   Unread announcement count for authenticated teacher
═══════════════════════════════════════════════════════════ */
router.get("/teacher/unread-count", async (req, res) => {
    try {
        const { userId } = getAuthContext(req);
        const unreadCount = await Notification.countDocuments({
            recipient: new mongoose.Types.ObjectId(userId),
            recipientType: "Teacher",
            isRead: false,
        });
        res.json({ success: true, unreadCount });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   PATCH /api/announcements/:id/read
   Mark a notification as read (works for both students and teachers)
═══════════════════════════════════════════════════════════ */
router.patch("/:id/read", async (req, res) => {
    try {
        const { userId } = getAuthContext(req);

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid notification ID." });
        }

        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: new mongoose.Types.ObjectId(userId) },
            { $set: { isRead: true } },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: "Notification not found." });
        }

        const io = req.app.get("io");
        if (io) io.to(userId).emit("notification_read", { notificationId: req.params.id });

        res.json({ success: true, notification });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
