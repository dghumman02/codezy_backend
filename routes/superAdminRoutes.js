import express from 'express';
import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Student from '../models/Students.js';
import Teacher from '../models/Teacher.js';
import Institution from '../models/Institution.js';
import User from '../models/User.js';
import GlobalCourse from '../models/GlobalCourse.js';
import LearnerCourseProgress from '../models/LearnerCourseProgress.js';

const router = express.Router();

// ======================== ORPHANED STUDENTS DIAGNOSTIC ========================
router.get("/superadmin/orphaned-students", async (req, res) => {
  try {
    // Get all students
    const allStudents = await Student.find().select('_id email name tenantId').lean();
    
    // Get all student IDs that are referenced in any class
    const courses = await Course.find().lean();
    const enrolledStudentIds = new Set();
    
    courses.forEach(course => {
      (course.classes || []).forEach(cls => {
        (cls.students || []).forEach(studentId => {
          enrolledStudentIds.add(studentId.toString());
        });
      });
    });
    
    // Find orphaned students (exist in Students collection but not in any class)
    const orphanedStudents = allStudents.filter(
      student => !enrolledStudentIds.has(student._id.toString())
    );
    
    res.json({
      totalStudents: allStudents.length,
      enrolledStudents: enrolledStudentIds.size,
      orphanedCount: orphanedStudents.length,
      orphanedStudents: orphanedStudents.map(s => ({
        _id: s._id,
        email: s.email,
        name: s.name,
        tenantId: s.tenantId
      }))
    });
  } catch (err) {
    console.error("Orphaned students check error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ======================== CLEANUP ORPHANED STUDENTS ========================
router.delete("/superadmin/cleanup-orphaned-students", async (req, res) => {
  try {
    // Get all student IDs that are referenced in any class
    const courses = await Course.find().lean();
    const enrolledStudentIds = new Set();
    
    courses.forEach(course => {
      (course.classes || []).forEach(cls => {
        (cls.students || []).forEach(studentId => {
          enrolledStudentIds.add(studentId.toString());
        });
      });
    });
    
    // Find and delete orphaned students
    const allStudents = await Student.find().select('_id email').lean();
    const orphanedIds = allStudents
      .filter(student => !enrolledStudentIds.has(student._id.toString()))
      .map(s => s._id);
    
    if (orphanedIds.length === 0) {
      return res.json({ message: "No orphaned students found", deletedCount: 0 });
    }
    
    const deleteResult = await Student.deleteMany({ _id: { $in: orphanedIds } });
    
    console.log(`[Cleanup] Deleted ${deleteResult.deletedCount} orphaned students`);
    
    res.json({
      message: "Orphaned students cleaned up successfully",
      deletedCount: deleteResult.deletedCount,
      deletedIds: orphanedIds
    });
  } catch (err) {
    console.error("Cleanup orphaned students error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ======================== CLEANUP STALE STUDENT REFERENCES ========================
router.delete("/superadmin/cleanup-stale-references", async (req, res) => {
  try {
    // Get all valid student IDs
    const allStudents = await Student.find().select('_id').lean();
    const validStudentIds = new Set(allStudents.map(s => s._id.toString()));
    
    // Find courses with stale references
    const courses = await Course.find().lean();
    let totalRemoved = 0;
    
    for (const course of courses) {
      let courseModified = false;
      
      for (const cls of (course.classes || [])) {
        const originalCount = (cls.students || []).length;
        const validStudents = (cls.students || []).filter(
          studentId => validStudentIds.has(studentId.toString())
        );
        
        if (validStudents.length < originalCount) {
          // Update this class to remove stale references
          await Course.updateOne(
            { _id: course._id, "classes._id": cls._id },
            { $set: { "classes.$.students": validStudents } }
          );
          totalRemoved += (originalCount - validStudents.length);
          console.log(`[Cleanup] Removed ${originalCount - validStudents.length} stale refs from class ${cls.name}`);
        }
      }
    }
    
    res.json({
      message: totalRemoved > 0 
        ? `Cleaned up ${totalRemoved} stale student references` 
        : "No stale references found",
      removedCount: totalRemoved
    });
  } catch (err) {
    console.error("Cleanup stale references error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ======================== CONSOLIDATED SUPER ADMIN DASHBOARD ========================
router.get("/superadmin/dashboard-stats", async (req, res) => {
  try {
    // 1. Fetch Global Counts for Summary Cards
    const [instCount, individualCount, allCourses, globalCoursesRaw] = await Promise.all([
      Institution.countDocuments(),
      User.countDocuments({ role: "individual_learner" }),
      Course.find().lean(),
      GlobalCourse.find().sort({ createdAt: -1 }).limit(4).lean()
    ]);

    // Count real subscribers per global course from LearnerCourseProgress
    const globalCourseIds = globalCoursesRaw.map(c => c._id);
    const enrollmentAgg = await LearnerCourseProgress.aggregate([
      { $match: { courseId: { $in: globalCourseIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } }
    ]);
    const enrollmentMap = {};
    enrollmentAgg.forEach(e => { enrollmentMap[e._id.toString()] = e.count; });

    // 2. Format Institution List (Top 10)
    // We use your aggregation logic here to get accurate counts per institution
    const institutions = await Institution.aggregate([
      { $limit: 10 },
      {
        $lookup: {
          from: 'students', // Collection name for Students
          localField: 'tenantId',
          foreignField: 'tenantId',
          as: 'students'
        }
      },
      {
        $lookup: {
          from: 'teachers', // Collection name for Teachers
          localField: 'tenantId',
          foreignField: 'tenantId',
          as: 'teachers'
        }
      },
      {
        $lookup: {
          from: 'courses', // Collection name for Courses
          localField: 'tenantId',
          foreignField: 'tenantId',
          as: 'courses'
        }
      },
      {
        $project: {
          name: 1,
          students: { $size: "$students" },
          teachers: { $size: "$teachers" },
          courses: { $size: "$courses" }
        }
      }
    ]);

    // 3. Format Course Performance Tracking (Institution + Global courses)
    const formattedInstitutionCourses = allCourses.map(course => {
      let totalLabs = 0;
      let studentSet = new Set();

      course.classes?.forEach(cls => {
        totalLabs += cls.labs?.length || 0;
        cls.students?.forEach(s => studentSet.add(s.toString()));
      });

      return {
        title: course.title,
        lectures: totalLabs,
        students: studentSet.size
      };
    }).slice(0, 4);

    // Format Global Courses (Codezy Official Track)
    const formattedGlobalCourses = globalCoursesRaw.map(course => {
      const totalLessons = course.modules?.reduce((acc, mod) => acc + (mod.lessons?.length || 0), 0) || 0;
      return {
        title: course.title,
        lectures: totalLessons,
        students: enrollmentMap[course._id.toString()] || 0
      };
    });

    // 4. Final Unified Response
    res.json({
      summary: {
        institutions: instCount,
        individuals: individualCount,
        activeUsers: individualCount
      },
      institutions: institutions,
      individualCourses: formattedGlobalCourses.length > 0 ? formattedGlobalCourses : formattedInstitutionCourses
    });

  } catch (err) {
    console.error("SUPERADMIN DASHBOARD ERROR:", err);
    res.status(500).json({ message: "Server error fetching dashboard data" });
  }
});

export default router;