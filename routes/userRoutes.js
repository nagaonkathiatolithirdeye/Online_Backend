const express     = require('express');
const router      = express.Router();
const User        = require('@models/User');
const Enrollment  = require('@models/Enrollment');
const ActivityLog = require('@models/ActivityLog');
const Exam        = require('@models/Exam');
const DoubtSession = require('@models/DoubtSession');
const { authMiddleware }       = require('@middleware/authMiddleware');
const { generateReferralCode } = require('@utils/referralUtils');

// Get Unified Dashboard Data
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;

    // Fetch user profile
    let user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Auto-generate referral code if missing (for legacy users)
    if (!user.referralCode) {
      user.referralCode = generateReferralCode(user.name);
      await user.save();
    }

    user = user.toObject(); // Convert to plain object if needed for the response logic below
    delete user.password;

    // Fetch enrollments with populated course details (excluding heavy fields)
    const enrollments = await Enrollment.find({ userId })
      .populate({
        path: 'courseId',
        select: 'title description thumbnail price duration level minDaysBeforeExam' // Exclude videos and mockTests to optimize response
      })
      .sort({ enrolledAt: -1 })
      .lean();

    // Fetch recent activities
    const recentActivities = await ActivityLog.find({ userId })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    // Referral Stats
    const referredUsers = await User.find({ referredBy: userId })
      .select('name createdAt rewardPoints')
      .sort({ createdAt: -1 })
      .lean();
    
    const referredCount = referredUsers.length;
    const referredUserIds = referredUsers.map(u => u._id);

    // Find all potential success indicators for these referred students
    const allEnrollments = await Enrollment.find({
      userId: { $in: referredUserIds }
    }).lean();

    // Deep Healing / Reconciliation Logic
    let needsSave = false;
    const currentRewarded = user.rewardedReferrals || [];
    const rewardedIdsStrings = new Set(currentRewarded.map(id => id.toString()));

    // Enriched list with ultra-robust status check
    const enrichedReferredUsers = referredUsers.map((u) => {
      const uIdStr = u._id.toString();
      const userEnrollments = allEnrollments.filter(e => 
        e.userId && e.userId.toString() === uIdStr
      );
      
      // Check if student has a successful enrollment
      const hasSuccessfulEnrollment = userEnrollments.some(e => {
        const status = String(e.status || '').toLowerCase();
        const payStatus = String(e.paymentStatus || '').toLowerCase();
        return status === 'paid' || payStatus === 'paid' || payStatus === 'partial';
      });

      // HEALING: If student is successful but not in rewarded list, add them!
      if (hasSuccessfulEnrollment && !rewardedIdsStrings.has(uIdStr)) {

        if (!user.rewardedReferrals) user.rewardedReferrals = [];
        user.rewardedReferrals.push(u._id);
        user.rewardPoints = (user.rewardPoints || 0) + 50;
        rewardedIdsStrings.add(uIdStr);
        needsSave = true;
      }

      const isActuallyRewarded = rewardedIdsStrings.has(uIdStr);

      return {
        ...u,
        isRewarded: isActuallyRewarded
      };
    });

    // Save changes if healing occurred
    if (needsSave) {
      await User.findByIdAndUpdate(userId, {
        rewardedReferrals: user.rewardedReferrals,
        rewardPoints: user.rewardPoints
      });

    }

    const successfulReferrals = enrichedReferredUsers.filter(u => u.isRewarded).length;

    // --- SMOOTH EXPERIENCE: Pre-calculate counts for badges ---
    // Exams: Filtered by course and eligibility
    const approvedCourseIds = enrollments.filter(e => e.status === 'paid').map(e => e.courseId?._id);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const availableExams = await Exam.find({ 
      courseId: { $in: approvedCourseIds },
      date: { $gte: startOfToday }
    }).lean();

    const pendingExamsCount = availableExams.filter(exam => {
      const isBooked = (exam.enrolledStudents || []).some(s => s.userId.toString() === userId.toString());
      if (isBooked) return false;
      
      const enrollment = enrollments.find(e => e.courseId?._id.toString() === exam.courseId.toString());
      if (!enrollment) return false;

      // Logic from examRoutes.js
      const enrolledAt = new Date(enrollment.enrolledAt);
      const daysPassed = Math.floor((new Date() - enrolledAt) / (1000 * 60 * 60 * 24));
      const minDaysBeforeExam = enrollment.courseId?.minDaysBeforeExam || 30;
      const minProgress = enrollment.courseId?.minProgress || 80;
      
      return enrollment.examEligible || enrollment.adminOverride || (daysPassed >= minDaysBeforeExam && enrollment.progress >= minProgress);
    }).length;

    // Doubt Sessions
    const availableSessions = await DoubtSession.find({
      courseId: { $in: approvedCourseIds },
      date: { $gte: startOfToday }
    }).lean();

    const pendingSessionsCount = availableSessions.filter(session => {
      return !(session.participants || []).some(p => p.toString() === userId.toString());
    }).length;

    res.json({
      user,
      enrollments,
      recentActivities,
      referralStats: {
        referredCount,
        successfulReferrals,
        referredUsers: enrichedReferredUsers
      },
      badges: {
        exams: pendingExamsCount,
        doubtSessions: pendingSessionsCount
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data. Please try again.' });
  }
});

module.exports = router;
