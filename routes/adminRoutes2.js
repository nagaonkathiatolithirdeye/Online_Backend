const express      = require('express');
const router       = express.Router();
const Course       = require('@models/Course');
const User         = require('@models/User');
const Enrollment   = require('@models/Enrollment');
const ActivityLog  = require('@models/ActivityLog');
const Exam         = require('@models/Exam');
const DoubtSession = require('@models/DoubtSession');
const { authMiddleware, adminMiddleware }          = require('@middleware/authMiddleware');
const { generateReferralCode, processReferralReward } = require('@utils/referralUtils');

// Apply auth and admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);


// Exam Management
router.get('/exams', async (req, res) => {
  try {
    const exams = await Exam.find().populate('courseId', 'title').populate('enrolledStudents.userId', 'name email').sort({ date: 1 });
    res.json(exams);
  } catch (error) {
    console.error('[ADMIN] GET exams error:', error);
    res.status(500).json({ error: 'Failed to fetch exams' });
  }
});

router.post('/exams', async (req, res) => {
  try {
    const exam = await Exam.create(req.body);
    res.status(201).json(exam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

router.put('/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('courseId', 'title');
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    res.json(exam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update exam' });
  }
});

router.delete('/exams/:id', async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    await Exam.findByIdAndDelete(req.params.id);
    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete exam' });
  }
});

router.put('/exams/:examId/student/:studentId', async (req, res) => {
  try {
    const { attended, marks, passed } = req.body;
    const exam = await Exam.findById(req.params.examId);
    const student = exam.enrolledStudents.find(s => s.userId.toString() === req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found in exam' });
    student.attended = attended;
    student.marks = marks;
    student.passed = passed;
    await exam.save();
    res.json(exam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update exam attendance' });
  }
});

// Student Management
router.get('/students', async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('-password').sort({ createdAt: -1 }).lean();
    const enrollments = await Enrollment.find({ userId: { $in: students.map(s => s._id) } })
                                      .select('userId progress courseId paymentStatus examEligible adminOverride')
                                      .populate('courseId', 'title')
                                      .lean();
    
    // Group enrollments by userId for O(1) lookup
    const enrollmentMap = {};
    enrollments.forEach(e => {
      const uid = e.userId.toString();
      if (!enrollmentMap[uid]) enrollmentMap[uid] = [];
      enrollmentMap[uid].push(e);
    });
    
    const enrichedStudents = students.map(student => {
      const studentEnrollments = enrollmentMap[student._id.toString()] || [];
      
      let totalProgress = 0;
      let courseNames = [];
      studentEnrollments.forEach(e => {
        totalProgress += e.progress || 0;
        if (e.courseId && e.courseId.title) {
          courseNames.push(e.courseId.title);
        }
      });
      
      const overallProgress = studentEnrollments.length > 0 ? Math.round(totalProgress / studentEnrollments.length) : 0;
      
      const msPerDay = 1000 * 60 * 60 * 24;
      const referenceDate = student.lastActiveDate ? new Date(student.lastActiveDate) : new Date(student.createdAt);
      const daysInactive = Math.floor((new Date() - referenceDate) / msPerDay);
      
      let activityStatus = 'Active';
      if (daysInactive >= 3) activityStatus = 'Inactive';
      else if (daysInactive >= 1) activityStatus = 'Warning';

      return {
        ...student,
        overallProgress,
        courseNames: courseNames.join(', '),
        activityStatus,
        daysInactive,
        enrollments: studentEnrollments
      };
    });

    res.json(enrichedStudents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

router.get('/students/:id', async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select('-password').lean();
    const enrollments = await Enrollment.find({ userId: req.params.id }).populate('courseId');
    
    // Compute activity status
    const msPerDay = 1000 * 60 * 60 * 24;
    const referenceDate = student.lastActiveDate ? new Date(student.lastActiveDate) : new Date(student.createdAt);
    const daysInactive = Math.max(0, Math.floor((new Date() - referenceDate) / msPerDay));
    
    let activityStatus = 'Active';
    if (daysInactive > 3) activityStatus = 'Inactive';
    else if (daysInactive >= 2) activityStatus = 'Warning';

    const enrichedStudent = {
      ...student,
      daysInactive,
      activityStatus
    };

    res.json({ student: enrichedStudent, enrollments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

router.delete('/students/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await Enrollment.deleteMany({ userId: req.params.id });
    await ActivityLog.deleteMany({ userId: req.params.id }); // Clear ghost activities
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Enrollment Management
router.get('/enrollments', async (req, res) => {
  try {
    const enrollments = await Enrollment.find()
      .populate({
        path: 'userId',
        select: 'name email phone whatsappPhone address studyCentre referredBy',
        populate: {
          path: 'referredBy',
          select: 'name'
        }
      })
      .populate('courseId', 'title')
      .sort({ enrolledAt: -1 });
    res.json(enrollments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

router.put('/enrollments/:id/pay', async (req, res) => {
  try {
    const enrollment = await Enrollment.findById(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    
    enrollment.status = 'paid';
    enrollment.examEligible = false; // Reset to false; student must earn it via progress/time
    await enrollment.save();

    // Reward the referrer if one exists
    await processReferralReward(enrollment.userId);
    
    res.json({ message: 'Enrollment approved and referral reward credited (if applicable)', enrollment });
  } catch (error) {
    console.error('[ADMIN] Approve Error:', error);
    res.status(500).json({ error: 'Failed to approve enrollment' });
  }
});

router.put('/enrollments/:id/override', async (req, res) => {
  try {
    const { adminOverride } = req.body;
    const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { adminOverride }, { new: true });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ message: `Admin override ${adminOverride ? 'enabled' : 'disabled'}`, enrollment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update admin override' });
  }
});

router.put('/enrollments/:id/eligibility', async (req, res) => {
  try {
    const { examEligible } = req.body;
    const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { examEligible }, { new: true });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ message: `Exam eligibility ${examEligible ? 'enabled' : 'disabled'}`, enrollment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update exam eligibility' });
  }
});

router.put('/enrollments/:id/payment-status', async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    const enrollment = await Enrollment.findByIdAndUpdate(req.params.id, { paymentStatus }, { new: true });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    // Reward the referrer if payment status is updated to 'paid' or 'partial'
    if (paymentStatus === 'paid' || paymentStatus === 'partial') {
      await processReferralReward(enrollment.userId);
    }

    res.json({ message: 'Payment status updated successfully', enrollment });
  } catch (error) {
    console.error('[ADMIN] Payment Status Update Error:', error);
    res.status(500).json({ error: 'Failed to update payment status: ' + error.message });
  }
});

router.delete('/enrollments/:id', async (req, res) => {
  try {
    const enrollment = await Enrollment.findById(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    
    const userId = enrollment.userId;

    // Delete the enrollment itself
    await Enrollment.findByIdAndDelete(req.params.id);
    
    // Delete the student (user) record and all their other enrollments
    if (userId) {
      await User.findByIdAndDelete(userId);
      await Enrollment.deleteMany({ userId }); // Ensure all traces of the student are gone
      await ActivityLog.deleteMany({ userId }); // Remove activity logs
    }
    
    res.json({ message: 'Enrollment and associated student record removed successfully' });
  } catch (error) {
    console.error('[ADMIN] Delete Error:', error);
    res.status(500).json({ error: 'Failed to delete enrollment and student' });
  }
});

// Dashboard Stats
router.get('/stats', async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalCourses = await Course.countDocuments({ isActive: true });
    const totalEnrollments = await Enrollment.countDocuments();
    const pendingEnrollments = await Enrollment.countDocuments({ status: 'pending' });
    res.json({ totalStudents, totalCourses, totalEnrollments, pendingEnrollments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Referral Milestones Report
router.get('/referral-reports', async (req, res) => {
  try {
    const students = await User.find({ 
      role: 'student',
      'rewardedReferrals.2': { $exists: true } // At least 3 referrals
    })
    .select('name email phone rewardedReferrals rewardPoints')
    .sort({ 'rewardedReferrals.length': -1 });

    const report = students.map(s => ({
      _id: s._id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      referralCount: s.rewardedReferrals.length,
      rewardPoints: s.rewardPoints,
      milestone: s.rewardedReferrals.length >= 5 ? 'Gold (5+)' : 'Silver (3+)'
    }));

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch referral reports' });
  }
});

// Suspicious Referral Activities
router.get('/suspicious-referrals', async (req, res) => {
  try {
    const ActivityLog = require('@models/ActivityLog');
    const logs = await ActivityLog.find({ 
      activityType: 'suspicious_attempt' 
    })
    .populate('userId', 'name email phone')
    .sort({ timestamp: -1 });

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch suspicious referrals' });
  }
});

// Reminder Center Logic
router.get('/reminders/candidates', async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('name email phone whatsappPhone lastActiveDate createdAt').lean();
    const enrollments = await Enrollment.find({ status: 'paid' }).populate('courseId', 'title').lean();
    const exams = await Exam.find().lean();

    const candidates = {
      inactive: [],
      nearCompletion: []
    };

    const msPerDay = 1000 * 60 * 60 * 24;
    const now = new Date();

    for (const student of students) {
      const referenceDate = student.lastActiveDate || student.createdAt;
      const daysInactive = Math.floor((now - new Date(referenceDate)) / msPerDay);

      // Inactive check (3+ days)
      if (daysInactive >= 3) {
        candidates.inactive.push({
          ...student,
          daysInactive
        });
      }

      // Near Completion check (80%+ progress and no exam booked)
      const studentEnrollments = enrollments.filter(e => e.userId.toString() === student._id.toString());
      for (const enrollment of studentEnrollments) {
        if (enrollment.progress >= 80) {
          // Check if exam is booked for this course
          const isExamBooked = exams.some(exam => 
            exam.courseId.toString() === enrollment.courseId?._id.toString() &&
            exam.enrolledStudents.some(s => s.userId.toString() === student._id.toString())
          );

          if (!isExamBooked) {
            candidates.nearCompletion.push({
              studentName: student.name,
              userId: student._id,
              email: student.email,
              phone: student.phone,
              courseTitle: enrollment.courseId?.title,
              progress: enrollment.progress
            });
          }
        }
      }
    }

    res.json(candidates);
  } catch (error) {
    console.error('Reminder candidates error:', error);
    res.status(500).json({ error: 'Failed to fetch reminder candidates' });
  }
});


// Course Management
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.post('/courses', async (req, res) => {
  try {
    const course = await Course.create(req.body);
    res.status(201).json(course);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/courses/:id', async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(course);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/courses/:id', async (req, res) => {
  try {
    await Course.findByIdAndUpdate(req.params.id, { isActive: false });
    await Enrollment.deleteMany({ courseId: req.params.id });
    res.json({ message: 'Course deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

router.get('/admins', async (req, res) => {
  try {
    
    // Using regex for 'admin' to be case-insensitive and handle potential whitespace issues
    const admins = await User.find({ role: { $regex: /^admin$/i } }).select('-password').sort({ createdAt: -1 });
    
    if (admins.length > 0) {
    } else {
      // Diagnostic check: what roles DO exist?
      const allRoles = await User.distinct('role');
    }
    
    res.json(admins);
  } catch (error) {
    console.error('[DEBUG] GET /admins database error:', error);
    res.status(500).json({ error: 'Failed to fetch admins: ' + error.message });
  }
});

router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const existingAdmin = await User.findOne({ email: email.toLowerCase(), role: 'admin' });
    if (existingAdmin) {
      return res.status(400).json({ error: 'An administrator account with this email already exists' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = await User.create({ 
      name, 
      email: email.toLowerCase(), 
      password: hashedPassword, 
      role: 'admin' 
    });
    
    res.status(201).json({ message: 'Admin created successfully', admin: { _id: newAdmin._id, name, email, role: 'admin' } });
  } catch (error) {
    console.error('[DEBUG] POST /create-admin unexpected error:', error);
    res.status(500).json({ error: 'Failed to create admin: ' + error.message });
  }
});

router.put('/admins/:id', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const updateData = { name, email: email.toLowerCase() };
    
    if (password) {
      const bcrypt = require('bcryptjs');
      updateData.password = await bcrypt.hash(password, 10);
    }

    const admin = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json(admin);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update admin' });
  }
});

router.delete('/admins/:id', async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.user.id === req.params.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const admin = await User.findByIdAndDelete(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete admin' });
  }
});

router.post('/create-student', async (req, res) => {
  try {
    const { name, email, password, phone, address, studyCentre } = req.body;
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode = generateReferralCode(name);
    const newStudent = await User.create({ 
      name, 
      email: email.toLowerCase(), 
      password: hashedPassword, 
      phone, 
      address, 
      studyCentre, 
      role: 'student',
      referralCode
    });
    res.status(201).json({ message: 'Student created successfully', student: { name, email, role: 'student' } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create student' });
  }
});

router.post('/enroll-student', async (req, res) => {
  try {
    const { studentId, courseId, paymentStatus } = req.body;
    const enrollment = await Enrollment.create({ 
      userId: studentId, 
      courseId, 
      status: 'paid', 
      examEligible: false, // Student must earn it or be manually toggled later
      progress: 0,
      paymentStatus: paymentStatus || 'pending'
    });
    // Reward the referrer if one exists (since this is auto-approved here)
    // Trigger on any payment status that isn't 'pending' if it was set
    if (paymentStatus === 'paid' || paymentStatus === 'partial') {
      await processReferralReward(studentId);
    }
    
    res.status(201).json({ message: 'Student enrolled successfully', enrollment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enroll student' });
  }
});

// Doubt Sessions
router.post('/doubt-sessions', async (req, res) => {
  try {
    const session = await DoubtSession.create(req.body);
    const course = await Course.findById(req.body.courseId);
    
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create doubt session' });
  }
});

router.get('/doubt-sessions', async (req, res) => {
  try {
    const sessions = await DoubtSession.find().populate('courseId', 'title').populate('participants', 'name email').sort({ date: 1 });
    res.json(sessions);
  } catch (error) {
    console.error('[ADMIN] GET doubt sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch doubt sessions' });
  }
});

router.put('/doubt-sessions/:id', async (req, res) => {
  try {
    const session = await DoubtSession.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('courseId', 'title');
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update doubt session' });
  }
});

router.delete('/doubt-sessions/:id', async (req, res) => {
  try {
    const session = await DoubtSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await DoubtSession.findByIdAndDelete(req.params.id);
    res.json({ message: 'Doubt session deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete doubt session' });
  }
});

module.exports = router;
