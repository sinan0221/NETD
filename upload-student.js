// const uploadToDrive = require('./helpers/uploadToDrive'); // path to your upload function
// const path = require('path');

// (async () => {
//   try {
//     const filePath = path.join(__dirname, 'student.csv'); // path to your exported CSV
//     const fileName = 'Student Backup Sheet';

//     const folderId = null; // optional: put a Google Drive folder ID if you want to upload inside a folder

//     await uploadToDrive(filePath, fileName, folderId);
//     console.log('🎉 Student CSV uploaded successfully!');
//   } catch (err) {
//     console.error('❌ Upload failed:', err);
//   }
// })();
// const path = require('path');
// const generateStudentCSV = require('./helpers/generateStudentCSV');
// const uploadToDrive = require('./helpers/uploadToDrive');
// const db = require('./config/connection');
// const collection = require('./config/collections');

// db.connect(async (err) => {
//   try {
//     if (err) {
//       console.error("❌ DB connection failed", err);
//       return;
//     }

//     const students = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .find({})
//       .toArray();
//       console.log("STUDENTS COUNT:", students.length);
//       console.log("FIRST STUDENT:", students[0]);
      
//     const filePath = path.join(__dirname, 'student.csv');

//     generateStudentCSV(students, filePath);

//     await uploadToDrive(filePath, 'Student Backup Sheet');

//     console.log('🎉 STUDENT BACKUP DONE (FULL TABLE)');
//   } catch (error) {
//     console.error('❌ Backup failed:', error);
//   }
// });

