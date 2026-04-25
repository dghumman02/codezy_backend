import mongoose from "mongoose";

const enrollmentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'GlobalCourse', required: true },
  activeChildCourseId: { type: mongoose.Schema.Types.ObjectId, default: null },
  progress: { type: Number, default: 0 },
  currentModule: { type: String, default: "Introduction" },
  enrolledAt: { type: Date, default: Date.now }
});

export default mongoose.model("Enrollment", enrollmentSchema);