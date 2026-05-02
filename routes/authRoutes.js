const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const User    = require('@models/User');
const { generateAccessToken, generateRefreshToken, setAuthCookies, clearAuthCookies } = require('@utils/jwtUtils');
const { authMiddleware }    = require('@middleware/authMiddleware');
const { trackActivity }     = require('@utils/activityTracker');
const { generateReferralCode } = require('@utils/referralUtils');

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, whatsappPhone, address, studyCentre, referralCode } = req.body;

    if (!name || !email || !password || !phone || !address || !studyCentre) {
      return res.status(400).json({ error: 'Name, email, password, phone, address, and study centre are required' });
    }

    const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] });
    if (existingUser) {
      return res.status(409).json({ 
        error: 'Account already exists', 
        message: 'An account with this email or phone number already exists. Please login to your dashboard.',
        guideToLogin: true
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Referral Logic
    let referredByUser = null;
    if (referralCode && referralCode.trim()) {
      referredByUser = await User.findOne({
        referralCode: referralCode.trim().toUpperCase()
      });

      // Prevent self-referral (check if the referrer has the same email or phone)
      if (referredByUser && (referredByUser.email === email.toLowerCase() || referredByUser.phone === phone)) {
        // Track suspicious self-referral attempt
        const { trackActivity } = require('@utils/activityTracker');
        // Since the user is not created yet, we log it slightly differently or wait, 
        // but we can at least return an error to block the abuse.
        return res.status(400).json({ error: 'Self-referral is not allowed. Please use a valid referral code or leave it blank.' });
      }
    }

    // Generate Unique Referral Code for new user
    const newReferralCode = generateReferralCode(name);

    const user = await User.create({
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

    const accessToken = generateAccessToken(user._id, user.email);
    const refreshToken = generateRefreshToken(user._id);

    setAuthCookies(res, accessToken, refreshToken);

    // Track registration (initial login)
    await trackActivity(user._id, 'login', null, 'User registered and logged in');

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const users = await User.find({ email: email.toLowerCase() });
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let user = null;
    for (const u of users) {
      const isMatch = await bcrypt.compare(password, u.password);
      if (isMatch) {
        user = u;
        break;
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user._id, user.email);
    const refreshToken = generateRefreshToken(user._id);

    setAuthCookies(res, accessToken, refreshToken);

    // Track login activity
    await trackActivity(user._id, 'login', null, 'User logged in');

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    res.json({
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ message: 'Logged out successfully' });
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = generateAccessToken(user._id, user.email);
    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/'
    });

    res.json({ message: 'Token refreshed' });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ── PUBLIC: Check if any admin exists ─────────────────────────────────
router.get('/admin-exists', async (req, res) => {
  try {
    const adminExists = await User.exists({ role: 'admin' });
    res.json({ exists: !!adminExists });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check admin status' });
  }
});

// ── PUBLIC: First-time admin setup (only works if NO admin exists) ─────
router.post('/setup-admin', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const adminExists = await User.exists({ role: 'admin' });
    if (adminExists) {
      return res.status(403).json({ error: 'Admin already exists. This setup endpoint is disabled.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'admin'
    });

    res.status(201).json({
      message: 'Admin created successfully. Please log in.',
      admin: { _id: admin._id, name: admin.name, email: admin.email, role: 'admin' }
    });
  } catch (error) {
    console.error('Setup admin error:', error);
    res.status(500).json({ error: 'Failed to create admin' });
  }
});

module.exports = router;
