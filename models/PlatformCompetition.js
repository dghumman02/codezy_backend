import mongoose from "mongoose";

const testCaseSchema = new mongoose.Schema({
    input: { type: String, default: '' },
    expectedOutput: { type: String, default: '' },
    comparisonMode: {
        type: String,
        enum: ['Exact', 'IgnoreWhitespace', 'Contains', 'Regex', 'Float'],
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

const platformCompetitionSchema = new mongoose.Schema({
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
    // Platform-level eligibility (no tenantId required)
    eligibility: {
        // 'all' = all institutions, 'none' = no institutions, 'specific' = listed ones
        institutions: {
            type: String,
            enum: ['all', 'none', 'specific'],
            default: 'all'
        },
        tenantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }],
        tenantNames: [{ type: String }],
        // Individual learner eligibility
        allowLearners: { type: Boolean, default: false },
        minLearnerXP: { type: Number, default: 0 },  // 0 = no minimum
        maxLearnerXP: { type: Number, default: 0 }   // 0 = no upper limit
    },
    tasks: {
        type: [taskSchema],
        validate: {
            validator: (v) => v && v.length > 0,
            message: 'A competition must have at least one task.'
        }
    },
    createdBy: {
        id: { type: mongoose.Schema.Types.ObjectId },
        name: { type: String }
    },
    // Learner submissions
    submissions: [{
        learnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        learnerName: { type: String },
        score: { type: Number, default: 0 },         // 0-100 %
        earnedMarks: { type: Number, default: 0 },
        totalMarks: { type: Number, default: 0 },
        submittedAt: { type: Date, default: Date.now },
        taskResults: [{ type: mongoose.Schema.Types.Mixed }]
    }]
}, { timestamps: true });

export default mongoose.model('PlatformCompetition', platformCompetitionSchema);
