import mongoose from 'mongoose';

/**
 * StudentGamification Model
 * Tracks student-specific gamification data (streaks, progress, etc.)
 */
const studentGamificationSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    unique: true,
    index: true
  },
  
  // === STREAK DATA ===
  // Submission streak (daily submissions)
  submissionStreak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastSubmissionDate: { type: Date },
    // Track how many times each milestone was reached
    milestonesReached: {
      streak3: { type: Number, default: 0 },
      streak4: { type: Number, default: 0 },
      streak5: { type: Number, default: 0 },
      streak10: { type: Number, default: 0 }
    }
  },
  
  // Early excellence streak (top 3 with 85%+ per course)
  earlyExcellenceStreaks: [{
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    classId: { type: mongoose.Schema.Types.ObjectId },
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastLabId: { type: mongoose.Schema.Types.ObjectId },
    // Track milestone counts for this course
    milestonesReached: {
      streak3: { type: Number, default: 0 },
      streak4: { type: Number, default: 0 },
      streak5: { type: Number, default: 0 },
      streak10: { type: Number, default: 0 }
    }
  }],

  // === XP TIER DATA ===
  tier: {
    type: String,
    enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'],
    default: 'Bronze'
  },
  
  // === SUBMISSION HISTORY ===
  // Track best scores per lab for reattempt logic
  labBestScores: [{
    labId: { type: mongoose.Schema.Types.ObjectId },
    courseId: { type: mongoose.Schema.Types.ObjectId },
    classId: { type: mongoose.Schema.Types.ObjectId },
    bestScore: { type: Number, default: 0 },  // 0-10
    bestXp: { type: Number, default: 0 },      // XP earned from best attempt
    attemptCount: { type: Number, default: 0 },
    firstAttemptPassed: { type: Boolean, default: false },
    submissionRank: { type: Number },         // 1,2,3 for early submission
    submittedAt: { type: Date }
  }],

  // === WEEKLY/MONTHLY STATS ===
  weeklyXp: {
    type: Number,
    default: 0
  },
  weekStartDate: {
    type: Date
  },
  monthlyXp: {
    type: Number,
    default: 0
  },
  monthStartDate: {
    type: Date
  },

  // === TOTALS ===
  totalLabsCompleted: {
    type: Number,
    default: 0
  },
  totalPerfectScores: {
    type: Number,
    default: 0
  },
  totalFirstAttemptPasses: {
    type: Number,
    default: 0
  },
  
  // === FIRST SUBMISSION TRACKING ===
  // Count of labs where student was first to submit with score >= 8.5
  firstToSubmitHighScore: {
    type: Number,
    default: 0
  },
  // Count of labs where student was first to submit with perfect score (10)
  firstToSubmitPerfect: {
    type: Number,
    default: 0
  },
  // Count of labs where student was among first 5 to submit
  topFiveSubmissions: {
    type: Number,
    default: 0
  },
  // Labs with high scores (>= 8.5)
  highScoreLabs: {
    type: Number,
    default: 0
  },
  // Labs with perfect scores (10)
  perfectScoreLabs: {
    type: Number,
    default: 0
  }

}, { timestamps: true });

// Helper method to check/update submission streak
studentGamificationSchema.methods.updateSubmissionStreak = function(submissionDate) {
  const today = new Date(submissionDate);
  today.setHours(0, 0, 0, 0);
  
  const lastDate = this.submissionStreak.lastSubmissionDate 
    ? new Date(this.submissionStreak.lastSubmissionDate) 
    : null;
  
  if (lastDate) {
    lastDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      // Same day, no streak change
      return { streakChanged: false, newStreak: this.submissionStreak.current };
    } else if (diffDays === 1) {
      // Consecutive day, increment streak
      this.submissionStreak.current += 1;
    } else {
      // Streak broken, reset to 1
      this.submissionStreak.current = 1;
    }
  } else {
    // First submission
    this.submissionStreak.current = 1;
  }
  
  // Update longest streak if current is higher
  if (this.submissionStreak.current > this.submissionStreak.longest) {
    this.submissionStreak.longest = this.submissionStreak.current;
  }
  
  this.submissionStreak.lastSubmissionDate = submissionDate;
  
  return { 
    streakChanged: true, 
    newStreak: this.submissionStreak.current,
    isLongest: this.submissionStreak.current === this.submissionStreak.longest
  };
};

// Helper to update early excellence streak
studentGamificationSchema.methods.updateEarlyExcellenceStreak = function(courseId, classId, labId, qualified) {
  let courseStreak = this.earlyExcellenceStreaks.find(
    s => s.courseId?.toString() === courseId.toString() && 
         s.classId?.toString() === classId.toString()
  );
  
  if (!courseStreak) {
    courseStreak = {
      courseId,
      classId,
      current: 0,
      longest: 0,
      lastLabId: null,
      milestonesReached: { streak3: 0, streak4: 0, streak5: 0, streak10: 0 }
    };
    this.earlyExcellenceStreaks.push(courseStreak);
    courseStreak = this.earlyExcellenceStreaks[this.earlyExcellenceStreaks.length - 1];
  }
  
  if (qualified) {
    courseStreak.current += 1;
    courseStreak.lastLabId = labId;
    
    if (courseStreak.current > courseStreak.longest) {
      courseStreak.longest = courseStreak.current;
    }
  } else {
    // Reset streak
    courseStreak.current = 0;
  }
  
  return {
    streakChanged: true,
    newStreak: courseStreak.current,
    qualified
  };
};

// Helper to calculate tier from XP
studentGamificationSchema.methods.calculateTier = function(totalXp) {
  if (totalXp >= 10000) return 'Diamond';
  if (totalXp >= 5000) return 'Platinum';
  if (totalXp >= 2500) return 'Gold';
  if (totalXp >= 1000) return 'Silver';
  return 'Bronze';
};

// Helper to get tier progress
studentGamificationSchema.methods.getTierProgress = function(totalXp) {
  const tiers = [
    { name: 'Bronze', min: 0, max: 999 },
    { name: 'Silver', min: 1000, max: 2499 },
    { name: 'Gold', min: 2500, max: 4999 },
    { name: 'Platinum', min: 5000, max: 9999 },
    { name: 'Diamond', min: 10000, max: Infinity }
  ];
  
  const currentTier = tiers.find(t => totalXp >= t.min && totalXp <= t.max);
  const currentIndex = tiers.indexOf(currentTier);
  const nextTier = tiers[currentIndex + 1];
  
  const xpInCurrentTier = totalXp - currentTier.min;
  const xpNeededForNextTier = nextTier ? nextTier.min - currentTier.min : 0;
  const progress = nextTier ? Math.round((xpInCurrentTier / xpNeededForNextTier) * 100) : 100;
  const xpToNextTier = nextTier ? nextTier.min - totalXp : 0;
  
  return {
    currentTier: currentTier.name,
    nextTier: nextTier?.name || null,
    progress,
    xpToNextTier,
    xpRange: `${currentTier.min.toLocaleString()} - ${currentTier.max === Infinity ? '∞' : currentTier.max.toLocaleString()}`
  };
};

const StudentGamification = mongoose.model('StudentGamification', studentGamificationSchema);
export default StudentGamification;
