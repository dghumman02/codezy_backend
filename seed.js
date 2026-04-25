// seedLearnerCourses.js
import mongoose from "mongoose";
import LearnerCourse from "./models/LearnerCourse.js";

const seedData = [
  {
    title: "Complete Python Programming Bootcamp",
    instructor: "Dr. Emily Chen",
    category: "Beginner",
    durationWeeks: 8,
    totalLabs: 24,
    xpReward: 150,
    price: 64.99
  },
  {
    title: "Modern Web Development with React",
    instructor: "Sarah Thompson",
    category: "Intermediate",
    durationWeeks: 6,
    totalLabs: 18,
    xpReward: 150,
    price: 44.99
  },
  {
    title: "Build a REST API with Node.js",
    instructor: "Codezy Expert",
    category: "Intermediate",
    durationMinutes: 75,
    xpReward: 180,
    price: 0 // "Recommended" usually implies free or part of a sub
  }
];

const seedDB = async () => {
  await mongoose.connect("YOUR_MONGODB_URI");
  await LearnerCourse.insertMany(seedData);
  console.log("Learner Courses Seeded!");
  process.exit();
};

seedDB();