import express from 'express';
import GlobalCourse from '../models/GlobalCourse.js';
import LearnerCourseProgress from '../models/LearnerCourseProgress.js';
import uploadVideo from "../middleware/uploadVideo.js";
import uploadThumbnail from "../middleware/uploadThumbnail.js";
import { uploadToCloudinary } from "../config/cloudinary.js";

const router = express.Router();

// UPLOAD THUMBNAIL IMAGE
router.post("/global-courses/upload-thumbnail", uploadThumbnail.single("thumbnail"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "codezy/thumbnails",
      resource_type: "image",
    });
    res.status(200).json({ message: "Success", thumbnailUrl: result.secure_url });
  } catch (err) {
    console.error("Thumbnail Upload Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/global-courses/upload-video", uploadVideo.single("video"), async (req, res) => {
  try {
    const { courseId, moduleId, lessonId } = req.body;
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const uploadResult = await uploadToCloudinary(req.file.buffer, {
      folder: "codezy/videos",
      resource_type: "video",
    });
    const videoUrl = uploadResult.secure_url;
    const { ObjectId } = await import('mongodb');
    const collection = GlobalCourse.collection;

    const course = await GlobalCourse.findById(courseId).lean();
    if (!course) return res.status(404).json({ message: "Course not found" });

    const findIndices = (modules, moduleId, lessonId) => {
      // Extract fallback index from generated IDs like "lesson-0-1234567890"
      const fallbackMatch = lessonId?.match(/^lesson-(\d+)-\d+$/);
      const fallbackLessonIdx = fallbackMatch ? parseInt(fallbackMatch[1]) : null;

      for (let mi = 0; mi < modules.length; mi++) {
        const mod = modules[mi];
        const modMatches = mod.id === moduleId || String(mod._id) === moduleId;

        if (modMatches) {
          const lessons = mod.lessons || [];

          // Lesson has a real ID — match by it
          if (fallbackLessonIdx === null) {
            for (let li = 0; li < lessons.length; li++) {
              if (lessons[li].id === lessonId || String(lessons[li]._id) === lessonId) {
                return { mi, li };
              }
            }
          }

          // Lesson has no ID in DB — use the index encoded in the fallback ID
          if (fallbackLessonIdx !== null && fallbackLessonIdx < lessons.length) {
            return { mi, li: fallbackLessonIdx };
          }
        }
      }
      return null;
    };
    let updatePath = null;

    if (course.isSpecialization) {
      for (let ci = 0; ci < (course.childCourses || []).length; ci++) {
        const child = course.childCourses[ci];
        const result = findIndices(child.modules || [], moduleId, lessonId);
        if (result) {
          updatePath = `childCourses.${ci}.modules.${result.mi}.lessons.${result.li}.videoUrl`;
          break;
        }
      }
    } else {
      const result = findIndices(course.modules || [], moduleId, lessonId);
      if (result) {
        updatePath = `modules.${result.mi}.lessons.${result.li}.videoUrl`;
      }
    }

    if (!updatePath) {
      console.error("Could not find lesson. moduleId:", moduleId, "lessonId:", lessonId);
      // Log actual DB structure for debugging
      if (course.isSpecialization) {
        course.childCourses?.forEach((cc, ci) => {
          (cc.modules || []).forEach((mod, mi) => {
            console.log(`CC[${ci}] mod[${mi}] id="${mod.id}" _id="${mod._id}"`);
            (mod.lessons || []).forEach((l, li) => {
              console.log(`  lesson[${li}] id="${l.id}" _id="${l._id}" title="${l.title}"`);
            });
          });
        });
      } else {
        (course.modules || []).forEach((mod, mi) => {
          console.log(`mod[${mi}] id="${mod.id}" _id="${mod._id}"`);
          (mod.lessons || []).forEach((l, li) => {
            console.log(`  lesson[${li}] id="${l.id}" _id="${l._id}" title="${l.title}"`);
          });
        });
      }
      return res.status(404).json({ message: "Lesson not found in DB", moduleId, lessonId });
    }

    console.log("Updating path:", updatePath);
    await collection.updateOne(
      { _id: new ObjectId(courseId) },
      { $set: { [updatePath]: videoUrl } }
    );

    res.status(200).json({ message: "Success", videoUrl });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// SAVE / CREATE COURSE
router.post("/global-courses", async (req, res) => {
  try {
    const data = req.body;

    // Ensure all lessons have an id field before saving to DB
    const ensureLessonIds = (modules) =>
      (modules || []).map(mod => ({
        ...mod,
        id: mod.id || String(mod._id) || Date.now().toString(),
        lessons: (mod.lessons || []).map((lesson, li) => ({
          ...lesson,
          id: lesson.id || String(lesson._id) || `${Date.now()}-${li}`
        }))
      }));

    if (data.isSpecialization && data.childCourses?.length > 0) {
      data.childCourses = data.childCourses.map(cc => ({
        ...cc,
        modules: ensureLessonIds(cc.modules || [])
      }));
    } else {
      data.modules = ensureLessonIds(data.modules || []);
    }

    // Update if _id exists, create if not
    let course;
    if (data._id) {
      course = await GlobalCourse.findByIdAndUpdate(data._id, data, { new: true, upsert: false });
    } else {
      course = await GlobalCourse.create(data);
    }

    res.json({ message: "Saved", data: course });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ message: "Save failed", error: err.message });
  }
});
// ==========================================
// 2. FETCH ALL (For the Global Courses Page)
// ==========================================
router.get("/global-courses", async (req, res) => {
  try {
    const courses = await GlobalCourse.find().sort({ createdAt: -1 }).lean();
    const courseIds = courses.map(c => c._id);
    const enrollmentAgg = await LearnerCourseProgress.aggregate([
      { $match: { courseId: { $in: courseIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } }
    ]);
    const enrollmentMap = {};
    enrollmentAgg.forEach(e => { enrollmentMap[e._id.toString()] = e.count; });
    const coursesWithCount = courses.map(c => ({
      ...c,
      enrollmentCount: enrollmentMap[c._id.toString()] || 0
    }));
    res.json(coursesWithCount);
  } catch (err) {
    res.status(500).json({ message: "Error fetching courses" });
  }
});

// 3. BULK DELETE (Add this before the single delete)
router.post("/global-courses/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body; // Expecting an array of IDs
    await GlobalCourse.deleteMany({ _id: { $in: ids } });
    res.json({ message: `${ids.length} courses deleted successfully` });
  } catch (err) {
    res.status(500).json({ message: "Bulk delete failed" });
  }
});

// 4. DELETE SINGLE COURSE
router.delete("/global-courses/:id", async (req, res) => {
  try {
    await GlobalCourse.findByIdAndDelete(req.params.id);
    res.json({ message: "Course permanently deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

// FETCH SINGLE COURSE BY ID (Required for Editing)
router.get("/global-courses/:id", async (req, res) => {
  try {
    // .populate('childCourses') converts IDs back into full objects for the editor
    const course = await GlobalCourse.findById(req.params.id).populate('childCourses');
    if (!course) return res.status(404).json({ message: "Not found" });
    res.json(course);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ATOMIC DELETE MODULE ---
router.delete("/global-courses/:courseId/modules/:moduleId", async (req, res) => {
  try {
    await GlobalCourse.findByIdAndUpdate(req.params.courseId, {
      $pull: { modules: { _id: req.params.moduleId } }
    });
    res.json({ message: "Module removed from database" });
  } catch (err) { res.status(500).json({ message: "Atomic delete failed" }); }
});

// ATOMIC DELETE LESSON ---
router.delete("/global-courses/:courseId/lesson/:lessonId", async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    
    // This query pulls the lesson regardless of whether it's in a top-level module 
    // or a submodule, as long as the ID matches.
    await GlobalCourse.findByIdAndUpdate(courseId, {
      $pull: {
        "modules.$[].lessons": { id: lessonId },
        "modules.$[].subModules.$[].lessons": { id: lessonId }
      }
    });

    res.json({ message: "Lesson removed" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: err.message });
  }
});

export default router;