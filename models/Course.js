const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  thumbnail: {
    type: String,
    default: ''
  },
  demoVideos: [{
    title: String,
    url: String,
    duration: String,
    isActive: { type: Boolean, default: true }
  }],
  videos: [{
    title: String,
    url: String,
    duration: String,
    order: Number,
    isActive: { type: Boolean, default: true }
  }],
  mockTests: [{
    title: String,
    questions: [{
      question: String,
      options: [String],
      correctAnswer: Number
    }]
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  minDaysBeforeExam: {
    type: Number,
    default: 30
  },
  minProgress: {
    type: Number,
    default: 80
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Course', courseSchema);
