import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/codezy';

async function checkCollections() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Check users collection
    const users = await mongoose.connection.db.collection('users').find({}).toArray();
    console.log(`=== USERS (${users.length}) ===`);
    users.forEach(u => {
      console.log(`  ${u.email} | ${u.fullName} | role: ${u.role} | xp: ${u.xp || 0}`);
    });

    // Check learner progress
    const progress = await mongoose.connection.db.collection('learnerprogresses').find({}).toArray();
    console.log(`\n=== LEARNER PROGRESS (${progress.length}) ===`);
    progress.forEach(p => {
      console.log(`  LearnerId: ${p.learnerId}`);
      console.log(`    Labs: ${p.totalLabsCompleted || 0}, Streak: ${p.streak?.current || 0}`);
    });

    // Check learner submissions
    const submissions = await mongoose.connection.db.collection('learnersubmissions').find({}).toArray();
    console.log(`\n=== LEARNER SUBMISSIONS (${submissions.length}) ===`);
    submissions.slice(0, 5).forEach(s => {
      console.log(`  LearnerId: ${s.learnerId}, Score: ${s.score}`);
    });

    // Check earned achievements  
    const earned = await mongoose.connection.db.collection('learnerearnedachievements').find({}).toArray();
    console.log(`\n=== EARNED ACHIEVEMENTS (${earned.length}) ===`);
    earned.forEach(e => {
      console.log(`  LearnerId: ${e.learnerId}, Code: ${e.achievementCode}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkCollections();
