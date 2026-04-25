// routes/learnerCourses.js
import express from "express";
import LearnerCourse from "../models/LearnerCourse.js";
import { syncInstitutionCoursesToLearners } from "../services/syncCourses.js";

const router = express.Router();

// GET all learner courses
router.get("/", async (req, res) => {
  try {
    const tenantId = req.query.tenantId; // optional filter by institution
    const courses = await LearnerCourse.find(tenantId ? { tenantId } : {}).lean();
    res.json(courses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;