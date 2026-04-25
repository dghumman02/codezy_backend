import mongoose from "mongoose";

const testCaseSchema = new mongoose.Schema({
  input: { type: String, default: '' },
  expectedOutput: { type: String, default: '' },
  comparisonMode: {
    type: String,
    enum: ['Exact', 'IgnoreWhitespace', 'Regex', 'Contains', 'Float'],
    default: 'Exact'
  },
  notes: { type: String, default: '' },
  isHidden: { type: Boolean, default: false }
}, { _id: false });

const specificConstraintSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Required', 'Forbidden'],
    required: true
  },
  construct: {
    type: String,
    required: true
  },
  specifics: {
    minDepth: { type: Number, default: 0 },
    maxDepth: { type: Number, default: 0 },
  },
}, { _id: false });

// HTML Required Tag constraint (flat rule)
const htmlRequiredTagSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    minCount: { type: Number, default: 1 },
    maxCount: { type: Number, default: 0 },
    message: { type: String, default: '' }
}, { _id: false });

// HTML Nesting constraint node (recursive tree via Mixed)
const htmlNestingNodeSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    minCount: { type: Number, default: 1 },
    message: { type: String, default: '' },
    children: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { _id: false });

const sharedTaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  marks: { type: Number, required: true },
  description: { type: String },
  language: {
    type: String,
    enum: ['python', 'java', 'cpp', 'html'],
    default: 'python'
  },
  testCases: [testCaseSchema],
  codeConstraints: {
    type: [specificConstraintSchema],
    default: []
  },
  htmlRequiredTags: {
    type: [htmlRequiredTagSchema],
    default: []
  },
  htmlNestingConstraints: {
    type: [htmlNestingNodeSchema],
    default: []
  }
});

const sharedLabSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
    index: true
  },
  title: { type: String, required: true },
  marks: { type: Number, required: true },
  description: { type: String },
  instructions: { type: String },
  language: {
    type: String,
    enum: ['python', 'java', 'cpp', 'html'],
    default: 'python'
  },
  difficulty: {
    type: String,
    enum: ["Easy", "Medium", "Hard"],
    default: "Medium"
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Teacher",
    required: true
  },
  authorName: { type: String, required: true },
  tasks: {
    type: [sharedTaskSchema],
    validate: {
      validator: function (v) {
        return v && v.length > 0;
      },
      message: 'A shared lab must contain at least one task.'
    }
  }
}, { timestamps: true });

sharedLabSchema.index({ courseId: 1, createdAt: -1 });

export default mongoose.model("SharedLab", sharedLabSchema);
