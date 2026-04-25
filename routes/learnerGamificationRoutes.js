import express from 'express';
import LearnerGamificationService from '../services/LearnerGamificationService.js';
import LearnerAchievement from '../models/LearnerAchievement.js';
import LearnerProgress from '../models/LearnerProgress.js';

const router = express.Router();

/**
 * GET /api/learner-gamification/achievements/:learnerId
 * Get achievements summary for a learner (used by AchievementsPage)
 */
router.get('/achievements/:learnerId', async (req, res) => {
  try {
    const { learnerId } = req.params;
    const summary = await LearnerGamificationService.getAchievementsSummary(learnerId);
    res.json(summary);
  } catch (error) {
    console.error('Error getting achievements:', error);
    res.status(500).json({ success: false, error: 'Failed to get achievements' });
  }
});

/**
 * GET /api/learner-gamification/progress/:learnerId
 */
router.get('/progress/:learnerId', async (req, res) => {
  try {
    const { learnerId } = req.params;
    const progress = await LearnerProgress.findOne({ learnerId });
    res.json({ success: true, progress: progress || {} });
  } catch (error) {
    console.error('Error getting progress:', error);
    res.status(500).json({ success: false, error: 'Failed to get progress' });
  }
});

/**
 * GET /api/learner-gamification/streak/:learnerId
 */
router.get('/streak/:learnerId', async (req, res) => {
  try {
    const { learnerId } = req.params;
    const progress = await LearnerProgress.findOne({ learnerId });
    res.json({
      success: true,
      streak: progress?.streak || { current: 0, longest: 0 }
    });
  } catch (error) {
    console.error('Error getting streak:', error);
    res.status(500).json({ success: false, error: 'Failed to get streak' });
  }
});

/**
 * POST /api/learner-gamification/lesson-complete
 */
router.post('/lesson-complete', async (req, res) => {
  try {
    const { learnerId, courseId } = req.body;
    if (!learnerId || !courseId) {
      return res.status(400).json({ success: false, error: 'learnerId and courseId required' });
    }
    const result = await LearnerGamificationService.recordLessonCompletion(learnerId, courseId);
    res.json(result);
  } catch (error) {
    console.error('Error recording lesson:', error);
    res.status(500).json({ success: false, error: 'Failed to record lesson' });
  }
});

/**
 * POST /api/learner-gamification/quiz-complete
 */
router.post('/quiz-complete', async (req, res) => {
  try {
    const { learnerId, quizId, courseId, score, maxScore } = req.body;
    if (!learnerId || !quizId) {
      return res.status(400).json({ success: false, error: 'learnerId and quizId required' });
    }
    const result = await LearnerGamificationService.recordQuizCompletion(
      learnerId, quizId, courseId, score || 0, maxScore || 100
    );
    res.json(result);
  } catch (error) {
    console.error('Error recording quiz:', error);
    res.status(500).json({ success: false, error: 'Failed to record quiz' });
  }
});

/**
 * POST /api/learner-gamification/module-complete
 */
router.post('/module-complete', async (req, res) => {
  try {
    const { learnerId, courseId, moduleId } = req.body;
    if (!learnerId || !moduleId) {
      return res.status(400).json({ success: false, error: 'learnerId and moduleId required' });
    }
    const result = await LearnerGamificationService.recordModuleCompletion(learnerId, courseId, moduleId);
    res.json(result);
  } catch (error) {
    console.error('Error recording module:', error);
    res.status(500).json({ success: false, error: 'Failed to record module' });
  }
});

/**
 * POST /api/learner-gamification/course-complete
 */
router.post('/course-complete', async (req, res) => {
  try {
    const { learnerId, courseId } = req.body;
    if (!learnerId || !courseId) {
      return res.status(400).json({ success: false, error: 'learnerId and courseId required' });
    }
    const result = await LearnerGamificationService.recordCourseCompletion(learnerId, courseId);
    res.json(result);
  } catch (error) {
    console.error('Error recording course:', error);
    res.status(500).json({ success: false, error: 'Failed to record course' });
  }
});

/**
 * POST /api/learner-gamification/lab-submit
 */
router.post('/lab-submit', async (req, res) => {
  try {
    const { learnerId, labId, courseId, score, labTitle } = req.body;
    console.log('[lab-submit] Received:', { learnerId, labId, courseId, score, labTitle });
    if (!learnerId) {
      return res.status(400).json({ success: false, error: 'learnerId required' });
    }
    const result = await LearnerGamificationService.processLabSubmission({
      learnerId,
      labId: labId || 'unknown',
      courseId: courseId || 'unknown',
      score: score || 0,
      labTitle: labTitle || 'Lab'
    });
    console.log('[lab-submit] Result:', { success: result.success, xpGained: result.xpGained, isReAttempt: result.isReAttempt });
    res.json(result);
  } catch (error) {
    console.error('Error processing lab submission:', error);
    res.status(500).json({ success: false, error: 'Failed to process lab submission' });
  }
});

/**
 * POST /api/learner-gamification/seed-achievements
 */
router.post('/seed-achievements', async (req, res) => {
  try {
    const count = await LearnerAchievement.seedDefaults();
    res.json({ success: true, message: `Seeded ${count} achievements` });
  } catch (error) {
    console.error('Error seeding achievements:', error);
    res.status(500).json({ success: false, error: 'Failed to seed achievements' });
  }
});

/**
 * GET /api/learner-gamification/all-badges
 */
router.get('/all-badges', async (req, res) => {
  try {
    const achievements = await LearnerAchievement.find({ isActive: true });
    res.json({ success: true, badges: achievements });
  } catch (error) {
    console.error('Error getting badges:', error);
    res.status(500).json({ success: false, error: 'Failed to get badges' });
  }
});

export default router;
