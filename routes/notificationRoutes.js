import express from "express";
import auth from "../middleware/auth.js";
import {
  getMyNotifications,
  getMyUnreadCount,
  markAsRead
} from "../controllers/notificationController.js";

const router = express.Router();

/**
 * Notification Routes
 * 
 * All routes are protected by JWT authentication.
 * User ID is derived from the token, never from request body.
 * 
 * Endpoints:
 * - GET    /api/notifications           → Get user's notifications (sorted by newest)
 * - GET    /api/notifications/unread-count → Get unread count
 * - PATCH  /api/notifications/:id/read  → Mark specific notification as read
 */

// Apply JWT authentication to all routes
router.use(auth);

// GET /api/notifications
// Query params: ?limit=50&skip=0
router.get("/", getMyNotifications);

// GET /api/notifications/unread-count  
// Must be defined before /:id routes to avoid matching "unread-count" as an ID
router.get("/unread-count", getMyUnreadCount);

// PATCH /api/notifications/:id/read
router.patch("/:id/read", markAsRead);

export default router;
