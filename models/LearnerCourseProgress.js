import mongoose from 'mongoose';

/**
 * LearnerCourseProgress Model - Tracks course and module completion for individual learners
 * Used for course locking and progress display
 */
const moduleProgressSchema = new mongoose.Schema({
  moduleId: {
    type: String,
    required: true
  },
  moduleTitle: {
    type: String,
    required: true
  },
  
  // Completion tracking
  isCompleted: {
    type: Boolean,
    default: false
  },
  
  // Score out of 10
  moduleScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  
  // Lab/Quiz counts
  totalLabs: { type: Number, default: 0 },
  completedLabs: { type: Number, default: 0 },
  totalQuizzes: { type: Number, default: 0 },
  completedQuizzes: { type: Number, default: 0 },
  
  // Individual scores
  labScores: [{
    lessonId: String,
    lessonTitle: String,
    score: Number,
    xpEarned: Number
  }],
  quizScores: [{
    lessonId: String,
    lessonTitle: String,
    score: Number,
    xpEarned: Number
  }],
  
  completedAt: Date
}, { _id: false });

const childCourseProgressSchema = new mongoose.Schema({
  childCourseId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  childCourseTitle: {
    type: String,
    required: true
  },
  
  // For specializations with multiple courses
  order: {
    type: Number,
    default: 0
  },
  
  isCompleted: {
    type: Boolean,
    default: false
  },
  
  isLocked: {
    type: Boolean,
    default: false
  },
  
  courseScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  
  modules: [moduleProgressSchema],
  
  completedAt: Date
}, { _id: false });

const learnerCourseProgressSchema = new mongoose.Schema({
  learnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GlobalCourse',
    required: true
  },
  
  isSpecialization: {
    type: Boolean,
    default: false
  },
  
  // For non-specialization courses
  modules: [moduleProgressSchema],
  
  // For specialization courses with child courses
  childCourses: [childCourseProgressSchema],
  
  // Overall course completion
  isCompleted: {
    type: Boolean,
    default: false
  },
  
  // Overall course score (average of all modules/child courses)
  courseScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  
  // Total XP earned from this course
  totalXpEarned: {
    type: Number,
    default: 0
  },
  
  completedAt: Date
  
}, { timestamps: true });

// Compound index for efficient querying
learnerCourseProgressSchema.index({ learnerId: 1, courseId: 1 }, { unique: true });

/**
 * Calculate module score based on lab and quiz scores
 */
learnerCourseProgressSchema.statics.calculateModuleScore = function(moduleProgress) {
  const allScores = [
    ...(moduleProgress.labScores || []).map(l => l.score),
    ...(moduleProgress.quizScores || []).map(q => q.score)
  ];
  
  if (allScores.length === 0) return 0;
  
  const sum = allScores.reduce((acc, score) => acc + score, 0);
  return Math.round((sum / allScores.length) * 10) / 10; // Round to 1 decimal
};

/**
 * Calculate course score based on all modules
 */
learnerCourseProgressSchema.statics.calculateCourseScore = function(modulesProgress) {
  const completedModules = modulesProgress.filter(m => m.isCompleted);
  if (completedModules.length === 0) return 0;
  
  const sum = completedModules.reduce((acc, m) => acc + m.moduleScore, 0);
  return Math.round((sum / completedModules.length) * 10) / 10;
};

/**
 * Check module completion
 */
learnerCourseProgressSchema.methods.checkModuleCompletion = function(moduleId) {
  const moduleProgress = this.modules.find(m => m.moduleId === moduleId);
  if (!moduleProgress) return false;
  
  const labsDone = moduleProgress.completedLabs >= moduleProgress.totalLabs;
  const quizzesDone = moduleProgress.completedQuizzes >= moduleProgress.totalQuizzes;
  
  // Module is complete when all labs and quizzes are submitted
  const isComplete = (moduleProgress.totalLabs + moduleProgress.totalQuizzes) > 0 && 
                     labsDone && quizzesDone;
  
  if (isComplete) {
    moduleProgress.isCompleted = true;
    moduleProgress.moduleScore = this.constructor.calculateModuleScore(moduleProgress);
    moduleProgress.completedAt = new Date();
  }
  
  return isComplete;
};

/**
 * Check course completion and update locking
 */
learnerCourseProgressSchema.methods.updateCourseCompletion = function() {
  if (this.isSpecialization) {
    // For specializations, check child courses in order
    let allCompleted = true;
    let previousCoursePassed = true;
    
    // Sort by order to process sequentially
    const sortedChildCourses = [...this.childCourses].sort((a, b) => a.order - b.order);
    
    for (let i = 0; i < sortedChildCourses.length; i++) {
      const childCourse = sortedChildCourses[i];
      
      // Lock if previous course didn't pass (score < 7)
      if (i > 0 && !previousCoursePassed) {
        childCourse.isLocked = true;
      } else {
        childCourse.isLocked = false;
      }
      
      // Check if all modules in this child course are completed
      const allModulesComplete = childCourse.modules.every(m => m.isCompleted);
      
      if (allModulesComplete && childCourse.modules.length > 0) {
        childCourse.isCompleted = true;
        childCourse.courseScore = this.constructor.calculateCourseScore(childCourse.modules);
        childCourse.completedAt = childCourse.completedAt || new Date();
        previousCoursePassed = childCourse.courseScore >= 7;
      } else {
        childCourse.isCompleted = false;
        allCompleted = false;
        previousCoursePassed = false;
      }
    }
    
    this.isCompleted = allCompleted;
    if (allCompleted) {
      const scores = sortedChildCourses.map(c => c.courseScore);
      this.courseScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
      this.completedAt = new Date();
    }
  } else {
    // For regular courses, check all modules
    const allModulesComplete = this.modules.every(m => m.isCompleted);
    
    if (allModulesComplete && this.modules.length > 0) {
      this.isCompleted = true;
      this.courseScore = this.constructor.calculateCourseScore(this.modules);
      this.completedAt = new Date();
    }
  }
  
  return {
    isCompleted: this.isCompleted,
    courseScore: this.courseScore
  };
};

export default mongoose.model('LearnerCourseProgress', learnerCourseProgressSchema);
