import mongoose from 'mongoose';

/**
 * StudentAchievement Model
 * Tracks which achievements each student has earned
 */
const studentAchievementSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true
  },
  achievementCode: {
    type: String,
    required: true,
    index: true
  },
  // How many times they've earned this achievement (for repeatable badges)
  earnedCount: {
    type: Number,
    default: 1
  },
  // XP awarded when earned
  xpAwarded: {
    type: Number,
    default: 0
  },
  // Context when earned (labId, courseId, etc.)
  context: {
    labId: mongoose.Schema.Types.ObjectId,
    courseId: mongoose.Schema.Types.ObjectId,
    classId: mongoose.Schema.Types.ObjectId,
    streakCount: Number,
    performance: Number
  },
  earnedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Compound index for quick lookups
studentAchievementSchema.index({ studentId: 1, achievementCode: 1 });

const StudentAchievement = mongoose.model('StudentAchievement', studentAchievementSchema);
export default StudentAchievement;
