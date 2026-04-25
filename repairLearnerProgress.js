import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/codezy';

async function repair() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // Get all LearnerProgress docs
  const progressDocs = await db.collection('learnerprogresses').find({}).toArray();
  console.log(`Found ${progressDocs.length} LearnerProgress documents\n`);

  for (const progress of progressDocs) {
    const learnerId = progress.learnerId;
    console.log(`=== Learner: ${learnerId} ===`);
    console.log(`  Current stats: labs=${progress.totalLabsCompleted}, modules=${progress.totalModulesCompleted}, courses=${progress.totalCoursesCompleted}, quizzes=${progress.totalQuizzesTaken}`);
    console.log(`  Perfect: labs=${progress.perfectLabsCompleted}, quizzes=${progress.perfectQuizzes}`);
    console.log(`  CompletedLabs array: ${(progress.completedLabs || []).length} entries`);
    console.log(`  CompletedModuleIds array: ${(progress.completedModuleIds || []).length} entries`);

    // Get all learner submissions from LearnerSubmission collection
    const submissions = await db.collection('learnersubmissions').find({
      learnerId: new mongoose.Types.ObjectId(learnerId)
    }).toArray();

    const labSubmissions = submissions.filter(s => s.lessonType === 'lab');
    const quizSubmissions = submissions.filter(s => s.lessonType === 'quiz');

    console.log(`  Actual submissions in DB: ${labSubmissions.length} labs, ${quizSubmissions.length} quizzes`);

    // Get course progress to count completed modules
    const courseProgresses = await db.collection('learnercourseprogresses').find({
      learnerId: new mongoose.Types.ObjectId(learnerId)
    }).toArray();

    let actualModulesCompleted = 0;
    const moduleKeys = [];
    let actualCoursesCompleted = 0;

    for (const cp of courseProgresses) {
      // Check child courses
      if (cp.childCourses && cp.childCourses.length > 0) {
        for (const child of cp.childCourses) {
          for (const mod of (child.modules || [])) {
            if (mod.isCompleted) {
              actualModulesCompleted++;
              moduleKeys.push(`${cp.courseId}_${mod.moduleId}`);
            }
          }
          if (child.isCompleted) {
            actualCoursesCompleted++;
          }
        }
      }
      // Check regular modules
      for (const mod of (cp.modules || [])) {
        if (mod.isCompleted) {
          actualModulesCompleted++;
          moduleKeys.push(`${cp.courseId}_${mod.moduleId}`);
        }
      }
      if (cp.isCompleted) {
        actualCoursesCompleted++;
      }
    }

    console.log(`  Actual completed modules: ${actualModulesCompleted}`);
    console.log(`  Actual completed courses: ${actualCoursesCompleted}`);

    // Build correct completedLabs array from submissions
    const correctLabs = [];
    let perfectLabCount = 0;
    for (const lab of labSubmissions) {
      correctLabs.push({
        labId: String(lab.lessonId),
        courseId: String(lab.courseId),
        score: lab.bestScore || lab.score || 0,
        xpEarned: lab.xpEarned || 0,
        completedAt: lab.updatedAt || lab.createdAt || new Date()
      });
      if ((lab.bestScore || lab.score || 0) >= 10) {
        perfectLabCount++;
      }
    }

    // Count perfect quizzes
    let perfectQuizCount = 0;
    for (const quiz of quizSubmissions) {
      if ((quiz.bestScore || quiz.score || 0) >= 10) {
        perfectQuizCount++;
      }
    }

    console.log(`  Corrected: labs=${labSubmissions.length}, perfectLabs=${perfectLabCount}, modules=${actualModulesCompleted}, quizzes=${quizSubmissions.length}, perfectQuizzes=${perfectQuizCount}`);

    // Apply corrections
    const updateResult = await db.collection('learnerprogresses').updateOne(
      { _id: progress._id },
      {
        $set: {
          totalLabsCompleted: labSubmissions.length,
          perfectLabsCompleted: perfectLabCount,
          totalModulesCompleted: actualModulesCompleted,
          totalCoursesCompleted: actualCoursesCompleted,
          totalQuizzesTaken: quizSubmissions.length,
          perfectQuizzes: perfectQuizCount,
          completedLabs: correctLabs,
          completedModuleIds: moduleKeys,
          firstLabCompleted: labSubmissions.length > 0,
          firstQuizCompleted: quizSubmissions.length > 0,
          firstModuleCompleted: actualModulesCompleted > 0,
          firstCodeSubmitted: labSubmissions.length > 0
        }
      }
    );

    console.log(`  Updated: ${updateResult.modifiedCount > 0 ? 'YES' : 'no changes needed'}\n`);
  }

  await mongoose.disconnect();
  console.log('Done! Disconnected from MongoDB.');
}

repair().catch(err => {
  console.error('Repair failed:', err);
  process.exit(1);
});
