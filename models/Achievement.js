import mongoose from 'mongoose';

/**
 * Achievement Model
 * Defines all available achievements/badges in the system
 */
const achievementSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['Programming', 'General', 'Streak', 'Performance'],
    default: 'General'
  },
  xpAward: {
    type: Number,
    default: 0
  },
  icon: {
    type: String,
    default: 'star'
  },
  iconColor: {
    type: String,
    default: '#6366f1' // indigo
  },
  tier: {
    type: String,
    enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'],
    default: 'Bronze'
  },
  // Criteria for unlocking (stored as JSON for flexibility)
  criteria: {
    type: {
      type: String,
      enum: [
        'submission_streak',      // consecutive daily submissions
        'early_excellence_streak', // consecutive top 3 finishes
        'first_attempt_perfect',   // pass all on first try
        'total_labs_completed',    // total labs finished
        'course_completion',       // complete all labs in a course
        'xp_milestone',            // reach XP threshold
        'performance_milestone',   // achieve score threshold
        'class_rank',              // rank in class
        'first_submit_high_score', // first to submit with 85%+ score
        'first_submit_perfect',    // first to submit with 100% score
        'high_score_labs',         // labs with score >= 8.5
        'perfect_score_labs',      // labs with perfect score (10)
        'custom'                   // custom criteria
      ]
    },
    threshold: Number,        // numeric value to achieve
    courseId: String,         // for course-specific achievements
    additionalParams: {}      // any extra params
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Seed default achievements
achievementSchema.statics.seedDefaults = async function() {
  const defaults = [
    // Submission Streak Achievements
    {
      code: 'CONSISTENT_CODER_I',
      title: 'Consistent Coder I',
      description: 'Submit labs 3 days in a row',
      category: 'Streak',
      xpAward: 20,
      icon: 'flame',
      iconColor: '#f97316',
      tier: 'Bronze',
      criteria: { type: 'submission_streak', threshold: 3 }
    },
    {
      code: 'CONSISTENT_CODER_II',
      title: 'Consistent Coder II',
      description: 'Submit labs 4 days in a row',
      category: 'Streak',
      xpAward: 30,
      icon: 'flame',
      iconColor: '#f97316',
      tier: 'Silver',
      criteria: { type: 'submission_streak', threshold: 4 }
    },
    {
      code: 'CONSISTENT_CODER_III',
      title: 'Consistent Coder III',
      description: 'Submit labs 5 days in a row',
      category: 'Streak',
      xpAward: 50,
      icon: 'flame',
      iconColor: '#f97316',
      tier: 'Gold',
      criteria: { type: 'submission_streak', threshold: 5 }
    },
    {
      code: 'UNSTOPPABLE_CODER',
      title: 'Unstoppable Coder',
      description: 'Submit labs 10 days in a row',
      category: 'Streak',
      xpAward: 150,
      icon: 'zap',
      iconColor: '#eab308',
      tier: 'Platinum',
      criteria: { type: 'submission_streak', threshold: 10 }
    },
    // Early Excellence Streak Achievements
    {
      code: 'SPEED_DEMON_I',
      title: 'Speed Demon I',
      description: 'Rank in top 3 with 85%+ score for 3 consecutive labs',
      category: 'Performance',
      xpAward: 50,
      icon: 'rocket',
      iconColor: '#8b5cf6',
      tier: 'Bronze',
      criteria: { type: 'early_excellence_streak', threshold: 3 }
    },
    {
      code: 'SPEED_DEMON_II',
      title: 'Speed Demon II',
      description: 'Rank in top 3 with 85%+ score for 4 consecutive labs',
      category: 'Performance',
      xpAward: 75,
      icon: 'rocket',
      iconColor: '#8b5cf6',
      tier: 'Silver',
      criteria: { type: 'early_excellence_streak', threshold: 4 }
    },
    {
      code: 'ELITE_FINISHER',
      title: 'Elite Finisher',
      description: 'Rank in top 3 with 85%+ score for 5 consecutive labs',
      category: 'Performance',
      xpAward: 120,
      icon: 'crown',
      iconColor: '#eab308',
      tier: 'Gold',
      criteria: { type: 'early_excellence_streak', threshold: 5 }
    },
    {
      code: 'LEGENDARY_TOPPER',
      title: 'Legendary Topper',
      description: 'Rank in top 3 with 85%+ score for 10 consecutive labs',
      category: 'Performance',
      xpAward: 300,
      icon: 'trophy',
      iconColor: '#eab308',
      tier: 'Diamond',
      criteria: { type: 'early_excellence_streak', threshold: 10 }
    },
    // First to Submit Achievements (Repeatable)
    {
      code: 'TRAILBLAZER',
      title: 'Trailblazer',
      description: 'Be the first to submit a lab with 85%+ score',
      category: 'Performance',
      xpAward: 75,
      icon: 'zap',
      iconColor: '#f59e0b',
      tier: 'Gold',
      criteria: { type: 'first_submit_high_score', threshold: 8.5 }
    },
    {
      code: 'PIONEER_PERFECTIONIST',
      title: 'Pioneer Perfectionist',
      description: 'Be the first to submit a lab with a perfect 100% score',
      category: 'Performance',
      xpAward: 150,
      icon: 'award',
      iconColor: '#8b5cf6',
      tier: 'Platinum',
      criteria: { type: 'first_submit_perfect', threshold: 10 }
    },
    // First Attempt Perfect
    {
      code: 'ONE_SHOT_WONDER',
      title: 'One Shot Wonder',
      description: 'Pass all test cases on your first attempt',
      category: 'Performance',
      xpAward: 25,
      icon: 'target',
      iconColor: '#22c55e',
      tier: 'Silver',
      criteria: { type: 'first_attempt_perfect', threshold: 1 }
    },
    // Programming Lab Badges
    {
      code: 'CODE_ROOKIE',
      title: 'Code Rookie',
      description: 'Complete your first programming lab',
      category: 'Programming',
      xpAward: 50,
      icon: 'footprints',
      iconColor: '#6366f1',
      tier: 'Bronze',
      criteria: { type: 'total_labs_completed', threshold: 1 }
    },
    {
      code: 'CODE_WARRIOR',
      title: 'Code Warrior',
      description: 'Complete 5 programming labs',
      category: 'Programming',
      xpAward: 100,
      icon: 'sword',
      iconColor: '#6366f1',
      tier: 'Silver',
      criteria: { type: 'total_labs_completed', threshold: 5 }
    },
    {
      code: 'HIGH_ACHIEVER',
      title: 'High Achiever',
      description: 'Score 8.5 or higher in 5 programming labs',
      category: 'Programming',
      xpAward: 150,
      icon: 'medal',
      iconColor: '#f59e0b',
      tier: 'Gold',
      criteria: { type: 'high_score_labs', threshold: 5 }
    },
    {
      code: 'PERFECTIONIST',
      title: 'Perfectionist',
      description: 'Score 10/10 in 5 programming labs',
      category: 'Programming',
      xpAward: 200,
      icon: 'crown',
      iconColor: '#8b5cf6',
      tier: 'Platinum',
      criteria: { type: 'perfect_score_labs', threshold: 5 }
    },
    // General Achievements
    {
      code: 'XP_ROOKIE',
      title: 'XP Rookie',
      description: 'Earn your first 100 XP',
      category: 'General',
      xpAward: 10,
      icon: 'star',
      iconColor: '#6366f1',
      tier: 'Bronze',
      criteria: { type: 'xp_milestone', threshold: 100 }
    },
    {
      code: 'XP_WARRIOR',
      title: 'XP Warrior',
      description: 'Earn 500 XP',
      category: 'General',
      xpAward: 25,
      icon: 'star',
      iconColor: '#6366f1',
      tier: 'Silver',
      criteria: { type: 'xp_milestone', threshold: 500 }
    },
    {
      code: 'XP_MASTER',
      title: 'XP Master',
      description: 'Earn 1000 XP',
      category: 'General',
      xpAward: 50,
      icon: 'star',
      iconColor: '#eab308',
      tier: 'Gold',
      criteria: { type: 'xp_milestone', threshold: 1000 }
    },
    {
      code: 'XP_LEGEND',
      title: 'XP Legend',
      description: 'Earn 5000 XP',
      category: 'General',
      xpAward: 100,
      icon: 'trophy',
      iconColor: '#eab308',
      tier: 'Diamond',
      criteria: { type: 'xp_milestone', threshold: 5000 }
    }
  ];

  for (const achievement of defaults) {
    await this.findOneAndUpdate(
      { code: achievement.code },
      achievement,
      { upsert: true, new: true }
    );
  }
  
  console.log('✅ Default achievements seeded');
};

const Achievement = mongoose.model('Achievement', achievementSchema);
export default Achievement;
