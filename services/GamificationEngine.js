import Student from '../models/Students.js';
import Achievement from '../models/Achievement.js';
import StudentAchievement from '../models/StudentAchievement.js';
import StudentGamification from '../models/StudentGamification.js';
import XPLog from '../models/XPLog.js';
import Course from '../models/Course.js';

/**
 * GamificationEngine Service
 * Handles all XP calculation, streak tracking, and achievement unlocking
 */
class GamificationEngine {
  
  // Difficulty multipliers
  static DIFFICULTY_MULTIPLIERS = {
    'Easy': 1.0,
    'Medium': 1.25,
    'Hard': 1.5
  };
  
  // Early submission bonuses (rank -> XP bonus)
  static EARLY_SUBMISSION_BONUSES = {
    1: 75,  // First to submit with 85%+
    2: 50,  // Second to fifth (top 5)
    3: 50,
    4: 50,
    5: 50
  };
  
  // Submission streak milestones
  static SUBMISSION_STREAK_REWARDS = {
    3: { xp: 20, badge: 'CONSISTENT_CODER_I' },
    4: { xp: 30, badge: 'CONSISTENT_CODER_II' },
    5: { xp: 50, badge: 'CONSISTENT_CODER_III' },
    10: { xp: 150, badge: 'UNSTOPPABLE_CODER' }
  };
  
  // Early excellence streak milestones
  static EARLY_EXCELLENCE_REWARDS = {
    3: { xp: 50, badge: 'SPEED_DEMON_I' },
    4: { xp: 75, badge: 'SPEED_DEMON_II' },
    5: { xp: 120, badge: 'ELITE_FINISHER' },
    10: { xp: 300, badge: 'LEGENDARY_TOPPER' }
  };
  
  // XP Scaling thresholds
  static XP_SCALING = [
    { min: 0, max: 1000, factor: 1.0 },
    { min: 1000, max: 2000, factor: 0.6 },
    { min: 2000, max: 5000, factor: 0.4 },
    { min: 5000, max: Infinity, factor: 0.25 }
  ];
  
  // First attempt perfect bonus
  static FIRST_ATTEMPT_BONUS = 25;
  
  /**
   * Main method: Calculate XP for a lab submission
   * @param {Object} params - Submission parameters
   * @returns {Object} XP breakdown and achievements
   */
  static async calculateSubmissionXP({
    studentId,
    labId,
    courseId,
    classId,
    score,           // 0-10 scale
    difficulty,      // Easy, Medium, Hard
    labTitle,
    courseTitle,
    allTestsPassed   // boolean - did they pass all test cases?
  }) {
    // Initialize response
    const response = {
      success: true,
      xpGained: 0,
      totalXp: 0,
      breakdown: {
        baseXp: 0,
        difficultyMultiplier: 1,
        earlySubmissionBonus: 0,
        streakBonus: 0,
        earlyExcellenceBonus: 0,
        firstAttemptBonus: 0,
        achievementBonus: 0,
        totalBeforeScaling: 0,
        scalingFactor: 1,
        scaledTotal: 0
      },
      bonuses: [],
      achievements: [],
      streaks: {
        submission: { current: 0, milestone: null },
        earlyExcellence: { current: 0, milestone: null }
      },
      isReattempt: false,
      previousBestXp: 0,
      tier: {
        current: 'Bronze',
        next: 'Silver',
        progress: 0,
        xpToNext: 1000
      },
      checklist: []
    };
    
    try {
      // Get or create gamification record
      let gamification = await StudentGamification.findOne({ studentId });
      if (!gamification) {
        gamification = new StudentGamification({ studentId });
      }
      
      // Get student
      const student = await Student.findById(studentId);
      if (!student) {
        throw new Error('Student not found');
      }
      
      const currentXp = student.xp || 0;
      const submissionDate = new Date();
      
      // === STEP 1: Calculate Base XP ===
      const performance = score / 10; // 0-1
      const diffMultiplier = this.DIFFICULTY_MULTIPLIERS[difficulty] || 1.0;
      const baseXp = Math.round(performance * 100 * diffMultiplier);
      
      response.breakdown.baseXp = baseXp;
      response.breakdown.difficultyMultiplier = diffMultiplier;
      response.checklist.push({
        label: 'Performance XP',
        value: `+${baseXp} XP`,
        achieved: true,
        detail: `${Math.round(performance * 100)}% × ${diffMultiplier}x difficulty`
      });
      
      // === STEP 2: Check for Reattempt ===
      const existingLabScore = gamification.labBestScores.find(
        l => l.labId?.toString() === labId.toString()
      );
      
      let xpToAdd = baseXp;
      let isReattempt = false;
      let previousBestXp = 0;
      
      if (existingLabScore) {
        isReattempt = true;
        previousBestXp = existingLabScore.bestXp || 0;
        
        // Only add XP if new score is better
        xpToAdd = Math.max(0, baseXp - previousBestXp);
        
        response.isReattempt = true;
        response.previousBestXp = previousBestXp;
        
        if (xpToAdd > 0) {
          // Update best score
          existingLabScore.bestScore = Math.max(existingLabScore.bestScore, score);
          existingLabScore.bestXp = Math.max(existingLabScore.bestXp, baseXp);
          existingLabScore.attemptCount += 1;
          
          response.checklist.push({
            label: 'Reattempt Bonus',
            value: `+${xpToAdd} XP (improvement)`,
            achieved: true,
            detail: `Previous best: ${previousBestXp} XP`
          });
        } else {
          response.checklist.push({
            label: 'Reattempt',
            value: 'No additional XP',
            achieved: false,
            detail: `Score didn't exceed previous best (${previousBestXp} XP)`
          });
        }
      } else {
        // First attempt - record it
        gamification.labBestScores.push({
          labId,
          courseId,
          classId,
          bestScore: score,
          bestXp: baseXp,
          attemptCount: 1,
          firstAttemptPassed: allTestsPassed,
          submittedAt: submissionDate
        });
        gamification.totalLabsCompleted = (gamification.totalLabsCompleted || 0) + 1;
      }
      
      let totalXpBeforeScaling = xpToAdd;
      
      // === STEP 3: Early Submission Bonus ===
      // Only for first attempts with score >= 8.5
      if (!isReattempt && score >= 8.5) {
        const rank = await this.getSubmissionRank(labId, classId, studentId);
        
        if (rank && rank <= 5) {
          const earlyBonus = this.EARLY_SUBMISSION_BONUSES[rank];
          response.breakdown.earlySubmissionBonus = earlyBonus;
          totalXpBeforeScaling += earlyBonus;
          
          // Update lab score with rank
          const labScore = gamification.labBestScores.find(
            l => l.labId?.toString() === labId.toString()
          );
          if (labScore) {
            labScore.submissionRank = rank;
          }
          
          response.bonuses.push({
            type: 'early_submission',
            xp: earlyBonus,
            detail: `Rank #${rank} early finisher`
          });
          
          response.checklist.push({
            label: 'Early Submission Bonus',
            value: `+${earlyBonus} XP`,
            achieved: true,
            detail: `Ranked #${rank} with score ≥ 8.5`
          });
          
          // === Award First Submit Badges (Repeatable) ===
          // TRAILBLAZER: First to submit with 85%+ score
          if (rank === 1) {
            // Track first to submit with high score
            gamification.firstToSubmitHighScore = (gamification.firstToSubmitHighScore || 0) + 1;
            
            const trailblazerAchievement = await this.awardAchievement(
              studentId,
              'TRAILBLAZER',
              { labId, courseId, classId, score, rank }
            );
            if (trailblazerAchievement.newlyEarned || trailblazerAchievement.incrementedCount) {
              response.achievements.push({
                ...trailblazerAchievement,
                newlyEarned: trailblazerAchievement.newlyEarned,
                earnedCount: trailblazerAchievement.earnedCount || 1
              });
              if (trailblazerAchievement.newlyEarned) {
                response.breakdown.achievementBonus += trailblazerAchievement.xpAwarded;
                totalXpBeforeScaling += trailblazerAchievement.xpAwarded;
              }
              response.bonuses.push({
                type: 'first_submit_badge',
                xp: trailblazerAchievement.newlyEarned ? trailblazerAchievement.xpAwarded : 0,
                detail: `Trailblazer badge ${trailblazerAchievement.newlyEarned ? 'unlocked' : `earned (×${trailblazerAchievement.earnedCount})`}!`
              });
            }
            
            // PIONEER_PERFECTIONIST: First to submit with perfect 100% score
            if (score === 10) {
              const perfectRank = await this.getPerfectSubmissionRank(labId, classId, studentId);
              if (perfectRank === 1) {
                // Track first to submit with perfect score
                gamification.firstToSubmitPerfect = (gamification.firstToSubmitPerfect || 0) + 1;
                
                const pioneerAchievement = await this.awardAchievement(
                  studentId,
                  'PIONEER_PERFECTIONIST',
                  { labId, courseId, classId, score, rank: perfectRank }
                );
                if (pioneerAchievement.newlyEarned || pioneerAchievement.incrementedCount) {
                  response.achievements.push({
                    ...pioneerAchievement,
                    newlyEarned: pioneerAchievement.newlyEarned,
                    earnedCount: pioneerAchievement.earnedCount || 1
                  });
                  if (pioneerAchievement.newlyEarned) {
                    response.breakdown.achievementBonus += pioneerAchievement.xpAwarded;
                    totalXpBeforeScaling += pioneerAchievement.xpAwarded;
                  }
                  response.bonuses.push({
                    type: 'first_submit_perfect_badge',
                    xp: pioneerAchievement.newlyEarned ? pioneerAchievement.xpAwarded : 0,
                    detail: `Pioneer Perfectionist badge ${pioneerAchievement.newlyEarned ? 'unlocked' : `earned (×${pioneerAchievement.earnedCount})`}!`
                  });
                }
              }
            }
          }
          
          // Track top 5 submissions
          if (rank <= 5) {
            gamification.topFiveSubmissions = (gamification.topFiveSubmissions || 0) + 1;
          }
        } else {
          response.checklist.push({
            label: 'Early Submission Bonus',
            value: 'Not achieved',
            achieved: false,
            detail: 'Not in top 5 high scorers'
          });
        }
      } else if (isReattempt) {
        response.checklist.push({
          label: 'Early Submission Bonus',
          value: 'N/A',
          achieved: false,
          detail: 'Only for first attempts'
        });
      } else {
        response.checklist.push({
          label: 'Early Submission Bonus',
          value: 'Not achieved',
          achieved: false,
          detail: 'Score must be ≥ 8.5'
        });
      }
      
      // === STEP 4: Submission Streak ===
      const streakResult = gamification.updateSubmissionStreak(submissionDate);
      response.streaks.submission.current = gamification.submissionStreak.current;
      
      // Check for streak milestone
      const streakMilestone = this.SUBMISSION_STREAK_REWARDS[gamification.submissionStreak.current];
      if (streakMilestone && streakResult.streakChanged) {
        response.breakdown.streakBonus = streakMilestone.xp;
        totalXpBeforeScaling += streakMilestone.xp;
        
        // Increment milestone counter
        const milestoneKey = `streak${gamification.submissionStreak.current}`;
        if (gamification.submissionStreak.milestonesReached[milestoneKey] !== undefined) {
          gamification.submissionStreak.milestonesReached[milestoneKey] += 1;
        }
        
        response.streaks.submission.milestone = {
          streak: gamification.submissionStreak.current,
          badge: streakMilestone.badge,
          xp: streakMilestone.xp,
          count: gamification.submissionStreak.milestonesReached[milestoneKey]
        };
        
        response.bonuses.push({
          type: 'streak',
          xp: streakMilestone.xp,
          detail: `${gamification.submissionStreak.current}-day submission streak!`
        });
        
        // Award achievement
        const achievement = await this.awardAchievement(
          studentId, 
          streakMilestone.badge, 
          { labId, courseId, classId, streakCount: gamification.submissionStreak.current }
        );
        if (achievement.newlyEarned) {
          response.achievements.push(achievement);
          response.breakdown.achievementBonus += achievement.xpAwarded;
          totalXpBeforeScaling += achievement.xpAwarded;
        }
        
        response.checklist.push({
          label: 'Streak Bonus',
          value: `+${streakMilestone.xp} XP`,
          achieved: true,
          detail: `${gamification.submissionStreak.current}-day streak milestone!`
        });
      } else {
        response.checklist.push({
          label: 'Streak Bonus',
          value: `${gamification.submissionStreak.current}-day streak`,
          achieved: false,
          detail: `Next milestone: ${this.getNextStreakMilestone(gamification.submissionStreak.current)} days`
        });
      }
      
      // === STEP 5: Early Excellence Streak ===
      // Check if qualified (top 3 with score >= 8.5)
      let earlyExcellenceQualified = false;
      if (!isReattempt && score >= 8.5) {
        const rank = await this.getSubmissionRank(labId, classId, studentId);
        earlyExcellenceQualified = rank && rank <= 3;
      }
      
      const excellenceResult = gamification.updateEarlyExcellenceStreak(
        courseId, classId, labId, earlyExcellenceQualified
      );
      
      const courseStreak = gamification.earlyExcellenceStreaks.find(
        s => s.courseId?.toString() === courseId.toString() && 
             s.classId?.toString() === classId.toString()
      );
      
      if (courseStreak) {
        response.streaks.earlyExcellence.current = courseStreak.current;
        
        const excellenceMilestone = this.EARLY_EXCELLENCE_REWARDS[courseStreak.current];
        if (excellenceMilestone && earlyExcellenceQualified) {
          response.breakdown.earlyExcellenceBonus = excellenceMilestone.xp;
          totalXpBeforeScaling += excellenceMilestone.xp;
          
          // Increment milestone counter
          const milestoneKey = `streak${courseStreak.current}`;
          if (courseStreak.milestonesReached[milestoneKey] !== undefined) {
            courseStreak.milestonesReached[milestoneKey] += 1;
          }
          
          response.streaks.earlyExcellence.milestone = {
            streak: courseStreak.current,
            badge: excellenceMilestone.badge,
            xp: excellenceMilestone.xp
          };
          
          response.bonuses.push({
            type: 'early_excellence',
            xp: excellenceMilestone.xp,
            detail: `${courseStreak.current} consecutive top 3 finishes!`
          });
          
          // Award achievement
          const achievement = await this.awardAchievement(
            studentId,
            excellenceMilestone.badge,
            { labId, courseId, classId, streakCount: courseStreak.current }
          );
          if (achievement.newlyEarned) {
            response.achievements.push(achievement);
            response.breakdown.achievementBonus += achievement.xpAwarded;
            totalXpBeforeScaling += achievement.xpAwarded;
          }
          
          response.checklist.push({
            label: 'Early Excellence Bonus',
            value: `+${excellenceMilestone.xp} XP`,
            achieved: true,
            detail: `${courseStreak.current} consecutive top finishes!`
          });
        } else {
          response.checklist.push({
            label: 'Early Excellence Bonus',
            value: earlyExcellenceQualified ? `${courseStreak.current} streak` : 'Streak broken',
            achieved: false,
            detail: earlyExcellenceQualified 
              ? `Next milestone: ${this.getNextExcellenceMilestone(courseStreak.current)}`
              : 'Need top 3 with score ≥ 8.5'
          });
        }
      }
      
      // === STEP 6: First Attempt Perfect Bonus ===
      if (!isReattempt && allTestsPassed) {
        response.breakdown.firstAttemptBonus = this.FIRST_ATTEMPT_BONUS;
        totalXpBeforeScaling += this.FIRST_ATTEMPT_BONUS;
        
        gamification.totalFirstAttemptPasses += 1;
        
        response.bonuses.push({
          type: 'first_attempt_perfect',
          xp: this.FIRST_ATTEMPT_BONUS,
          detail: 'All test cases passed on first try!'
        });
        
        // Award One Shot Wonder achievement
        const achievement = await this.awardAchievement(
          studentId,
          'ONE_SHOT_WONDER',
          { labId, courseId, classId }
        );
        if (achievement.newlyEarned) {
          response.achievements.push(achievement);
        }
        
        response.checklist.push({
          label: 'First Attempt Bonus',
          value: `+${this.FIRST_ATTEMPT_BONUS} XP`,
          achieved: true,
          detail: 'Perfect score on first attempt!'
        });
      } else if (isReattempt) {
        response.checklist.push({
          label: 'First Attempt Bonus',
          value: 'N/A',
          achieved: false,
          detail: 'Only for first attempts'
        });
      } else {
        response.checklist.push({
          label: 'First Attempt Bonus',
          value: 'Not achieved',
          achieved: false,
          detail: 'Pass all test cases on first try'
        });
      }
      
      // === STEP 6.5: Track Score Stats & Award Programming Badges ===
      if (!isReattempt) {
        // Track high score labs (>= 8.5)
        if (score >= 8.5) {
          gamification.highScoreLabs = (gamification.highScoreLabs || 0) + 1;
          
          // Check HIGH_ACHIEVER badge (5 high score labs)
          if (gamification.highScoreLabs >= 5) {
            const highAchieverBadge = await this.awardAchievement(
              studentId,
              'HIGH_ACHIEVER',
              { labId, courseId, classId, highScoreLabs: gamification.highScoreLabs }
            );
            if (highAchieverBadge.newlyEarned) {
              response.achievements.push(highAchieverBadge);
              response.breakdown.achievementBonus += highAchieverBadge.xpAwarded;
              totalXpBeforeScaling += highAchieverBadge.xpAwarded;
            }
          }
        }
        
        // Track perfect score labs (10)
        if (score === 10) {
          gamification.perfectScoreLabs = (gamification.perfectScoreLabs || 0) + 1;
          gamification.totalPerfectScores = (gamification.totalPerfectScores || 0) + 1;
          
          // Check PERFECTIONIST badge (5 perfect score labs)
          if (gamification.perfectScoreLabs >= 5) {
            const perfectionistBadge = await this.awardAchievement(
              studentId,
              'PERFECTIONIST',
              { labId, courseId, classId, perfectScoreLabs: gamification.perfectScoreLabs }
            );
            if (perfectionistBadge.newlyEarned) {
              response.achievements.push(perfectionistBadge);
              response.breakdown.achievementBonus += perfectionistBadge.xpAwarded;
              totalXpBeforeScaling += perfectionistBadge.xpAwarded;
            }
          }
        }
        
        // Check CODE_ROOKIE badge (first lab completed)
        if (gamification.totalLabsCompleted >= 1) {
          const rookieBadge = await this.awardAchievement(
            studentId,
            'CODE_ROOKIE',
            { labId, courseId, classId }
          );
          if (rookieBadge.newlyEarned) {
            response.achievements.push(rookieBadge);
            response.breakdown.achievementBonus += rookieBadge.xpAwarded;
            totalXpBeforeScaling += rookieBadge.xpAwarded;
          }
        }
        
        // Check CODE_WARRIOR badge (5 labs completed)
        if (gamification.totalLabsCompleted >= 5) {
          const warriorBadge = await this.awardAchievement(
            studentId,
            'CODE_WARRIOR',
            { labId, courseId, classId, totalLabs: gamification.totalLabsCompleted }
          );
          if (warriorBadge.newlyEarned) {
            response.achievements.push(warriorBadge);
            response.breakdown.achievementBonus += warriorBadge.xpAwarded;
            totalXpBeforeScaling += warriorBadge.xpAwarded;
          }
        }
      }
      
      response.breakdown.totalBeforeScaling = totalXpBeforeScaling;
      
      // === STEP 7: Apply XP Scaling ===
      const scalingFactor = this.getScalingFactor(currentXp);
      const scaledXp = Math.round(totalXpBeforeScaling * scalingFactor);
      
      response.breakdown.scalingFactor = scalingFactor;
      response.breakdown.scaledTotal = scaledXp;
      
      if (scalingFactor < 1) {
        response.checklist.push({
          label: 'XP Scaling Applied',
          value: `×${scalingFactor}`,
          achieved: true,
          detail: `High XP tier scaling (${currentXp.toLocaleString()} XP)`
        });
      }
      
      response.xpGained = scaledXp;
      
      // === STEP 8: Check XP Milestone Achievements ===
      const newTotalXp = currentXp + scaledXp;
      const xpMilestoneAchievements = await this.checkXPMilestones(studentId, currentXp, newTotalXp);
      for (const achievement of xpMilestoneAchievements) {
        if (achievement.newlyEarned) {
          response.achievements.push(achievement);
          response.breakdown.achievementBonus += achievement.xpAwarded;
          // Note: Achievement XP from milestones is already accounted for in the milestone check
        }
      }
      
      // === STEP 9: Update Student XP ===
      student.xp = newTotalXp;
      await student.save();
      
      response.totalXp = newTotalXp;
      
      // === STEP 10: Update Tier ===
      gamification.tier = gamification.calculateTier(newTotalXp);
      const tierProgress = gamification.getTierProgress(newTotalXp);
      response.tier = tierProgress;
      
      // Update weekly XP tracking
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      
      if (!gamification.weekStartDate || gamification.weekStartDate < weekStart) {
        gamification.weeklyXp = scaledXp;
        gamification.weekStartDate = weekStart;
      } else {
        gamification.weeklyXp += scaledXp;
      }
      
      // Save gamification data
      await gamification.save();
      
      // === STEP 11: Log XP Transaction ===
      await this.logXPTransaction({
        studentId,
        eventType: 'lab_submission',
        xpAmount: scaledXp,
        rawXp: totalXpBeforeScaling,
        scalingFactor,
        xpBefore: currentXp,
        xpAfter: newTotalXp,
        context: {
          labId,
          courseId,
          classId,
          labTitle,
          courseTitle,
          performance: score / 10,
          difficulty,
          isReattempt,
          previousBestXp
        },
        breakdown: response.breakdown,
        description: `Lab submission: ${labTitle}`
      });
      
      // Add achievement checklist items
      if (response.achievements.length > 0) {
        response.checklist.push({
          label: 'Achievements Unlocked',
          value: `${response.achievements.length} badge(s)`,
          achieved: true,
          detail: response.achievements.map(a => a.title).join(', ')
        });
      }
      
      return response;
      
    } catch (error) {
      console.error('GamificationEngine.calculateSubmissionXP error:', error);
      response.success = false;
      response.error = error.message;
      return response;
    }
  }
  
  /**
   * Get submission rank for early submission bonus
   * Note: This is called BEFORE the current submission is saved, so we calculate
   * what the rank WILL BE when the submission is added.
   */
  static async getSubmissionRank(labId, classId, studentId) {
    try {
      const course = await Course.findOne({ 'classes.labs._id': labId });
      if (!course) return null;
      
      let lab = null;
      for (const cls of course.classes) {
        if (cls._id.toString() === classId.toString()) {
          lab = cls.labs.id(labId);
          break;
        }
      }
      
      if (!lab) return null;
      
      // Check if student already has a submission (reattempt)
      const existingSubmission = lab.submissions.find(
        s => s.studentId.toString() === studentId.toString()
      );
      
      // If this is a reattempt, they don't qualify for first submission rank
      if (existingSubmission) {
        return null;
      }
      
      // Get all EXISTING submissions with score >= 8.5, sorted by submission time
      const qualifyingSubmissions = lab.submissions
        .filter(s => s.averageScore >= 8.5)
        .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
      
      // Since current student hasn't submitted yet, their rank will be position after all existing
      // If no one else has qualifying submissions, they will be rank 1
      // If 2 people already have qualifying submissions, they will be rank 3
      const rank = qualifyingSubmissions.length + 1;
      
      return rank;
    } catch (error) {
      console.error('Error getting submission rank:', error);
      return null;
    }
  }
  
  /**
   * Get perfect submission rank (first to submit with score = 10)
   * Note: This is called BEFORE the current submission is saved.
   */
  static async getPerfectSubmissionRank(labId, classId, studentId) {
    try {
      const course = await Course.findOne({ 'classes.labs._id': labId });
      if (!course) return null;
      
      let lab = null;
      for (const cls of course.classes) {
        if (cls._id.toString() === classId.toString()) {
          lab = cls.labs.id(labId);
          break;
        }
      }
      
      if (!lab) return null;
      
      // Check if student already has a submission (reattempt)
      const existingSubmission = lab.submissions.find(
        s => s.studentId.toString() === studentId.toString()
      );
      
      // If this is a reattempt, they don't qualify for first submission rank
      if (existingSubmission) {
        return null;
      }
      
      // Get all EXISTING submissions with perfect score (10)
      const perfectSubmissions = lab.submissions
        .filter(s => s.averageScore === 10)
        .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
      
      // Since current student hasn't submitted yet, their rank will be position after all existing
      const rank = perfectSubmissions.length + 1;
      
      return rank;
    } catch (error) {
      console.error('Error getting perfect submission rank:', error);
      return null;
    }
  }
  
  /**
   * Award an achievement to a student
   */
  static async awardAchievement(studentId, achievementCode, context = {}) {
    try {
      const achievement = await Achievement.findOne({ code: achievementCode });
      if (!achievement) {
        return { newlyEarned: false, error: 'Achievement not found' };
      }
      
      // Check if already earned
      let studentAchievement = await StudentAchievement.findOne({
        studentId,
        achievementCode
      });
      
      if (studentAchievement) {
        // Increment count for repeatable achievements (like streak badges)
        studentAchievement.earnedCount += 1;
        studentAchievement.context = context;
        await studentAchievement.save();
        
        return {
          newlyEarned: false,
          incrementedCount: true,
          code: achievementCode,
          title: achievement.title,
          description: achievement.description,
          xpAwarded: 0, // No XP for repeat earnings
          earnedCount: studentAchievement.earnedCount
        };
      }
      
      // Create new achievement record
      studentAchievement = new StudentAchievement({
        studentId,
        achievementCode,
        xpAwarded: achievement.xpAward,
        context,
        earnedAt: new Date()
      });
      await studentAchievement.save();
      
      return {
        newlyEarned: true,
        code: achievementCode,
        title: achievement.title,
        description: achievement.description,
        xpAwarded: achievement.xpAward,
        icon: achievement.icon,
        iconColor: achievement.iconColor,
        tier: achievement.tier,
        category: achievement.category
      };
    } catch (error) {
      console.error('Error awarding achievement:', error);
      return { newlyEarned: false, error: error.message };
    }
  }
  
  /**
   * Check and award XP milestone achievements
   */
  static async checkXPMilestones(studentId, oldXp, newXp) {
    const milestones = [
      { threshold: 100, badge: 'XP_ROOKIE' },
      { threshold: 500, badge: 'XP_WARRIOR' },
      { threshold: 1000, badge: 'XP_MASTER' },
      { threshold: 5000, badge: 'XP_LEGEND' }
    ];
    
    const achievements = [];
    
    for (const milestone of milestones) {
      if (oldXp < milestone.threshold && newXp >= milestone.threshold) {
        const achievement = await this.awardAchievement(studentId, milestone.badge, {
          xpMilestone: milestone.threshold
        });
        if (achievement.newlyEarned) {
          achievements.push(achievement);
        }
      }
    }
    
    return achievements;
  }
  
  /**
   * Get XP scaling factor based on current XP
   */
  static getScalingFactor(currentXp) {
    for (const tier of this.XP_SCALING) {
      if (currentXp >= tier.min && currentXp < tier.max) {
        return tier.factor;
      }
    }
    return 0.25; // Default for very high XP
  }
  
  /**
   * Get next streak milestone
   */
  static getNextStreakMilestone(currentStreak) {
    const milestones = [3, 4, 5, 10];
    for (const m of milestones) {
      if (currentStreak < m) return m;
    }
    return 'Max reached';
  }
  
  /**
   * Get next early excellence milestone
   */
  static getNextExcellenceMilestone(currentStreak) {
    const milestones = [3, 4, 5, 10];
    for (const m of milestones) {
      if (currentStreak < m) return m;
    }
    return 'Max reached';
  }
  
  /**
   * Log XP transaction
   */
  static async logXPTransaction(data) {
    try {
      const log = new XPLog(data);
      await log.save();
      return log;
    } catch (error) {
      console.error('Error logging XP transaction:', error);
    }
  }
  
  /**
   * Get student's achievement data for display
   */
  static async getStudentAchievements(studentId) {
    try {
      const student = await Student.findById(studentId);
      if (!student) throw new Error('Student not found');
      
      const gamification = await StudentGamification.findOne({ studentId });
      const studentAchievements = await StudentAchievement.find({ studentId });
      const allAchievements = await Achievement.find({ isActive: true });
      
      // Build achievements with earned status
      const earnedCodes = new Set(studentAchievements.map(a => a.achievementCode));
      
      const badges = allAchievements.map(achievement => {
        const earned = studentAchievements.find(sa => sa.achievementCode === achievement.code);
        return {
          code: achievement.code,
          title: achievement.title,
          description: achievement.description,
          category: achievement.category,
          xpAward: achievement.xpAward,
          icon: achievement.icon,
          iconColor: achievement.iconColor,
          tier: achievement.tier,
          isLocked: !earned,
          earnedAt: earned?.earnedAt,
          earnedCount: earned?.earnedCount || 0,
          progress: this.calculateAchievementProgress(achievement, gamification)
        };
      });
      
      // Calculate tier info
      const totalXp = student.xp || 0;
      const tierProgress = gamification?.getTierProgress(totalXp) || {
        currentTier: 'Bronze',
        nextTier: 'Silver',
        progress: 0,
        xpToNextTier: 1000,
        xpRange: '0 - 999'
      };
      
      return {
        totalXp,
        weeklyXp: gamification?.weeklyXp || 0,
        tier: tierProgress.currentTier,
        nextTier: tierProgress.nextTier,
        nextTierPercent: tierProgress.progress,
        xpRange: tierProgress.xpRange,
        xpToNextTier: tierProgress.xpToNextTier,
        earnedBadges: studentAchievements.length,
        lockedBadges: allAchievements.length - studentAchievements.length,
        totalBadges: allAchievements.length,
        completionPercent: Math.round((studentAchievements.length / allAchievements.length) * 100),
        badges,
        streaks: {
          submission: {
            current: gamification?.submissionStreak?.current || 0,
            longest: gamification?.submissionStreak?.longest || 0
          },
          earlyExcellence: gamification?.earlyExcellenceStreaks || []
        },
        // First submission stats
        firstSubmitStats: {
          firstToSubmitHighScore: gamification?.firstToSubmitHighScore || 0,
          firstToSubmitPerfect: gamification?.firstToSubmitPerfect || 0,
          topFiveSubmissions: gamification?.topFiveSubmissions || 0,
          highScoreLabs: gamification?.highScoreLabs || 0,
          perfectScoreLabs: gamification?.perfectScoreLabs || 0
        },
        totals: {
          labsCompleted: gamification?.totalLabsCompleted || 0,
          perfectScores: gamification?.totalPerfectScores || 0,
          firstAttemptPasses: gamification?.totalFirstAttemptPasses || 0
        }
      };
    } catch (error) {
      console.error('Error getting student achievements:', error);
      throw error;
    }
  }
  
  /**
   * Calculate progress towards an achievement
   */
  static calculateAchievementProgress(achievement, gamification) {
    if (!gamification || !achievement.criteria) return 0;
    
    const { type, threshold } = achievement.criteria;
    let current = 0;
    
    switch (type) {
      case 'submission_streak':
        current = gamification.submissionStreak?.current || 0;
        break;
      case 'early_excellence_streak':
        // Get the highest early excellence streak across all courses
        const excellenceStreaks = gamification.earlyExcellenceStreaks || [];
        current = excellenceStreaks.reduce((max, s) => Math.max(max, s.current || 0), 0);
        break;
      case 'total_labs_completed':
        current = gamification.totalLabsCompleted || 0;
        break;
      case 'high_score_labs':
        current = gamification.highScoreLabs || 0;
        break;
      case 'perfect_score_labs':
        current = gamification.perfectScoreLabs || 0;
        break;
      case 'first_submit_high_score':
        current = gamification.firstToSubmitHighScore || 0;
        break;
      case 'first_submit_perfect':
        current = gamification.firstToSubmitPerfect || 0;
        break;
      case 'xp_milestone':
        // This would need the student's XP
        current = 0;
        break;
      default:
        current = 0;
    }
    
    return Math.min(100, Math.round((current / threshold) * 100));
  }
  
  /**
   * Get XP history for a student
   */
  static async getXPHistory(studentId, limit = 20) {
    try {
      const logs = await XPLog.find({ studentId })
        .sort({ createdAt: -1 })
        .limit(limit);
      
      return logs.map(log => ({
        id: log._id,
        type: log.eventType,
        xp: log.xpAmount,
        date: log.createdAt,
        description: log.description,
        labTitle: log.context?.labTitle,
        breakdown: log.breakdown
      }));
    } catch (error) {
      console.error('Error getting XP history:', error);
      return [];
    }
  }
  
  /**
   * Initialize gamification for a student (call on registration)
   */
  static async initializeStudent(studentId) {
    try {
      let gamification = await StudentGamification.findOne({ studentId });
      if (!gamification) {
        gamification = new StudentGamification({ studentId });
        await gamification.save();
      }
      return gamification;
    } catch (error) {
      console.error('Error initializing student gamification:', error);
      throw error;
    }
  }
}

export default GamificationEngine;
