import mongoose from "mongoose";

const institutionSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    select: true,
  },
  type: {
    type: String,
    enum: ['institution', 'individual'],
    required: true
  },
  name: { type: String, required: true },
  adminEmail: { type: String, required: true },
  password: { type: String, required: true, select: false },
  contactPhone: String,
  subscription: {
    plan: { type: String, default: 'free' },
    status: { type: String, default: 'active' },
    startedAt: Date,
    expiresAt: Date
  },
  limits: {
    maxStudents: Number,
    maxTeachers: Number,
    maxCourses: Number
  },
  metadata: {
    country: String,
    timezone: String,
    industry: String
  },
  createdAt: { type: Date, default: Date.now },
  resetPasswordToken: String,
  resetPasswordExpires: Date
});

export default mongoose.model("Institution", institutionSchema);
