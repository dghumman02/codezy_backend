# Gamification Service - Quick Reference

## XP Calculation Formula

```
BaseXP = (score / 10) × 100 × difficultyMultiplier
```

**Difficulty Multipliers:**
| Difficulty | Multiplier |
|------------|------------|
| Easy       | 1.0        |
| Medium     | 1.25       |
| Hard       | 1.5        |

**Example:** Score 8/10 on Medium lab = (8/10) × 100 × 1.25 = **100 XP**

---

## Bonuses

| Bonus Type | Condition | XP Reward |
|------------|-----------|-----------|
| Early Submission (1st) | Score ≥ 8.5, submit first | +50 XP |
| Early Submission (2nd) | Score ≥ 8.5, submit second | +30 XP |
| Early Submission (3rd) | Score ≥ 8.5, submit third | +15 XP |
| First Attempt Perfect | Pass all tests on 1st try | +25 XP |

---

## Reattempt Logic

```
XP Added = max(0, newXP - previousBestXP)
```
- Never lose XP
- Only gain if you improve

---

## Streak System

### Submission Streak (daily submissions)
| Days | Bonus | Badge |
|------|-------|-------|
| 3 | +20 XP | Consistent Coder I |
| 4 | +30 XP | Consistent Coder II |
| 5 | +50 XP | Consistent Coder III |
| 10 | +150 XP | Unstoppable Coder |

### Early Excellence Streak (top 3 + score ≥ 8.5 consecutively)
| Labs | Bonus | Badge |
|------|-------|-------|
| 3 | +50 XP | Speed Demon I |
| 4 | +75 XP | Speed Demon II |
| 5 | +120 XP | Elite Finisher |
| 10 | +300 XP | Legendary Topper |

---

## XP Scaling (Decay after 1000 XP)

| Total XP Range | Scaling Factor |
|----------------|----------------|
| 0 - 1,000 | ×1.0 (full) |
| 1,000 - 2,000 | ×0.6 |
| 2,000 - 5,000 | ×0.4 |
| 5,000+ | ×0.25 |

**Example:** Earned 100 XP at 1500 total XP → Actually get 100 × 0.6 = **60 XP**

---

## Tier System (5 Tiers)

| Tier | XP Required | Emoji |
|------|-------------|-------|
| Bronze | 0 | 🥉 |
| Silver | 1,000 | 🥈 |
| Gold | 2,500 | 🥇 |
| Platinum | 5,000 | 💎 |
| Diamond | 10,000 | 👑 |

---

## Key Files

- `services/GamificationEngine.js` - Main calculation logic
- `models/Achievement.js` - Badge definitions
- `models/StudentGamification.js` - Student progress/streaks
- `models/XPLog.js` - Transaction history

---

## How It Works

1. Student submits lab → `submit-lab` API called
2. GamificationEngine.calculateSubmissionXP() runs
3. Calculates base XP + checks all bonuses
4. Updates streaks, checks achievements
5. Applies XP scaling if needed
6. Returns breakdown to frontend
7. XPChecklistModal shows results
