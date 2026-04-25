import User from '../models/User.js';
import LearnerAchievement from '../models/LearnerAchievement.js';
import LearnerEarnedAchievement from '../models/LearnerEarnedAchievement.js';
import LearnerProgress from '../models/LearnerProgress.js';

/**
 * LearnerGamificationService - For Individual Learners Only
 * Achievement engine: XP, tiers, streaks, 18 badges (repeatable support)
 */
class LearnerGamificationService {
  
  // XP rewards based on score (out of 10)
  static getScoreBasedXP(score) {
    if (score >= 10) return 150;
    if (score >= 8.5) return 100;
    return 50;
  }

  /**
   * Process lab submission - XP + achievements
   */
  static async processLabSubmission({ learnerId, labId, courseId, score, labTitle }) {
    const result = {
      success: true,
      xpGained: 0,
      totalXp: 0,
      newAchievements: [],
      streak: { current: 0 }
    };
    
    try {
      let progress = await LearnerProgress.findOne({ learnerId });
      if (!progress) progress = new LearnerProgress({ learnerId });
      
      const learner = await User.findById(learnerId);
      if (!learner) throw new Error('Learner not found');
      
      const baseXp = this.getScoreBasedXP(score);
      const labResult = progress.recordLabCompletion(labId, courseId, score, baseXp);
      const actualXp = labResult.xpGained;
      
      // Streak
      progress.updateStreak();
      result.streak.current = progress.streak.current;
      
      // Streak bonus (only if XP gained)
      let streakBonus = 0;
      if (progress.streak.current >= 3 && actualXp > 0) {
        streakBonus = Math.min(progress.streak.current * 5, 50);
      }
      
      let xpToAdd = actualXp + streakBonus;
      
      // Check achievements
      const newAchievements = await this.checkAndAwardAchievements(learnerId, progress, {
        type: 'lab',
        isPerfect: labResult.isPerfect,
        score
      });
      
      const achXp = newAchievements.reduce((s, a) => s + a.xpAwarded, 0);
      xpToAdd += achXp;
      
      learner.xp = (learner.xp || 0) + xpToAdd;
      learner.streak = progress.streak.current;
      result.xpGained = xpToAdd;
      result.totalXp = learner.xp;
      result.newAchievements = newAchievements;
      result.isReAttempt = !labResult.isNewCompletion;
      result.scoreImproved = labResult.xpGained > 0;
      
      await progress.save();
      await learner.save();
      
      return result;
    } catch (error) {
      console.error('LearnerGamificationService lab error:', error);
      return { ...result, success: false, error: error.message };
    }
  }

  /**
   * Process quiz submission
   */
  static async recordQuizCompletion(learnerId, quizId, courseId, score, maxScore = 100) {
    try {
      let progress = await LearnerProgress.findOne({ learnerId });
      if (!progress) progress = new LearnerProgress({ learnerId });
      
      const learner = await User.findById(learnerId);
      if (!learner) throw new Error('Learner not found');
      
      const percentage = (score / maxScore) * 100;
      progress.totalQuizzesTaken = (progress.totalQuizzesTaken || 0) + 1;
      
      if (!progress.firstQuizCompleted) {
        progress.firstQuizCompleted = true;
      }
      
      const isPerfectQuiz = percentage >= 100;
      if (isPerfectQuiz) {
        progress.perfectQuizzes = (progress.perfectQuizzes || 0) + 1;
      }
      
      progress.updateStreak();
      
      let xpGained = Math.round(percentage / 2);
      if (isPerfectQuiz) xpGained += 25;
      else if (percentage >= 90) xpGained += 10;
      
      // Check achievements
      const newAchievements = await this.checkAndAwardAchievements(learnerId, progress, {
        type: 'quiz',
        isPerfect: isPerfectQuiz
      });
      
      const achXp = newAchievements.reduce((s, a) => s + a.xpAwarded, 0);
      learner.xp = (learner.xp || 0) + xpGained + achXp;
      learner.streak = progress.streak.current;
      
      await progress.save();
      await learner.save();
      
      return {
        success: true,
        xpGained: xpGained + achXp,
        newAchievements
      };
    } catch (error) {
      console.error('Quiz completion error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record lesson completion
   */
  static async recordLessonCompletion(learnerId, courseId) {
    try {
      let progress = await LearnerProgress.findOne({ learnerId });
      if (!progress) progress = new LearnerProgress({ learnerId });
      
      const learner = await User.findById(learnerId);
      if (!learner) throw new Error('Learner not found');
      
      progress.totalLessonsCompleted = (progress.totalLessonsCompleted || 0) + 1;
      progress.updateStreak();
      
      const xpGained = 10;
      learner.xp = (learner.xp || 0) + xpGained;
      learner.streak = progress.streak.current;
      
      await progress.save();
      await learner.save();
      
      return { success: true, xpGained };
    } catch (error) {
      console.error('Lesson completion error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record module completion
   */
  static async recordModuleCompletion(learnerId, courseId, moduleId) {
    try {
      let progress = await LearnerProgress.findOne({ learnerId });
      if (!progress) progress = new LearnerProgress({ learnerId });
      
      const learner = await User.findById(learnerId);
      if (!learner) throw new Error('Learner not found');
      
      // Deduplication: check if this module was already counted
      const moduleKey = `${courseId}_${moduleId}`;
      if (!progress.completedModuleIds) progress.completedModuleIds = [];
      if (progress.completedModuleIds.includes(moduleKey)) {
        return { success: true, xpGained: 0, newAchievements: [], message: 'Module already recorded' };
      }
      
      progress.completedModuleIds.push(moduleKey);
      progress.totalModulesCompleted = (progress.totalModulesCompleted || 0) + 1;
      if (!progress.firstModuleCompleted) {
        progress.firstModuleCompleted = true;
      }
      
      progress.updateStreak();
      
      const xpGained = 50;
      learner.xp = (learner.xp || 0) + xpGained;
      
      // Check achievements
      const newAchievements = await this.checkAndAwardAchievements(learnerId, progress, {
        type: 'module'
      });
      
      const achXp = newAchievements.reduce((s, a) => s + a.xpAwarded, 0);
      learner.xp += achXp;
      learner.streak = progress.streak.current;
      
      await progress.save();
      await learner.save();
      
      return { success: true, xpGained: xpGained + achXp, newAchievements };
    } catch (error) {
      console.error('Module completion error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record course completion
   */
  static async recordCourseCompletion(learnerId, courseId) {
    try {
      let progress = await LearnerProgress.findOne({ learnerId });
      if (!progress) progress = new LearnerProgress({ learnerId });
      
      const learner = await User.findById(learnerId);
      if (!learner) throw new Error('Learner not found');
      
      const existingCourse = progress.courseProgress.find(
        c => c.courseId?.toString() === courseId.toString() && c.completed
      );
      if (existingCourse) {
        return { success: true, xpGained: 0, message: 'Course already completed' };
      }
      
      progress.totalCoursesCompleted = (progress.totalCoursesCompleted || 0) + 1;
      
      const courseEntry = progress.courseProgress.find(
        c => c.courseId?.toString() === courseId.toString()
      );
      if (courseEntry) {
        courseEntry.completed = true;
        courseEntry.completedAt = new Date();
      } else {
        progress.courseProgress.push({ courseId, completed: true, completedAt: new Date() });
      }
      
      const xpGained = 100;
      learner.xp = (learner.xp || 0) + xpGained;
      
      // Check achievements
      const newAchievements = await this.checkAndAwardAchievements(learnerId, progress, {
        type: 'course'
      });
      
      const achXp = newAchievements.reduce((s, a) => s + a.xpAwarded, 0);
      learner.xp += achXp;
      
      await progress.save();
      await learner.save();
      
      return { success: true, xpGained: xpGained + achXp, newAchievements };
    } catch (error) {
      console.error('Course completion error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Achievement Engine - check all badges and award earned ones
   * Supports repeatable badges (Perfect Lab, Perfect Quiz, Course Conqueror)
   */
  static async checkAndAwardAchievements(learnerId, progress, context = {}) {
    const newlyEarned = [];
    
    try {
      const achievements = await LearnerAchievement.find({ isActive: true });
      const earned = await LearnerEarnedAchievement.find({ learnerId });
      const earnedMap = {};
      earned.forEach(e => { earnedMap[e.achievementCode] = e; });
      
      const totalPerfects = (progress.perfectLabsCompleted || 0) + (progress.perfectQuizzes || 0);
      
      for (const ach of achievements) {
        const existing = earnedMap[ach.code];
        const threshold = ach.criteria?.threshold || 0;
        
        // For non-repeatable badges, skip if already earned
        if (existing && !ach.repeatable) continue;
        
        let shouldAward = false;
        
        switch (ach.criteria?.type) {
          // BEGINNER
          case 'first_lab':
            shouldAward = progress.firstLabCompleted === true;
            break;
          case 'first_module':
            shouldAward = progress.firstModuleCompleted === true;
            break;
          case 'first_quiz':
            shouldAward = progress.firstQuizCompleted === true;
            break;
          case 'first_code':
            shouldAward = progress.firstCodeSubmitted === true;
            break;
            
          // SCORE BASED (repeatable)
          case 'perfect_lab':
            if (context.type === 'lab' && context.isPerfect) {
              shouldAward = true;
            }
            break;
          case 'perfect_quiz':
            if (context.type === 'quiz' && context.isPerfect) {
              shouldAward = true;
            }
            break;
          case 'perfect_lab_count':
            shouldAward = (progress.perfectLabsCompleted || 0) >= threshold;
            break;
          case 'perfect_quiz_count':
            shouldAward = (progress.perfectQuizzes || 0) >= threshold;
            break;
          case 'perfect_total':
            shouldAward = totalPerfects >= threshold;
            break;
            
          // LEARNING PROGRESS
          case 'lab_completion':
            shouldAward = (progress.totalLabsCompleted || 0) >= threshold;
            break;
          case 'module_completion':
            shouldAward = (progress.totalModulesCompleted || 0) >= threshold;
            break;
          case 'course_completion':
            if (context.type === 'course') {
              shouldAward = (progress.totalCoursesCompleted || 0) >= threshold;
            }
            break;
            
          // STREAK
          case 'streak_days':
            shouldAward = (progress.streak?.current || 0) >= threshold ||
                          (progress.streak?.longest || 0) >= threshold;
            break;
        }
        
        if (shouldAward) {
          if (existing && ach.repeatable) {
            // Increment count for repeatable badge
            existing.unlockedCount = (existing.unlockedCount || 1) + 1;
            existing.xpAwarded = (existing.xpAwarded || 0) + ach.xpAward;
            existing.lastEarnedAt = new Date();
            await existing.save();
          } else if (!existing) {
            // New badge
            await LearnerEarnedAchievement.create({
              learnerId,
              achievementCode: ach.code,
              xpAwarded: ach.xpAward,
              unlockedCount: 1,
              earnedAt: new Date(),
              lastEarnedAt: new Date()
            });
          }
          
          newlyEarned.push({
            code: ach.code,
            title: ach.title,
            description: ach.description,
            icon: ach.icon,
            xpAwarded: ach.xpAward,
            category: ach.category
          });
        }
      }
    } catch (error) {
      console.error('Achievement check error:', error);
    }
    
    return newlyEarned;
  }

  /**
   * Get full achievements summary for the achievements page
   */
  static async getAchievementsSummary(learnerId) {
    try {
      const learner = await User.findById(learnerId);
      let progress = await LearnerProgress.findOne({ learnerId });
      if (!progress) {
        progress = new LearnerProgress({ learnerId });
        await progress.save();
      }
      
      const totalXp = learner?.xp || 0;
      const tierInfo = LearnerProgress.getTierInfo(totalXp);
      
      // Get all badges and earned records
      const allAchievements = await LearnerAchievement.find({ isActive: true });
      const earnedRecords = await LearnerEarnedAchievement.find({ learnerId });
      const earnedMap = {};
      earnedRecords.forEach(e => { earnedMap[e.achievementCode] = e; });
      
      const totalPerfects = (progress.perfectLabsCompleted || 0) + (progress.perfectQuizzes || 0);
      
      const badges = allAchievements.map(ach => {
        const earned = earnedMap[ach.code];
        const threshold = ach.criteria?.threshold || 1;
        let current = 0;
        
        switch (ach.criteria?.type) {
          case 'first_lab': current = progress.firstLabCompleted ? 1 : 0; break;
          case 'first_module': current = progress.firstModuleCompleted ? 1 : 0; break;
          case 'first_quiz': current = progress.firstQuizCompleted ? 1 : 0; break;
          case 'first_code': current = progress.firstCodeSubmitted ? 1 : 0; break;
          case 'perfect_lab': current = progress.perfectLabsCompleted || 0; break;
          case 'perfect_quiz': current = progress.perfectQuizzes || 0; break;
          case 'perfect_lab_count': current = progress.perfectLabsCompleted || 0; break;
          case 'perfect_quiz_count': current = progress.perfectQuizzes || 0; break;
          case 'perfect_total': current = totalPerfects; break;
          case 'lab_completion': current = progress.totalLabsCompleted || 0; break;
          case 'module_completion': current = progress.totalModulesCompleted || 0; break;
          case 'course_completion': current = progress.totalCoursesCompleted || 0; break;
          case 'streak_days': current = Math.max(progress.streak?.current || 0, progress.streak?.longest || 0); break;
        }
        
        const isUnlocked = !!earned;
        const progressPct = threshold > 0
          ? Math.min(Math.round((current / threshold) * 100), 100)
          : (isUnlocked ? 100 : 0);
        
        return {
          code: ach.code,
          title: ach.title,
          description: ach.description,
          icon: ach.icon,
          iconColor: ach.iconColor || '#6366f1',
          category: ach.category,
          xpAward: ach.xpAward,
          tier: ach.tier,
          repeatable: ach.repeatable,
          isLocked: !isUnlocked,
          progress: progressPct,
          current,
          target: threshold,
          earnedCount: earned?.unlockedCount || 0,
          earnedAt: earned?.earnedAt || null,
          lastEarnedAt: earned?.lastEarnedAt || null
        };
      });
      
      const earnedBadges = badges.filter(b => !b.isLocked).length;
      const lockedBadges = badges.filter(b => b.isLocked).length;
      
      // Weekly XP calculation
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const weeklyXp = (progress.completedLabs || [])
        .filter(l => new Date(l.completedAt) >= oneWeekAgo)
        .reduce((sum, l) => sum + (l.xpEarned || 0), 0);
      
      return {
        success: true,
        totalXp,
        weeklyXp,
        ...tierInfo,
        earnedBadges,
        lockedBadges,
        totalBadges: badges.length,
        completionPercent: badges.length > 0 ? Math.round((earnedBadges / badges.length) * 100) : 0,
        badges,
        streaks: {
          submission: {
            current: progress.streak?.current || 0,
            longest: progress.streak?.longest || 0
          }
        },
        stats: {
          labsCompleted: progress.totalLabsCompleted || 0,
          modulesCompleted: progress.totalModulesCompleted || 0,
          coursesCompleted: progress.totalCoursesCompleted || 0,
          quizzesTaken: progress.totalQuizzesTaken || 0,
          perfectLabs: progress.perfectLabsCompleted || 0,
          perfectQuizzes: progress.perfectQuizzes || 0
        }
      };
    } catch (error) {
      console.error('Achievement summary error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default LearnerGamificationService;
