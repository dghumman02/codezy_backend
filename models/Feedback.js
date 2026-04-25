import mongoose from 'mongoose';

const feedbackSchema = new mongoose.Schema({
  submitterId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  submitterType: {
    type: String,
    enum: ['institution_admin', 'individual_learner'],
    required: true
  },
  submitterName: {
    type: String,
    required: true
  },
  institutionName: {
    type: String,
    default: null   // null for individual learners
  },
  ratings: {
    helpfulness: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    userExperience: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    overall: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    }
  },
  review: {
    type: String,
    maxlength: 1000,
    default: ''
  }
}, { timestamps: true });

const Feedback = mongoose.model('Feedback', feedbackSchema);
export default Feedback;
