const mongoose = require('mongoose');

const SuperAdminSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'superadmin' },
  
  // Permissions level (for multiple internal staff)
  privileges: {
    canEditGlobalCourses: { type: Boolean, default: true },
    canDeleteInstitutions: { type: Boolean, default: false }, // Safety lock
    canManagePayments: { type: Boolean, default: true }
  },

  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SuperAdmin', SuperAdminSchema);