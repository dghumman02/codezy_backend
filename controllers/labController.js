import Course from "../models/Course.js";
import mongoose from "mongoose";

export const createLab = async (req, res) => {
  try {
    const { title, courseId, classId } = req.body;

    if (!title || !courseId || !classId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Find the course and the specific class within it
    const course = await Course.findById(courseId).populate("classes.students");
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Find the class within the course
    const classData = course.classes.id(classId);
    if (!classData) {
      return res.status(404).json({ message: "Class not found in course" });
    }

    // Create new lab object
    const newLab = {
      title,
      marks: req.body.marks || 0,
      description: req.body.description || "",
      instructions: req.body.instructions || "",
      createdBy: {
        id: new mongoose.Types.ObjectId(req.user.userId),
        name: req.user.name || "Teacher"
      },
      status: req.body.status || "Draft",
      difficulty: req.body.difficulty || "Medium",
      startDate: req.body.startDate || new Date(),
      startTime: req.body.startTime || "00:00",
      dueDate: req.body.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      dueTime: req.body.dueTime || "23:59",
      tasks: req.body.tasks || []
    };

    // Add the lab to the class
    classData.labs.push(newLab);
    await course.save();

    // Get the created lab (last one in the array)
    const createdLab = classData.labs[classData.labs.length - 1];

    // TODO: Re-implement notification system here

    res.status(201).json(createdLab);

  } catch (error) {
    console.error("Error creating lab:", error);
    res.status(500).json({ message: "Server error creating lab" });
  }
};

