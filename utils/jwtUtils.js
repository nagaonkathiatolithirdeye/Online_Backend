const jwt    = require('jsonwebtoken');
const isProd = process.env.NODE_ENV === 'production';

const generateAccessToken = (userId, email) => {
  return jwt.sign(
    { userId, email, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

const setAuthCookies = (res, accessToken, refreshToken) => {
  const cookieOpts = (maxAge) => ({
    httpOnly: true,
    secure: isProd,              // true on Render (HTTPS), false locally
    sameSite: isProd ? 'none' : 'lax', // 'none' required for cross-origin on HTTPS
    maxAge,
    path: '/'
  });

  res.cookie('access_token',  accessToken,  cookieOpts(15 * 60 * 1000));
  res.cookie('refresh_token', refreshToken, cookieOpts(7 * 24 * 60 * 60 * 1000));
};

const clearAuthCookies = (res) => {
  const clearOpts = { path: '/', httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' };
  res.clearCookie('access_token',  clearOpts);
  res.clearCookie('refresh_token', clearOpts);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setAuthCookies,
  clearAuthCookies
};
