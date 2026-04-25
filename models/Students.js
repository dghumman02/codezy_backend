import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rollNumber: { type: String, required: true },
  xp: { type: Number, default: 0 },
  role: { type: String, default: 'student' },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  classId: { type: mongoose.Schema.Types.ObjectId },
  isFrozen: { type: Boolean, default: false },
  frozenAt: { type: Date, default: null },
  frozenBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", default: null },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, default: null },
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // ============================================
  // FIREBASE CLOUD MESSAGING (FCM) - Mobile Push
  // ============================================
  // Array to support multiple devices per user
  fcmTokens: [{
    token: { type: String, required: true },
    device: { type: String }, // Optional: device identifier/name
    platform: { 
      type: String, 
      enum: ["android", "ios", "web"],
      default: "android"
    },
    createdAt: { type: Date, default: Date.now },
    lastUsed: { type: Date, default: Date.now }
  }],

  // Push notification preferences
  pushNotificationsEnabled: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });
studentSchema.index({ tenantId: 1, email: 1 }, { unique: true });

const Student = mongoose.model('Student', studentSchema);
export default Student;