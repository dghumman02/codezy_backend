import mongoose from 'mongoose';

/* ===========================
   Test Case Schema
=========================== */
/* Update in TestCaseSchema */
const TestCaseSchema = new mongoose.Schema({
  input: { type: String },
  expectedOutput: { type: String },
  comparisonMode: { 
    type: String, 
    enum: ['Exact', 'Contains', 'Regex', 'Float'], 
    default: 'Exact' 
  }, // Add this line
  isHidden: { type: Boolean, default: false },
  weight: { type: Number, default: 1 }
}, { _id: false });


/* ===========================
   Quiz Question Schema
=========================== */
const QuizQuestionSchema = new mongoose.Schema({
  question: { type: String },
  options: [{ type: String }],
  correctAnswer: { type: Number },               // index of correct option
  explanation: { type: String }
}, { _id: false });


/* ===========================
   Lab Configuration Schema
=========================== */
const HtmlRequiredTagSchema = new mongoose.Schema({
  tag: { type: String, required: true },
  minCount: { type: Number, default: 1 },
  maxCount: { type: Number, default: 0 },
  message: { type: String, default: '' }
}, { _id: false });

const HtmlNestingNodeSchema = new mongoose.Schema({
  tag: { type: String, required: true },
  minCount: { type: Number, default: 1 },
  message: { type: String, default: '' },
  children: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { _id: false });

const LabConfigSchema = new mongoose.Schema({
  problemStatement: String,
  code: String,
  language: { type: String, default: 'nodejs' },
  testCases: [TestCaseSchema],
  // Update this to match your new Sliders logic
  codeConstraints: [{
    id: String,
    type: { type: String, enum: ['Required', 'Forbidden'] },
    construct: String,
    specifics: {
      minDepth: Number,
      maxDepth: Number
    }
  }],
  // HTML-specific constraints
  htmlRequiredTags: {
    type: [HtmlRequiredTagSchema],
    default: []
  },
  htmlNestingConstraints: {
    type: [HtmlNestingNodeSchema],
    default: []
  }
}, { _id: false });


/* ===========================
   Lesson Schema
=========================== */
const LessonSchema = new mongoose.Schema({
  id: String, // Unique lesson identifier — persisted so submissions can reference it
  title: { type: String, required: true },

  type: { 
    type: String, 
    enum: ['video', 'lab', 'quiz', 'document'], 
    required: true 
  },

  videoUrl: { type: String },

  // Keep external Lab reference (YOU REQUESTED NOT TO REMOVE)
  labId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Lab' 
  },

  // Embedded lab configuration (optional)
  labConfig: LabConfigSchema,

  studyMaterial: { type: String },

  // Multiple quiz questions supported
  quizData: [QuizQuestionSchema]

}, { _id: false });


/* ===========================
   Module Schema
=========================== */
const ModuleSchema = new mongoose.Schema({
  id: String, // To match Date.now() from frontend
  title: { type: String, required: true },
  isCourseWrapper: { type: Boolean, default: false }, // New
  lessons: [LessonSchema],
  // This allows the "Course > Module" nesting
  subModules: [new mongoose.Schema({
    id: String,
    title: String,
    lessons: [LessonSchema]
  }, { _id: false })] 
}, { _id: false });


/* ===========================
   Main Global Course Schema
=========================== */
const GlobalCourseSchema = new mongoose.Schema({

  title: { type: String, required: true },
  description: { type: String, required: true },

  domain: { 
    type: String, 
    required: true,
    enum: [
      'Web Development',
      'Mobile App Development',
      'Data Science',
      'Machine Learning',
      'Cybersecurity',
      'Cloud Computing',
      'DevOps',
      'Blockchain',
      'Game Development',
      'Software Engineering',
      'Artificial Intelligence',
      'Data Engineering',
      'System Design'
    ]
  },

  difficulty: { 
    type: String, 
    enum: ['Beginner', 'Intermediate', 'Advanced', 'Specialization'], 
    default: 'Beginner' 
  },
  instructor: {
  type: String,
  required: true
},

price: {
  type: Number,
  default: 0
},

duration: {
  type: String // Example: "8 weeks", "12 hours"
},

thumbnail: {
  type: String
},
  /* ===========================
     Specialization Support
  =========================== */
  isSpecialization: { type: Boolean, default: false },

  childCourses: [new mongoose.Schema({
    title: String,
    description: String,
    modules: [ModuleSchema], // These are the modules for that specific internal course
    difficulty: String,
    order: Number
}, { _id: true })],

  /* ===========================
     Authorship
  =========================== */
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'SuperAdmin' 
  },

  /* ===========================
     Curriculum Tree
  =========================== */
  modules: [ModuleSchema],

  /* ===========================
     Publishing & Analytics
  =========================== */
  isPublished: { type: Boolean, default: true },
  enrollmentCount: { type: Number, default: 0 }

}, { timestamps: true });


export default mongoose.model('GlobalCourse', GlobalCourseSchema);