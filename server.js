
require('module-alias/register');  // ← MUST be the very first line

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const compression  = require('compression');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const connectDB  = require('@config/database');
const seedAdmin  = require('@utils/seedAdmin');

const app    = express();
const isProd = process.env.NODE_ENV === 'production';

// Enable trust proxy to correctly detect client IPs behind Render/Netlify
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'https://onlinefullstack.netlify.app',
  'https://onlinefrontend.netlify.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins in development mode or if the origin is a local network IP
    const isLocalOrigin = origin?.startsWith('http://localhost') || 
                         origin?.startsWith('http://127.0.0.1') || 
                         origin?.startsWith('http://10.') || 
                         origin?.startsWith('http://192.168.');

    if (!isProd || isLocalOrigin) {
      return callback(null, true);
    }
    // Restrict to allowedOrigins in production
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS blocked'));
    }
  },
  credentials: true
}));

// ── CORE MIDDLEWARE ───────────────────────────────────────────────────
app.use(compression());
app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── SECURITY HEADERS ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Content Security Policy (Basic)
  res.setHeader('Content-Security-Policy', "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https: fonts.googleapis.com; font-src 'self' https: data: fonts.gstatic.com; img-src 'self' https: data:; media-src 'self' https: blob:; connect-src 'self' https:;");
  next();
});

// ── RATE LIMITING ─────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased from 20 for school/shared IP environments
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Increased from 200
  message: { error: 'Too many requests, please try again later.' },
});

app.use('/api/auth', authLimiter);
app.use('/api/', apiLimiter);

// ── ROUTES ────────────────────────────────────────────────────────────
app.use('/api/auth',           require('@routes/authRoutes'));
app.use('/api/courses',        require('@routes/courseRoutes'));
app.use('/api/enrollments',    require('@routes/enrollmentRoutes'));
app.use('/api/users',          require('@routes/userRoutes'));
app.use('/api/leaderboard',    require('@routes/leaderboardRoutes'));
app.use('/api/exams',          require('@routes/examRoutes'));
app.use('/api/doubt-sessions', require('@routes/doubtSessionRoutes'));
app.use('/api/admin',          require('@routes/adminRoutes2'));

// ── HEALTH CHECK ──────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  try {
    res.json({ status: 'ok', message: 'Third Eye Education Platform API is running' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── SERVE FRONTEND (PRODUCTION) ───────────────────────────────────────
const frontendBuildPath = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuildPath));

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// SPA catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (isProd) {
    res.status(err.status || 500).json({ error: 'Internal Server Error' });
  } else {
    console.error(err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
  }
});

// ── START ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8005;

const startServer = async () => {
  try {
    await connectDB();
    await seedAdmin();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT} [${isProd ? 'production' : 'development'}]`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};


// ── GLOBAL UNEXPECTED ERROR HANDLERS ─────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION! Shutting down...');
  console.error(reason);
  // Give the server a second to log properly before exiting
  setTimeout(() => process.exit(1), 1000);
});

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

startServer();
