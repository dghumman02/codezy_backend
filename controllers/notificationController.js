import mongoose from "mongoose";
import {
  getUserNotifications,
  getUnreadCount,
  markNotificationAsRead
} from "../services/notificationService.js";

/**
 * Notification Controller
 * 
 * Security rules:
 * - All endpoints require JWT authentication
 * - userId is derived from req.user (never from request body)
 * - Users can only access their own notifications
 * - Ownership validation on all operations
 */

/**
 * GET /api/notifications
 * 
 * Returns notifications for the logged-in user, sorted by newest first.
 */
export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found in token" });
    }

    // Parse pagination options from query params
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100
    const skip = parseInt(req.query.skip) || 0;

    const notifications = await getUserNotifications(userId, { limit, skip });

    console.log(`[Notifications] Fetched ${notifications.length} notifications for user ${userId}`);

    res.json({
      success: true,
      count: notifications.length,
      notifications
    });

  } catch (error) {
    console.error("[Notifications] Error fetching notifications:", error);
    res.status(500).json({ message: "Server error fetching notifications" });
  }
};

/**
 * GET /api/notifications/unread-count
 * 
 * Returns total unread notifications for the logged-in user.
 */
export const getMyUnreadCount = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found in token" });
    }

    const unreadCount = await getUnreadCount(userId);

    res.json({
      success: true,
      unreadCount
    });

  } catch (error) {
    console.error("[Notifications] Error fetching unread count:", error);
    res.status(500).json({ message: "Server error fetching unread count" });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * 
 * Marks a notification as read only if it belongs to the logged-in user.
 */
export const markAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found in token" });
    }

    // Validate notification ID format
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ message: "Invalid notification ID format" });
    }

    // Mark as read with ownership validation (done in service)
    const notification = await markNotificationAsRead(notificationId, userId);

    if (!notification) {
      return res.status(404).json({ 
        message: "Notification not found or does not belong to you" 
      });
    }

    // Emit socket event for real-time sync across devices/tabs
    const io = req.app.get("io");
    if (io) {
      io.to(userId).emit("notification_read", { notificationId });
    }

    res.json({
      success: true,
      message: "Notification marked as read",
      notification
    });

  } catch (error) {
    console.error("[Notifications] Error marking as read:", error);
    res.status(500).json({ message: "Server error marking notification as read" });
  }
};
