const express    = require('express');
const router     = express.Router();
const Course     = require('@models/Course');
const Enrollment = require('@models/Enrollment');
const { authMiddleware } = require('@middleware/authMiddleware');
const { trackActivity }  = require('@utils/activityTracker');

// Get all active courses
router.get('/', async (req, res) => {
  try {
    // Exclude mockTests and videos from the initial list to keep payload small
    const courses = await Course.find({ isActive: true }).select('-mockTests -videos').lean();
    res.json(courses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get course by ID
router.get('/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Return full details only if user is enrolled
    if (req.query.enrolled === 'true') {
      res.json(course);
    } else {
      // Return limited info for non-enrolled users
      res.json({
        _id: course._id,
        title: course.title,
        description: course.description,
        price: course.price,
        thumbnail: course.thumbnail,
        demoVideos: course.demoVideos.filter(v => v.isActive !== false)
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// Get course content (protected)
router.get('/:id/content', authMiddleware, async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      courseId: req.params.id
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'You are not enrolled in this course.' });
    }

    if (enrollment.status !== 'paid') {
      return res.status(403).json({ error: 'Access denied. Your enrollment is pending approval.' });
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Exclude heavy questions from the initial content load
    const slimMockTests = course.mockTests.map(test => ({
      _id: test._id,
      title: test.title,
      questionsCount: test.questions.length
    }));

    res.json({
      videos: course.videos.filter(v => v.isActive !== false),
      mockTests: slimMockTests,
      enrollment: enrollment
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch course content' });
  }
});

// Update video progress
router.post('/:id/progress', authMiddleware, async (req, res) => {
  try {
    const { videoId, progress } = req.body;

    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      courseId: req.params.id
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Update or add video progress
    const existingVideo = enrollment.watchedVideos.find(v => v.videoId === videoId);
    if (existingVideo) {
      existingVideo.progress = progress;
      existingVideo.watchedAt = new Date();
    } else {
      enrollment.watchedVideos.push({
        videoId,
        progress,
        watchedAt: new Date()
      });
    }

    // Calculate overall progress
    const course = await Course.findById(req.params.id);
    const activeVideos = course.videos.filter(v => v.isActive !== false);
    const totalVideos = activeVideos.length;
    
    // Calculate progress based only on active videos
    const watchedCount = enrollment.watchedVideos.filter(v => {
      const isActive = activeVideos.some(av => av._id.toString() === v.videoId || av.title === v.videoId);
      return isActive && v.progress >= 90;
    }).length;

    enrollment.progress = totalVideos > 0 ? Math.round((watchedCount / totalVideos) * 100) : 100;

    // Set completedAt for 'Fastest Learners' leaderboard metric
    if (enrollment.progress === 100 && !enrollment.completedAt) {
      enrollment.completedAt = new Date();
    }

    await enrollment.save();

    await trackActivity(req.user._id, 'video', req.params.id, `Watched video: ${videoId}`);

    res.json({ progress: enrollment.progress });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Submit mock test
router.post('/:id/test/:testId', authMiddleware, async (req, res) => {
  try {
    const { answers } = req.body;

    const course = await Course.findById(req.params.id);
    const test = course.mockTests.id(req.params.testId);

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    // Calculate score
    let correctCount = 0;
    test.questions.forEach((q, index) => {
      if (answers[index] === q.correctAnswer) {
        correctCount++;
      }
    });

    const score = Math.round((correctCount / test.questions.length) * 100);

    // Update enrollment
    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      courseId: req.params.id
    });

    enrollment.completedTests.push({
      testId: req.params.testId,
      score,
      completedAt: new Date()
    });

    await enrollment.save();

    await trackActivity(req.user._id, 'lesson', req.params.id, `Completed mock test: ${test.title}`);

    res.json({ score, correctCount, totalQuestions: test.questions.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// Get mock test questions (protected)
router.get('/:id/test/:testId/questions', authMiddleware, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    const test = course.mockTests.id(req.params.testId);

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    res.json(test.questions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch test questions' });
  }
});

module.exports = router;
