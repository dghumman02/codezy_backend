import mongoose from "mongoose";
import Course from "../models/Course.js";
import Notification from "../models/Notification.js";
import { sendPushNotifications } from "./notificationService.js";

/**
 * Deadline Reminder Service
 *
 * Runs periodically to find labs with approaching deadlines and sends
 * push notifications to students who haven't submitted yet.
 *
 * Reminder windows:
 *   - DEADLINE_5H : fires when ≤5 hours remain before the due date/time
 *   - DEADLINE_1H : fires when ≤1 hour remains before the due date/time
 */

const INTERVAL_MS = 10 * 60 * 1000; // run every 10 minutes
const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Build a JS Date from a lab's dueDate (Date) and dueTime (string "HH:MM").
 */
function buildDeadline(dueDate, dueTime) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return null;

  if (dueTime && dueTime.includes(":")) {
    const [h, m] = dueTime.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(23, 59, 0, 0);
  }
  return d;
}

/**
 * Core check: scan every course → class → lab and create reminder
 * notifications where appropriate.
 */
async function checkDeadlines(io) {
  const now = new Date();
  const fiveHoursLater = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const oneHourLater = new Date(now.getTime() + 1 * 60 * 60 * 1000);

  // Fetch all active courses that have classes with labs
  const courses = await Course.find({ status: "Active" })
    .select("classes title")
    .lean();

  for (const course of courses) {
    for (const cls of course.classes || []) {
      for (const lab of cls.labs || []) {
        const deadline = buildDeadline(lab.dueDate, lab.dueTime);
        if (!deadline || deadline <= now) continue; // already past

        // Determine which reminder windows apply
        const reminders = [];

        if (deadline <= fiveHoursLater) {
          reminders.push({ type: "DEADLINE_5H", label: "5 hours" });
        }
        if (deadline <= oneHourLater) {
          reminders.push({ type: "DEADLINE_1H", label: "1 hour" });
        }

        if (reminders.length === 0) continue;

        // Students who already submitted this lab
        const submittedIds = new Set(
          (lab.submissions || []).map((s) => s.studentId.toString())
        );

        // Students enrolled but not yet submitted
        const pendingStudentIds = (cls.students || [])
          .map((id) => id.toString())
          .filter((id) => !submittedIds.has(id));

        if (pendingStudentIds.length === 0) continue;

        for (const reminder of reminders) {
          await sendReminder({
            type: reminder.type,
            label: reminder.label,
            courseId: course._id,
            classId: cls._id,
            lab,
            pendingStudentIds,
            deadline,
            io,
          });
        }
      }
    }
  }
}

/**
 * Create notifications for a single reminder type/lab combination,
 * skipping students who already received that exact reminder.
 */
async function sendReminder({
  type,
  label,
  courseId,
  classId,
  lab,
  pendingStudentIds,
  deadline,
  io,
}) {
  // Find which students already received this specific reminder for this lab
  const existing = await Notification.find({
    type,
    lab: lab._id,
    recipient: {
      $in: pendingStudentIds.map((id) => new mongoose.Types.ObjectId(id)),
    },
  })
    .select("recipient")
    .lean();

  const alreadySent = new Set(existing.map((n) => n.recipient.toString()));

  const targets = pendingStudentIds.filter((id) => !alreadySent.has(id));
  if (targets.length === 0) return;

  const expiresAt = new Date(Date.now() + NOTIFICATION_TTL_MS);

  const title =
    type === "DEADLINE_1H" ? "⚠️ Final Reminder" : "⏰ Deadline Approaching";

  const deadlineStr = deadline.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const message =
    type === "DEADLINE_1H"
      ? `Hurry! "${lab.title}" is due in less than 1 hour (${deadlineStr}). Submit now!`
      : `"${lab.title}" is due in less than 5 hours (${deadlineStr}). Don't forget to submit!`;

  const docs = targets.map((studentId) => ({
    recipient: new mongoose.Types.ObjectId(studentId),
    title,
    message,
    type,
    course: courseId,
    class: classId,
    lab: lab._id,
    dueDate: lab.dueDate,
    isRead: false,
    expiresAt,
  }));

  const inserted = await Notification.insertMany(docs);
  console.log(
    `[DeadlineReminder] Created ${inserted.length} ${type} notifications for lab "${lab.title}"`
  );

  // Real-time delivery via Socket.io
  if (io) {
    for (const notif of inserted) {
      const room = notif.recipient.toString();
      const sockets = io.sockets.adapter.rooms.get(room);
      if (sockets && sockets.size > 0) {
        io.to(room).emit("new_notification", {
          _id: notif._id,
          title: notif.title,
          message: notif.message,
          type: notif.type,
          course: notif.course,
          lab: notif.lab,
          dueDate: notif.dueDate,
          isRead: false,
          createdAt: notif.createdAt,
        });
      }
    }
  }

  // FCM push notifications
  await sendPushNotifications(inserted);
}

/**
 * Start the periodic deadline-reminder checker.
 * Call once after MongoDB is connected.
 *
 * @param {Object} io - Socket.io server instance
 * @returns {NodeJS.Timeout} interval handle (for cleanup)
 */
export function startDeadlineReminders(io) {
  console.log(
    `[DeadlineReminder] ✅ Started — checking every ${INTERVAL_MS / 60000} minutes`
  );

  // Run immediately on startup, then on interval
  checkDeadlines(io).catch((err) =>
    console.error("[DeadlineReminder] Error on initial run:", err)
  );

  return setInterval(() => {
    checkDeadlines(io).catch((err) =>
      console.error("[DeadlineReminder] Error:", err)
    );
  }, INTERVAL_MS);
}
