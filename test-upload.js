const uploadToDrive = require('./helpers/uploadToDrive'); // correct relative path
const path = require('path');

(async () => {
  try {
    const filePath = path.join(__dirname, 'test-backup.txt'); // your test file
    const fileName = 'test-backup.txt'; // name it should have in Drive
    const folderId = null; // optional: set a Google Drive folder ID if you want

    await uploadToDrive(filePath, fileName, folderId);
    console.log('🎉 Test upload successful!');
  } catch (err) {
    console.error('❌ Upload failed:', err);
  }
})();
