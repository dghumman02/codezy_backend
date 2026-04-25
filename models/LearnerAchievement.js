import mongoose from 'mongoose';

/**
 * LearnerAchievement Model - For Individual Learners Only
 * 18 badges across 4 categories: Beginner, Score Based, Learning Progress, Streak
 */
const learnerAchievementSchema = new mongoose.Schema({
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
    enum: ['Beginner', 'Score Based', 'Learning Progress', 'Streak'],
    default: 'Beginner'
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
    default: '#6366f1'
  },
  tier: {
    type: String,
    enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'],
    default: 'Bronze'
  },
  criteria: {
    type: {
      type: String,
      enum: [
        'first_lab',
        'first_module',
        'first_quiz',
        'first_code',
        'perfect_lab',
        'perfect_quiz',
        'perfect_lab_count',
        'perfect_quiz_count',
        'perfect_total',
        'lab_completion',
        'module_completion',
        'course_completion',
        'streak_days'
      ]
    },
    threshold: Number
  },
  repeatable: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Seed 18 achievements across 4 categories for individual learners
learnerAchievementSchema.statics.seedDefaults = async function() {
  const defaults = [
    // ===== BEGINNER (4) =====
    {
      code: 'FIRST_STEPS',
      title: 'First Steps',
      description: 'Complete your first lab',
      category: 'Beginner',
      xpAward: 50,
      icon: 'footprints',
      iconColor: '#6366f1',
      tier: 'Bronze',
      criteria: { type: 'first_lab', threshold: 1 },
      repeatable: false
    },
    {
      code: 'MODULE_EXPLORER',
      title: 'Module Explorer',
      description: 'Complete your first module',
      category: 'Beginner',
      xpAward: 75,
      icon: 'layers',
      iconColor: '#8b5cf6',
      tier: 'Bronze',
      criteria: { type: 'first_module', threshold: 1 },
      repeatable: false
    },
    {
      code: 'QUIZ_STARTER',
      title: 'Quiz Starter',
      description: 'Complete your first quiz',
      category: 'Beginner',
      xpAward: 50,
      icon: 'target',
      iconColor: '#06b6d4',
      tier: 'Bronze',
      criteria: { type: 'first_quiz', threshold: 1 },
      repeatable: false
    },
    {
      code: 'CODE_INITIATE',
      title: 'Code Initiate',
      description: 'Submit your first code solution',
      category: 'Beginner',
      xpAward: 50,
      icon: 'code',
      iconColor: '#10b981',
      tier: 'Bronze',
      criteria: { type: 'first_code', threshold: 1 },
      repeatable: false
    },

    // ===== SCORE BASED (5) =====
    {
      code: 'PERFECT_LAB',
      title: 'Perfect Lab',
      description: 'Score 10/10 on any lab',
      category: 'Score Based',
      xpAward: 100,
      icon: 'star',
      iconColor: '#f59e0b',
      tier: 'Silver',
      criteria: { type: 'perfect_lab', threshold: 1 },
      repeatable: true
    },
    {
      code: 'PERFECT_QUIZ',
      title: 'Perfect Quiz',
      description: 'Score 100% on any quiz',
      category: 'Score Based',
      xpAward: 100,
      icon: 'award',
      iconColor: '#f97316',
      tier: 'Silver',
      criteria: { type: 'perfect_quiz', threshold: 1 },
      repeatable: true
    },
    {
      code: 'PERFECTIONIST',
      title: 'Perfectionist',
      description: 'Score 10/10 on 5 different labs',
      category: 'Score Based',
      xpAward: 200,
      icon: 'trophy',
      iconColor: '#eab308',
      tier: 'Gold',
      criteria: { type: 'perfect_lab_count', threshold: 5 },
      repeatable: false
    },
    {
      code: 'FLAWLESS_MIND',
      title: 'Flawless Mind',
      description: 'Score 100% on 5 different quizzes',
      category: 'Score Based',
      xpAward: 200,
      icon: 'crown',
      iconColor: '#a855f7',
      tier: 'Gold',
      criteria: { type: 'perfect_quiz_count', threshold: 5 },
      repeatable: false
    },
    {
      code: 'ELITE_SOLVER',
      title: 'Elite Solver',
      description: 'Achieve 15 total perfect scores (labs + quizzes)',
      category: 'Score Based',
      xpAward: 350,
      icon: 'zap',
      iconColor: '#ef4444',
      tier: 'Platinum',
      criteria: { type: 'perfect_total', threshold: 15 },
      repeatable: false
    },

    // ===== LEARNING PROGRESS (5) =====
    {
      code: 'LAB_APPRENTICE',
      title: 'Lab Apprentice',
      description: 'Complete 10 labs',
      category: 'Learning Progress',
      xpAward: 150,
      icon: 'code',
      iconColor: '#3b82f6',
      tier: 'Silver',
      criteria: { type: 'lab_completion', threshold: 10 },
      repeatable: false
    },
    {
      code: 'LAB_MASTER',
      title: 'Lab Master',
      description: 'Complete 25 labs',
      category: 'Learning Progress',
      xpAward: 300,
      icon: 'rocket',
      iconColor: '#6366f1',
      tier: 'Gold',
      criteria: { type: 'lab_completion', threshold: 25 },
      repeatable: false
    },
    {
      code: 'LAB_GRANDMASTER',
      title: 'Lab Grandmaster',
      description: 'Complete 50 labs',
      category: 'Learning Progress',
      xpAward: 500,
      icon: 'crown',
      iconColor: '#d946ef',
      tier: 'Diamond',
      criteria: { type: 'lab_completion', threshold: 50 },
      repeatable: false
    },
    {
      code: 'MODULE_FINISHER',
      title: 'Module Finisher',
      description: 'Complete 5 modules',
      category: 'Learning Progress',
      xpAward: 250,
      icon: 'layers',
      iconColor: '#14b8a6',
      tier: 'Gold',
      criteria: { type: 'module_completion', threshold: 5 },
      repeatable: false
    },
    {
      code: 'COURSE_CONQUEROR',
      title: 'Course Conqueror',
      description: 'Complete an entire course',
      category: 'Learning Progress',
      xpAward: 500,
      icon: 'medal',
      iconColor: '#f59e0b',
      tier: 'Platinum',
      criteria: { type: 'course_completion', threshold: 1 },
      repeatable: true
    },

    // ===== STREAK (4) =====
    {
      code: 'WEEK_WARRIOR',
      title: 'Week Warrior',
      description: 'Maintain a 7-day learning streak',
      category: 'Streak',
      xpAward: 100,
      icon: 'flame',
      iconColor: '#f97316',
      tier: 'Silver',
      criteria: { type: 'streak_days', threshold: 7 },
      repeatable: false
    },
    {
      code: 'MARATHON_RUNNER',
      title: 'Marathon Runner',
      description: 'Maintain a 14-day learning streak',
      category: 'Streak',
      xpAward: 200,
      icon: 'flame',
      iconColor: '#ef4444',
      tier: 'Gold',
      criteria: { type: 'streak_days', threshold: 14 },
      repeatable: false
    },
    {
      code: 'UNSTOPPABLE',
      title: 'Unstoppable',
      description: 'Maintain a 30-day learning streak',
      category: 'Streak',
      xpAward: 350,
      icon: 'flame',
      iconColor: '#dc2626',
      tier: 'Platinum',
      criteria: { type: 'streak_days', threshold: 30 },
      repeatable: false
    },
    {
      code: 'LEGEND',
      title: 'Legend',
      description: 'Maintain a 60-day learning streak',
      category: 'Streak',
      xpAward: 500,
      icon: 'crown',
      iconColor: '#b91c1c',
      tier: 'Diamond',
      criteria: { type: 'streak_days', threshold: 60 },
      repeatable: false
    }
  ];

  // Remove old badges that no longer exist
  const validCodes = defaults.map(d => d.code);
  await this.deleteMany({ code: { $nin: validCodes } });

  for (const achievement of defaults) {
    await this.findOneAndUpdate(
      { code: achievement.code },
      achievement,
      { upsert: true, new: true }
    );
  }
  
  console.log('✅ 18 achievements seeded for individual learners');
  return defaults.length;
};

const LearnerAchievement = mongoose.model('LearnerAchievement', learnerAchievementSchema);
export default LearnerAchievement;
