const express = require('express');
const router = express.Router();
const fs = require('fs');
// const { oAuth2Client, TOKEN_PATH } = require('../google/auth');

// Step 1: Redirect to Google
router.get('/auth/google', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent'
  });
  res.redirect(url);
});

// Step 2: Google callback
router.get('/auth/google/callback', async (req, res) => {
  try {
    const { tokens } = await oAuth2Client.getToken(req.query.code);
    oAuth2Client.setCredentials(tokens);

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    res.send('✅ Google Drive connected successfully. You can close this tab.');
  } catch (err) {
    console.error(err);
    res.status(500).send('OAuth failed');
  }
});

module.exports = router;
