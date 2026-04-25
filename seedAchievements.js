/**
 * Seed Achievements Script
 * Run this script to populate the database with default achievements
 * 
 * Usage: node seedAchievements.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Achievement from './models/Achievement.js';

dotenv.config();

// Old badges that should be removed
const OLD_BADGES_TO_REMOVE = [
  'FIRST_STEPS',
  'PF_MASTER',
  'QUICK_LEARNER',
  'OOP_NOVICE',
  'CLASS_DESIGNER',
  'INHERITANCE_EXPERT',
  'ARRAY_EXPLORER'
];

const seedAchievements = async () => {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Remove old/deprecated badges
    console.log('🗑️  Removing deprecated badges...');
    const deleteResult = await Achievement.deleteMany({ code: { $in: OLD_BADGES_TO_REMOVE } });
    console.log(`   Removed ${deleteResult.deletedCount} deprecated badges`);

    console.log('🌱 Seeding achievements...');
    await Achievement.seedDefaults();

    const count = await Achievement.countDocuments();
    console.log(`✅ Seeded ${count} achievements successfully!`);

    // List all achievements
    const achievements = await Achievement.find({}).select('code title category xpAward tier');
    console.log('\n📋 Achievement List:');
    console.log('='.repeat(80));
    
    achievements.forEach(a => {
      console.log(`  [${a.tier.padEnd(8)}] ${a.code.padEnd(25)} | ${a.title.padEnd(20)} | ${a.category.padEnd(15)} | +${a.xpAward} XP`);
    });
    
    console.log('='.repeat(80));
    console.log('\n✨ Done!');

  } catch (error) {
    console.error('❌ Error seeding achievements:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

seedAchievements();
