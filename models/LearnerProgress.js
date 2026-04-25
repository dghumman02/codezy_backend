import mongoose from 'mongoose';

/**
 * LearnerProgress Model - For Individual Learners Only
 * Tracks learner gamification progress (streaks, lab counts, tier, etc.)
 */

// Tier definitions
const TIERS = [
  { name: 'Bronze',   min: 0,     max: 999,   next: 'Silver' },
  { name: 'Silver',   min: 1000,  max: 2499,  next: 'Platinum' },
  { name: 'Platinum', min: 2500,  max: 6999,  next: 'Gold' },
  { name: 'Gold',     min: 7000,  max: 14999, next: 'Diamond' },
  { name: 'Diamond',  min: 15000, max: 50000, next: null }
];

const learnerProgressSchema = new mongoose.Schema({
  learnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  
  // Streak tracking
  streak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastActivityDate: { type: Date }
  },
  
  // Progress counters
  totalLabsCompleted: { type: Number, default: 0 },
  totalLessonsCompleted: { type: Number, default: 0 },
  totalCoursesCompleted: { type: Number, default: 0 },
  totalQuizzesTaken: { type: Number, default: 0 },
  totalModulesCompleted: { type: Number, default: 0 },
  
  // Perfect score tracking
  perfectLabsCompleted: { type: Number, default: 0 },
  perfectQuizzes: { type: Number, default: 0 },
  
  // First-time flags
  firstLabCompleted: { type: Boolean, default: false },
  firstModuleCompleted: { type: Boolean, default: false },
  firstQuizCompleted: { type: Boolean, default: false },
  firstCodeSubmitted: { type: Boolean, default: false },
  
  // Module deduplication tracking
  completedModuleIds: [{ type: String }],
  
  // Lab tracking
  completedLabs: [{
    labId: { type: String },
    courseId: { type: String },
    score: { type: Number, default: 0 },
    xpEarned: { type: Number, default: 0 },
    completedAt: { type: Date, default: Date.now }
  }],
  
  // Course progress
  courseProgress: [{
    courseId: { type: mongoose.Schema.Types.ObjectId },
    lessonsCompleted: { type: Number, default: 0 },
    labsCompleted: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date }
  }]
  
}, { timestamps: true });

/**
 * Get tier info for a given XP amount
 */
learnerProgressSchema.statics.getTierInfo = function(totalXp) {
  const xp = totalXp || 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (xp >= TIERS[i].min) {
      const tier = TIERS[i];
      const nextTier = TIERS[i + 1] || null;
      const xpInTier = xp - tier.min;
      const tierRange = tier.max - tier.min + 1;
      const percent = nextTier 
        ? Math.min(Math.round((xpInTier / (nextTier.min - tier.min)) * 100), 100)
        : 100;
      const xpToNext = nextTier ? nextTier.min - xp : 0;
      
      return {
        tier: tier.name,
        xpRange: `${tier.min.toLocaleString()} - ${tier.max.toLocaleString()}`,
        nextTier: tier.next,
        nextTierPercent: percent,
        xpToNextTier: Math.max(xpToNext, 0)
      };
    }
  }
  return { tier: 'Bronze', xpRange: '0 - 999', nextTier: 'Silver', nextTierPercent: 0, xpToNextTier: 1000 };
};

/**
 * Update streak based on activity
 */
learnerProgressSchema.methods.updateStreak = function(activityDate = new Date()) {
  const today = new Date(activityDate);
  today.setHours(0, 0, 0, 0);
  
  const lastActivity = this.streak.lastActivityDate 
    ? new Date(this.streak.lastActivityDate) 
    : null;
  
  let streakChanged = false;
  
  if (!lastActivity) {
    this.streak.current = 1;
    this.streak.longest = 1;
    streakChanged = true;
  } else {
    const lastDate = new Date(lastActivity);
    lastDate.setHours(0, 0, 0, 0);
    
    const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      streakChanged = false;
    } else if (diffDays === 1) {
      this.streak.current += 1;
      if (this.streak.current > this.streak.longest) {
        this.streak.longest = this.streak.current;
      }
      streakChanged = true;
    } else {
      this.streak.current = 1;
      streakChanged = true;
    }
  }
  
  this.streak.lastActivityDate = today;
  return { streakChanged, newStreak: this.streak.current };
};

/**
 * Record a lab completion
 */
learnerProgressSchema.methods.recordLabCompletion = function(labId, courseId, score, xp) {
  const labIdStr = String(labId);
  const existingLab = this.completedLabs.find(
    l => String(l.labId) === labIdStr
  );
  
  let isNewCompletion = false;
  let xpGained = xp;
  const isPerfect = score >= 10;
  
  if (existingLab) {
    if (score > existingLab.score) {
      const previousXp = existingLab.xpEarned;
      const wasPreviouslyPerfect = existingLab.score >= 10;
      existingLab.score = score;
      existingLab.xpEarned = xp;
      xpGained = xp - previousXp;
      
      if (isPerfect && !wasPreviouslyPerfect) {
        this.perfectLabsCompleted = (this.perfectLabsCompleted || 0) + 1;
      }
    } else {
      xpGained = 0;
    }
  } else {
    this.completedLabs.push({
      labId: labIdStr,
      courseId: String(courseId),
      score,
      xpEarned: xp,
      completedAt: new Date()
    });
    this.totalLabsCompleted += 1;
    isNewCompletion = true;
    
    if (!this.firstLabCompleted) {
      this.firstLabCompleted = true;
    }
    if (!this.firstCodeSubmitted) {
      this.firstCodeSubmitted = true;
    }
    
    if (isPerfect) {
      this.perfectLabsCompleted = (this.perfectLabsCompleted || 0) + 1;
    }
  }
  
  return { isNewCompletion, xpGained, isPerfect };
};

const LearnerProgress = mongoose.model('LearnerProgress', learnerProgressSchema);
export default LearnerProgress;
