import mongoose from "mongoose";

/**
 * Notification Model
 * 
 * Architecture Principles:
 * - MongoDB is the source of truth
 * - Notifications auto-delete after 7 days via TTL index
 * - Each notification belongs to a single recipient (student)
 * - Socket.io is only used for real-time delivery enhancement
 */
const notificationSchema = new mongoose.Schema(
  {
    // The student who receives this notification
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true
    },

    // Notification content
    title: {
      type: String,
      required: true,
      trim: true
    },

    message: {
      type: String,
      required: true,
      trim: true
    },

    // Notification type - extensible for future types
    type: {
      type: String,
      enum: ["LAB_CREATED", "DEADLINE_5H", "DEADLINE_1H", "DEADLINE_24H", "ANNOUNCEMENT"],
      required: true
    },

    // Announcement-specific fields
    subject: {
      type: String,
      trim: true,
      default: ""
    },

    announcementBody: {
      type: String,
      trim: true,
      default: ""
    },

    // Who sent this (for announcements)
    senderName: {
      type: String,
      trim: true,
      default: ""
    },

    // recipientType helps frontend know which model recipient belongs to
    recipientType: {
      type: String,
      enum: ["Student", "Teacher"],
      default: "Student"
    },

    // Related entities for deep linking
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course"
    },

    class: {
      type: mongoose.Schema.Types.ObjectId
    },

    lab: {
      type: mongoose.Schema.Types.ObjectId
    },

    // Additional metadata
    teacherName: {
      type: String,
      trim: true
    },

    dueDate: {
      type: Date
    },

    // Read status
    isRead: {
      type: Boolean,
      default: false
    },

    // TTL - notifications auto-delete at this time
    // MongoDB TTL index will automatically remove documents when current time >= expiresAt
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// Compound indexes for efficient queries
notificationSchema.index({ recipient: 1, createdAt: -1 }); // For fetching user's notifications sorted by newest
notificationSchema.index({ recipient: 1, isRead: 1 }); // For counting unread notifications

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
