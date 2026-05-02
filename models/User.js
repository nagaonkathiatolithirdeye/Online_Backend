const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: function() { return this.role === 'student'; },
    unique: true,
    sparse: true
  },
  whatsappPhone: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    required: function() { return this.role === 'student'; }
  },
  studyCentre: {
    type: String,
    enum: ['Kathiatoli', 'Nagaon'],
    required: function() { return this.role === 'student'; }
  },
  role: {
    type: String,
    enum: ['student', 'admin'],
    default: 'student'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActiveDate: {
    type: Date,
    default: Date.now
  },
  referralCode: {
    type: String,
    unique: true,
    index: true,
    sparse: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rewardPoints: {
    type: Number,
    default: 0
  },
  rewardedReferrals: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  }
});

module.exports = mongoose.model('User', userSchema);
