import mongoose from "mongoose";

const learnerCourseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  instructor: { type: String, required: true },
  thumbnail: { type: String, default: "https://via.placeholder.com/300x200" },
  category: { 
    type: String, 
    enum: ['Beginner', 'Intermediate', 'Advanced'], 
    default: 'Beginner' 
  },
  xpReward: { type: Number, default: 150 },
  durationMinutes: { type: Number, default: 60 },
  price: { type: Number, default: 0 },
  durationWeeks: { type: Number, default: 4 }, 
  totalLabs: { type: Number, default: 0 },
  rating: { type: Number, default: 4.8 },
  studentsCount: { type: Number, default: 0 },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' } 
}, { timestamps: true });

export default mongoose.model("LearnerCourse", learnerCourseSchema);