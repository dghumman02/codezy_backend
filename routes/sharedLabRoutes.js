import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import SharedLab from "../models/SharedLab.js";
import Course from "../models/Course.js";

const router = express.Router();

const getAuthContext = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  const token = authHeader.split(" ")[1];
  return jwt.verify(token, process.env.JWT_SECRET);
};

// GET all shared labs for a course
router.get("/course/:courseId", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId } = req.params;
    const { search, author } = req.query;

    // Verify course belongs to tenant
    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Auto-sync: find isShared labs in course classes that have no SharedLab doc yet
    try {
      const existingDocs = await SharedLab.find({ courseId }).select("title authorId").lean();
      const existingKeys = new Set(existingDocs.map(s => `${s.title}__${s.authorId}`));

      const toSync = [];
      for (const cls of course.classes || []) {
        for (const lab of cls.labs || []) {
          if (lab.isShared) {
            const key = `${lab.title}__${lab.createdBy?.id}`;
            if (!existingKeys.has(key)) {
              toSync.push({
                courseId,
                title: lab.title,
                marks: lab.marks || 0,
                description: lab.description || "",
                instructions: lab.instructions || "",
                language: lab.language || "python",
                difficulty: lab.difficulty || "Medium",
                authorId: lab.createdBy?.id || "000000000000000000000000",
                authorName: lab.createdBy?.name || "Teacher",
                tasks: (lab.tasks || []).map(t => ({
                  title: t.title,
                  marks: t.marks || 0,
                  description: t.description || "",
                  language: t.language || "python",
                  testCases: (t.testCases || []).map(tc => ({
                    input: tc.input || "",
                    expectedOutput: tc.expectedOutput || "",
                    comparisonMode: tc.comparisonMode || "Exact",
                    notes: tc.notes || "",
                    isHidden: !!tc.isHidden
                  })),
                  codeConstraints: (t.codeConstraints || []).map(c => ({
                    type: c.type,
                    construct: c.construct,
                    specifics: {
                      minDepth: c.specifics?.minDepth || 0,
                      maxDepth: c.specifics?.maxDepth || 0
                    }
                  }))
                }))
              });
              existingKeys.add(key);
            }
          }
        }
      }

      if (toSync.length > 0) {
        await SharedLab.insertMany(toSync);
        console.log(`[SharedLabs] Auto-synced ${toSync.length} isShared labs for course ${courseId}`);
      }
    } catch (syncErr) {
      console.error("[SharedLabs] Auto-sync error (non-fatal):", syncErr.message);
    }

    const filter = { courseId };

    if (search) {
      filter.title = { $regex: search, $options: "i" };
    }
    if (author) {
      filter.authorId = author;
    }

    const sharedLabs = await SharedLab.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json(sharedLabs);
  } catch (err) {
    console.error("Get shared labs error:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET single shared lab (preview)
router.get("/:sharedLabId", async (req, res) => {
  try {
    getAuthContext(req);
    const { sharedLabId } = req.params;

    const sharedLab = await SharedLab.findById(sharedLabId).lean();
    if (!sharedLab) {
      return res.status(404).json({ message: "Shared lab not found" });
    }

    res.json(sharedLab);
  } catch (err) {
    console.error("Get shared lab error:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST export a lab to shared labs
router.post("/", async (req, res) => {
  try {
    const { tenantId, userId, name } = getAuthContext(req);
    const { courseId, title, marks, description, instructions, difficulty, tasks, language } = req.body;

    if (!courseId || !title || !tasks || tasks.length === 0) {
      return res.status(400).json({ message: "Missing required fields: courseId, title, tasks" });
    }

    // Verify course belongs to tenant
    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const sharedLab = await SharedLab.create({
      courseId,
      title,
      marks: marks || 0,
      description: description || "",
      instructions: instructions || "",
      language: language || "python",
      difficulty: difficulty || "Medium",
      authorId: userId,
      authorName: name || "Teacher",
      tasks: tasks.map(t => ({
        title: t.title,
        marks: t.marks || 0,
        description: t.description || "",
        language: t.language || "python",
        testCases: (t.testCases || []).map(tc => ({
          input: tc.input || "",
          expectedOutput: tc.expectedOutput || "",
          comparisonMode: tc.comparisonMode || "Exact",
          notes: tc.notes || "",
          isHidden: !!tc.isHidden
        })),
        codeConstraints: (t.codeConstraints || []).map(c => ({
          type: c.type,
          construct: c.construct,
          specifics: {
            minDepth: c.specifics?.minDepth || 0,
            maxDepth: c.specifics?.maxDepth || 0
          }
        }))
      }))
    });

    res.status(201).json(sharedLab);
  } catch (err) {
    console.error("Create shared lab error:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE a shared lab (only author can delete)
router.delete("/:sharedLabId", async (req, res) => {
  try {
    const { userId } = getAuthContext(req);
    const { sharedLabId } = req.params;

    const sharedLab = await SharedLab.findById(sharedLabId);
    if (!sharedLab) {
      return res.status(404).json({ message: "Shared lab not found" });
    }

    if (sharedLab.authorId.toString() !== userId) {
      return res.status(403).json({ message: "Only the author can delete a shared lab" });
    }

    await SharedLab.findByIdAndDelete(sharedLabId);
    res.json({ message: "Shared lab deleted" });
  } catch (err) {
    console.error("Delete shared lab error:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET unique authors for a course (for filter dropdown)
router.get("/course/:courseId/authors", async (req, res) => {
  try {
    const { tenantId } = getAuthContext(req);
    const { courseId } = req.params;

    const course = await Course.findOne({ _id: courseId, tenantId }).lean();
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const authors = await SharedLab.aggregate([
      { $match: { courseId: new mongoose.Types.ObjectId(courseId) } },
      { $group: { _id: "$authorId", authorName: { $first: "$authorName" } } },
      { $project: { _id: 0, authorId: "$_id", authorName: 1 } }
    ]);

    res.json(authors);
  } catch (err) {
    console.error("Get authors error:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
