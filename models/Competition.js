import mongoose from "mongoose";

// Reuse same test case / constraint schemas as Course labs
const testCaseSchema = new mongoose.Schema({
    input: { type: String, default: '' },
    expectedOutput: { type: String, default: '' },
    comparisonMode: {
        type: String,
        enum: ['Exact', 'IgnoreWhitespace', 'Regex'],
        default: 'Exact'
    },
    notes: { type: String, default: '' },
    isHidden: { type: Boolean, default: false }
}, { _id: false });

const specificConstraintSchema = new mongoose.Schema({
    type: { type: String, enum: ['Required', 'Forbidden'], required: true },
    construct: { type: String, required: true },
    specifics: {
        minDepth: { type: Number, default: 0 },
        maxDepth: { type: Number, default: 0 }
    }
}, { _id: false });

const htmlRequiredTagSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    minCount: { type: Number, default: 1 },
    maxCount: { type: Number, default: 0 },
    message: { type: String, default: '' }
}, { _id: false });

const htmlNestingNodeSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    minCount: { type: Number, default: 1 },
    message: { type: String, default: '' },
    children: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { _id: false });

const taskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    marks: { type: Number, required: true },
    description: { type: String, default: '' },
    testCases: [testCaseSchema],
    codeConstraints: { type: [specificConstraintSchema], default: [] },
    htmlRequiredTags: { type: [htmlRequiredTagSchema], default: [] },
    htmlNestingConstraints: { type: [htmlNestingNodeSchema], default: [] }
});

const submissionSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    studentName: { type: String, default: '' },
    rollNumber: { type: String, default: '' },
    score: { type: Number, default: 0 },         // 0-100 percentage
    totalMarks: { type: Number, default: 0 },
    earnedMarks: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now },
    taskResults: [
        {
            taskId: String,
            code: String,
            score: Number,   // 0-10 execution score
            passed: Boolean
        }
    ]
}, { _id: false });

const competitionSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true
    },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    instructions: { type: String, default: '' },
    language: {
        type: String,
        enum: ['python', 'java', 'cpp', 'html'],
        default: 'python'
    },
    difficulty: {
        type: String,
        enum: ['Easy', 'Medium', 'Hard'],
        default: 'Medium'
    },
    totalMarks: { type: Number, required: true },
    startDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    status: {
        type: String,
        enum: ['Draft', 'Active', 'Closed'],
        default: 'Active'
    },
    // Eligibility: which courses & classes can participate (empty arrays = open to all)
    eligibility: {
        courseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
        courseNames: [{ type: String }],
        // Empty array means ALL classes in those courses; otherwise specific class IDs
        classIds: [{ type: mongoose.Schema.Types.ObjectId }],
        classNames: [{ type: String }]
    },
    tasks: {
        type: [taskSchema],
        validate: {
            validator: (v) => v && v.length > 0,
            message: 'A competition must have at least one task.'
        }
    },
    createdBy: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
        name: { type: String }
    },
    submissions: [submissionSchema]
}, { timestamps: true });

export default mongoose.model('Competition', competitionSchema);
