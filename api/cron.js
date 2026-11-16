const crypto = require('node:crypto');
const { runDailyNewsJob } = require('../src/jobs/daily-news-job');

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const value = req.headers && req.headers.authorization || '';
  if (!secret || !value.startsWith('Bearer ')) return false;

  const expected = Buffer.from('Bearer ' + secret);
  const actual = Buffer.from(value);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = async function cronHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).setHeader('Allow', 'GET').json({
      success: false,
      error: 'Method Not Allowed'
    });
  }

  if (!authorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const result = await runDailyNewsJob();
    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        error: 'Daily run already claimed or delivered'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Daily news job failed'
    });
  }
};
