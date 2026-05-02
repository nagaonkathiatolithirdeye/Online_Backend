const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Enrollment = require('@models/Enrollment');
const Course = require('@models/Course');
const User = require('@models/User');
const { authMiddleware } = require('@middleware/authMiddleware');
const { generateAccessToken, generateRefreshToken,
  setAuthCookies } = require('@utils/jwtUtils');

// Public enrollment endpoint - register + enroll in one step
router.post('/enroll', async (req, res) => {
  try {
    const { name, email, phone, whatsappPhone, address, password, courseId, studyCentre, referralCode } = req.body;

    if (!name || !email || !phone || !address || !password || !courseId || !studyCentre) {
      return res.status(400).json({ error: 'All fields are required: name, email, phone, address, password, courseId, studyCentre' });
    }

    // Validate course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Find or create user
    let user = await User.findOne({ 
      $or: [
        { email: email.toLowerCase() },
        { phone: phone }
      ]
    });
    
    if (user) {
      return res.status(409).json({ 
        error: 'Account already exists', 
        message: 'An account with this email or phone number already exists. Please login to your dashboard to continue your enrollment.',
        guideToLogin: true
      });
    }

    // Create new user
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Referral Logic
    let referredByUser = null;
    if (referralCode && referralCode.trim()) {
      referredByUser = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      // Prevent self-referral
      if (referredByUser && (referredByUser.email === email.toLowerCase() || referredByUser.phone === phone)) {
        referredByUser = null;
      }
    }

    const { generateReferralCode } = require('@utils/referralUtils');
    const newReferralCode = generateReferralCode(name);

    user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone,
      whatsappPhone: whatsappPhone || phone,
      address,
      studyCentre,
      role: 'student',
      referralCode: newReferralCode,
      referredBy: referredByUser ? referredByUser._id : undefined
    });

    // Check for duplicate pending enrollment (same user + course + pending)
    const existingEnrollment = await Enrollment.findOne({
      userId: user._id,
      courseId,
      status: 'pending'
    });

    if (existingEnrollment) {
      // Auto-login newly created user
      const accessToken = generateAccessToken(user._id, user.email);
      const refreshToken = generateRefreshToken(user._id);
      setAuthCookies(res, accessToken, refreshToken);

      return res.status(409).json({
        error: 'Already applied',
        message: 'You have already submitted an enrollment request for this course. Please wait for confirmation.'
      });
    }

    // Check if already paid/approved
    const paidEnrollment = await Enrollment.findOne({
      userId: user._id,
      courseId,
      status: 'paid'
    });

    if (paidEnrollment) {
      // Auto-login newly created user
      const accessToken = generateAccessToken(user._id, user.email);
      const refreshToken = generateRefreshToken(user._id);
      setAuthCookies(res, accessToken, refreshToken);

      return res.status(409).json({
        error: 'Already enrolled',
        message: 'You are already enrolled in this course.'
      });
    }

    // Create enrollment with pending status
    const enrollment = await Enrollment.create({
      userId: user._id,
      courseId,
      status: 'pending'
    });

    // Auto-login the user
    const accessToken = generateAccessToken(user._id, user.email);
    const refreshToken = generateRefreshToken(user._id);
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({
      message: 'Enrollment submitted successfully. We will contact you soon.',
      enrollment,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email already registered. Please login instead.' });
    }
    res.status(500).json({ error: 'Enrollment failed. Please try again.', details: error.message, stack: error.stack });
  }
});

// Enroll for logged-in users (simpler)
router.post('/enroll-loggedin', authMiddleware, async (req, res) => {
  try {
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ error: 'courseId is required' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check for duplicate pending enrollment
    const existingEnrollment = await Enrollment.findOne({
      userId: req.user._id,
      courseId,
      status: { $in: ['pending', 'paid'] }
    });

    if (existingEnrollment) {
      const msg = existingEnrollment.status === 'pending'
        ? 'You have already submitted an enrollment request for this course. Please wait for confirmation.'
        : 'You are already enrolled in this course.';
      return res.status(409).json({ error: 'Already applied', message: msg });
    }

    // Create enrollment
    const enrollment = await Enrollment.create({
      userId: req.user._id,
      courseId,
      status: 'pending'
    });

    res.status(201).json({
      message: 'Enrollment submitted successfully. We will contact you soon.',
      enrollment
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ error: 'Enrollment failed. Please try again.' });
  }
});

// Get user enrollments
router.get('/my-enrollments', authMiddleware, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ userId: req.user._id })
      .populate('courseId')
      .sort({ enrolledAt: -1 });
    res.json(enrollments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// Download enrollment receipt (PDF)
router.get('/download/:id', authMiddleware, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const enrollment = await Enrollment.findById(req.params.id)
      .populate('userId', 'name email phone studyCentre address')
      .populate('courseId', 'title');

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Security: Only student themselves or admin can download
    if (req.user.role !== 'admin' && enrollment.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to download this receipt' });
    }

    const doc = new PDFDocument({ margin: 50 });
    const filename = `Receipt_${enrollment._id}.pdf`;

    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');

    doc.pipe(res);

    // Header Banner
    doc.rect(0, 0, doc.page.width, 80).fill('#1e3a8a');

    // Institute Name (Left)
    doc
      .fillColor('white')
      .fontSize(20)
      .text('Third Eye Computer Education', 50, 20);

    // Subtitle
    doc
      .fontSize(12)
      .text('Enrollment Receipt', 50, 45);

    // ✅ Certification Details (Right side - clean alignment)
    doc
      .fontSize(8)
      .fillColor('white')
      .text(
        'ISO 9001:2015 Certified Institution\nRegistered Under the Companies Act 1956,\nMinistry of Corporate Affairs, Govt. of India\nRegistration No: U72400AS1998PTC005595',
        300,
        20,
        {
          width: 240,
          align: 'right',
          lineGap: 2,
        }
      );

    // Reset color
    doc.fillColor('black').moveDown(2);

    // Date (top right)
    doc
      .fontSize(10)
      .text(
        `Date: ${new Date(enrollment.enrolledAt).toLocaleDateString()}`,
        400,
        90
      );

    // Divider
    doc.moveTo(50, 110).lineTo(550, 110).stroke();

    // ----------------------
    // STUDENT SECTION
    // ----------------------
    doc.moveDown();
    doc
      .fontSize(14)
      .fillColor('#1e3a8a')
      .text('Student Details', 50, 130);

    doc
      .roundedRect(50, 150, 500, 110, 5)
      .stroke();

    doc
      .fillColor('black')
      .fontSize(11)
      .text(`Name: ${enrollment.userId.name}`, 60, 165)
      .text(`Email: ${enrollment.userId.email}`, 60, 185)
      .text(`Phone: ${enrollment.userId.phone}`, 60, 205)
      .text(`Study Centre: ${enrollment.userId.studyCentre}`, 60, 225)
      .text(`Address: ${enrollment.userId.address}`, 60, 245);

    // ----------------------
    // COURSE SECTION
    // ----------------------
    doc
      .fontSize(14)
      .fillColor('#1e3a8a')
      .text('Course Details', 50, 280);

    doc
      .roundedRect(50, 300, 500, 110, 5)
      .stroke();

    const getPaymentStatusLabel = (status) => {
      const s = String(status || 'pending').toLowerCase();
      if (s === 'paid') return 'Paid (100%)';
      if (s === 'partial') return 'Partial (50%)';
      return 'Pending (0%)';
    };

    doc
      .fillColor('black')
      .fontSize(11)
      .text(`Course: ${enrollment.courseId.title}`, 60, 315)
      .text(`Status: ${enrollment.status.toUpperCase()}`, 60, 355)
      .text(`Payment Status: ${getPaymentStatusLabel(enrollment.paymentStatus)}`, 60, 375);

    // ----------------------
    // FOOTER
    // ----------------------
    doc
      .fontSize(10)
      .fillColor('gray')
      .text(
        'Thank you for choosing Third Eye Computer Education.',
        50,
        700,
        { align: 'center' }
      );

    doc.end();
  } catch (error) {
    console.error('PDF Download Error:', error);
    res.status(500).json({ error: 'Failed to generate PDF receipt' });
  }
});

// Get specific enrollment for a course
router.get('/:courseId', authMiddleware, async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({
      userId: req.user._id,
      courseId: req.params.courseId
    }).populate('courseId');

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.json(enrollment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch enrollment' });
  }
});

module.exports = router;
