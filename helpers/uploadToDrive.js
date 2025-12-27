

// const { google } = require('googleapis');
// const fs = require('fs');
// const { oAuth2Client } = require('../google/auth');

// async function uploadToDrive(filePath, fileName, folderId = null) {
//   const drive = google.drive({ version: 'v3', auth: oAuth2Client });

//   // Force refresh access token
//   await oAuth2Client.getAccessToken();

//   const fileMetadata = { name: fileName };
//   if (folderId) fileMetadata.parents = [folderId];

//   await drive.files.create({
//     requestBody: fileMetadata,
//     media: { body: fs.createReadStream(filePath) }
//   });

//   console.log(`✅ Uploaded: ${fileName}`);
// }

// module.exports = uploadToDrive;
const { google } = require('googleapis');
const fs = require('fs');
const { oAuth2Client } = require('../google/auth');

async function uploadToDrive(filePath, fileName, folderId = null) {
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  await oAuth2Client.getAccessToken();

  // Upload CSV
  const uploadRes = await drive.files.create({
    requestBody: {
      name: fileName + '.csv',
      parents: folderId ? [folderId] : []
    },
    media: {
      mimeType: 'text/csv',
      body: fs.createReadStream(filePath)
    },
    fields: 'id'
  });

  // Convert to Google Sheet (PARSES COLUMNS)
  const sheetRes = await drive.files.copy({
    fileId: uploadRes.data.id,
    requestBody: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet'
    }
  });

  // Delete CSV
  await drive.files.delete({ fileId: uploadRes.data.id });

  console.log('📊 Google Sheet READY AS TABLE');
  return sheetRes.data.id;
}

module.exports = uploadToDrive;
