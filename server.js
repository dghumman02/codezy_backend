import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import authRoutes from "./routes/authRoutes.js";
import paymentRoutes from "./routes/payment.js";
import subscriptionRoutes from "./routes/subscription.js";
import teacherRoutes from "./routes/teacherRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import studentRoutes from './routes/studentRoutes.js';
import learnerRoutes from './routes/learnerRoutes.js';
import codeExecutionRoutes from "./routes/codeExecutionRoutes.js";
import learnerCoursesRoute from "./routes/learnerCourses.js";
import gamificationRoutes from "./routes/gamificationRoutes.js";
import superAdminRoutes from "./routes/superAdminRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import globalCourseRoutes from "./routes/globalCourseRoutes.js";
import learnerGamificationRoutes from "./routes/learnerGamificationRoutes.js";
import learnerSubmissionRoutes from "./routes/learnerSubmissionRoutes.js";
import sharedLabRoutes from "./routes/sharedLabRoutes.js";
import competitionRoutes from "./routes/competitionRoutes.js";
import platformCompetitionRoutes from "./routes/platformCompetitionRoutes.js";
import announcementRoutes from "./routes/announcementRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import { startDeadlineReminders } from "./services/deadlineReminderService.js";
dotenv.config();

const app = express();
const httpServer = createServer(app);

// ============================================
// SOCKET.IO SETUP WITH JWT AUTHENTICATION
// ============================================
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"]
});

// Make io accessible in routes/controllers
app.set("io", io);

// Socket.io JWT Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  
  if (!token) {
    console.log("[Socket] Connection rejected: No token provided");
    return next(new Error("Authentication error: Token required"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = {
      userId: decoded.userId,
      role: decoded.role,
      tenantId: decoded.tenantId
    };
    next();
  } catch (err) {
    console.log("[Socket] Connection rejected: Invalid token");
    return next(new Error("Authentication error: Invalid token"));
  }
});

// Socket.io Connection Handler
io.on("connection", (socket) => {
  const userId = socket.user.userId;
  
  // Automatically join user to their personal room (room name = userId)
  // This is secure - client cannot choose room name
  socket.join(userId);
  
  console.log(`[Socket] ✅ User ${userId} connected (socket: ${socket.id})`);

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`[Socket] ❌ User ${userId} disconnected (reason: ${reason})`);
  });

  // Optional: Allow client to request their unread count
  socket.on("get_unread_count", async (callback) => {
    try {
      const { getUnreadCount } = await import("./services/notificationService.js");
      const count = await getUnreadCount(userId);
      if (typeof callback === "function") {
        callback({ success: true, unreadCount: count });
      }
    } catch (err) {
      console.error("[Socket] Error getting unread count:", err);
      if (typeof callback === "function") {
        callback({ success: false, error: "Failed to get unread count" });
      }
    }
  });
});

// Stripe webhook raw parser (must be before express.json())
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));

// JSON parser
app.use(express.json());

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  "http://localhost:8080",   // Flutter web (default)
  "http://localhost:3000",   // alternate dev
];
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // allow all in dev — tighten in production
    }
  },
  credentials: true,
}));

// Serve uploaded files
app.use("/uploads", express.static("uploads"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/courses", courseRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/learners', learnerRoutes);
app.use("/api/code-execution", codeExecutionRoutes);
app.use("/api/learner-courses", learnerCoursesRoute);
app.use("/api/gamification", gamificationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api", superAdminRoutes);
app.use("/api/curriculum", globalCourseRoutes);
app.use("/api/learner-gamification", learnerGamificationRoutes);
app.use("/api/learner-submissions", learnerSubmissionRoutes);
app.use("/api/shared-labs", sharedLabRoutes);
app.use("/api/competitions", competitionRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/platform-competitions", platformCompetitionRoutes);
app.use("/api/announcements", announcementRoutes);

// Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");
    // Start deadline reminder checker after DB is ready
    startDeadlineReminders(io);
  })
  .catch((err) => console.error("❌ DB Connection Error:", err));

// Start server (httpServer for Socket.io)
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io ready for connections`);
});
