# Third Eye Computer Education — Backend

Node.js + Express + MongoDB REST API for the Third Eye Computer Education learning platform.

---

## 📋 Project Overview

This backend powers:
- **Student registration & authentication** (JWT via HTTP-only cookies)
- **Course management** (CRUD for courses, videos, mock tests)
- **Enrollment & payment tracking** (admin approval workflow)
- **Referral system** (auto-reward points on successful enrollment)
- **Exam booking & eligibility** checks
- **Doubt session scheduling**
- **Leaderboard** (top performers by course progress)
- **Email notifications** (Gmail SMTP via Nodemailer)

---

## ⚙️ Setup Instructions

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env.node` and fill in all values:
```bash
cp .env.example .env.node
```

### 3. Run in development
```bash
npm run dev
```

### 4. Run in production
```bash
npm start
```

---

## 🔑 Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Port the server runs on (default: `8005`) |
| `NODE_ENV` | `development` or `production` |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string for signing JWTs |
| `JWT_EXPIRES_IN` | Token expiry e.g. `24h` |
| `FRONTEND_URL` | Allowed CORS origin (your frontend URL) |
| `GMAIL_USER` | Gmail address used for sending emails |
| `GMAIL_PASS` | Gmail App Password (not your real password) |
| `ADMIN_EMAIL` | Admin email to receive enrollment notifications |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (for media uploads) |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

> ⚠️ **Never commit `.env.node` to version control.** It is already in `.gitignore`.

---

## 🌐 API Base URL

- **Development:** `http://localhost:8005`
- **Production:** Your deployed backend URL (e.g. `https://your-app.onrender.com`)

### Main Route Groups
| Prefix | Description |
|---|---|
| `/api/auth` | Register, login, logout, token refresh |
| `/api/courses` | Course listing and content |
| `/api/enrollments` | Student enrollment |
| `/api/users` | Dashboard data |
| `/api/admin` | All admin operations |
| `/api/exams` | Exam booking |
| `/api/doubt-sessions` | Doubt session management |
| `/api/leaderboard` | Top performers |
| `/api/health` | Health check endpoint |

---

## 🚀 Deployment (Render)

1. Push your code to GitHub (ensure `.env.node` is in `.gitignore`)
2. Create a new **Web Service** on [Render](https://render.com)
3. Set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add all environment variables from `.env.example` in the Render dashboard
5. Set `NODE_ENV=production` and `FRONTEND_URL=https://your-frontend.com`
6. For `MONGO_URI`, use a cloud MongoDB (e.g. [MongoDB Atlas](https://cloud.mongodb.com))

---

## 🔒 Security Notes

- JWTs are stored in **HTTP-only cookies** — not accessible to JavaScript
- Passwords are hashed with **bcrypt** (10 salt rounds)
- Rate limiting is applied: **20 req/15min** on auth routes, **200 req/15min** on all others
- `NODE_ENV=production` hides internal error details from API responses
- CORS is restricted to `FRONTEND_URL` in production

---

## 📁 Project Structure

```
backend/
├── config/
│   └── database.js          # MongoDB connection
├── middleware/
│   └── authMiddleware.js    # JWT auth + admin guards
├── models/
│   ├── User.js
│   ├── Course.js
│   ├── Enrollment.js
│   ├── Exam.js
│   ├── DoubtSession.js
│   └── ActivityLog.js
├── routes/
│   ├── authRoutes.js
│   ├── adminRoutes2.js
│   ├── courseRoutes.js
│   ├── enrollmentRoutes.js
│   ├── examRoutes.js
│   ├── doubtSessionRoutes.js
│   ├── leaderboardRoutes.js
│   └── userRoutes.js
├── utils/
│   ├── activityTracker.js
│   ├── emailService.js
│   ├── jwtUtils.js
│   ├── referralUtils.js
│   └── seedAdmin.js
├── .env.node                # Your actual env (git-ignored)
├── .env.example             # Template for env setup
├── package.json
└── server.js                # Application entry point
```
