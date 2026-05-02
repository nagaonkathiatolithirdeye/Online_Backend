const User = require('@models/User');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const seedAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@thirdeye.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';

    let existingAdmin = await User.findOne({ email: adminEmail });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await User.create({
        name: 'Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin'
      });
    }

    // Write test credentials to a safe local path
    // Using process.cwd() ensures it works on Windows and Linux
    const credentialsPath = path.join(process.cwd(), 'temp_credentials.md');

    const credentials = `# Test Credentials

## Admin Account
- Email: ${adminEmail}
- Password: ${adminPassword}
- Role: admin

## Auth Endpoints
- Login: POST /api/auth/login
- Register: POST /api/auth/register
- Get Me: GET /api/auth/me
- Logout: POST /api/auth/logout
`;

    fs.writeFileSync(credentialsPath, credentials);

  } catch (error) {
    console.error('Error seeding admin:', error);
  }
};

module.exports = seedAdmin;
