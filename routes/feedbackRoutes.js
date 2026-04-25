import express from 'express';
import auth from '../middleware/auth.js';
import Feedback from '../models/Feedback.js';
import Institution from '../models/Institution.js';
import User from '../models/User.js';

const router = express.Router();

// POST /api/feedback  — submit feedback (institution_admin or individual_learner)
router.post('/', auth, async (req, res) => {
    try {
        const { role, userId, tenantId } = req.user;

        if (role !== 'institution_admin' && role !== 'individual_learner') {
            return res.status(403).json({ message: 'Only institution admins and individual learners can submit feedback.' });
        }

        const { ratings, review } = req.body;

        // Validate ratings
        if (!ratings || typeof ratings.helpfulness !== 'number' ||
            typeof ratings.userExperience !== 'number' ||
            typeof ratings.overall !== 'number') {
            return res.status(400).json({ message: 'All three rating fields are required (1-5).' });
        }

        for (const key of ['helpfulness', 'userExperience', 'overall']) {
            const v = ratings[key];
            if (v < 1 || v > 5) return res.status(400).json({ message: `${key} rating must be between 1 and 5.` });
        }

        let submitterName = '';
        let institutionName = null;

        if (role === 'institution_admin') {
            // Look up institution by tenantId to get its name
            const inst = await Institution.findOne({ tenantId }).select('name').lean();
            institutionName = inst?.name || 'Unknown Institution';
            submitterName = req.body.submitterName || institutionName + ' Admin';
        } else {
            // individual_learner — look up User for name
            const user = await User.findById(userId).select('fullName').lean();
            submitterName = user?.fullName || 'Learner';
        }

        // Check if already submitted (one feedback per user)
        const existing = await Feedback.findOne({ submitterId: userId });
        if (existing) {
            // Update existing feedback
            existing.ratings = ratings;
            existing.review = (review || '').slice(0, 1000);
            existing.submitterName = submitterName;
            existing.institutionName = institutionName;
            await existing.save();
            return res.json({ message: 'Feedback updated successfully.', feedback: existing });
        }

        const feedback = new Feedback({
            submitterId: userId,
            submitterType: role,
            submitterName,
            institutionName,
            ratings,
            review: (review || '').slice(0, 1000)
        });

        await feedback.save();
        res.status(201).json({ message: 'Feedback submitted successfully.', feedback });
    } catch (err) {
        console.error('Feedback submit error:', err);
        res.status(500).json({ message: 'Server error.' });
    }
});

// GET /api/feedback/my  — get current user's own feedback (to pre-fill form)
router.get('/my', auth, async (req, res) => {
    try {
        const { userId } = req.user;
        const feedback = await Feedback.findOne({ submitterId: userId }).lean();
        res.json(feedback || null);
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// GET /api/feedback  — get all feedbacks (superadmin only)
router.get('/', auth, async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') {
            return res.status(403).json({ message: 'Superadmin access only.' });
        }
        const feedbacks = await Feedback.find()
            .sort({ createdAt: -1 })
            .lean();
        res.json(feedbacks);
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

export default router;
