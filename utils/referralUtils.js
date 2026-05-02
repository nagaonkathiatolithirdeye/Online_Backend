const User              = require('@models/User');
const { trackActivity } = require('@utils/activityTracker');

const generateReferralCode = (name) => {
  if (!name) return `USER${Math.floor(1000 + Math.random() * 9000)}`;
  const baseCode = name.trim().split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').substring(0, 4);
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode || 'TECE'}${randomNum}`;
};

/**
 * Awards 50 reward points to the referrer when a referred student
 * completes a successful (paid/partial) enrollment. Idempotent.
 */
const processReferralReward = async (studentId) => {
  try {
    const student = await User.findById(studentId);
    if (!student || !student.referredBy) return null;

    const referrer = await User.findById(student.referredBy);
    if (!referrer) return null;

    if (!referrer.rewardedReferrals) referrer.rewardedReferrals = [];

    const isAlreadyRewarded = referrer.rewardedReferrals.some(
      (id) => id.toString() === student._id.toString()
    );

    if (isAlreadyRewarded) return { success: false, reason: 'Already rewarded' };

    referrer.rewardPoints = (referrer.rewardPoints || 0) + 50;
    referrer.rewardedReferrals.push(student._id);
    referrer.markModified('rewardedReferrals');
    await referrer.save();

    await trackActivity(
      referrer._id,
      'referral',
      null,
      `Received 50 reward points for referring ${student.name}`
    );

    const referralCount = referrer.rewardedReferrals.length;
    if ([3, 5, 10].includes(referralCount)) {
      await trackActivity(
        referrer._id,
        'referral',
        null,
        `MILESTONE REACHED: Successfully referred ${referralCount} students! Reward will be allotted at the certificate distribution ceremony.`
      );
    }

    return { success: true, referrerName: referrer.name, referralCount };
  } catch (error) {
    console.error('Error processing referral reward:', error);
    return null;
  }
};

module.exports = { generateReferralCode, processReferralReward };
