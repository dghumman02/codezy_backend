import express from 'express';
import LearnerSubmission from '../models/LearnerSubmission.js';
import LearnerCourseProgress from '../models/LearnerCourseProgress.js';
import LearnerProgress from '../models/LearnerProgress.js';
import User from '../models/User.js';
import GlobalCourse from '../models/GlobalCourse.js';
import LearnerGamificationService from '../services/LearnerGamificationService.js';

const router = express.Router();

/**
 * POST /api/learner-submissions/submit-lab
 * Submit a lab and track the submission
 */
router.post('/submit-lab', async (req, res) => {
  try {
    const {
      learnerId,
      courseId,
      childCourseId,
      moduleId,
      lessonId,
      lessonTitle,
      score,
      testCasesPassed,
      testCasesTotal,
      code
    } = req.body;
    
    if (!learnerId || !courseId || !moduleId || !lessonId) {
      return res.status(400).json({
        success: false,
        error: 'learnerId, courseId, moduleId, and lessonId are required'
      });
    }
    
    // Get learner
    const learner = await User.findById(learnerId);
    if (!learner) {
      return res.status(404).json({ success: false, error: 'Learner not found' });
    }
    
    // Find or create submission
    let submission = await LearnerSubmission.findOne({
      learnerId,
      courseId,
      lessonId
    });
    
    const scoreNum = Number(score) || 0;
    let xpGained = 0;
    let xpDifference = 0;
    let isFirstSubmission = false;
    let scoreImproved = false;
    let previousBestScore = 0;
    
    if (submission) {
      // Re-attempt
      previousBestScore = submission.bestScore;
      const result = submission.recordAttempt(scoreNum, {
        passed: testCasesPassed,
        total: testCasesTotal
      }, code);
      
      scoreImproved = result.scoreImproved;
      
      // Calculate XP difference if score improved
      if (scoreImproved) {
        const previousXp = calculateLabXP(previousBestScore);
        const newXp = calculateLabXP(scoreNum);
        xpDifference = newXp - previousXp;
        
        if (xpDifference > 0) {
          xpGained = xpDifference;
          submission.xpEarned += xpDifference;
          submission.totalXpFromLesson += xpDifference;
          
          // Update learner's total XP
          learner.xp = (learner.xp || 0) + xpDifference;
          await learner.save();
        }
      }
      
      await submission.save();
    } else {
      // First submission
      isFirstSubmission = true;
      xpGained = calculateLabXP(scoreNum);
      
      submission = new LearnerSubmission({
        learnerId,
        courseId,
        childCourseId: childCourseId || null,
        moduleId,
        lessonId,
        lessonTitle: lessonTitle || 'Lab',
        lessonType: 'lab',
        status: scoreNum >= 7 ? 'passed' : 'failed',
        score: scoreNum,
        bestScore: scoreNum,
        testCasesPassed: testCasesPassed || 0,
        testCasesTotal: testCasesTotal || 0,
        xpEarned: xpGained,
        totalXpFromLesson: xpGained,
        attempts: 1,
        lastCode: code || ''
      });
      
      await submission.save();
      
      // Update learner's total XP
      learner.xp = (learner.xp || 0) + xpGained;
      await learner.save();
    }
    
    // Update course progress
    await updateCourseProgress(learnerId, courseId, childCourseId, moduleId, lessonId, lessonTitle, 'lab', scoreNum, xpGained);
    
    // Trigger gamification for lab completion (badges, achievements)
    try {
      await LearnerGamificationService.processLabSubmission({
        learnerId,
        labId: lessonId,
        courseId,
        score: scoreNum,
        labTitle: lessonTitle || 'Lab'
      });
    } catch (gamErr) {
      console.error('Lab gamification error (non-blocking):', gamErr);
    }
    
    res.json({
      success: true,
      submission: {
        _id: submission._id,
        lessonId: submission.lessonId,
        lessonTitle: submission.lessonTitle,
        score: submission.score,
        bestScore: submission.bestScore,
        testCasesPassed: submission.testCasesPassed,
        testCasesTotal: submission.testCasesTotal,
        xpEarned: submission.xpEarned,
        totalXpFromLesson: submission.totalXpFromLesson,
        attempts: submission.attempts,
        status: submission.status
      },
      xpGained,
      isFirstSubmission,
      scoreImproved,
      previousBestScore,
      learnerTotalXp: learner.xp
    });
    
  } catch (error) {
    console.error('Lab submission error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit lab' });
  }
});

/**
 * POST /api/learner-submissions/submit-quiz
 * Submit a quiz and track the submission
 */
router.post('/submit-quiz', async (req, res) => {
  try {
    const {
      learnerId,
      courseId,
      childCourseId,
      moduleId,
      lessonId,
      lessonTitle,
      score,
      totalQuestions,
      correctAnswers,
      quizAnswers
    } = req.body;
    
    if (!learnerId || !courseId || !moduleId || !lessonId) {
      return res.status(400).json({
        success: false,
        error: 'learnerId, courseId, moduleId, and lessonId are required'
      });
    }
    
    // Get learner
    const learner = await User.findById(learnerId);
    if (!learner) {
      return res.status(404).json({ success: false, error: 'Learner not found' });
    }
    
    // Normalize score to 10
    const normalizedScore = totalQuestions > 0 
      ? Math.round((correctAnswers / totalQuestions) * 10 * 10) / 10
      : 0;
    
    // Find or create submission
    let submission = await LearnerSubmission.findOne({
      learnerId,
      courseId,
      lessonId
    });
    
    let xpGained = 0;
    let xpDifference = 0;
    let isFirstSubmission = false;
    let scoreImproved = false;
    let previousBestScore = 0;
    
    if (submission) {
      // Re-attempt
      previousBestScore = submission.bestScore;
      scoreImproved = normalizedScore > previousBestScore;
      
      submission.score = normalizedScore;
      submission.attempts += 1;
      submission.lastAttemptAt = new Date();
      submission.quizAnswers = quizAnswers || [];
      submission.testCasesPassed = correctAnswers || 0;
      submission.testCasesTotal = totalQuestions || 0;
      
      if (scoreImproved) {
        submission.bestScore = normalizedScore;
        
        const previousXp = calculateQuizXP(previousBestScore);
        const newXp = calculateQuizXP(normalizedScore);
        xpDifference = newXp - previousXp;
        
        if (xpDifference > 0) {
          xpGained = xpDifference;
          submission.xpEarned += xpDifference;
          submission.totalXpFromLesson += xpDifference;
          
          // Update learner's total XP
          learner.xp = (learner.xp || 0) + xpDifference;
          await learner.save();
        }
      }
      
      submission.status = normalizedScore >= 7 ? 'passed' : 'failed';
      await submission.save();
    } else {
      // First submission
      isFirstSubmission = true;
      xpGained = calculateQuizXP(normalizedScore);
      
      submission = new LearnerSubmission({
        learnerId,
        courseId,
        childCourseId: childCourseId || null,
        moduleId,
        lessonId,
        lessonTitle: lessonTitle || 'Quiz',
        lessonType: 'quiz',
        status: normalizedScore >= 7 ? 'passed' : 'failed',
        score: normalizedScore,
        bestScore: normalizedScore,
        testCasesPassed: correctAnswers || 0,
        testCasesTotal: totalQuestions || 0,
        xpEarned: xpGained,
        totalXpFromLesson: xpGained,
        attempts: 1,
        quizAnswers: quizAnswers || []
      });
      
      await submission.save();
      
      // Update learner's total XP
      learner.xp = (learner.xp || 0) + xpGained;
      await learner.save();
    }
    
    // Update course progress
    await updateCourseProgress(learnerId, courseId, childCourseId, moduleId, lessonId, lessonTitle, 'quiz', normalizedScore, xpGained);
    
    // Trigger gamification for quiz completion (badges, achievements)
    try {
      await LearnerGamificationService.recordQuizCompletion(
        learnerId,
        lessonId,
        courseId,
        normalizedScore * 10, // convert 0-10 to 0-100 percentage
        100
      );
    } catch (gamErr) {
      console.error('Quiz gamification error (non-blocking):', gamErr);
    }
    
    res.json({
      success: true,
      submission: {
        _id: submission._id,
        lessonId: submission.lessonId,
        lessonTitle: submission.lessonTitle,
        score: submission.score,
        bestScore: submission.bestScore,
        correctAnswers: submission.testCasesPassed,
        totalQuestions: submission.testCasesTotal,
        xpEarned: submission.xpEarned,
        totalXpFromLesson: submission.totalXpFromLesson,
        attempts: submission.attempts,
        status: submission.status
      },
      xpGained,
      isFirstSubmission,
      scoreImproved,
      previousBestScore,
      learnerTotalXp: learner.xp
    });
    
  } catch (error) {
    console.error('Quiz submission error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit quiz' });
  }
});

/**
 * GET /api/learner-submissions/:learnerId/course/:courseId
 * Get all submissions for a learner in a course
 */
router.get('/:learnerId/course/:courseId', async (req, res) => {
  try {
    const { learnerId, courseId } = req.params;
    
    const submissions = await LearnerSubmission.find({
      learnerId,
      courseId
    }).lean();
    
    // Create a map for quick lookup
    const submissionMap = {};
    submissions.forEach(sub => {
      submissionMap[sub.lessonId] = {
        lessonId: sub.lessonId,
        lessonTitle: sub.lessonTitle,
        lessonType: sub.lessonType,
        status: sub.status,
        score: sub.score,
        bestScore: sub.bestScore,
        testCasesPassed: sub.testCasesPassed,
        testCasesTotal: sub.testCasesTotal,
        xpEarned: sub.xpEarned,
        totalXpFromLesson: sub.totalXpFromLesson,
        attempts: sub.attempts,
        submittedAt: sub.submittedAt,
        lastAttemptAt: sub.lastAttemptAt
      };
    });
    
    res.json({
      success: true,
      submissions: submissionMap
    });
    
  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({ success: false, error: 'Failed to get submissions' });
  }
});

/**
 * GET /api/learner-submissions/:learnerId/lesson/:lessonId
 * Get submission details for a specific lesson
 */
router.get('/:learnerId/lesson/:lessonId', async (req, res) => {
  try {
    const { learnerId, lessonId } = req.params;
    
    const submission = await LearnerSubmission.findOne({
      learnerId,
      lessonId
    }).lean();
    
    if (!submission) {
      return res.json({
        success: true,
        submission: null,
        isSubmitted: false
      });
    }
    
    res.json({
      success: true,
      isSubmitted: true,
      submission: {
        lessonId: submission.lessonId,
        lessonTitle: submission.lessonTitle,
        lessonType: submission.lessonType,
        status: submission.status,
        score: submission.score,
        bestScore: submission.bestScore,
        testCasesPassed: submission.testCasesPassed,
        testCasesTotal: submission.testCasesTotal,
        xpEarned: submission.xpEarned,
        totalXpFromLesson: submission.totalXpFromLesson,
        attempts: submission.attempts,
        submittedAt: submission.submittedAt,
        lastAttemptAt: submission.lastAttemptAt,
        lastCode: submission.lastCode,
        quizAnswers: submission.quizAnswers
      }
    });
    
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ success: false, error: 'Failed to get submission' });
  }
});

/**
 * GET /api/learner-submissions/:learnerId/course-progress/:courseId
 * Get course progress including module completion and locking status
 */
router.get('/:learnerId/course-progress/:courseId', async (req, res) => {
  try {
    const { learnerId, courseId } = req.params;
    
    // Get course details
    const course = await GlobalCourse.findById(courseId).lean();
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    
    // Get or create progress
    let progress = await LearnerCourseProgress.findOne({ learnerId, courseId });
    
    if (!progress) {
      // Initialize progress based on course structure
      progress = await initializeCourseProgress(learnerId, courseId, course);
    } else {
      // Sync existing progress with current course structure
      // Handles cases where admin added/removed modules or child courses
      progress = await syncProgressWithCourse(progress, course);
    }
    
    res.json({
      success: true,
      progress: {
        courseId: progress.courseId,
        isSpecialization: progress.isSpecialization,
        isCompleted: progress.isCompleted,
        courseScore: progress.courseScore,
        totalXpEarned: progress.totalXpEarned,
        modules: progress.modules,
        childCourses: progress.childCourses
      }
    });
    
  } catch (error) {
    console.error('Get course progress error:', error);
    res.status(500).json({ success: false, error: 'Failed to get course progress' });
  }
});

// Helper function to calculate lab XP
function calculateLabXP(score) {
  if (score >= 10) return 150;  // Perfect
  if (score >= 8.5) return 100; // High score
  if (score >= 7) return 75;    // Passed
  if (score >= 5) return 50;    // Attempted
  return 25;                     // Submitted
}

// Helper function to calculate quiz XP
function calculateQuizXP(score) {
  if (score >= 10) return 100;  // Perfect (10/10)
  if (score >= 8) return 75;    // High score (8+/10)
  if (score >= 7) return 50;    // Passed (7+/10)
  if (score >= 5) return 35;    // Attempted
  return 20;                     // Submitted
}

// Helper function to update course progress
async function updateCourseProgress(learnerId, courseId, childCourseId, moduleId, lessonId, lessonTitle, lessonType, score, xpGained) {
  try {
    const course = await GlobalCourse.findById(courseId).lean();
    if (!course) return;
    
    let progress = await LearnerCourseProgress.findOne({ learnerId, courseId });
    
    if (!progress) {
      progress = await initializeCourseProgress(learnerId, courseId, course);
    } else {
      // Sync progress with current course structure before updating
      progress = await syncProgressWithCourse(progress, course);
    }
    
    if (course.isSpecialization && childCourseId) {
      // Update child course progress
      const childCourseProgress = progress.childCourses.find(
        c => c.childCourseId.toString() === childCourseId.toString()
      );
      
      if (childCourseProgress) {
        updateModuleInProgress(childCourseProgress.modules, moduleId, lessonId, lessonTitle, lessonType, score, xpGained);
        
        // Recalculate child course completion
        const allModulesComplete = childCourseProgress.modules.every(m => m.isCompleted);
        if (allModulesComplete && childCourseProgress.modules.length > 0) {
          childCourseProgress.isCompleted = true;
          childCourseProgress.courseScore = LearnerCourseProgress.calculateCourseScore(childCourseProgress.modules);
          childCourseProgress.completedAt = childCourseProgress.completedAt || new Date();
        }
      }
    } else {
      // Update regular module progress
      updateModuleInProgress(progress.modules, moduleId, lessonId, lessonTitle, lessonType, score, xpGained);
    }
    
    // Update total XP
    progress.totalXpEarned = (progress.totalXpEarned || 0) + xpGained;
    
    // Check overall course completion
    progress.updateCourseCompletion();
    
    await progress.save();
    
    // Trigger gamification for module/course completions
    await checkCompletionGamification(learnerId, courseId, childCourseId, moduleId, progress);
    
  } catch (error) {
    console.error('Update course progress error:', error);
  }
}

// Helper to update module progress
function updateModuleInProgress(modules, moduleId, lessonId, lessonTitle, lessonType, score, xpGained) {
  const moduleProgress = modules.find(m => m.moduleId === moduleId);
  if (!moduleProgress) return;
  
  if (lessonType === 'lab') {
    // Update or add lab score
    const existingLab = moduleProgress.labScores.find(l => l.lessonId === lessonId);
    if (existingLab) {
      if (score > existingLab.score) {
        existingLab.score = score;
        existingLab.xpEarned += xpGained;
      }
    } else {
      moduleProgress.labScores.push({
        lessonId,
        lessonTitle,
        score,
        xpEarned: xpGained
      });
      moduleProgress.completedLabs += 1;
    }
  } else if (lessonType === 'quiz') {
    // Update or add quiz score
    const existingQuiz = moduleProgress.quizScores.find(q => q.lessonId === lessonId);
    if (existingQuiz) {
      if (score > existingQuiz.score) {
        existingQuiz.score = score;
        existingQuiz.xpEarned += xpGained;
      }
    } else {
      moduleProgress.quizScores.push({
        lessonId,
        lessonTitle,
        score,
        xpEarned: xpGained
      });
      moduleProgress.completedQuizzes += 1;
    }
  }
  
  // Check module completion
  const labsDone = moduleProgress.completedLabs >= moduleProgress.totalLabs;
  const quizzesDone = moduleProgress.completedQuizzes >= moduleProgress.totalQuizzes;
  const hasAssessments = moduleProgress.totalLabs + moduleProgress.totalQuizzes > 0;
  
  if (hasAssessments && labsDone && quizzesDone) {
    moduleProgress.isCompleted = true;
    moduleProgress.moduleScore = LearnerCourseProgress.calculateModuleScore(moduleProgress);
    moduleProgress.completedAt = moduleProgress.completedAt || new Date();
  }
}

// Trigger gamification for module and course completions
async function checkCompletionGamification(learnerId, courseId, childCourseId, moduleId, progress) {
  try {
    // Find the module that was just updated
    let modules;
    if (progress.isSpecialization && childCourseId) {
      const childProgress = progress.childCourses.find(
        c => c.childCourseId?.toString() === childCourseId?.toString()
      );
      modules = childProgress?.modules || [];
    } else {
      modules = progress.modules || [];
    }

    const mod = modules.find(m => m.moduleId === moduleId);
    if (mod?.isCompleted) {
      await LearnerGamificationService.recordModuleCompletion(learnerId, courseId, moduleId);
    }

    // Check child-course completion (counts as a course completion for badges)
    if (progress.isSpecialization && childCourseId) {
      const childProgress = progress.childCourses.find(
        c => c.childCourseId?.toString() === childCourseId?.toString()
      );
      if (childProgress?.isCompleted) {
        await LearnerGamificationService.recordCourseCompletion(learnerId, childCourseId);
      }
    }

    // Check overall course completion
    if (progress.isCompleted) {
      await LearnerGamificationService.recordCourseCompletion(learnerId, courseId);
    }
  } catch (err) {
    console.error('Completion gamification error (non-blocking):', err);
  }
}

/**
 * Sync existing LearnerCourseProgress with the current GlobalCourse structure.
 * Preserves all existing scores/completion data while adding new modules/childCourses
 * and updating counts if the course structure changed.
 */
async function syncProgressWithCourse(progress, course) {
  let needsSave = false;

  if (course.isSpecialization && course.childCourses?.length > 0) {
    const existingMap = new Map();
    for (const cp of progress.childCourses) {
      existingMap.set(cp.childCourseId.toString(), cp);
    }

    const syncedChildCourses = [];

    for (let index = 0; index < course.childCourses.length; index++) {
      const childCourse = course.childCourses[index];
      const childId = childCourse._id.toString();
      const existing = existingMap.get(childId);

      if (existing) {
        existing.order = childCourse.order || index;
        existing.childCourseTitle = childCourse.title;
        const moduleSynced = syncModulesArray(existing.modules, childCourse.modules || []);
        if (moduleSynced) needsSave = true;
        syncedChildCourses.push(existing);
      } else {
        needsSave = true;
        const childProgress = {
          childCourseId: childCourse._id,
          childCourseTitle: childCourse.title,
          order: childCourse.order || index,
          isCompleted: false,
          isLocked: index > 0,
          courseScore: 0,
          modules: []
        };
        if (childCourse.modules?.length > 0) {
          childCourse.modules.forEach(mod => {
            const lessons = mod.lessons?.length ? mod.lessons : (mod.subModules?.[0]?.lessons || []);
            childProgress.modules.push({
              moduleId: mod.id || mod._id?.toString() || mod.title,
              moduleTitle: mod.title,
              isCompleted: false,
              moduleScore: 0,
              totalLabs: lessons.filter(l => l.type === 'lab').length,
              completedLabs: 0,
              totalQuizzes: lessons.filter(l => l.type === 'quiz').length,
              completedQuizzes: 0,
              labScores: [],
              quizScores: []
            });
          });
        }
        syncedChildCourses.push(childProgress);
      }
    }

    if (syncedChildCourses.length !== progress.childCourses.length ||
        syncedChildCourses.some((sc, i) => {
          const old = progress.childCourses[i];
          return !old || sc.childCourseId.toString() !== old.childCourseId.toString();
        })) {
      needsSave = true;
    }

    progress.childCourses = syncedChildCourses;

  } else if (course.modules?.length > 0) {
    const moduleSynced = syncModulesArray(progress.modules, course.modules);
    if (moduleSynced) needsSave = true;
  }

  if (needsSave) {
    progress.updateCourseCompletion();
    await progress.save();
  }

  return progress;
}

/**
 * Sync a modules progress array with the current course modules.
 * Adds new modules, updates totalLabs/totalQuizzes counts, preserves scores.
 */
function syncModulesArray(progressModules, courseModules) {
  if (!courseModules || courseModules.length === 0) return false;

  let changed = false;
  const existingMap = new Map();
  for (const mp of progressModules) {
    existingMap.set(mp.moduleId, mp);
  }

  const synced = [];

  for (const mod of courseModules) {
    const moduleId = mod.id || mod._id?.toString() || mod.title;
    const existing = existingMap.get(moduleId);

    const lessons = mod.lessons?.length ? mod.lessons : (mod.subModules?.[0]?.lessons || []);
    const labCount = lessons.filter(l => l.type === 'lab').length;
    const quizCount = lessons.filter(l => l.type === 'quiz').length;

    if (existing) {
      if (existing.totalLabs !== labCount || existing.totalQuizzes !== quizCount) {
        existing.totalLabs = labCount;
        existing.totalQuizzes = quizCount;
        const labsDone = existing.completedLabs >= labCount;
        const quizzesDone = existing.completedQuizzes >= quizCount;
        if (existing.isCompleted && !(labsDone && quizzesDone && (labCount + quizCount > 0))) {
          existing.isCompleted = false;
          existing.completedAt = undefined;
        }
        changed = true;
      }
      existing.moduleTitle = mod.title;
      synced.push(existing);
    } else {
      changed = true;
      synced.push({
        moduleId,
        moduleTitle: mod.title,
        isCompleted: false,
        moduleScore: 0,
        totalLabs: labCount,
        completedLabs: 0,
        totalQuizzes: quizCount,
        completedQuizzes: 0,
        labScores: [],
        quizScores: []
      });
    }
  }

  if (changed || synced.length !== progressModules.length) {
    progressModules.splice(0, progressModules.length, ...synced);
    return true;
  }
  return false;
}

// Helper to initialize course progress
async function initializeCourseProgress(learnerId, courseId, course) {
  const progress = new LearnerCourseProgress({
    learnerId,
    courseId,
    isSpecialization: course.isSpecialization || false,
    modules: [],
    childCourses: [],
    isCompleted: false,
    courseScore: 0,
    totalXpEarned: 0
  });
  
  if (course.isSpecialization && course.childCourses?.length > 0) {
    // Initialize child courses
    course.childCourses.forEach((childCourse, index) => {
      const childProgress = {
        childCourseId: childCourse._id,
        childCourseTitle: childCourse.title,
        order: childCourse.order || index,
        isCompleted: false,
        isLocked: index > 0, // Lock all except first
        courseScore: 0,
        modules: []
      };
      
      // Initialize modules within child course
      if (childCourse.modules?.length > 0) {
        childCourse.modules.forEach(mod => {
          const lessons = mod.lessons?.length ? mod.lessons : (mod.subModules?.[0]?.lessons || []);
          const labs = lessons.filter(l => l.type === 'lab');
          const quizzes = lessons.filter(l => l.type === 'quiz');
          
          childProgress.modules.push({
            moduleId: mod.id || mod._id?.toString() || mod.title,
            moduleTitle: mod.title,
            isCompleted: false,
            moduleScore: 0,
            totalLabs: labs.length,
            completedLabs: 0,
            totalQuizzes: quizzes.length,
            completedQuizzes: 0,
            labScores: [],
            quizScores: []
          });
        });
      }
      
      progress.childCourses.push(childProgress);
    });
  } else if (course.modules?.length > 0) {
    // Initialize regular modules
    course.modules.forEach(mod => {
      const lessons = mod.lessons?.length ? mod.lessons : (mod.subModules?.[0]?.lessons || []);
      const labs = lessons.filter(l => l.type === 'lab');
      const quizzes = lessons.filter(l => l.type === 'quiz');
      
      progress.modules.push({
        moduleId: mod.id || mod._id?.toString() || mod.title,
        moduleTitle: mod.title,
        isCompleted: false,
        moduleScore: 0,
        totalLabs: labs.length,
        completedLabs: 0,
        totalQuizzes: quizzes.length,
        completedQuizzes: 0,
        labScores: [],
        quizScores: []
      });
    });
  }
  
  await progress.save();
  return progress;
}

export default router;
