const mongoose = require('mongoose');

const emergencyLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  studentID: { type: String, ref: 'Student', required: true },
  levelOfEmergency: { 
    type: Number, 
    enum: [1, 2, 3], // Corresponds to your 3 Levels
    required: true 
  },
  status: { 
    type: String, 
    enum: ['Pending', 'Resolved'], 
    default: 'Pending' 
  },
  remarks: { type: String, default: '' }
});

module.exports = mongoose.model('EmergencyLog', emergencyLogSchema);