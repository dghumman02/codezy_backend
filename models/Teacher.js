import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const teacherSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: [true, "Teacher name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/\S+@\S+\.\S+/, "Please use a valid email address"],
    },
    role: {
      type: String,
      required: [true, "Role/Position is required"],
      trim: true,
    },
    department: {
      type: [String],
      default: [],
    },
    office: {
      type: String,
      default: "",
      trim: true,
    },
    joinDate: {
      type: Date,
      default: null,
    },
    bio: {
      type: String,
      default: "Professional Educator",
      trim: true,
    },
    password: {
      type: String,
      minlength: [6, "Password must be at least 6 characters"],
      default: null,
    },

    // Courses & Classes
    courses: [{
      type: [String],
      default: [],
      ref: "Course",
    }], 
    classes: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ["Active", "On Leave", "Frozen"],
      default: "Active",
    },
    isFrozen: {
      type: Boolean,
      default: false,
    },
    frozenAt: {
      type: Date,
      default: null,
    },
    frozenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institution",
      default: null,
    },
    // Add these to teacherSchema
    twoFactorSecret: { type: String, default: null },
    isTwoFactorEnabled: { type: Boolean, default: false },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
  },
  { timestamps: true }
);
teacherSchema.index({ tenantId: 1, email: 1 }, { unique: true });

// Hash password before saving, only if password is provided
teacherSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  if (!this.password || this.password.trim() === "") {
    return next(new Error("Password cannot be empty"));
  }

  // Prevent double hashing
  if (this.password.startsWith("$2")) return next();

  this.password = await bcrypt.hash(this.password, 10);
  next();
});


// Handle unique email errors nicely
teacherSchema.post("save", function (error, doc, next) {
  if (error.name === "MongoServerError" && error.code === 11000) {
    next(new Error("A teacher with this email already exists."));
  } else {
    next(error);
  }
});

const Teacher = mongoose.model("Teacher", teacherSchema);
export default Teacher;
