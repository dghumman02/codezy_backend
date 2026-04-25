import mongoose from 'mongoose';
import dotenv from 'dotenv';
import LearnerAchievement from './models/LearnerAchievement.js';

dotenv.config();

/**
 * Seed script for Individual Learner Achievements
 * Run with: node seedLearnerAchievements.js
 */

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/codezy';

async function seedLearnerAchievements() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🏆 Seeding Learner Achievements...');
    const count = await LearnerAchievement.seedDefaults();
    
    console.log(`\n✅ Successfully seeded ${count} achievements!`);
    
    // List all seeded achievements by category
    const achievements = await LearnerAchievement.find({ isActive: true }).sort({ category: 1, xpAward: 1 });
    
    console.log('\n📊 Achievement Summary by Category:');
    const categories = {};
    achievements.forEach(ach => {
      if (!categories[ach.category]) {
        categories[ach.category] = [];
      }
      categories[ach.category].push(ach);
    });
    
    for (const [category, badges] of Object.entries(categories)) {
      console.log(`\n  ${category} (${badges.length} badges):`);
      badges.forEach(b => {
        console.log(`    ${b.icon} ${b.title} - ${b.xpAward} XP (${b.tier})`);
      });
    }
    
    console.log('\n🎉 Seeding complete!');
    
  } catch (error) {
    console.error('❌ Error seeding achievements:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

seedLearnerAchievements();
