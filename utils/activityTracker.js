const ActivityLog = require('@models/ActivityLog');
const User        = require('@models/User');

const trackActivity = async (userId, activityType, courseId = null, description = '') => {
  try {
    if (!userId) return;

    await ActivityLog.create({
      userId,
      activityType,
      courseId,
      description
    });

    await User.findByIdAndUpdate(userId, { lastActiveDate: new Date() });
  } catch (error) {
    console.error('Failed to track activity:', error);
  }
};

module.exports = { trackActivity };
