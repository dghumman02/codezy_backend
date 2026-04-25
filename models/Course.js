import mongoose from "mongoose";

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
    maxCount: { type: Number, default: 0 }, // 0 = no max
    message: { type: String, default: '' }
}, { _id: false });

// HTML Nesting constraint node (recursive tree via Mixed)
const htmlNestingNodeSchema = new mongoose.Schema({
    tag: { type: String, required: true },
    minCount: { type: Number, default: 1 },
    message: { type: String, default: '' },
    children: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { _id: false });

const taskSchema = new mongoose.Schema({
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
    // HTML-specific constraints
    htmlRequiredTags: {
        type: [htmlRequiredTagSchema],
        default: []
    },
    htmlNestingConstraints: {
        type: [htmlNestingNodeSchema],
        default: []
    }
});

const labSchema = new mongoose.Schema({
    title: { type: String, required: true },
    marks: { type: Number, required: true }, 
    description: { type: String },
    instructions: { type: String },
    language: {
        type: String,
        enum: ['python', 'java', 'cpp', 'html'],
        default: 'python'
    },
    isShared: { type: Boolean, default: false },
    createdBy: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher" },
        name: { type: String }
    },
    status: {
        type: String,
        enum: ["Draft","Active", "Closed"],
        default: "Draft"
    },
    difficulty: { 
        type: String, 
        enum: ["Easy", "Medium", "Hard"], 
        default: "Medium" 
    },
    progressStatus: {
        type: String,
        enum: ["Pending", "Completed"],
        default: "Pending"
    },
    startDate: { type: Date, required: true },     
    startTime: { type: String, required: true },
    dueDate: { type: Date, required: true },
    dueTime: { type: String, required: true }, 
    submissions: [
        {
            studentId: {
                type: mongoose.Schema.Types.ObjectId, 
                ref: 'Student',
                required: true
            },
            submittedAt: {
                type: Date,
                default: Date.now
            },
            xp: {
                type: Number,
                default: 0
            },
            averageScore: {
                type: Number,
                default: 0
            },
            status: {
                type: String,
                enum: ["Submitted", "Not Submitted"],
                default: "Submitted"
            },
            code: {
                type: String,
                required: true 
            },
            isLate: {
                type: Boolean,
                default: false
            },
            results: [
                {
                    taskId: String,
                    code: String,
                    language: String,
                    passed: Boolean,
                    score: Number
                }
            ]
        }
    ],
    tasks: { 
        type: [taskSchema], 
        validate: {
            validator: function(v) {
                return v && v.length > 0;
            },
            message: 'A lab must contain at least one task.'
        }
    } 
});

const classSchema = new mongoose.Schema({
    name: { type: String, required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    labs: [labSchema], 
});

const courseSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        index: true
    },
    title: { type: String, required: true },
    courseCode: { type: String, required: true},
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    classes: [classSchema], 
}, { timestamps: true });

courseSchema.index(
    { tenantId: 1, courseCode: 1 },
    { unique: true }
);

export default mongoose.model("Course", courseSchema);
