// // routes/backup.js
// const express = require('express');
// const fs = require('fs');
// const path = require('path');
// const archiver = require('archiver');
// const { google } = require('googleapis');

// const {
//   getOAuthClient,
//   getAuthorizedClient,
//   TOKEN_PATH,
//   SCOPES
// } = require('../services/googleDrive'); // Make sure path is correct

// const router = express.Router();

// // ==============================
// // STEP 1: Start OAuth
// // ==============================
// router.get('/auth', (req, res) => {
//   try {
//     const auth = getOAuthClient();
//     const url = auth.generateAuthUrl({
//       access_type: 'offline',
//       scope: SCOPES
//     });
//     console.log('OAuth URL:', url); // Debug: check URL sent to Google
//     res.redirect(url);
//   } catch (err) {
//     console.error('Error generating OAuth URL:', err);
//     res.status(500).send('❌ Error generating OAuth URL');
//   }
// });

// // ==============================
// // STEP 2: OAuth callback
// // ==============================
// router.get('/oauth2callback', async (req, res) => {
//   try {
//     const { code } = req.query;
//     if (!code) return res.status(400).send("❌ No code found in query. Start from /backup/auth.");

//     const auth = getOAuthClient();
//     const { tokens } = await auth.getToken(code);
//     auth.setCredentials(tokens);

//     // Save token.json
//     fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
//     console.log('✅ Token saved at:', TOKEN_PATH);

//     res.send('✅ Google Drive connected successfully. You can close this tab.');
//   } catch (err) {
//     console.error('OAuth callback error:', err);
//     res.status(500).send('❌ OAuth callback error. Check server console.');
//   }
// });

// // ==============================
// // STEP 3: Backup uploads folder to Google Drive
// // ==============================
// router.get('/run', async (req, res) => {
//   try {
//     const auth = await getAuthorizedClient();
//     if (!auth) return res.redirect('/backup/auth');

//     const drive = google.drive({ version: 'v3', auth });

//     const zipPath = path.join(__dirname, '../backup.zip');
//     const output = fs.createWriteStream(zipPath);
//     const archive = archiver('zip', { zlib: { level: 9 } });

//     archive.pipe(output);
//     archive.directory(path.join(__dirname, '../public/uploads'), false);

//     // Wait until zip finishes
//     await new Promise((resolve, reject) => {
//       output.on('close', resolve);
//       archive.on('error', reject);
//       archive.finalize();
//     });

//     // Upload to Google Drive
//     const response = await drive.files.create({
//       requestBody: {
//         name: `NETD-backup-${Date.now()}.zip`
//       },
//       media: {
//         mimeType: 'application/zip',
//         body: fs.createReadStream(zipPath)
//       }
//     });

//     // Delete local zip file
//     fs.unlinkSync(zipPath);

//     res.json({
//       success: true,
//       fileId: response.data.id,
//       message: '✅ Backup uploaded to Google Drive successfully.'
//     });
//   } catch (err) {
//     console.error('Backup error:', err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// module.exports = router;
// routes/backup.js
// routes/backup.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { google } = require('googleapis');

const {
  getOAuthClient,
  getAuthorizedClient,
  TOKEN_PATH,
  SCOPES
} = require('../services/googleDrive');

const router = express.Router();

// ==============================
// STEP 1: Start OAuth
// ==============================
router.get('/auth', (req, res) => {
  const auth = getOAuthClient();
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });

  console.log('OAuth URL:', url);
  res.redirect(url);
});

// ==============================
// STEP 2: OAuth callback
// ==============================
router.get('/oauth2callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('❌ No code found. Start from /backup/auth');
    }

    const auth = getOAuthClient();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('✅ Token saved at:', TOKEN_PATH);

    res.send('✅ Google Drive connected successfully. You can close this tab.');
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).send('❌ OAuth failed');
  }
});

// ==============================
// STEP 3: Backup STORAGE folder
// ==============================
router.get('/run', async (req, res) => {
  try {
    const auth = await getAuthorizedClient();
    if (!auth) return res.redirect('/backup/auth');

    const drive = google.drive({ version: 'v3', auth });

    // 🔥 CORRECT STORAGE PATH
    const STORAGE_DIR = path.join(__dirname, '../storage');

    console.log('🔍 Looking for storage at:', STORAGE_DIR);

    if (!fs.existsSync(STORAGE_DIR)) {
      return res.status(400).json({
        success: false,
        message: '❌ storage folder not found'
      });
    }

    const zipPath = path.join(__dirname, '../storage-backup.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(STORAGE_DIR, false);

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.finalize();
    });

    const response = await drive.files.create({
      requestBody: {
        name: `NETD-storage-backup-${Date.now()}.zip`
      },
      media: {
        mimeType: 'application/zip',
        body: fs.createReadStream(zipPath)
      }
    });

    fs.unlinkSync(zipPath);

    res.json({
      success: true,
      fileId: response.data.id,
      message: '✅ Storage backup uploaded to Google Drive successfully.'
    });

  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
