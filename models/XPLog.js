import mongoose from 'mongoose';

/**
 * XPLog Model
 * Tracks all XP transactions for audit and analytics
 */
const xpLogSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true
  },
  // Type of XP event
  eventType: {
    type: String,
    enum: [
      'lab_submission',
      'early_submission_bonus',
      'streak_bonus',
      'early_excellence_bonus',
      'first_attempt_bonus',
      'achievement_bonus',
      'reattempt_adjustment',
      'manual_adjustment'
    ],
    required: true
  },
  // XP amount (can be negative for adjustments)
  xpAmount: {
    type: Number,
    required: true
  },
  // XP before scaling
  rawXp: {
    type: Number
  },
  // Scaling factor applied (if any)
  scalingFactor: {
    type: Number,
    default: 1.0
  },
  // Student's XP before this transaction
  xpBefore: {
    type: Number,
    required: true
  },
  // Student's XP after this transaction
  xpAfter: {
    type: Number,
    required: true
  },
  // Context
  context: {
    labId: mongoose.Schema.Types.ObjectId,
    courseId: mongoose.Schema.Types.ObjectId,
    classId: mongoose.Schema.Types.ObjectId,
    labTitle: String,
    courseTitle: String,
    performance: Number,      // 0-1 score
    difficulty: String,       // Easy, Medium, Hard
    submissionRank: Number,   // 1, 2, 3 for early submission
    streakCount: Number,      // current streak
    achievementCode: String,  // if from achievement
    previousBestXp: Number,   // for reattempts
    isReattempt: Boolean
  },
  // Breakdown of XP calculation
  breakdown: {
    baseXp: Number,
    difficultyMultiplier: Number,
    earlySubmissionBonus: Number,
    streakBonus: Number,
    earlyExcellenceBonus: Number,
    firstAttemptBonus: Number,
    achievementBonus: Number,
    totalBeforeScaling: Number,
    scaledTotal: Number
  },
  description: {
    type: String
  }
}, { timestamps: true });

// Indexes for queries
xpLogSchema.index({ studentId: 1, createdAt: -1 });
xpLogSchema.index({ eventType: 1 });
xpLogSchema.index({ 'context.labId': 1 });

const XPLog = mongoose.model('XPLog', xpLogSchema);
export default XPLog;
