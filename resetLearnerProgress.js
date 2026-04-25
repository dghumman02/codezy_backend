import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import LearnerProgress from './models/LearnerProgress.js';
import LearnerCourseProgress from './models/LearnerCourseProgress.js';
import LearnerSubmission from './models/LearnerSubmission.js';
import LearnerEarnedAchievement from './models/LearnerEarnedAchievement.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/codezy';
const LEARNER_EMAIL = 'zille626@gmail.com';

async function resetLearnerProgress() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find the learner
    const learner = await User.findOne({ email: LEARNER_EMAIL });
    if (!learner) {
      console.log(`❌ Learner with email ${LEARNER_EMAIL} not found`);
      return;
    }

    console.log(`📋 Found learner: ${learner.fullName} (${learner.email})`);
    console.log(`   Current XP: ${learner.xp || 0}`);
    console.log(`   Current Streak: ${learner.streak || 0}\n`);

    const learnerId = learner._id;

    // 1. Reset User XP and streak
    console.log('1️⃣ Resetting user XP and streak...');
    await User.updateOne(
      { _id: learnerId },
      { $set: { xp: 0, streak: 0 } }
    );
    console.log('   ✅ User XP and streak reset to 0\n');

    // 2. Delete LearnerProgress
    console.log('2️⃣ Deleting LearnerProgress records...');
    const progressResult = await LearnerProgress.deleteMany({ learnerId });
    console.log(`   ✅ Deleted ${progressResult.deletedCount} LearnerProgress record(s)\n`);

    // 3. Delete LearnerCourseProgress (module/lab completion tracking)
    console.log('3️⃣ Deleting LearnerCourseProgress records...');
    const courseProgressResult = await LearnerCourseProgress.deleteMany({ learnerId });
    console.log(`   ✅ Deleted ${courseProgressResult.deletedCount} LearnerCourseProgress record(s)\n`);

    // 4. Delete LearnerSubmission (lab submissions)
    console.log('4️⃣ Deleting LearnerSubmission records...');
    const submissionResult = await LearnerSubmission.deleteMany({ learnerId });
    console.log(`   ✅ Deleted ${submissionResult.deletedCount} LearnerSubmission record(s)\n`);

    // 5. Delete earned achievements
    console.log('5️⃣ Deleting earned achievements...');
    const achievementResult = await LearnerEarnedAchievement.deleteMany({ learnerId });
    console.log(`   ✅ Deleted ${achievementResult.deletedCount} earned achievement(s)\n`);

    // Verify subscription is still intact
    console.log('6️⃣ Verifying subscription status...');
    const updatedLearner = await User.findById(learnerId).select('subscription email fullName xp streak');
    console.log(`   📧 Email: ${updatedLearner.email}`);
    console.log(`   👤 Name: ${updatedLearner.fullName}`);
    console.log(`   ⭐ XP: ${updatedLearner.xp || 0}`);
    console.log(`   🔥 Streak: ${updatedLearner.streak || 0}`);
    console.log(`   💳 Subscription: ${updatedLearner.subscription?.status || 'N/A'}`);
    console.log(`   📅 Plan: ${updatedLearner.subscription?.plan || 'N/A'}\n`);

    console.log('🎉 Learner progress reset complete!');
    console.log('   - All XP removed');
    console.log('   - All lab submissions deleted');
    console.log('   - All course progress deleted');
    console.log('   - All achievements removed');
    console.log('   - Subscription preserved');

  } catch (error) {
    console.error('❌ Error resetting learner progress:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

resetLearnerProgress();
