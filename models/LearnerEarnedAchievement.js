import mongoose from 'mongoose';

/**
 * LearnerEarnedAchievement Model - For Individual Learners Only
 * Tracks which achievements each learner has earned (supports repeatable badges)
 */
const learnerEarnedAchievementSchema = new mongoose.Schema({
  learnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  achievementCode: {
    type: String,
    required: true,
    index: true
  },
  xpAwarded: {
    type: Number,
    default: 0
  },
  unlockedCount: {
    type: Number,
    default: 1
  },
  earnedAt: {
    type: Date,
    default: Date.now
  },
  lastEarnedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Compound unique index - one record per learner per badge (count tracked via unlockedCount)
learnerEarnedAchievementSchema.index({ learnerId: 1, achievementCode: 1 }, { unique: true });

const LearnerEarnedAchievement = mongoose.model('LearnerEarnedAchievement', learnerEarnedAchievementSchema);
export default LearnerEarnedAchievement;
