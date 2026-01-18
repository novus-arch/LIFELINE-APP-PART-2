const mongoose = require('mongoose');

const medicalHistorySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  condition: { type: String, required: true },
  description: { type: String }
});

const studentSchema = new mongoose.Schema({
  studentID: { type: String, required: true, unique: true }, // e.g., 2024-01-*****
  name: { type: String, required: true },
  birthday: { type: Date, required: true },
  age: { type: Number },
  height: { type: Number }, // in cm
  weight: { type: Number }, // in kg
  bmi: { type: Number },
  medicalHistory: [medicalHistorySchema] // Array of history objects from your UI
});

module.exports = mongoose.model('Student', studentSchema);