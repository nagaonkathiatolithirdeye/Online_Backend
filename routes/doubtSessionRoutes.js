const express      = require('express');
const mongoose     = require('mongoose');
const router       = express.Router();
const DoubtSession = require('@models/DoubtSession');
const User         = require('@models/User');
const Enrollment   = require('@models/Enrollment');
const { authMiddleware }     = require('@middleware/authMiddleware');

router.get('/available', authMiddleware, async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Get user's enrolled course IDs
    const enrollments = await Enrollment.find({ userId: req.user._id, status: 'paid' });
    const enrolledCourseIds = enrollments.map(e => e.courseId);

    const sessions = await DoubtSession.find({ 
      courseId: { $in: enrolledCourseIds },
      date: { $gte: startOfToday }
    }).populate('courseId', 'title').sort({ date: 1 });
    
    // Add joined status so frontend can filter badges
    const enrichedSessions = sessions.map(session => ({
      ...session.toObject(),
      isJoined: session.participants.some(p => p.toString() === req.user._id.toString())
    }));

    res.json(enrichedSessions);
  } catch (error) {
    console.error('[BACKEND] GET available doubt sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch doubt sessions' });
  }
});

// Get all upcoming doubt sessions for a course
router.get('/course/:courseId', authMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.courseId)) {
      return res.json([]);
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sessions = await DoubtSession.find({ 
      courseId: req.params.courseId,
      date: { $gte: startOfToday }
    }).sort({ date: 1 });
    
    res.json(sessions);
  } catch (error) {
    console.error('[BACKEND] GET doubt sessions by course error:', error);
    res.status(500).json({ error: 'Failed to fetch doubt sessions' });
  }
});

// Join doubt session
router.post('/:sessionId/join', authMiddleware, async (req, res) => {
  try {
    const session = await DoubtSession.findById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if session is full
    if (session.participants.length >= session.maxParticipants) {
      return res.status(400).json({ error: 'Session is full' });
    }

    // Check if user is enrolled in the course
    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      courseId: session.courseId
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'You must be enrolled in the course' });
    }

    // Check if already joined
    if (session.participants.includes(req.user._id)) {
      return res.status(400).json({ error: 'Already joined this session' });
    }

    session.participants.push(req.user._id);
    await session.save();

    res.json({ message: 'Joined session successfully', session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// Get user's joined sessions
router.get('/my-sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await DoubtSession.find({
      participants: req.user._id
    }).populate('courseId', 'title').sort({ date: 1 });

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

module.exports = router;
