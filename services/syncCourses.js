import Course from "../models/Course.js";
import LearnerCourse from "../models/LearnerCourse.js";
import Institution from "../models/Institution.js"; // Assuming you have an Institution model

/**
 * Sync institution courses into a learner's tenant.
 * Learners see courses from multiple institutions with instructor and institution info.
 *
 * @param {string} learnerTenantId - Tenant ID of the learner
 * @param {string|null} courseId - Optional: specific course to sync
 */
export const syncInstitutionCoursesToLearners = async (learnerTenantId, courseId = null) => {
  try {
    // Fetch all courses or a specific course
    const query = {};
    if (courseId) query._id = courseId;

    const courses = await Course.find(query)
      .populate("classes.teacher", "name")      // Fetch teacher names
      .populate("tenantId", "name")             // Fetch institution name
      .lean();

    console.log(`Sync found courses: ${courses.length} for learner tenant ${learnerTenantId}`);

    for (const course of courses) {
      // Institution / author name
      const institutionName = course.tenantId?.name || "Unknown Institution";

      // Flatten teacher names (one per class)
      const teacherNames = Array.from(
        new Set(course.classes.flatMap(c => c.teacher?.name).filter(Boolean))
      );

      // Count total labs across all classes
      const totalLabs = Array.from(
        new Set(course.classes.flatMap(cls => (cls.labs || []).map(lab => lab._id.toString())))
      ).length;

      // Prepare learner-friendly course object
      const data = {
        courseId: course._id,
        title: course.title,
        instructor: teacherNames.join(", ") || "Unknown Instructor",
        institution: institutionName,
        totalLabs,
        tenantId: learnerTenantId, // Store in learner's tenant
        category: course.category || "Beginner",
        durationWeeks: course.durationWeeks || 4,
        price: course.price || 0,
        thumbnail: course.thumbnail || "https://via.placeholder.com/300x200"
      };

      // Upsert into learner tenant
      const existing = await LearnerCourse.findOne({ tenantId: learnerTenantId, courseId: course._id });
      if (existing) {
        await LearnerCourse.updateOne({ _id: existing._id }, data);
      } else {
        await LearnerCourse.create(data);
      }
    }

    console.log(`Courses synced successfully for learner tenant ${learnerTenantId}`);
  } catch (err) {
    console.error("SYNC ERROR:", err);
  }
};