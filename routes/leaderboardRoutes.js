const express     = require('express');
const router      = express.Router();
const User        = require('@models/User');
const Enrollment  = require('@models/Enrollment');
const ActivityLog = require('@models/ActivityLog');
const { authMiddleware } = require('@middleware/authMiddleware');


// GET Leaderboard Data (Public/Private)
router.get('/', async (req, res) => {
  try {
    // 1. Top Performers (Highest Progress)
    const topPerformersData = await Enrollment.find({ status: 'paid' })
      .populate('userId', 'name')
      .populate('courseId', 'title')
      .sort({ progress: -1 })
      .limit(10)
      .lean();

    const topPerformers = topPerformersData
      .filter(e => e.userId) // Ensure student still exists
      .map(e => ({
        name: e.userId?.name || 'Anonymous',
        course: e.courseId?.title,
        progress: e.progress,
        userId: e.userId?._id
      }));

    const fastestLearners = [];

    // 3. Most Active (Last 30 Days Activity Count)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeAggregate = await ActivityLog.aggregate([
      { $match: { timestamp: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$userId', activityCount: { $sum: 1 } } },
      { $sort: { activityCount: -1 } },
      { $limit: 10 }
    ]);

    const activeUserIds = activeAggregate.map(a => a._id);
    const activeUsersInfo = await User.find({ _id: { $in: activeUserIds } }).select('name').lean();

    const mostActive = activeAggregate
      .map(a => {
        const user = activeUsersInfo.find(u => u._id.toString() === a._id.toString());
        return {
          name: user?.name,
          activityCount: a.activityCount,
          userId: a._id
        };
      })
      .filter(a => a.name); // Only include if user still exists

    res.json({
      topPerformers,
      mostActive
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
