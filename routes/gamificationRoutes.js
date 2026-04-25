import express from 'express';
import GamificationEngine from '../services/GamificationEngine.js';
import Achievement from '../models/Achievement.js';
import StudentAchievement from '../models/StudentAchievement.js';
import StudentGamification from '../models/StudentGamification.js';
import XPLog from '../models/XPLog.js';
import Student from '../models/Students.js';

const router = express.Router();

/**
 * GET /api/gamification/achievements/:studentId
 * Get all achievements data for a student (for achievements page)
 */
router.get('/achievements/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const achievementData = await GamificationEngine.getStudentAchievements(studentId);
    
    res.json({
      success: true,
      ...achievementData
    });
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/gamification/xp-history/:studentId
 * Get XP transaction history for a student
 */
router.get('/xp-history/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 20 } = req.query;
    
    const history = await GamificationEngine.getXPHistory(studentId, parseInt(limit));
    
    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Error fetching XP history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/gamification/stats/:studentId
 * Get gamification stats (streaks, XP, tier) for a student
 */
router.get('/stats/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Student not found'
      });
    }
    
    const gamification = await StudentGamification.findOne({ studentId });
    const tierProgress = gamification?.getTierProgress(student.xp || 0) || {
      currentTier: 'Bronze',
      nextTier: 'Silver',
      progress: 0,
      xpToNextTier: 1000
    };
    
    res.json({
      success: true,
      totalXp: student.xp || 0,
      tier: tierProgress.currentTier,
      nextTier: tierProgress.nextTier,
      tierProgress: tierProgress.progress,
      xpToNextTier: tierProgress.xpToNextTier,
      weeklyXp: gamification?.weeklyXp || 0,
      streaks: {
        submission: {
          current: gamification?.submissionStreak?.current || 0,
          longest: gamification?.submissionStreak?.longest || 0,
          lastSubmission: gamification?.submissionStreak?.lastSubmissionDate
        }
      },
      firstSubmitStats: {
        firstToSubmitHighScore: gamification?.firstToSubmitHighScore || 0,
        firstToSubmitPerfect: gamification?.firstToSubmitPerfect || 0,
        topFiveSubmissions: gamification?.topFiveSubmissions || 0
      },
      totals: {
        labsCompleted: gamification?.totalLabsCompleted || 0,
        perfectScores: gamification?.totalPerfectScores || 0,
        firstAttemptPasses: gamification?.totalFirstAttemptPasses || 0,
        highScoreLabs: gamification?.highScoreLabs || 0,
        perfectScoreLabs: gamification?.perfectScoreLabs || 0
      }
    });
  } catch (error) {
    console.error('Error fetching gamification stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/gamification/leaderboard
 * Get XP leaderboard (optionally filtered by class/course)
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const { courseId, classId, limit = 10 } = req.query;
    
    // Build query
    const query = {};
    if (courseId) query.course = courseId;
    
    const students = await Student.find(query)
      .select('name xp rollNumber')
      .sort({ xp: -1 })
      .limit(parseInt(limit));
    
    const leaderboard = students.map((student, index) => ({
      rank: index + 1,
      studentId: student._id,
      name: student.name,
      rollNumber: student.rollNumber,
      xp: student.xp || 0
    }));
    
    res.json({
      success: true,
      leaderboard
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/gamification/seed-achievements
 * Seed default achievements (admin only, should be run once)
 */
router.post('/seed-achievements', async (req, res) => {
  try {
    await Achievement.seedDefaults();
    
    const count = await Achievement.countDocuments();
    
    res.json({
      success: true,
      message: 'Achievements seeded successfully',
      totalAchievements: count
    });
  } catch (error) {
    console.error('Error seeding achievements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/gamification/initialize/:studentId
 * Initialize gamification data for a student
 */
router.post('/initialize/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const gamification = await GamificationEngine.initializeStudent(studentId);
    
    res.json({
      success: true,
      message: 'Gamification initialized for student',
      gamificationId: gamification._id
    });
  } catch (error) {
    console.error('Error initializing gamification:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/gamification/recent-achievements/:studentId
 * Get recently earned achievements
 */
router.get('/recent-achievements/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 5 } = req.query;
    
    const recentAchievements = await StudentAchievement.find({ studentId })
      .sort({ earnedAt: -1 })
      .limit(parseInt(limit));
    
    // Get achievement details
    const achievementCodes = recentAchievements.map(a => a.achievementCode);
    const achievements = await Achievement.find({ code: { $in: achievementCodes } });
    
    const achievementMap = {};
    achievements.forEach(a => {
      achievementMap[a.code] = a;
    });
    
    const result = recentAchievements.map(sa => ({
      code: sa.achievementCode,
      title: achievementMap[sa.achievementCode]?.title || sa.achievementCode,
      description: achievementMap[sa.achievementCode]?.description,
      icon: achievementMap[sa.achievementCode]?.icon,
      iconColor: achievementMap[sa.achievementCode]?.iconColor,
      xpAwarded: sa.xpAwarded,
      earnedAt: sa.earnedAt,
      earnedCount: sa.earnedCount
    }));
    
    res.json({
      success: true,
      achievements: result
    });
  } catch (error) {
    console.error('Error fetching recent achievements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
