import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import Course from "../models/Course.js";
import Student from "../models/Students.js";
import admin from "../config/firebase.js";

/**
 * Notification Service
 * 
 * ARCHITECTURE:
 * 1. MongoDB is the source of truth - notifications are ALWAYS stored in DB first
 * 2. Socket.io is only a real-time delivery layer for connected users
 * 3. Offline users retrieve notifications via REST API
 * 4. FCM push support is prepared but not implemented
 */

// TTL duration: 7 days in milliseconds
const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create notifications for all students in a class when a lab is created
 * 
 * @param {Object} params
 * @param {string} params.courseId - The course ID
 * @param {string} params.classId - The class ID where lab was created
 * @param {Object} params.lab - The created lab object
 * @param {string} params.teacherName - Name of the teacher who created the lab
 * @param {Object} params.io - Socket.io instance (optional, for real-time delivery)
 * @returns {Promise<{success: boolean, notificationCount: number, studentIds: string[]}>}
 */
export const createLabNotifications = async ({
  courseId,
  classId,
  lab,
  teacherName,
  io = null
}) => {
  try {
    // Validate required parameters
    if (!courseId || !classId || !lab) {
      throw new Error("Missing required parameters: courseId, classId, or lab");
    }

    const courseObjectId = new mongoose.Types.ObjectId(courseId);
    const classObjectId = new mongoose.Types.ObjectId(classId);

    // Step 1: Get the course and class to find enrolled students
    const course = await Course.findById(courseObjectId)
      .select("classes title")
      .lean();

    if (!course) {
      console.error(`[NotificationService] Course not found: ${courseId}`);
      return { success: false, notificationCount: 0, studentIds: [] };
    }

    // Find the specific class
    const targetClass = course.classes.find(
      (c) => c._id.toString() === classId
    );

    if (!targetClass) {
      console.error(`[NotificationService] Class not found: ${classId}`);
      return { success: false, notificationCount: 0, studentIds: [] };
    }

    // Step 2: Get student IDs from the class
    const studentIds = targetClass.students || [];

    console.log(`[NotificationService] Class "${targetClass.name}" has students:`, studentIds);

    if (studentIds.length === 0) {
      console.log(`[NotificationService] ⚠️ No students enrolled in class "${targetClass.name}" - no notifications created`);
      return { success: true, notificationCount: 0, studentIds: [] };
    }

    console.log(`[NotificationService] Creating notifications for ${studentIds.length} students in class "${targetClass.name}"`);

    // Step 3: Calculate expiration date (7 days from now)
    const expiresAt = new Date(Date.now() + NOTIFICATION_TTL_MS);

    // Step 4: Create notification documents for each student
    const notificationDocs = studentIds.map((studentId) => ({
      recipient: new mongoose.Types.ObjectId(studentId),
      title: "New Lab Assigned",
      message: `"${lab.title}" has been assigned by ${teacherName}. Due: ${formatDueDate(lab.dueDate, lab.dueTime)}`,
      type: "LAB_CREATED",
      course: courseObjectId,
      class: classObjectId,
      lab: lab._id,
      teacherName: teacherName,
      dueDate: lab.dueDate,
      isRead: false,
      expiresAt: expiresAt
    }));

    // Step 5: Bulk insert notifications (MongoDB source of truth)
    const insertedNotifications = await Notification.insertMany(notificationDocs);

    console.log(`[NotificationService] ✅ Created ${insertedNotifications.length} notifications in database`);

    // Step 6: Real-time delivery via Socket.io (enhancement only)
    if (io) {
      await emitNotificationsViaSocket(io, insertedNotifications);
    }

    // Step 7: Send FCM push notifications to mobile devices
    await sendPushNotifications(insertedNotifications);

    return {
      success: true,
      notificationCount: insertedNotifications.length,
      studentIds: studentIds.map((id) => id.toString())
    };

  } catch (error) {
    console.error("[NotificationService] Error creating lab notifications:", error);
    throw error;
  }
};

/**
 * Emit notifications to connected users via Socket.io
 * This is only a real-time enhancement - notifications are already in DB
 * 
 * @param {Object} io - Socket.io instance
 * @param {Array} notifications - Array of notification documents
 */
const emitNotificationsViaSocket = async (io, notifications) => {
  try {
    for (const notification of notifications) {
      const recipientId = notification.recipient.toString();
      const roomName = recipientId; // Room name = userId

      // Check if user is connected (has joined their room)
      const room = io.sockets.adapter.rooms.get(roomName);
      
      if (room && room.size > 0) {
        // User is online - emit notification
        io.to(roomName).emit("new_notification", {
          _id: notification._id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          course: notification.course,
          class: notification.class,
          lab: notification.lab,
          teacherName: notification.teacherName,
          dueDate: notification.dueDate,
          isRead: notification.isRead,
          createdAt: notification.createdAt
        });

        console.log(`[Socket] ✅ Emitted notification to user ${recipientId}`);
      } else {
        // User is offline - no action needed, notification is already in DB
        console.log(`[Socket] User ${recipientId} is offline - notification saved in DB`);
      }
    }
  } catch (error) {
    // Socket errors should not affect notification creation
    console.error("[Socket] Error emitting notifications:", error);
  }
};

/**
 * FUTURE: Send push notifications via Firebase Cloud Messaging
 * 
 * Integration point for mobile push notifications.
 * When implementing:
 * 1. Import firebase-admin
 * 2. Fetch FCM tokens from Student model
 * 3. Send multicast message to all tokens
 * 
 * @param {Array} notifications - Array of notification documents
 */
export const sendPushNotifications = async (notifications) => {
  try {
    if (!notifications || notifications.length === 0) return;

    const recipientIds = [...new Set(notifications.map((n) => n.recipient.toString()))];

    const students = await Student.find({
      _id: { $in: recipientIds },
      pushNotificationsEnabled: { $ne: false },
    }).select("fcmTokens").lean();

    const tokenMap = {};
    for (const s of students) {
      if (s.fcmTokens && s.fcmTokens.length > 0) {
        tokenMap[s._id.toString()] = s.fcmTokens.map((t) => t.token);
      }
    }

    let sent = 0;
    let failed = 0;
    const staleTokens = [];

    for (const notification of notifications) {
      const tokens = tokenMap[notification.recipient.toString()];
      if (!tokens || tokens.length === 0) continue;

      const message = {
        tokens,
        notification: {
          title: notification.title,
          body: notification.message,
        },
        data: {
          type: notification.type || "LAB_CREATED",
          notificationId: notification._id.toString(),
          courseId: notification.course ? notification.course.toString() : "",
          labId: notification.lab ? notification.lab.toString() : "",
          dueDate: notification.dueDate ? notification.dueDate.toISOString() : "",
        },
        android: {
          priority: "high",
          notification: { channelId: "codezy_labs" },
        },
      };

      try {
        const response = await admin.messaging().sendEachForMulticast(message);
        sent += response.successCount;
        failed += response.failureCount;

        // Collect stale tokens for cleanup
        response.responses.forEach((resp, idx) => {
          if (
            !resp.success &&
            resp.error &&
            (resp.error.code === "messaging/registration-token-not-registered" ||
              resp.error.code === "messaging/invalid-registration-token")
          ) {
            staleTokens.push(tokens[idx]);
          }
        });
      } catch (fcmErr) {
        console.error("[FCM] Error sending to recipient:", fcmErr.message);
        failed += tokens.length;
      }
    }

    // Remove stale tokens from DB
    if (staleTokens.length > 0) {
      await Student.updateMany(
        { "fcmTokens.token": { $in: staleTokens } },
        { $pull: { fcmTokens: { token: { $in: staleTokens } } } }
      );
      console.log(`[FCM] Cleaned up ${staleTokens.length} stale tokens`);
    }

    console.log(`[FCM] Push notifications sent: ${sent}, failed: ${failed}`);
  } catch (error) {
    console.error("[FCM] sendPushNotifications error:", error.message);
  }
};

/**
 * Get notifications for a user
 * 
 * @param {string} userId - The user's ID
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum notifications to return
 * @param {number} options.skip - Number to skip (for pagination)
 * @returns {Promise<Array>}
 */
export const getUserNotifications = async (userId, options = {}) => {
  const { limit = 50, skip = 0 } = options;

  // Convert to ObjectId for proper querying
  const recipientId = new mongoose.Types.ObjectId(userId);

  console.log(`[NotificationService] Getting notifications for user: ${userId}`);

  const notifications = await Notification.find({ recipient: recipientId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  console.log(`[NotificationService] Found ${notifications.length} notifications`);

  return notifications;
};

/**
 * Get unread notification count for a user
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<number>}
 */
export const getUnreadCount = async (userId) => {
  // Convert to ObjectId for proper querying
  const recipientId = new mongoose.Types.ObjectId(userId);

  const count = await Notification.countDocuments({
    recipient: recipientId,
    isRead: false
  });

  console.log(`[NotificationService] Unread count for user ${userId}: ${count}`);

  return count;
};

/**
 * Mark a notification as read
 * 
 * @param {string} notificationId - The notification ID
 * @param {string} userId - The user's ID (for ownership validation)
 * @returns {Promise<Object|null>}
 */
export const markNotificationAsRead = async (notificationId, userId) => {
  // Convert to ObjectIds for proper querying
  const notifId = new mongoose.Types.ObjectId(notificationId);
  const recipientId = new mongoose.Types.ObjectId(userId);

  // Only mark as read if the notification belongs to this user
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notifId,
      recipient: recipientId // Ownership check
    },
    { isRead: true },
    { new: true }
  );

  return notification;
};

/**
 * Format due date for notification message
 * 
 * @param {Date} dueDate
 * @param {string} dueTime
 * @returns {string}
 */
const formatDueDate = (dueDate, dueTime) => {
  if (!dueDate) return "No deadline";
  
  const date = new Date(dueDate);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  
  return dueTime ? `${dateStr} at ${dueTime}` : dateStr;
};

export default {
  createLabNotifications,
  getUserNotifications,
  getUnreadCount,
  markNotificationAsRead,
  sendPushNotifications
};
