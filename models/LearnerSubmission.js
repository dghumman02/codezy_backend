import mongoose from 'mongoose';

/**
 * LearnerSubmission Model - Tracks individual lab and quiz submissions for learners
 * Used to show submission status, scores, and XP for re-attempts
 */
const learnerSubmissionSchema = new mongoose.Schema({
  learnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Course hierarchy
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GlobalCourse',
    required: true
  },
  childCourseId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  moduleId: {
    type: String, // Module id from GlobalCourse
    required: true
  },
  
  // Lesson details
  lessonId: {
    type: String, // Can be lesson title or id
    required: true
  },
  lessonTitle: {
    type: String,
    required: true
  },
  lessonType: {
    type: String,
    enum: ['lab', 'quiz'],
    required: true
  },
  
  // Submission data
  status: {
    type: String,
    enum: ['submitted', 'passed', 'failed'],
    default: 'submitted'
  },
  
  // Score tracking (out of 10)
  score: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  
  // Best score for tracking improvements
  bestScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  
  // Test case results (for labs)
  testCasesPassed: {
    type: Number,
    default: 0
  },
  testCasesTotal: {
    type: Number,
    default: 0
  },
  
  // XP tracking
  xpEarned: {
    type: Number,
    default: 0
  },
  totalXpFromLesson: {
    type: Number,
    default: 0
  },
  
  // Attempt tracking
  attempts: {
    type: Number,
    default: 1
  },
  
  // Last submission code (for labs)
  lastCode: {
    type: String,
    default: ''
  },
  
  // Quiz answers (for quizzes)
  quizAnswers: [{
    questionIndex: Number,
    selectedAnswer: Number,
    isCorrect: Boolean
  }],
  
  submittedAt: {
    type: Date,
    default: Date.now
  },
  lastAttemptAt: {
    type: Date,
    default: Date.now
  }
  
}, { timestamps: true });

// Compound index for efficient querying
learnerSubmissionSchema.index({ learnerId: 1, courseId: 1, moduleId: 1 });
learnerSubmissionSchema.index({ learnerId: 1, courseId: 1, lessonId: 1 }, { unique: true });

/**
 * Update submission with new attempt
 */
learnerSubmissionSchema.methods.recordAttempt = function(newScore, testResults = null, code = null) {
  const previousBestScore = this.bestScore;
  const scoreImproved = newScore > previousBestScore;
  
  this.score = newScore;
  this.attempts += 1;
  this.lastAttemptAt = new Date();
  
  if (scoreImproved) {
    this.bestScore = newScore;
  }
  
  if (testResults) {
    this.testCasesPassed = testResults.passed || 0;
    this.testCasesTotal = testResults.total || 0;
  }
  
  if (code) {
    this.lastCode = code;
  }
  
  // Update status based on score
  this.status = newScore >= 7 ? 'passed' : 'failed';
  
  return {
    scoreImproved,
    previousBestScore,
    newBestScore: this.bestScore
  };
};

export default mongoose.model('LearnerSubmission', learnerSubmissionSchema);
