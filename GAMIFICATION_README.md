# Gamification Engine Documentation

## Overview

The Gamification Engine provides XP calculation, achievement tracking, and streak management for student lab submissions in CodeZy.

## Features

### 1. XP Calculation on Lab Submission

When a student submits a lab, the engine calculates XP based on:

#### Base XP Formula
```
performance = obtained_score / 10  (0-1 scale)
baseXP = performance × 100 × difficultyMultiplier
```

#### Difficulty Multipliers
- Easy: 1.0
- Medium: 1.25
- Hard: 1.5

### 2. Early Submission Bonus

Students who submit with score ≥ 8.5 receive bonus XP based on their rank:
- 1st place: +50 XP
- 2nd place: +30 XP
- 3rd place: +15 XP

### 3. Reattempt Handling

- XP does NOT stack fully on reattempts
- `xpAdded = max(0, newXP - previousBestXP)`
- Never subtracts XP
- Always keeps best attempt

### 4. Streak System

#### A) Submission Streak
Triggered when student submits labs on consecutive days:

| Streak | Bonus XP | Badge Name          |
|--------|----------|---------------------|
| 3      | +20      | Consistent Coder I  |
| 4      | +30      | Consistent Coder II |
| 5      | +50      | Consistent Coder III|
| 10     | +150     | Unstoppable Coder   |

#### B) Early Excellence Streak
Student ranks in top 3 AND performance ≥ 0.85 for consecutive labs in same course:

| Streak | Bonus XP | Badge Name        |
|--------|----------|-------------------|
| 3      | +50      | Speed Demon I     |
| 4      | +75      | Speed Demon II    |
| 5      | +120     | Elite Finisher    |
| 10     | +300     | Legendary Topper  |

### 5. First Attempt Perfect Bonus

- If student passes all test cases on first attempt: **+25 XP**
- Unlocks badge: "One Shot Wonder"

### 6. XP Scaling (After 1000 XP)

Progressive decay to prevent runaway XP accumulation:

| XP Range    | Scaling Factor |
|-------------|---------------|
| 0-1000      | 1.0           |
| 1000-2000   | 0.6           |
| 2000-5000   | 0.4           |
| 5000+       | 0.25          |

## API Endpoints

### Gamification Routes (`/api/gamification`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/achievements/:studentId` | Get all achievements for a student |
| GET | `/xp-history/:studentId` | Get XP transaction history |
| GET | `/stats/:studentId` | Get gamification stats (streaks, XP, tier) |
| GET | `/leaderboard` | Get XP leaderboard |
| GET | `/recent-achievements/:studentId` | Get recently earned achievements |
| POST | `/seed-achievements` | Seed default achievements (run once) |
| POST | `/initialize/:studentId` | Initialize gamification for a student |

### Student Routes (`/api/students`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/:studentId/achievements` | Get achievements page data |

## Database Models

### Achievement
Defines available achievements/badges in the system.

### StudentAchievement
Tracks which achievements each student has earned.

### StudentGamification
Tracks student-specific gamification data (streaks, progress).

### XPLog
Tracks all XP transactions for audit and analytics.

## Setup

1. **Seed achievements** (run once):
   ```bash
   cd backend
   node seedAchievements.js
   ```
   
   Or call the API:
   ```bash
   POST /api/gamification/seed-achievements
   ```

2. **Initialize student gamification** (automatic on first submission, or call manually):
   ```bash
   POST /api/gamification/initialize/:studentId
   ```

## Frontend Components

### StudentAchievements.jsx
Displays the achievements page with:
- Total XP and tier progress
- Badge statistics (earned/locked/total)
- Category filters
- Badge cards with progress indicators
- Streak information

### XPChecklistModal.jsx
Shows after lab submission with:
- Total XP gained
- XP breakdown (base, bonuses)
- Achievements unlocked
- Streak progress
- Tier progress

## Integration

The gamification engine is automatically called when a student submits a lab via:
```
POST /api/code-execution/submit-lab
```

The response includes full gamification data:
```json
{
  "success": true,
  "submitted": true,
  "averageScore": 8.5,
  "xpGained": 125,
  "totalXp": 1250,
  "gamification": {
    "breakdown": {
      "baseXp": 85,
      "difficultyMultiplier": 1.25,
      "earlySubmissionBonus": 30,
      "streakBonus": 0,
      "firstAttemptBonus": 25,
      "totalBeforeScaling": 140,
      "scalingFactor": 0.6,
      "scaledTotal": 84
    },
    "bonuses": [...],
    "achievements": [...],
    "streaks": {...},
    "tier": {...},
    "checklist": [...]
  }
}
```

## Tier System

| Tier     | XP Required | Emoji |
|----------|-------------|-------|
| Bronze   | 0           | 🥉    |
| Silver   | 1,000       | 🥈    |
| Gold     | 2,500       | 🥇    |
| Platinum | 5,000       | 💎    |
| Diamond  | 10,000      | 👑    |
