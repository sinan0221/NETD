var express = require('express');
var router = express.Router();
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs'); 
const fsp = require('fs').promises;
const hbs = require('hbs');
const fontkit = require('fontkit');
const jpegRotate = require('jpeg-autorotate');
const archiver = require("archiver");
const ExcelJS = require("exceljs");


// Node's File System module for cleanup
const centerHelpers = require('../helpers/center-helpers');
const studentHelpers = require('../helpers/student-helper');
const batchHelpers=require('../helpers/batch-helpers');


const db = require('../config/connection');
const collection = require('../config/collections');
const { ObjectId } = require('mongodb');


const uploadDir = path.join(__dirname, '../public/images/institution_logos');
const deptUploadDir = path.join(__dirname, '../public/images/department_logos');



/* ================================
   MIDDLEWARE
   ================================ */
function verifyAdminLogin(req, res, next) {
  if (req.session.adminLoggedIn) {
    next();
  } else {
    res.redirect('/admin/login');
  }
}
//middle ware for auto rotate of image
async function fixImageOrientation(imageBuffer) {
  try {
    const { buffer } = await jpegRotate.rotate(imageBuffer, { quality: 90 });
    return buffer;
  } catch (error) {
    // If rotation fails (not a JPEG or no EXIF data), return original buffer
    console.log('No rotation needed or not a JPEG');
    return imageBuffer;
  }
}

/* ================================
   AUTH ROUTES
   ================================ */

// Admin login page
router.get('/login', (req, res) => {
  if (req.session.adminLoggedIn) {
    res.redirect('/admin');
  } else {
    res.render('admin/login', { loginErr: req.session.loginErr });
    req.session.loginErr = false;
  }
});

// Admin login POST
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // ✅ Hardcoded check (replace with DB if needed)
  if (username === "admin" && password === "2025") {
    req.session.adminLoggedIn = true;
    req.session.admin = { username };
    res.redirect('/admin');
  } else {
    req.session.loginErr = "Invalid Credentials";
    res.redirect('/admin/login');
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

/* ================================
   ADMIN DASHBOARD + CENTERS
   ================================ */

// Dashboard (list all centers)
router.get('/', verifyAdminLogin, (req, res) => {
  centerHelpers.getAllCenters().then((centers) => {
    res.render('admin/view-centre', { admin: true, centers });
  });
});

// Add Center
router.get('/add-center', verifyAdminLogin, (req, res) => {
  res.render('admin/add-center', { hideNavbar: true });
});

// router.post('/add-center', verifyAdminLogin, (req, res) => {
//   centerHelpers.addCenter(req.body, () => {
//     res.redirect('/admin');
//   });
// });
router.post('/add-center', verifyAdminLogin, (req, res) => {

  // Ensure courseName is always an array
  if (!Array.isArray(req.body.courseName)) {
    req.body.courseName = [req.body.courseName];
  }

  // Remove empty values
  req.body.courseName = req.body.courseName.filter(c => c.trim() !== "");

  centerHelpers.addCenter(req.body, () => {
    res.redirect('/admin');
  });
});

// Delete Center
router.get('/delete-center/:id', verifyAdminLogin, (req, res) => {
  let centId = req.params.id;
  centerHelpers.deleteCenter(centId).then(() => {
    res.redirect('/admin');
  });
});
// ✏️ EDIT CENTER (GET)
router.get('/edit-center/:id', verifyAdminLogin, async (req, res) => {
  try {
    const centerId = req.params.id;

    // 1️⃣ Get specific center details
    const center = await centerHelpers.getCenterDetails(centerId);
    if (!center) {
      return res.status(404).send("Center not found");
    }

    // 2️⃣ Fetch all unique dropdown values from DB
    const dbInstance = db.get().collection(collection.CENTER_COLLECTION);

    const schemes = await dbInstance.distinct("scheme");
    const colleges = await dbInstance.distinct("college");
    const sectors = await dbInstance.distinct("sector");
    const departments = await dbInstance.distinct("department");

    // ⭐ ADD THIS
    const courses = await dbInstance.distinct("courseName");

    // 3️⃣ Render edit-center.hbs with all data
    res.render('admin/edit-center', { 
      admin: true,
      hideNavbar: true,
      center,
      schemes,
      colleges,
      sectors,
      departments,
      courses   // ⭐ ADD THIS
    });

  } catch (err) {
    console.error("❌ Error fetching center:", err);
    res.status(500).send("Error loading center details");
  }
});


// 💾 EDIT CENTER (POST)
// router.post('/edit-center/:id', verifyAdminLogin, async (req, res) => {
//   try {
//     await centerHelpers.updateCenter(req.params.id, req.body);
//     res.redirect('/admin');
//   } catch (err) {
//     console.error("❌ Error updating center:", err);
//     res.status(500).send("Error updating center");
//   }
// });
router.post('/edit-center/:id', verifyAdminLogin, async (req, res) => {

  if (!Array.isArray(req.body.courseName)) {
    req.body.courseName = [req.body.courseName];
  }

  try {
    await centerHelpers.updateCenter(req.params.id, req.body);
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating");
  }
});



// ===========================
// EXPORT STUDENTS WITH IMAGE TO EXCEL
// ===========================
router.get("/export-students-excel/:centreId", verifyAdminLogin, async (req, res) => {
  try {
    const { centreId } = req.params;
    const objectId = new ObjectId(centreId);

    const ExcelJS = require("exceljs");
    const fs = require("fs");
    const path = require("path");

    // Fetch Centre
    const centre = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .findOne({ _id: objectId });

    if (!centre) return res.status(404).send("Centre not found");
    const centreName = centre.centreName;

    // Fetch batches of centre
    const batches = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .find({ centreId: objectId })
      .toArray();

    if (!batches.length) return res.status(404).send("No batches under this centre");

    const batchIds = batches.map(b => b._id);

    // Fetch students under those batches
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: { $in: batchIds } })
      .toArray();

    if (!students.length) return res.status(404).send("No students found");

    // Workbook + Sheet
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Students");

    sheet.columns = [
      { header: "Center Name", key: "centerName", width: 25 },
      { header: "Register No", key: "regNo", width: 15 },
      { header: "Student Name", key: "name", width: 25 },
      { header: "Phone No", key: "phone", width: 15 },
      { header: "Course Name", key: "course", width: 20 },
      { header: "Duration", key: "duration", width: 15 },
      { header: "Join Date", key: "joinDate", width: 15 },
      { header: "Photo", key: "photo", width: 12 }
    ];

    const imgBasePath = path.join(__dirname, "../public/studentImages/");

    students.forEach((student, index) => {
      const row = sheet.addRow({
        centerName: centreName,
        regNo: student.regNo || "",
        name: student.fullName || "",
        phone: student.number || "",
        course: student.courseName || "",
        duration: student.courseDuration || "",
        joinDate: student.createdAt ? new Date(student.createdAt).toLocaleDateString('en-IN') : ""
      });

      // Check and attach image
      const possibleExt = ["jpg", "jpeg", "png"];
      let photoPath = null;

      for (const ext of possibleExt) {
        const p = path.join(imgBasePath, `${student._id}.${ext}`);
        if (fs.existsSync(p)) {
          photoPath = p;
          break;
        }
      }

      if (photoPath) {
        const imageId = workbook.addImage({
          filename: photoPath,
          extension: photoPath.split('.').pop()
        });

        sheet.addImage(imageId, {
          tl: { col: 7, row: index + 1 },  // Photo cell
          ext: { width: 60, height: 60 }   // Image size
        });

        sheet.getRow(index + 2).height = 50; // row height
      }
    });

    const fileName = `Students_${centreName}_${Date.now()}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.log("❌ Excel Export Error:", err);
    res.status(500).send("Error exporting Excel");
  }
});



// Add batch
router.get('/add-batch', verifyAdminLogin, (req, res) => {
  res.render('admin/add-batch', { hideNavbar: true });
});

router.post('/add-batch', verifyAdminLogin, (req, res) => {
  batchHelpers.addBatch(req.body, () => {
    res.redirect('/admin');
  });
});
// View all batches
router.get('/view-batch', verifyAdminLogin, async (req, res) => {
  try {
    const batches = await batchHelpers.getAllBatchesWithCentre();

    res.render('admin/view-batch', { batches, admin: true });
  } catch (err) {
    console.error("❌ Error fetching batches:", err);
    res.status(500).send("Error loading batches");
  }
});
//edit batch:
router.get('/edit-batch/:id', verifyAdminLogin, async (req, res) => {
  try {
    let batchId = req.params.id;
    let batch = await batchHelpers.getBatchDetails(batchId);
    

    if (!batch) {
      return res.status(404).send("batch not found");
    }

    res.render('admin/edit-batch', { 
      admin: true, 
      hideNavbar: true,
      batch // 👈 pass center to hbs
    });
  } catch (err) {
    console.error("❌ Error fetching batch:", err);
    res.status(500).send("Error loading batch details");
  }
});
//post route:
router.post('/edit-batch/:id', verifyAdminLogin, async (req, res) => {
  try {
    await batchHelpers.updateBatch(req.params.id, req.body);
    res.redirect('/admin');
  } catch (err) {
    console.error("❌ Error updating batch:", err);
    res.status(500).send("Error updating batch");
  }
});
// View Batches by Centre

router.get('/view-cbatch/:centreId', verifyAdminLogin, async (req, res) => {
  try {
    const centreId = req.params.centreId;

    // Fetch all batches
    let batches = await batchHelpers.getBatchesByCentre(centreId);

    const oneMonth = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();

    // Hide batches downloaded more than 1 month ago
    batches = batches.filter(batch => {
      if (!batch.certificateDownloadAt) {
        // Not downloaded → keep visible
        return true;
      }

      const downloadedAt = new Date(batch.certificateDownloadAt).getTime();
      const difference = now - downloadedAt;

      // Show only if within 1 month
      return difference <= oneMonth;
    });

    res.render('admin/view-cbatch', {
      admin: true,
      batches,
      centreId
    });

  } catch (err) {
    console.error("Error loading batches:", err);
    res.status(500).send("Internal server error");
  }
});





// Delete batch
router.get('/delete-batch/:id', verifyAdminLogin, (req, res) => {
  let batchId = req.params.id;
  batchHelpers.deleteBatch(batchId).then(() => {
    res.redirect('/admin');
  });
});


/* ================================
   STUDENT MANAGEMENT
   ================================ */


/* ================================
   STUDENT APPROVAL SYSTEM - FIXED
   ================================ */

// View ALL Students (Both activated and not activated)
router.get('/view-student', verifyAdminLogin, async (req, res) => {
  try {
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({})
      .toArray();

    res.render('admin/view-student', { 
      students, 
      admin: true,
      pageTitle: 'All Students'
    });
  } catch (err) {
    console.error("❌ Error fetching students:", err);
    res.status(500).send("Error loading students");
  }
});

//add student

// router.get('/add-student', verifyAdminLogin, async (req, res) => {
//   try {
//     const centreId = req.query.centreId; // get center ID from URL
//     if (!centreId) {
//       return res.status(400).send("Centre ID is missing");
//     }

//     // 🔹 Fetch the center by its _id (from Mongo)
//     const center = await centerHelpers.getCenterDetails(centreId);
//     if (!center) {
//       return res.status(404).send("Center not found");
//     }

//     // 🔹 Get batches (if needed)
//     const batches = await batchHelpers.getAllBatchesWithCentre();

//     // 🔹 Pass full center data to view
//     res.render('admin/add-student', {
//       admin: true,
//       hideNavbar: true,
//       centreId: center.centreId,        // human-friendly ID
//       centreName: center.centreName,
//       department: center.department,    // department from center
//       batches
//     });

//   } catch (err) {
//     console.error("❌ Error loading add-student page:", err);
//     res.status(500).send("Error loading add-student page");
//   }
// });
router.get('/add-student', verifyAdminLogin, async (req, res) => {
  try {
    const centreId = req.query.centreId;
    if (!centreId) return res.status(400).send("Centre ID is missing");

    const center = await centerHelpers.getCenterDetails(centreId);
    if (!center) return res.status(404).send("Center not found");

    // const batches = await batchHelpers.getAllBatchesWithCentre();
    const batches = await batchHelpers.getBatchesByCentre(centreId); 


    res.render('admin/add-student', {
      admin: true,
      hideNavbar: true,
      centreId: center.centreId,
      centreName: center.centreName,
      department: center.department,
      centre: center,
      courseNames: center.courseName,  // <-- IMPORTANT
      batches
    });

  } catch (err) {
    console.error("❌ Error loading add-student page:", err);
    res.status(500).send("Error loading add-student page");
  }
});




router.post('/add-student', verifyAdminLogin, (req, res) => {
  // 🟢 Raw form data
  console.log("📥 Raw Form Data:", req.body);

  // 🟢 Prepare qualification objects
  let qualifications = [];

  let eduArr = Array.isArray(req.body['education[]']) ? req.body['education[]'] : [req.body['education[]']];
  let maxArr = Array.isArray(req.body['maxMarks[]']) ? req.body['maxMarks[]'] : [req.body['maxMarks[]']];
  let minArr = Array.isArray(req.body['minMarks[]']) ? req.body['minMarks[]'] : [req.body['minMarks[]']];
  let obtArr = Array.isArray(req.body['obtainedMarks[]']) ? req.body['obtainedMarks[]'] : [req.body['obtainedMarks[]']];
  let gradeArr = Array.isArray(req.body['grade[]']) ? req.body['grade[]'] : [req.body['grade[]']];
  let yearArr = Array.isArray(req.body['year[]']) ? req.body['year[]'] : [req.body['year[]']];
  let boardArr = Array.isArray(req.body['board[]']) ? req.body['board[]'] : [req.body['board[]']];

  eduArr.forEach((edu, i) => {
    if (edu && maxArr[i] && yearArr[i]) {   // filter out empty rows
      qualifications.push({
        education: edu,
        maxMarks: maxArr[i],
        minMarks: minArr[i],
        obtainedMarks: obtArr[i],
        grade: gradeArr[i],
        year: yearArr[i],
        board: boardArr[i]
      });
    }
  });

  console.log("🎓 Qualifications Parsed:", qualifications);

  // Merge qualifications into req.body
  let studentData = {
    ...req.body,
    qualifications
  };
  studentData.activated = false;


  studentHelpers.addStudent(studentData, (id) => {
    if (req.files && req.files.image) {
      let imageFile = req.files.image;
      let uploadPath = path.join(__dirname, '../public/studentImages/', id + '.jpg');

      imageFile.mv(uploadPath, (err) => {
        if (err) console.error("❌ Error saving image:", err);
      });
    }
    res.redirect('/admin/view-student');
  });
});

// Edit Student Route
router.get('/edit-student/:id', verifyAdminLogin, async (req, res) => {
  try {
      const studentId = req.params.id;
      const student = await studentHelpers.getStudentDetails(studentId);
      const batches = await batchHelpers.getAllBatchesWithCentre();
      
      res.render('admin/edit-student', {
          admin: true,
          hideNavbar: true,
          student,
          batches
      });
  } catch (error) {
      console.error("❌ Error loading edit student:", error);
      res.status(500).send("Error loading edit form");
  }
});
// ===========================
// UPDATE STUDENT - POST ROUTE
// ===========================
router.post('/update-student/:id', verifyAdminLogin, (req, res) => {
  const studentId = req.params.id;
  
  // 🟢 Raw form data
  console.log("📥 Raw Update Form Data:", req.body);

  // 🟢 Prepare qualification objects
  let qualifications = [];

  let eduArr = Array.isArray(req.body['education[]']) ? req.body['education[]'] : [req.body['education[]']];
  let maxArr = Array.isArray(req.body['maxMarks[]']) ? req.body['maxMarks[]'] : [req.body['maxMarks[]']];
  let minArr = Array.isArray(req.body['minMarks[]']) ? req.body['minMarks[]'] : [req.body['minMarks[]']];
  let obtArr = Array.isArray(req.body['obtainedMarks[]']) ? req.body['obtainedMarks[]'] : [req.body['obtainedMarks[]']];
  let gradeArr = Array.isArray(req.body['grade[]']) ? req.body['grade[]'] : [req.body['grade[]']];
  let yearArr = Array.isArray(req.body['year[]']) ? req.body['year[]'] : [req.body['year[]']];
  let boardArr = Array.isArray(req.body['board[]']) ? req.body['board[]'] : [req.body['board[]']];

  eduArr.forEach((edu, i) => {
    if (edu && maxArr[i] && yearArr[i]) {   // filter out empty rows
      qualifications.push({
        education: edu,
        maxMarks: maxArr[i],
        minMarks: minArr[i],
        obtainedMarks: obtArr[i],
        grade: gradeArr[i],
        year: yearArr[i],
        board: boardArr[i]
      });
    }
  });

  console.log("🎓 Updated Qualifications:", qualifications);

  // Merge qualifications into req.body
  let studentData = {
    ...req.body,
    qualifications
  };

  // Update student in database
  studentHelpers.updateStudent(studentId, studentData)
    .then((response) => {
      // Handle photo update if new image is uploaded
      if (req.files && req.files.image) {
        let imageFile = req.files.image;
        let uploadPath = path.join(__dirname, '../public/studentImages/', studentId + '.jpg');

        imageFile.mv(uploadPath, (err) => {
          if (err) {
            console.error("❌ Error updating image:", err);
          } else {
            console.log("✅ Student photo updated");
          }
        });
      }
      
      console.log("✅ Student updated successfully");
      res.redirect('/admin/view-student');
    })
    .catch((err) => {
      console.error("❌ Error updating student:", err);
      res.status(500).send("Error updating student");
    });
});


// Delete Student
router.get('/delete-student/:id', verifyAdminLogin, (req, res) => {
  let studentId = req.params.id;
  studentHelpers.deleteStudent(studentId).then(() => {
    res.redirect('/admin/view-student');
  }).catch((err) => {
    console.error("❌ Error deleting student:", err);
    res.status(500).send("Error deleting student");
  });
});


// });// ✅ View Students by Batch (Fixed: Centre ID now passed to view)
router.get('/view-bstudent/:batchId', verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log("🔄 Loading students for batch:", batchId);

    // 1️⃣ Fetch batch to get its centreId
    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    if (!batch) {
      console.log("❌ Batch not found:", batchId);
      return res.status(404).render('error', { error: "Batch not found" });
    }

    const centreId = batch.centreId; // ✅ This is what your button needs

    // 2️⃣ Get all students under this batch
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: new ObjectId(batchId), activated: true })
      .toArray();

    // 3️⃣ Add status flags
    const processedStudents = students.map(student => {
      const hasFailed =
        Array.isArray(student.marks?.subjects) &&
        student.marks.subjects.some(sub => sub.result === 'FAILED');

      return {
        ...student,
        hasFailed,
        hasSupply: student.hasSupply || false
      };
    });

    // 4️⃣ Render page with all values
    res.render('admin/view-bstudent', {
      admin: true,
      students: processedStudents,
      batchId,
      centreId, // ✅ Now available for your <a href="/admin/add-student?centreId={{centreId}}">
      batchName: batch.batchName,
      // optional, to show in heading
    });

  } catch (error) {
    console.error("❌ Error loading students for batch:", error);
    res.status(500).render('error', { error: "Failed to load students" });
  }
});

//search button
// Global search from header - shows all matching students
// router.get('/search', verifyAdminLogin, async (req, res) => {
//   try {
//     const keyword = req.query.q;
//     const batchId = req.query.batchId; // Optional: if searching within a batch

//     if (!keyword || keyword.trim() === "") {
//       // If no keyword, redirect appropriately
//       if (batchId) {
//         return res.redirect(`/admin/view-bstudent/${batchId}`);
//       }
//       return res.redirect('/admin/view-student');
//     }

//     console.log("🔍 Searching for:", keyword);

//     const results = await studentHelpers.searchStudents(keyword);

//     res.render('admin/search-results', {
//       admin: true,
//       results,
//       keyword,
//       batchId: batchId || null,
//       fromHeader: true // Flag to indicate search came from header
//     });

//   } catch (error) {
//     console.error("❌ Error in search route:", error);
//     res.status(500).render('error', { error: "Search failed" });
//   }
// });
// Global search from header - shows ALL matching students
// Simple search route - shows all matching students
router.get('/search', verifyAdminLogin, async (req, res) => {
  try {
    const keyword = req.query.q;

    if (!keyword || keyword.trim() === "") {
      return res.redirect('/admin/view-student');
    }

    console.log("🔍 Searching for:", keyword);

    // Search all students
    const results = await studentHelpers.searchStudents(keyword);

    res.render('admin/search-results', {
      admin: true,
      results,
      keyword
    });

  } catch (error) {
    console.error("❌ Error in search route:", error);
    res.status(500).render('error', { error: "Search failed" });
  }
});

// ===========================
// ID CARD - PREVIEW with Download Button
// ===========================
router.get('/id-card-preview/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // Fetch the student
    const student = await db.get().collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send('Student not found');
    }

    // Fetch the center details using student's centreId
    const centre = await db.get().collection(collection.CENTER_COLLECTION)
      .findOne({ centreId: student.centreId });

    // Calculate dates
    const issueDate = new Date().toLocaleDateString('en-GB');
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const expiryDateFormatted = expiryDate.toLocaleDateString('en-GB');

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    
    // ID Card dimensions (2.63in x 3.88in converted to points)
    const width = 2.63 * 72;
    const height = 3.88 * 72;
    const page = pdfDoc.addPage([width, height]);

    // Load background image
    const bgPath = path.join(__dirname, "../public/images/id-card.jpg");
    const bgBytes = fs.readFileSync(bgPath);
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    
    // Draw background
    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: width,
      height: height,
    });

    // Load fonts
    const { rgb } = require('pdf-lib');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Load and draw student photo with curved corners
const imageDir = path.join(__dirname, "../public/studentImages/");
const possibleExtensions = [".jpg", ".jpeg", ".png"];
let photoFound = false;

for (const ext of possibleExtensions) {
  const photoPath = path.join(imageDir, `${student._id}${ext}`);
  if (fs.existsSync(photoPath)) {
    try {
      let photoBytes = fs.readFileSync(photoPath);
      let photo;

      if (ext === ".png") {
        photo = await pdfDoc.embedPng(photoBytes);
      } else {
        try {
          photoBytes = await fixImageOrientation(photoBytes);
        } catch (err) {
          console.log("No rotation needed or not a JPEG");
        }
        photo = await pdfDoc.embedJpg(photoBytes);
      }

      // Draw student photo (98px x 115px converted to points)
      const photoWidth = 92 * (72/96);
      const photoHeight = 107 * (72/96);
      const photoX = (width - photoWidth) / 2;
      const photoY = height - 42 * (72/96) - photoHeight + (-13 * (72/96));
      const cornerRadius = 10 * (72/96); // Curved corner radius

      // Create rounded rectangle mask for curved corners
      page.drawRectangle({
        x: photoX,
        y: photoY,
        width: photoWidth,
        height: photoHeight,
        color: rgb(1, 1, 1), // White background
        
        borderRadius: cornerRadius,
      });

      // Draw the photo with rounded corners using clip
      page.drawImage(photo, {
        x: photoX,
        y: photoY,
        width: photoWidth,
        height: photoHeight,
        // Apply rounded corners by clipping
        mask: {
          x: photoX,
          y: photoY,
          width: photoWidth,
          height: photoHeight,
          borderRadius: cornerRadius,
        }
      });

      photoFound = true;
      break;
    } catch (photoError) {
      console.log("Error embedding student photo:", photoError);
      continue;
    }
  }
}

    // Text color (black)
    const textColor = rgb(0, 0, 0);

    // Student Name (centered)
    const nameLabel = "NAME:";
    const nameValue = student.fullName || student.name || '';
    
    // Calculate positions
    const labelWidth = fontBold.widthOfTextAtSize(nameLabel, 11 * (72/96));
    const valueWidth = font.widthOfTextAtSize(nameValue, 11 * (72/96));
    const totalWidth = labelWidth + valueWidth;
    
    // Starting X position (centered)
    const startX = (width - totalWidth) / 2;
    
    // Draw "NAME:" in bold
    page.drawText(nameLabel, {
      x: startX,
      y: height - 177 * (72/96),
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });
    
    // Draw the name value in normal font
    page.drawText(nameValue, {
      x: startX + labelWidth,
      y: height - 177 * (72/96),
      size: 11 * (72/96),
      font: font,
      color: textColor,
    });

   // Issue Date (centered)
const issueLabel = "Issue:";
const issueValue = issueDate;

// Calculate positions
const issueLabelWidth = fontBold.widthOfTextAtSize(issueLabel, 11 * (72/96));
const issueValueWidth = font.widthOfTextAtSize(issueValue, 11 * (72/96));
const issueTotalWidth = issueLabelWidth + issueValueWidth;

// Starting X position (centered)
const issueStartX = (width - issueTotalWidth) / 2;


// Draw "Issue:" in bold
page.drawText(issueLabel, {
  x: issueStartX,
  y: height - 190 * (72/96),
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Draw the date value in normal font
page.drawText(issueValue, {
  x: issueStartX + issueLabelWidth,
  y: height - 190 * (72/96),
  size: 11 * (72/96),
  font: font,
  color: textColor,
});

    // Student Information (left aligned)
    const infoStartY = height - 210 * (72/96);
    const lineHeight = 15 * (72/96);
    function drawLabelValue(label, value, x, y, page, fontBold, font, textColor) {
  const fontSize = 11 * (72 / 96);
  const labelText = `${label} : `;
  const labelWidth = fontBold.widthOfTextAtSize(labelText, fontSize);

  // Draw label + colon
  page.drawText(labelText, {
    x,
    y,
    size: fontSize,
    font: fontBold,
    color: textColor,
  });

  // Draw value aligned perfectly
  page.drawText(value || '', {
    x: x + labelWidth,
    y,
    size: fontSize,
    font: font,
    color: textColor,
  });
}
// Common positions
const labelX = 15 * (72/96);
const colonX = 95 * (72/96);
const valueX = colonX + 8; // spacing after colon



// -----------------
// 1️⃣ ENROLMENT NO
// -----------------
page.drawText("Enrolment No", {
  x: labelX,
  y: infoStartY,
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Bold colon
page.drawText(":", {
  x: colonX,
  y: infoStartY,
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Value (normal font)
page.drawText(` ${student.regNo || ''}`, {
  x: valueX,
  y: infoStartY,
  size: 11 * (72/96),
  font: font,
  color: textColor,
});


// -----------------
// 2️⃣ COURSE NAME
// -----------------
page.drawText("Course Name", {
  x: labelX,
  y: infoStartY - lineHeight,
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Bold colon
page.drawText(":", {
  x: colonX,
  y: infoStartY - lineHeight,
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Value
page.drawText(` ${student.courseName || ''}`, {
  x: valueX,
  y: infoStartY - lineHeight,
  size: 11 * (72/96),
  font: font,
  color: textColor,
});


// -----------------
// 3️⃣ EXPIRY DATE
// -----------------
page.drawText("Expiry Date", {
  x: labelX,
  y: infoStartY - (2 * lineHeight),
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Bold colon
page.drawText(":", {
  x: colonX,
  y: infoStartY - (2 * lineHeight),
  size: 11 * (72/96),
  font: fontBold,
  color: textColor,
});

// Value
page.drawText(` ${expiryDateFormatted}`, {
  x: valueX,
  y: infoStartY - (2 * lineHeight),
  size: 11 * (72/96),
  font: font,
  color: textColor,
});



    // Principal text (right aligned)
    const principalText = 'Principal';
    const principalWidth = fontBold.widthOfTextAtSize(principalText, 12 * (72/96));
    page.drawText(principalText, {
      x: width - principalWidth - 15 * (72/96),
      y: 110 * (72/96),
      size: 12 * (72/96),
      font: fontBold,
      color: textColor,
    });

// ATC Name and Address (bottom left)
const atcText = `ATC Name: ${centre ? centre.centreName : ''}, ${centre ? centre.address : ''}`;
const maxWidth = width - 10 * (72/96);
const lineHeightAtc = 12 * (72/96);

let parts = atcText.split(",").map(p => p.trim());  // split by comma
let chunks = parts.map((p, i) => (i < parts.length - 1 ? p + "," : p)); // re-add comma except last

let atcLines = [];
let currentLine = "";

// Wrap with proper comma rule
for (const chunk of chunks) {
  const testLine = currentLine ? currentLine + " " + chunk : chunk;

  if (fontBold.widthOfTextAtSize(testLine, 9 * (72/96)) <= maxWidth) {
    currentLine = testLine;
  } else {
    atcLines.push(currentLine);
    currentLine = chunk;
  }
}
if (currentLine) atcLines.push(currentLine);

// Draw each wrapped line in white
let atcY = 26 * (72/96);

for (const line of atcLines) {
  page.drawText(line, {
    x: 15 * (72/96),
    y: atcY,
    size: 8 * (72/96),
    font: fontBold,
    color: rgb(1, 1, 1), // white
  });
  atcY -= lineHeightAtc;
}


    // Convert to base64 for preview
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    // Send HTML with embedded PDF preview and download button
    res.send(`
      <html>
        <head>
          <title>ID Card Preview - ${student.fullName || student.name}</title>
          <style>
            body { 
              margin: 0; 
              padding: 20px; 
              font-family: Arial, sans-serif; 
              background: #f5f5f5;
              display: flex;
              flex-direction: column;
              align-items: center;
              min-height: 100vh;
            }
            .preview-container {
              text-align: center;
              margin-bottom: 20px;
            }
            .preview-title {
              font-size: 24px;
              margin-bottom: 20px;
              color: #333;
            }
            .download-btn {
              background: #1f3555;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: all 0.3s ease;
              display: inline-block;
              margin-top: 20px;
            }
            .download-btn:hover {
              background: #152642;
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            iframe {
              border: 2px solid #ccc;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            }
          </style>
        </head>
        <body>
          <div class="preview-container">
            <h1 class="preview-title">ID Card Preview - ${student.fullName || student.name}</h1>
            
            <iframe src="data:application/pdf;base64,${base64}" 
                    width="400" height="550"
                    style="border:none;"></iframe>
            
            <br>
            <a href="/admin/id-card-pdf/${student._id}" class="download-btn">
              📥 Download ID Card
            </a>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Error generating ID card preview:', error);
    res.status(500).send('Error generating ID card preview');
  }
});
// ===========================
// ID CARD - DOWNLOAD
// ===========================
router.get('/id-card-pdf/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // Fetch the student
    const student = await db.get().collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send('Student not found');
    }

    // Fetch the center details using student's centreId
    const centre = await db.get().collection(collection.CENTER_COLLECTION)
      .findOne({ centreId: student.centreId });

    // Calculate dates
    const issueDate = new Date().toLocaleDateString('en-GB');
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const expiryDateFormatted = expiryDate.toLocaleDateString('en-GB');

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    
    // ID Card dimensions (2.63in x 3.88in converted to points)
    const width = 2.63 * 72;
    const height = 3.88 * 72;
    const page = pdfDoc.addPage([width, height]);

    // Load background image
    const bgPath = path.join(__dirname, "../public/images/id-card.jpg");
    const bgBytes = fs.readFileSync(bgPath);
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    
    // Draw background
    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: width,
      height: height,
    });

    // Load fonts
    const { rgb } = require('pdf-lib');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Load and draw student photo with curved corners
    const imageDir = path.join(__dirname, "../public/studentImages/");
    const possibleExtensions = [".jpg", ".jpeg", ".png"];
    let photoFound = false;

    for (const ext of possibleExtensions) {
      const photoPath = path.join(imageDir, `${student._id}${ext}`);
      if (fs.existsSync(photoPath)) {
        try {
          let photoBytes = fs.readFileSync(photoPath);
          let photo;

          if (ext === ".png") {
            photo = await pdfDoc.embedPng(photoBytes);
          } else {
            try {
              photoBytes = await fixImageOrientation(photoBytes);
            } catch (err) {
              console.log("No rotation needed or not a JPEG");
            }
            photo = await pdfDoc.embedJpg(photoBytes);
          }

          // Draw student photo (98px x 115px converted to points)
          const photoWidth = 92 * (72/96);
          const photoHeight = 107 * (72/96);
          const photoX = (width - photoWidth) / 2;
          const photoY = height - 42 * (72/96) - photoHeight + (-13 * (72/96));
          const cornerRadius = 10 * (72/96); // Curved corner radius

          // Create rounded rectangle mask for curved corners
          page.drawRectangle({
            x: photoX,
            y: photoY,
            width: photoWidth,
            height: photoHeight,
            color: rgb(1, 1, 1), // White background
            
            borderRadius: cornerRadius,
          });

          // Draw the photo with rounded corners using clip
          page.drawImage(photo, {
            x: photoX,
            y: photoY,
            width: photoWidth,
            height: photoHeight,
            // Apply rounded corners by clipping
            mask: {
              x: photoX,
              y: photoY,
              width: photoWidth,
              height: photoHeight,
              borderRadius: cornerRadius,
            }
          });

          photoFound = true;
          break;
        } catch (photoError) {
          console.log("Error embedding student photo:", photoError);
          continue;
        }
      }
    }

    // Text color (black)
    const textColor = rgb(0, 0, 0);

    // Student Name (centered)
    const nameLabel = "NAME:";
    const nameValue = student.fullName || student.name || '';
    
    // Calculate positions
    const labelWidth = fontBold.widthOfTextAtSize(nameLabel, 11 * (72/96));
    const valueWidth = font.widthOfTextAtSize(nameValue, 11 * (72/96));
    const totalWidth = labelWidth + valueWidth;
    
    // Starting X position (centered)
    const startX = (width - totalWidth) / 2;
    
    // Draw "NAME:" in bold
    page.drawText(nameLabel, {
      x: startX,
      y: height - 177 * (72/96),
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });
    
    // Draw the name value in normal font
    page.drawText(nameValue, {
      x: startX + labelWidth,
      y: height - 177 * (72/96),
      size: 11 * (72/96),
      font: font,
      color: textColor,
    });

    // Issue Date (centered)
    const issueLabel = "Issue:";
    const issueValue = issueDate;

    // Calculate positions
    const issueLabelWidth = fontBold.widthOfTextAtSize(issueLabel, 11 * (72/96));
    const issueValueWidth = font.widthOfTextAtSize(issueValue, 11 * (72/96));
    const issueTotalWidth = issueLabelWidth + issueValueWidth;

    // Starting X position (centered)
    const issueStartX = (width - issueTotalWidth) / 2;


    // Draw "Issue:" in bold
    page.drawText(issueLabel, {
      x: issueStartX,
      y: height - 190 * (72/96),
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Draw the date value in normal font
    page.drawText(issueValue, {
      x: issueStartX + issueLabelWidth,
      y: height - 190 * (72/96),
      size: 11 * (72/96),
      font: font,
      color: textColor,
    });

    // Student Information (left aligned)
    const infoStartY = height - 210 * (72/96);
    const lineHeight = 15 * (72/96);

    // Common positions
    const labelX = 15 * (72/96);
    const colonX = 95 * (72/96);
    const valueX = colonX + 8; // spacing after colon

    // -----------------
    // 1️⃣ ENROLMENT NO
    // -----------------
    page.drawText("Enrolment No", {
      x: labelX,
      y: infoStartY,
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Bold colon
    page.drawText(":", {
      x: colonX,
      y: infoStartY,
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Value (normal font)
    page.drawText(` ${student.regNo || ''}`, {
      x: valueX,
      y: infoStartY,
      size: 11 * (72/96),
      font: font,
      color: textColor,
    });


    // -----------------
    // 2️⃣ COURSE NAME
    // -----------------
    page.drawText("Course Name", {
      x: labelX,
      y: infoStartY - lineHeight,
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Bold colon
    page.drawText(":", {
      x: colonX,
      y: infoStartY - lineHeight,
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Value
    page.drawText(` ${student.courseName || ''}`, {
      x: valueX,
      y: infoStartY - lineHeight,
      size: 11 * (72/96),
      font: font,
      color: textColor,
    });


    // -----------------
    // 3️⃣ EXPIRY DATE
    // -----------------
    page.drawText("Expiry Date", {
      x: labelX,
      y: infoStartY - (2 * lineHeight),
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Bold colon
    page.drawText(":", {
      x: colonX,
      y: infoStartY - (2 * lineHeight),
      size: 11 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // Value
    page.drawText(` ${expiryDateFormatted}`, {
      x: valueX,
      y: infoStartY - (2 * lineHeight),
      size: 11 * (72/96),
      font: font,
      color: textColor,
    });

    // Principal text (right aligned)
    const principalText = 'Principal';
    const principalWidth = fontBold.widthOfTextAtSize(principalText, 12 * (72/96));
    page.drawText(principalText, {
      x: width - principalWidth - 15 * (72/96),
      y: 110 * (72/96),
      size: 12 * (72/96),
      font: fontBold,
      color: textColor,
    });

    // ATC Name and Address (bottom left)
    const atcText = `ATC Name: ${centre ? centre.centreName : ''}, ${centre ? centre.address : ''}`;
    const maxWidth = width - 10 * (72/96);
    const lineHeightAtc = 12 * (72/96);

    let parts = atcText.split(",").map(p => p.trim());  // split by comma
    let chunks = parts.map((p, i) => (i < parts.length - 1 ? p + "," : p)); // re-add comma except last

    let atcLines = [];
    let currentLine = "";

    // Wrap with proper comma rule
    for (const chunk of chunks) {
      const testLine = currentLine ? currentLine + " " + chunk : chunk;

      if (fontBold.widthOfTextAtSize(testLine, 9 * (72/96)) <= maxWidth) {
        currentLine = testLine;
      } else {
        atcLines.push(currentLine);
        currentLine = chunk;
      }
    }
    if (currentLine) atcLines.push(currentLine);

    // Draw each wrapped line in white
    let atcY = 26 * (72/96);

    for (const line of atcLines) {
      page.drawText(line, {
        x: 15 * (72/96),
        y: atcY,
        size: 8 * (72/96),
        font: fontBold,
        color: rgb(1, 1, 1), // white
      });
      atcY -= lineHeightAtc;
    }

    // Save and send as downloadable file
    const pdfBytes = await pdfDoc.save();
    const fileName = `ID-Card-${student.fullName || student.name || student._id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('❌ Error generating ID card PDF:', error);
    res.status(500).send('Error generating ID card PDF');
  }
});
// ===========================
// BATCH ID CARDS - DOWNLOAD ALL
// ===========================
router.get("/batch-idcards-download/:batchId", verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log(`🔄 Processing batch ID cards: ${batchId}`);

    // 1️⃣ Fetch all students in the batch
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: new ObjectId(batchId) })
      .toArray();

    console.log(`📋 Found ${students.length} students in batch`);

    if (!students || students.length === 0) {
      return res.status(404).send("No students found in this batch");
    }

    // 2️⃣ Load background image
    const bgPath = path.join(__dirname, "../public/images/id-card.jpg");
    const bgBytes = fs.readFileSync(bgPath);

    // 3️⃣ Create main PDF document
    const pdfDoc = await PDFDocument.create();

    // 4️⃣ Load fonts
    const { rgb } = require('pdf-lib');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 5️⃣ Process each student with COMPLETE error handling
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const student of students) {
      let studentProcessed = false;
      
      try {
        console.log(`🪪 Processing ID card: ${student.fullName || student.name}`);

        // Fetch the center details using student's centreId
        const centre = await db.get().collection(collection.CENTER_COLLECTION)
          .findOne({ centreId: student.centreId });

        // Calculate dates
        const issueDate = new Date().toLocaleDateString('en-GB');
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        const expiryDateFormatted = expiryDate.toLocaleDateString('en-GB');

        // CREATE ID CARD PAGE
        const width = 2.63 * 72;
        const height = 3.88 * 72;
        const page = pdfDoc.addPage([width, height]);

        // Draw background
        const bgImage = await pdfDoc.embedJpg(bgBytes);
        page.drawImage(bgImage, { x: 0, y: 0, width: width, height: height });

        // 🖼️ Student Photo - COMPLETE error wrapping
        const imageDir = path.join(__dirname, "../public/studentImages/");
        const possibleExtensions = [".jpg", ".jpeg", ".png"];
        let photoFound = false;

        for (const ext of possibleExtensions) {
          const photoPath = path.join(imageDir, `${student._id}${ext}`);
          if (fs.existsSync(photoPath)) {
            try {
              console.log(`📸 Trying to load photo: ${photoPath}`);
              let photoBytes = fs.readFileSync(photoPath);
              
              try {
                let photo;
                if (ext === ".png") {
                  photo = await pdfDoc.embedPng(photoBytes);
                } else {
                  try {
                    photoBytes = await fixImageOrientation(photoBytes);
                  } catch (rotateError) {
                    // Ignore rotation errors
                  }
                  photo = await pdfDoc.embedJpg(photoBytes);
                }

                // Draw student photo
                const photoWidth = 92 * (72/96);
                const photoHeight = 107 * (72/96);
                const photoX = (width - photoWidth) / 2;
                const photoY = height - 42 * (72/96) - photoHeight + (-13 * (72/96));
                const cornerRadius = 10 * (72/96);

                // Create rounded rectangle mask for curved corners
                page.drawRectangle({
                  x: photoX,
                  y: photoY,
                  width: photoWidth,
                  height: photoHeight,
                  color: rgb(1, 1, 1),
                  borderRadius: cornerRadius,
                });

                // Draw the photo with rounded corners using clip
                page.drawImage(photo, {
                  x: photoX,
                  y: photoY,
                  width: photoWidth,
                  height: photoHeight,
                  mask: {
                    x: photoX,
                    y: photoY,
                    width: photoWidth,
                    height: photoHeight,
                    borderRadius: cornerRadius,
                  }
                });

                photoFound = true;
                console.log(`✅ Added photo for ${student.fullName}`);
                break;
              } catch (embedError) {
                console.log(`⚠️ SKIPPED PHOTO: ${student.fullName} - Cannot embed image: ${embedError.message}`);
                break;
              }
            } catch (fileError) {
              console.log(`⚠️ SKIPPED PHOTO: ${student.fullName} - Cannot read file: ${fileError.message}`);
              break;
            }
          }
        }

        if (!photoFound) {
          console.log(`📷 No photo available for ${student.fullName}`);
        }

        // Text color (black)
        const textColor = rgb(0, 0, 0);

        // Student Name (centered)
        const nameLabel = "NAME:";
        const nameValue = student.fullName || student.name || '';
        
        const labelWidth = fontBold.widthOfTextAtSize(nameLabel, 11 * (72/96));
        const valueWidth = font.widthOfTextAtSize(nameValue, 11 * (72/96));
        const totalWidth = labelWidth + valueWidth;
        const startX = (width - totalWidth) / 2;
        
        page.drawText(nameLabel, {
          x: startX,
          y: height - 177 * (72/96),
          size: 11 * (72/96),
          font: fontBold,
          color: textColor,
        });
        
        page.drawText(nameValue, {
          x: startX + labelWidth,
          y: height - 177 * (72/96),
          size: 11 * (72/96),
          font: font,
          color: textColor,
        });

        // Issue Date (centered)
        const issueLabel = "Issue:";
        const issueValue = issueDate;

        const issueLabelWidth = fontBold.widthOfTextAtSize(issueLabel, 11 * (72/96));
        const issueValueWidth = font.widthOfTextAtSize(issueValue, 11 * (72/96));
        const issueTotalWidth = issueLabelWidth + issueValueWidth;
        const issueStartX = (width - issueTotalWidth) / 2;

        page.drawText(issueLabel, {
          x: issueStartX,
          y: height - 190 * (72/96),
          size: 11 * (72/96),
          font: fontBold,
          color: textColor,
        });

        page.drawText(issueValue, {
          x: issueStartX + issueLabelWidth,
          y: height - 190 * (72/96),
          size: 11 * (72/96),
          font: font,
          color: textColor,
        });

        // Student Information (left aligned)
        const infoStartY = height - 210 * (72/96);
        const lineHeight = 15 * (72/96);
        const labelX = 15 * (72/96);
        const colonX = 95 * (72/96);
        const valueX = colonX + 8;

        // ENROLMENT NO
        page.drawText("Enrolment No", { x: labelX, y: infoStartY, size: 11 * (72/96), font: fontBold, color: textColor });
        page.drawText(":", { x: colonX, y: infoStartY, size: 11 * (72/96), font: fontBold, color: textColor });
        page.drawText(` ${student.regNo || ''}`, { x: valueX, y: infoStartY, size: 11 * (72/96), font: font, color: textColor });

        // COURSE NAME
        page.drawText("Course Name", { x: labelX, y: infoStartY - lineHeight, size: 11 * (72/96), font: fontBold, color: textColor });
        page.drawText(":", { x: colonX, y: infoStartY - lineHeight, size: 11 * (72/96), font: fontBold, color: textColor });
        page.drawText(` ${student.courseName || ''}`, { x: valueX, y: infoStartY - lineHeight, size: 11 * (72/96), font: font, color: textColor });

        // EXPIRY DATE
        page.drawText("Expiry Date", { x: labelX, y: infoStartY - (2 * lineHeight), size: 11 * (72/96), font: fontBold, color: textColor });
        page.drawText(":", { x: colonX, y: infoStartY - (2 * lineHeight), size: 11 * (72/96), font: fontBold, color: textColor });
        page.drawText(` ${expiryDateFormatted}`, { x: valueX, y: infoStartY - (2 * lineHeight), size: 11 * (72/96), font: font, color: textColor });

        // Principal text (right aligned)
        const principalText = 'Principal';
        const principalWidth = fontBold.widthOfTextAtSize(principalText, 12 * (72/96));
        page.drawText(principalText, {
          x: width - principalWidth - 15 * (72/96),
          y: 110 * (72/96),
          size: 12 * (72/96),
          font: fontBold,
          color: textColor,
        });

        // ATC Name and Address (bottom left)
        const atcText = `ATC Name: ${centre ? centre.centreName : ''}, ${centre ? centre.address : ''}`;
        const maxWidth = width - 10 * (72/96);
        const lineHeightAtc = 12 * (72/96);

        let parts = atcText.split(",").map(p => p.trim());
        let chunks = parts.map((p, i) => (i < parts.length - 1 ? p + "," : p));

        let atcLines = [];
        let currentLine = "";

        for (const chunk of chunks) {
          const testLine = currentLine ? currentLine + " " + chunk : chunk;
          if (fontBold.widthOfTextAtSize(testLine, 9 * (72/96)) <= maxWidth) {
            currentLine = testLine;
          } else {
            atcLines.push(currentLine);
            currentLine = chunk;
          }
        }
        if (currentLine) atcLines.push(currentLine);

        let atcY = 26 * (72/96);
        for (const line of atcLines) {
          page.drawText(line, {
            x: 15 * (72/96),
            y: atcY,
            size: 8 * (72/96),
            font: fontBold,
            color: rgb(1, 1, 1),
          });
          atcY -= lineHeightAtc;
        }

        processedCount++;
        studentProcessed = true;
        console.log(`✅ SUCCESS: Added ID card for ${student.fullName}`);

      } catch (studentError) {
        console.log(`❌ SKIPPED STUDENT: ${student.fullName || student.name} - ${studentError.message}`);
        skippedCount++;
        
        // Remove the last added page if student processing failed mid-way
        if (!studentProcessed) {
          const pages = pdfDoc.getPages();
          if (pages.length > 0) {
            pdfDoc.removePage(pages.length - 1);
          }
        }
        continue;
      }
    }

    // 6️⃣ Check if any students were processed
    if (processedCount === 0) {
      return res.status(400).send("No students could be processed. All students were skipped due to errors.");
    }

    // 7️⃣ Save combined PDF
    const pdfBytes = await pdfDoc.save();
    const batch = await db.get().collection(collection.BATCH_COLLECTION).findOne({ _id: new ObjectId(batchId) });
    const batchName = batch ? batch.batchName.replace(/\s+/g, '-') : 'Batch';
    const fileName = `ID-Cards-${batchName}.pdf`;

    console.log(`📊 BATCH ID CARDS PROCESSING COMPLETE:`);
    console.log(`   ✅ Processed: ${processedCount} students`);
    console.log(`   ⏭️ Skipped: ${skippedCount} students`);
    console.log(`   📄 Total ID cards: ${pdfDoc.getPages().length}`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ CRITICAL Error generating batch ID cards:", err);
    res.status(500).send("Error generating batch ID cards");
  }
});
//approval of
// View PENDING Students (Only not activated)
router.get('/pending-students', verifyAdminLogin, async (req, res) => {
  try {
    const pendingStudents = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ activated: { $ne: true } }) // FIXED: Use activated field
      .toArray();

    res.render('admin/pending-students', { 
      admin: true, 
      pendingStudents,
      pageTitle: 'Pending Students'
    });
  } catch (err) {
    console.error("❌ Error loading pending students:", err);
    res.status(500).send("Error loading pending students");
  }
});
// View APPROVED Students (Only activated)
router.get('/approved-students', verifyAdminLogin, async (req, res) => {
  try {
    const approvedStudents = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ activated: true }) // FIXED: Use activated field
      .toArray();

    res.render('admin/approved-students', { 
      admin: true, 
      approvedStudents,
      pageTitle: 'Approved Students'
    });
  } catch (err) {
    console.error("❌ Error loading approved students:", err);
    res.status(500).send("Error loading approved students");
  }
});
// 🔹 Approve student
// Activate Student - FIXED REDIRECT
router.get('/activate-student/:id', verifyAdminLogin, async (req, res) => {
  const studentId = req.params.id;
  try {
    await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .updateOne(
        { _id: new ObjectId(studentId) },
        { $set: { activated: true } }
      );
    
    // FIXED: Redirect based on referer or to pending-students
    const referer = req.get('Referer');
    if (referer && referer.includes('/pending-students')) {
      res.redirect('/admin/pending-students');
    } else {
      res.redirect('/admin/view-student');
    }
  } catch (err) {
    console.error("❌ Error activating student:", err);
    res.status(500).send("Error activating student");
  }
});
// Deactivate Student
router.get('/deactivate-student/:id', verifyAdminLogin, async (req, res) => {
  const studentId = req.params.id;
  try {
    await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .updateOne(
        { _id: new ObjectId(studentId) },
        { $set: { activated: false } }
      );
    
    const referer = req.get('Referer');
    if (referer && referer.includes('/approved-students')) {
      res.redirect('/admin/approved-students');
    } else {
      res.redirect('/admin/view-student');
    }
  } catch (err) {
    console.error("❌ Error deactivating student:", err);
    res.status(500).send("Error deactivating student");
  }
});


// Approve Student hallticket

router.get('/approve-student/:id', async (req, res) => {
  const studentId = req.params.id;

  try {
    await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .updateOne(
        { _id: new ObjectId(studentId) },
        { $set: { approved: true } }
      );

    res.redirect('/admin/view-student');
  } catch (err) {
    console.error("❌ Error approving student:", err);
    res.status(500).send("Error approving student");
  }
});



// Add batch for specific centre
router.get('/add-batch/:centreId', verifyAdminLogin, (req, res) => {
  res.render('admin/add-batch', { hideNavbar: true, centreId: req.params.centreId });
});

router.post('/add-batch/:centreId', verifyAdminLogin, (req, res) => {
  let centreId = req.params.centreId;
  let batchData = {
    ...req.body,
    centreId: centreId
  };

  batchHelpers.addBatch(batchData, () => {
    res.redirect('/admin/view-cbatch/' + centreId);
  });
});

// /* ======================
//    APPLICATION FORM + AUTO HALL TICKET APPROVAL
//    ====================== */

// router.get('/app-form/:id', verifyAdminLogin, async (req, res) => {
//   try {
//     const studentId = req.params.id;

//     // 1️⃣ Fetch student details
//     const student = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .findOne({ _id: new ObjectId(studentId) });

//     if (!student) {
//       return res.status(404).send("Student not found");
//     }

//     // ============================
//     // ⭐ AUTO APPROVE LOGIC (12 HOURS)
//     // ============================
//     if (
//       student.appliedForHallTicket &&
//       student.applicationForm &&
//       !student.applicationForm.approved &&
//       student.applicationForm.appliedAt
//     ) {
//       const now = new Date();
//       const appliedTime = new Date(student.applicationForm.appliedAt);

//       const diffHours = (now - appliedTime) / (1000 * 60 * 60);

//       if (diffHours >= 12) {
//         await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
//           { _id: student._id },
//           { $set: { "applicationForm.approved": true } }
//         );

//         student.applicationForm.approved = true;
//         console.log("✅ Auto-approved hall ticket for:", student._id);
//       }
//     }

//     // 2️⃣ Fetch all centers
//     const centres = await db.get()
//       .collection(collection.CENTER_COLLECTION)
//       .find({})
//       .toArray();

//     // 3️⃣ Pick the student's centre
//     let centre = null;
//     if (student.centreId) {
//       centre = centres.find(c => c._id.toString() === student.centreId.toString());
//     }
//     if (!centre && centres.length > 0) centre = centres[0];

//     const today = new Date().toISOString().split('T')[0];

//     // 4️⃣ Render
//     res.render('admin/app-form', { 
//       hideNavbar: true,
//       studentId,
//       student,
//       centre,
//       centres,
//       today,
//     });

//   } catch (err) {
//     console.error("❌ Error loading app form:", err);
//     res.status(500).send("Error loading application form");
//   }
// });




// // ===========================
// //  POST: SAVE APPLICATION FORM
// // ===========================

// router.post('/app-form', verifyAdminLogin, async (req, res) => {
//   try {
//     const studentId = req.body.studentId;

//     if (!ObjectId.isValid(studentId)) {
//       return res.status(400).send("Invalid Student ID");
//     }

//     // Format today's date
//     const date = new Date();
//     const today = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;

//     // Build form data
//     const formData = {
//       candidateName: req.body.candidateName?.trim() || "",
//       courseName: req.body.courseName?.trim() || "",
//       studyCentre: req.body.studyCentre?.trim() || "",
//       examCentre: req.body.examCentre?.trim() || "",
//       examDate: req.body.examDate || "",
//       examTime: req.body.examTime?.trim() || "",
//       registerNumber: req.body.registerNumber?.trim() || "",
//       studentDate: req.body.studentDate || today,
//       approved: false,               // Approval starts as FALSE
//       appliedAt: new Date()          // ⏳ Used for 12-hour auto approval
//     };

//     // Save to DB
//     const updateResult = await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
//       { _id: new ObjectId(studentId) },
//       {
//         $set: {
//           applicationForm: formData,
//           appliedForHallTicket: true,
//           examDate: formData.examDate,
//           examTime: formData.examTime
//         }
//       }
//     );

//     if (updateResult.modifiedCount === 0) {
//       return res.status(500).send("Failed to save application form");
//     }

//     // Redirect to students list
//     res.redirect('/admin/view-bstudent/' + req.body.batchId);

//   } catch (err) {
//     console.error("❌ Error saving application form:", err);
//     res.status(500).send("Error submitting application form");
//   }
// });

/* ======================
   APPLICATION FORM + AUTO HALL TICKET APPROVAL
   ====================== */

   router.get('/app-form/:id', verifyAdminLogin, async (req, res) => {
    try {
      const studentId = req.params.id;
  
      // 1️⃣ Fetch student details
      const student = await db.get()
        .collection(collection.STUDENT_COLLECTION)
        .findOne({ _id: new ObjectId(studentId) });
  
      if (!student) {
        return res.status(404).send("Student not found");
      }
  
      // ============================
      // ⭐ AUTO APPROVE LOGIC (12 HOURS)
      // ============================
      if (
        student.appliedForHallTicket &&
        student.applicationForm &&
        !student.applicationForm.approved &&
        student.applicationForm.appliedAt
      ) {
        const now = new Date();
        const appliedTime = new Date(student.applicationForm.appliedAt);
  
        const diffHours = (now - appliedTime) / (1000 * 60 * 60);
  
        if (diffHours >= 12) {
          await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
            { _id: student._id },
            { $set: { "applicationForm.approved": true } }
          );
  
          student.applicationForm.approved = true;
          console.log("✅ Auto-approved hall ticket for:", student._id);
        }
      }
  
      // 2️⃣ Fetch all centers
      const centres = await db.get()
        .collection(collection.CENTER_COLLECTION)
        .find({})
        .toArray();
  
      // 3️⃣ Pick the student's centre
      let centre = null;
      if (student.centreId) {
        centre = centres.find(c => c._id.toString() === student.centreId.toString());
      }
      if (!centre && centres.length > 0) centre = centres[0];
  
      const today = new Date().toISOString().split('T')[0];
  
      // 4️⃣ Render
      res.render('admin/app-form', { 
        hideNavbar: true,
        studentId,
        student,
        centre,
        centres,
        today,
      });
  
    } catch (err) {
      console.error("❌ Error loading app form:", err);
      res.status(500).send("Error loading application form");
    }
  });
  
  
  
  
  // ===========================
  //  POST: SAVE APPLICATION FORM
  // ===========================
  
  router.post('/app-form', verifyAdminLogin, async (req, res) => {
    try {
      const studentId = req.body.studentId;
  
      if (!ObjectId.isValid(studentId)) {
        return res.status(400).send("Invalid Student ID");
      }
  
      // Format today's date
      const date = new Date();
      const today = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
  
      // Build form data
      const formData = {
        candidateName: req.body.candidateName?.trim() || "",
        courseName: req.body.courseName?.trim() || "",
        studyCentre: req.body.studyCentre?.trim() || "",
        examCentre: req.body.examCentre?.trim() || "",
        examDate: req.body.examDate || "",
        examTime: req.body.examTime?.trim() || "",
        registerNumber: req.body.registerNumber?.trim() || "",
        studentDate: req.body.studentDate || today,
        approved: false,               // Approval starts as FALSE
        appliedAt: new Date()          // ⏳ Used for 12-hour auto approval
      };
  
      // Save to DB
      const updateResult = await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
        { _id: new ObjectId(studentId) },
        {
          $set: {
            applicationForm: formData,
            appliedForHallTicket: true,
            examDate: formData.examDate,
            examTime: formData.examTime
          }
        }
      );
  
      if (updateResult.modifiedCount === 0) {
        return res.status(500).send("Failed to save application form");
      }
  
      // Redirect to students list
      res.redirect('/admin/view-bstudent/' + req.body.batchId);
  
    } catch (err) {
      console.error("❌ Error saving application form:", err);
      res.status(500).send("Error submitting application form");
    }
  });
  
// ===========================
// HALL TICKET - PREVIEW
// ===========================
router.get("/hall-ticket/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) return res.status(404).send("Student not found");

    // ✅ Extract application form details (if exists)
    const form = student.applicationForm || {};

    // 2️⃣ Load background images
    const frontPath = path.join(__dirname, "../public/images/ht-front.jpg");
    const backPath = path.join(__dirname, "../public/images/ht-back.jpg");

    const frontBytes = fs.readFileSync(frontPath);
    const backBytes = fs.readFileSync(backPath);

    // 3️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();

    // 🧩 Register fontkit (required for custom TTF fonts)
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load Arial fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    } else {
      arialBold = arial;
    }

    // ✅ HELPER: Format date as DD-MM-YYYY (Indian format)
    const formatDate = (dateString) => {
      if (!dateString) return "";
      
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return ""; // Invalid date check
      
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      return `${day}-${month}-${year}`;
    };

    // ✅ HELPER: Draw right-aligned text
    function drawRightAlignedText(page, text, x, y, font, size, maxWidth = null) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const rightX = maxWidth ? x + maxWidth - textWidth : x - textWidth;
      page.drawText(text, { x: rightX, y, size, font });
    }

    // 5️⃣ Create Front Page
    const page = pdfDoc.addPage([595.28, 841.89]);
    const frontImg = await pdfDoc.embedJpg(frontBytes);
    page.drawImage(frontImg, { x: 0, y: 0, width: 595.28, height: 841.89 });

    // 🟢 Student Details (from form) - NORMAL (not centered)
    page.drawText((form.candidateName || student.name || "").toUpperCase(), { x: 137, y: 737, size: 11, font: arial });
    page.drawText((form.registerNumber || ""), { x: 410, y: 657, size: 11, font: arial });
    page.drawText((form.courseName || ""), { x: 410, y: 736.5, size: 11, font: arial });
    page.drawText((form.studyCentre || ""), { x: 145, y: 711, size: 11, font: arial });
    page.drawText((form.examCentre || ""), { x: 410, y: 711, size: 11, font: arial });

    // First section date - NORMAL
    if (form.examDate) {
      page.drawText(formatDate(form.examDate), { x: 141, y: 685.5, size: 11, font: arial });
    }

    if (form.examTime) {
      page.drawText(form.examTime, { x: 410, y: 683, size: 11, font: arial });
    }

    // Second section - NORMAL
    page.drawText((form.registerNumber || ""), { x: 55, y: 176.5, size: 11, font: arial });
    page.drawText((form.candidateName || student.name || "").toUpperCase(), { x: 55, y: 125, size: 11, font: arial });
    page.drawText((form.courseName || ""), { x: 55, y: 74, size: 11, font: arial });
    page.drawText((form.studyCentre || ""), { x: 320, y: 178, size: 11, font: arial });
    
    // Second date - NORMAL
    if (form.examDate) {
      page.drawText(formatDate(form.examDate), { x: 320, y: 124, size: 11, font: arial });
    }
    
    page.drawText((form.examCentre || ""), { x: 320, y: 74, size: 11, font: arial });

    // Student section - NORMAL
    if (form.studentDate) {
      page.drawText(formatDate(form.studentDate), { x:55, y: 543.2, size: 11, font: arial });
    }

    // Keep right-aligned text as is
    drawRightAlignedText(page, (form.candidateName || student.name || "").toUpperCase(), 121, 629, arial, 11, 200);
    drawRightAlignedText(page, (form.candidateName || student.name || "").toUpperCase(), 160, 507.5, arial, 11, 200);

    // 🖼️ Student Photo
    const imageDir = path.join(__dirname, "../public/studentImages/");
    const possibleExtensions = [".jpg", ".jpeg", ".png"];
    let photoFound = false;

    for (const ext of possibleExtensions) {
      const photoPath = path.join(imageDir, `${student._id}${ext}`);
      if (fs.existsSync(photoPath)) {
        let photoBytes = fs.readFileSync(photoPath);
        let photo;

        if (ext === ".png") {
          photo = await pdfDoc.embedPng(photoBytes);
        } else {
          try {
            photoBytes = await fixImageOrientation(photoBytes);
          } catch (err) {
            console.log("No rotation needed or not a JPEG");
          }
          photo = await pdfDoc.embedJpg(photoBytes);
        }

        page.drawImage(photo, {
          x: 476.5,
          y: 214,
          width: 79.75,
          height: 108,
        });
        photoFound = true;
        break;
      }
    }

    if (!photoFound) {
      page.drawText("Photo Not Available", { x: 400, y: 650, size: 10, font: arial });
    }

    // BACK PAGE
    const backPage = pdfDoc.addPage([595.28, 841.89]);
    const backImg = await pdfDoc.embedJpg(backBytes);
    backPage.drawImage(backImg, {
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
    });

    if (form.instructions) {
      backPage.drawText("Important Instructions:", { x: 50, y: 750, size: 14, font: arialBold });
      // For multi-line text
      backPage.drawText(form.instructions, {
        x: 50,
        y: 720,
        size: 10,
        font: arial,
        maxWidth: 500,
        lineHeight: 12,
      });
    }

    // 6️⃣ Convert PDF to Base64 and preview
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <head>
          <title>Hall Ticket Preview</title>
          <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            .download-btn {
              background: #1f3555;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-family: sans-serif;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: all 0.3s ease;
            }
            .download-btn:hover {
              background: #152642;
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
          </style>
        </head>
        <body>
          <iframe src="data:application/pdf;base64,${base64}" 
                  width="100%" height="100%" 
                  style="border:none;height:100vh;"></iframe>

          <div style="position:fixed;bottom:30px;right:40px;z-index:1000;">
            <a href="/admin/hallticket-download/${student._id}" class="download-btn">
              Download Hall Ticket
            </a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Error generating Hall Ticket preview:", err);
    res.status(500).send("Error generating Hall Ticket preview");
  }
});
// ===========================
// HALL TICKET - DOWNLOAD
// ===========================
router.get("/hallticket-download/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) return res.status(404).send("Student not found");

    // ✅ Extract application form details (if exists)
    const form = student.applicationForm || {};

    // 2️⃣ Load background images
    const frontPath = path.join(__dirname, "../public/images/ht-front.jpg");
    const backPath = path.join(__dirname, "../public/images/ht-back.jpg");

    const frontBytes = fs.readFileSync(frontPath);
    const backBytes = fs.readFileSync(backPath);

    // 3️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();

    // 🧩 Register fontkit (required for custom TTF fonts)
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load Arial fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    } else {
      arialBold = arial;
    }

    // ✅ HELPER: Format date as DD-MM-YYYY (Indian format)
    const formatDate = (dateString) => {
      if (!dateString) return "";
      
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return ""; // Invalid date check
      
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      return `${day}-${month}-${year}`;
    };

    // ✅ HELPER: Draw right-aligned text
    function drawRightAlignedText(page, text, x, y, font, size, maxWidth = null) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const rightX = maxWidth ? x + maxWidth - textWidth : x - textWidth;
      page.drawText(text, { x: rightX, y, size, font });
    }

    // 5️⃣ Create Front Page
    const page = pdfDoc.addPage([595.28, 841.89]);
    const frontImg = await pdfDoc.embedJpg(frontBytes);
    page.drawImage(frontImg, { x: 0, y: 0, width: 595.28, height: 841.89 });

    // 🟢 Student Details (from form) - NORMAL (not centered)
    page.drawText((form.candidateName || student.name || "").toUpperCase(), { x: 137, y: 737, size: 11, font: arial });
    page.drawText((form.registerNumber || ""), { x: 410, y: 657, size: 11, font: arial });
    page.drawText((form.courseName || ""), { x: 410, y: 736.5, size: 11, font: arial });
    page.drawText((form.studyCentre || ""), { x: 145, y: 711, size: 11, font: arial });
    page.drawText((form.examCentre || ""), { x: 410, y: 711, size: 11, font: arial });

    // First section date - NORMAL
    if (form.examDate) {
      page.drawText(formatDate(form.examDate), { x: 141, y: 685.5, size: 11, font: arial });
    }

    if (form.examTime) {
      page.drawText(form.examTime, { x: 410, y: 683, size: 11, font: arial });
    }

    // Second section - NORMAL
    page.drawText((form.registerNumber || ""), { x: 55, y: 176.5, size: 11, font: arial });
    page.drawText((form.candidateName || student.name || "").toUpperCase(), { x: 55, y: 125, size: 11, font: arial });
    page.drawText((form.courseName || ""), { x: 55, y: 74, size: 11, font: arial });
    page.drawText((form.studyCentre || ""), { x: 320, y: 178, size: 11, font: arial });
    
    // Second date - NORMAL
    if (form.examDate) {
      page.drawText(formatDate(form.examDate), { x: 320, y: 124, size: 11, font: arial });
    }
    
    page.drawText((form.examCentre || ""), { x: 320, y: 74, size: 11, font: arial });

    // Student section - NORMAL
    if (form.studentDate) {
      page.drawText(formatDate(form.studentDate), { x:55, y: 543.2, size: 11, font: arial });
    }

    // Keep right-aligned text as is
    drawRightAlignedText(page, (form.candidateName || student.name || "").toUpperCase(), 121, 629, arial, 11, 200);
    drawRightAlignedText(page, (form.candidateName || student.name || "").toUpperCase(), 160, 507.5, arial, 11, 200);

    // 🖼️ Student Photo
    const imageDir = path.join(__dirname, "../public/studentImages/");
    const possibleExtensions = [".jpg", ".jpeg", ".png"];
    let photoFound = false;

    for (const ext of possibleExtensions) {
      const photoPath = path.join(imageDir, `${student._id}${ext}`);
      if (fs.existsSync(photoPath)) {
        let photoBytes = fs.readFileSync(photoPath);
        let photo;

        if (ext === ".png") {
          photo = await pdfDoc.embedPng(photoBytes);
        } else {
          try {
            photoBytes = await fixImageOrientation(photoBytes);
          } catch (err) {
            console.log("No rotation needed or not a JPEG");
          }
          photo = await pdfDoc.embedJpg(photoBytes);
        }

        page.drawImage(photo, {
          x: 476.5,
          y: 214,
          width: 79.75,
          height: 108,
        });
        photoFound = true;
        break;
      }
    }

    if (!photoFound) {
      page.drawText("Photo Not Available", { x: 400, y: 650, size: 10, font: arial });
    }

    // BACK PAGE
    const backPage = pdfDoc.addPage([595.28, 841.89]);
    const backImg = await pdfDoc.embedJpg(backBytes);
    backPage.drawImage(backImg, {
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
    });

    if (form.instructions) {
      backPage.drawText("Important Instructions:", { x: 50, y: 750, size: 14, font: arialBold });
      // For multi-line text
      backPage.drawText(form.instructions, {
        x: 50,
        y: 720,
        size: 10,
        font: arial,
        maxWidth: 500,
        lineHeight: 12,
      });
    }

    // 6️⃣ Convert PDF to bytes and send as download
    const pdfBytes = await pdfDoc.save();
    
    // Set download headers
    const fileName = `hall-ticket-${form.registerNumber || studentId}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    // Send the PDF as download
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error downloading Hall Ticket:", err);
    res.status(500).send("Error downloading Hall Ticket");
  }
});
// ===========================
// BATCH HALL TICKETS - DOWNLOAD ALL (Using Individual Formatting)
// ===========================
router.get("/batch-halltickets-download/:batchId", verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log(`🔄 Processing batch: ${batchId}`);

    // 1️⃣ Fetch all students in the batch
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: new ObjectId(batchId) })
      .toArray();

    console.log(`📋 Found ${students.length} students in batch`);

    if (!students || students.length === 0) {
      return res.status(404).send("No students found in this batch");
    }

    // 2️⃣ Load background images
    const frontPath = path.join(__dirname, "../public/images/ht-front.jpg");
    const backPath = path.join(__dirname, "../public/images/ht-back.jpg");
    
    const frontBytes = fs.readFileSync(frontPath);
    const backBytes = fs.readFileSync(backPath);

    // 3️⃣ Create main PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load Arial fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold = arial;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    }

    // ✅ HELPER: Format date as DD-MM-YYYY (Indian format)
    const formatDate = (dateString) => {
      if (!dateString) return "";
      
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return ""; // Invalid date check
      
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      return `${day}-${month}-${year}`;
    };

    // ✅ HELPER: Draw right-aligned text (EXACTLY like individual preview)
    function drawRightAlignedText(page, text, x, y, font, size, maxWidth = null) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const rightX = maxWidth ? x + maxWidth - textWidth : x - textWidth;
      page.drawText(text, { x: rightX, y, size, font });
    }

    // 5️⃣ Process each student with COMPLETE error handling
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const student of students) {
      let studentProcessed = false;
      
      try {
        if (!student.applicationForm) {
          console.log(`⏭️ SKIPPED: ${student.name || 'Unknown'} - No application form`);
          skippedCount++;
          continue;
        }

        const form = student.applicationForm;
        console.log(`🎫 Processing: ${form.candidateName || student.name || 'Unknown'}`);

        // FRONT PAGE (EXACTLY like individual preview)
        const page = pdfDoc.addPage([595.28, 841.89]);
        const frontImg = await pdfDoc.embedJpg(frontBytes);
        page.drawImage(frontImg, { x: 0, y: 0, width: 595.28, height: 841.89 });

        // 🟢 Student Details (from form) - NORMAL (not centered) - EXACTLY like individual
        page.drawText((form.candidateName || student.name || "").toUpperCase(), { x: 137, y: 737, size: 11, font: arial });
        page.drawText((form.registerNumber || ""), { x: 410, y: 657, size: 11, font: arial });
        page.drawText((form.courseName || ""), { x: 410, y: 736.5, size: 11, font: arial });
        page.drawText((form.studyCentre || ""), { x: 145, y: 711, size: 11, font: arial });
        page.drawText((form.examCentre || ""), { x: 410, y: 711, size: 11, font: arial });

        // First section date - NORMAL
        if (form.examDate) {
          page.drawText(formatDate(form.examDate), { x: 141, y: 685.5, size: 11, font: arial });
        }

        if (form.examTime) {
          page.drawText(form.examTime, { x: 410, y: 683, size: 11, font: arial });
        }

        // Second section - NORMAL
        page.drawText((form.registerNumber || ""), { x: 55, y: 176.5, size: 11, font: arial });
        page.drawText((form.candidateName || student.name || "").toUpperCase(), { x: 55, y: 125, size: 11, font: arial });
        page.drawText((form.courseName || ""), { x: 55, y: 74, size: 11, font: arial });
        page.drawText((form.studyCentre || ""), { x: 320, y: 178, size: 11, font: arial });
        
        // Second date - NORMAL
        if (form.examDate) {
          page.drawText(formatDate(form.examDate), { x: 320, y: 124, size: 11, font: arial });
        }
        
        page.drawText((form.examCentre || ""), { x: 320, y: 74, size: 11, font: arial });

        // Student section - NORMAL
        if (form.studentDate) {
          page.drawText(formatDate(form.studentDate), { x:55, y: 543.2, size: 11, font: arial });
        }

        // Keep right-aligned text as is
        drawRightAlignedText(page, (form.candidateName || student.name || "").toUpperCase(), 121, 629, arial, 11, 200);
        drawRightAlignedText(page, (form.candidateName || student.name || "").toUpperCase(), 160, 507.5, arial, 11, 200);

        // 🖼️ Student Photo - COMPLETE error wrapping (EXACTLY like individual preview)
        const imageDir = path.join(__dirname, "../public/studentImages/");
        const possibleExtensions = [".jpg", ".jpeg", ".png"];
        let photoFound = false;

        for (const ext of possibleExtensions) {
          const photoPath = path.join(imageDir, `${student._id}${ext}`);
          if (fs.existsSync(photoPath)) {
            try {
              console.log(`📸 Trying to load photo: ${photoPath}`);
              let photoBytes = fs.readFileSync(photoPath);
              let photo;

              if (ext === ".png") {
                photo = await pdfDoc.embedPng(photoBytes);
              } else {
                try {
                  photoBytes = await fixImageOrientation(photoBytes);
                } catch (err) {
                  console.log("No rotation needed or not a JPEG");
                }
                photo = await pdfDoc.embedJpg(photoBytes);
              }

              page.drawImage(photo, {
                x: 476.5,
                y: 214,
                width: 79.75,
                height: 108,
              });
              photoFound = true;
              console.log(`✅ Added photo for ${form.candidateName || student.name}`);
              break;
            } catch (embedError) {
              console.log(`⚠️ SKIPPED PHOTO: ${form.candidateName || student.name} - Cannot embed image: ${embedError.message}`);
              break;
            }
          }
        }

        if (!photoFound) {
          console.log(`📷 No photo available for ${form.candidateName || student.name}`);
          page.drawText("Photo Not Available", { x: 400, y: 650, size: 10, font: arial });
        }

        // BACK PAGE (EXACTLY like individual preview)
        const backPage = pdfDoc.addPage([595.28, 841.89]);
        const backImg = await pdfDoc.embedJpg(backBytes);
        backPage.drawImage(backImg, {
          x: 0,
          y: 0,
          width: 595.28,
          height: 841.89,
        });

        if (form.instructions) {
          backPage.drawText("Important Instructions:", { x: 50, y: 750, size: 14, font: arialBold });
          backPage.drawText(form.instructions, {
            x: 50,
            y: 720,
            size: 10,
            font: arial,
            maxWidth: 500,
            lineHeight: 12,
          });
        }

        processedCount++;
        studentProcessed = true;
        console.log(`✅ SUCCESS: Added hall ticket for ${form.candidateName || student.name}`);

      } catch (studentError) {
        console.log(`❌ SKIPPED STUDENT: ${student.name || 'Unknown'} - ${studentError.message}`);
        skippedCount++;
        
        // Remove the last added page if student processing failed mid-way
        if (!studentProcessed) {
          const pages = pdfDoc.getPages();
          if (pages.length > 0) {
            pdfDoc.removePage(pages.length - 1);
          }
        }
        continue;
      }
    }

    // 6️⃣ Check if any students were processed
    if (processedCount === 0) {
      return res.status(400).send("No students could be processed. All students were skipped due to errors.");
    }

    // 7️⃣ Save combined PDF
    const pdfBytes = await pdfDoc.save();
    const batch = await db.get().collection(collection.BATCH_COLLECTION).findOne({ _id: new ObjectId(batchId) });
    const batchName = batch ? batch.batchName.replace(/\s+/g, '-') : 'Batch';
    const fileName = `Hall-Tickets-${batchName}.pdf`;

    console.log(`📊 BATCH PROCESSING COMPLETE:`);
    console.log(`   ✅ Processed: ${processedCount} students`);
    console.log(`   ⏭️ Skipped: ${skippedCount} students`);
    console.log(`   📄 Total pages: ${pdfDoc.getPages().length}`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ CRITICAL Error generating batch hall tickets:", err);
    res.status(500).send("Error generating batch hall tickets");
  }
});

// ADD MARK PAGE
router.get('/add-mark/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student details
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    // 2️⃣ Fetch center details (not from student — directly from centers)
    const centres = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .find({})
      .toArray();

    // If you only need one default center (for example, the first one)
    const centre = centres.length > 0 ? centres[0] : null;

    // 3️⃣ Render page with student + center
    res.render('admin/add-mark', { 
      hideNavbar: true, 
      studentId,
      student,
      centre,     // Single center (first or chosen)
      centres     // Or full list if you want a dropdown
    });

  } catch (err) {
    console.error("❌ Error loading student or centre data:", err);
    res.status(500).send("Error loading student or centre data");
  }
});
// POST route to save marks
// POST route to save marks
// POST route to save marks
router.post('/add-mark', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.body.studentId;
    console.log("📝 Received form data for student:", studentId);
    console.log("📋 Form body keys:", Object.keys(req.body));

    if (!ObjectId.isValid(studentId)) {
      console.error("❌ Invalid studentId:", studentId);
      return res.status(400).send("Invalid Student ID");
    }

    // Extract all form data
    const marksData = {
      // Student information
      candidateName: req.body.candidateName,
      address: req.body.address,
      institute: req.body.institute,
      examination: req.body.examination,
      course: req.body.course,
      courseDuration: req.body.courseDuration,
      registrationNo: req.body.registrationNo,
      
      // Department and exam info
      department: req.body.department,
      examTitle: req.body.examTitle,
      
      // Marks data - parse subjects from form
      subjects: [],
      
      // Calculated totals
      totalWords: req.body.totalWords,
      maxTotal: parseInt(req.body.maxTotal) || 0,
      obtainedTotal: parseInt(req.body.obtainedTotal) || 0,
      overallResult: req.body.overallResult,
      grade: req.body.grade,
      
      // Timestamp
      createdAt: new Date()
    };

    // Debug: Check if subject arrays are coming through
    console.log("📚 Subject names received:", req.body.subjectName);
    console.log("🔢 Theory marks received:", req.body.theoryObt);

    // Process subjects data
    if (req.body.subjectName && Array.isArray(req.body.subjectName)) {
      console.log(`📖 Processing ${req.body.subjectName.length} subjects`);
      
      for (let i = 0; i < req.body.subjectName.length; i++) {
        if (req.body.subjectName[i].trim() !== '') {
          const subjectData = {
            subject: req.body.subjectName[i],
            theoryMax: parseInt(req.body.theoryMax[i]) || 0,
            theoryMin: parseInt(req.body.theoryMin[i]) || 0,
            theoryObt: parseInt(req.body.theoryObt[i]) || 0,
            practicalMax: parseInt(req.body.practicalMax[i]) || 0,
            practicalMin: parseInt(req.body.practicalMin[i]) || 0,
            practicalObt: parseInt(req.body.practicalObt[i]) || 0,
            totalMax: parseInt(req.body.theoryMax[i]) + parseInt(req.body.practicalMax[i]) || 0,
            totalMin: parseInt(req.body.theoryMin[i]) + parseInt(req.body.practicalMin[i]) || 0,
            totalObt: parseInt(req.body.theoryObt[i]) + parseInt(req.body.practicalObt[i]) || 0,
            result: (parseInt(req.body.theoryObt[i]) >= parseInt(req.body.theoryMin[i]) && 
                    parseInt(req.body.practicalObt[i]) >= parseInt(req.body.practicalMin[i])) ? 'PASSED' : 'FAILED'
          };
          
          marksData.subjects.push(subjectData);
          console.log(`✅ Added subject: ${subjectData.subject}`);
        }
      }
    } else {
      console.log("⚠️ No subject data received or not in array format");
    }

    console.log("📊 Final marks data to save:", JSON.stringify(marksData, null, 2));

    // Save to database
    const result = await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
      { _id: new ObjectId(studentId) },
      { 
        $set: { 
          marks: marksData,
          updatedAt: new Date()
        } 
      }
    );

    console.log("💾 Database update result:", result.modifiedCount ? "Success" : "No changes");

    res.redirect('/admin/mark-list/' + studentId);
  } catch (err) {
    console.error("❌ Error saving marks:", err);
    res.status(500).send("Error submitting marks");
  }
});

// // MARK LIST ROUTE (Fully Fixed)
// router.get('/mark-list/:id', verifyAdminLogin, async (req, res) => {
//   try {
//     const studentId = new ObjectId(req.params.id);

//     // 1️⃣ Get student data
//     const student = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .findOne({ _id: studentId });

//     if (!student) return res.status(404).send("Student not found");

//     const centreId = student.centreId;
//     const departmentName = student.department;

//     // 2️⃣ Fetch center data
//     const centerData = await centerHelpers.getCenterById(centreId);

//     // 3️⃣ Extract logos
//     const institutionLogo = centerData?.institutionLogo || null;

//     // ✅ Find department logo safely
//     let departmentLogo = null;

//     if (centerData?.departmentLogos && departmentName) {
//       const deptKeys = Object.keys(centerData.departmentLogos);
//       const matchedKey = deptKeys.find(
//         key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
//       );

//       if (matchedKey) {
//         departmentLogo = centerData.departmentLogos[matchedKey];
//         console.log("✅ Found department logo path:", departmentLogo);
//       } else {
//         console.log("⚠️ No matching department logo found. Available keys:", deptKeys);
//       }
//     }

//     // 🧾 Debug info
//     console.log("✅ Marklist Debug:", {
//       centreId,
//       departmentName,
//       institutionLogo,
//       departmentLogo
//     });

//     // 4️⃣ Render page
//     res.render('admin/mark-list', {
//       hideNavbar: true,
//       studentId: req.params.id,
//       student,
//       logos: {
//         institution: institutionLogo,
//         department: departmentLogo
//       },
//       currentDate: new Date()
//     });

//   } catch (err) {
//     console.error("❌ Error loading mark list:", err);
//     res.status(500).send("Error loading mark list");
//   }
// });
// ===========================
// MARKLIST PREVIEW (with Download Button) - FIXED CENTERING
// ===========================
router.get("/preview-marklist/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student || !student.marks) {
      return res.status(404).send("Student or marks not found");
    }
    
    // ✅ Fetch center and logo data
    const centreId = student.centreId;
    const centerData = await centerHelpers.getCenterById(centreId);
    const institutionLogo = centerData?.institutionLogo || null;
    
    // ✅ Fetch and match Department Logo
    let departmentLogo = null;
    const departmentName = student.department || student.courseDepartmentName;

    if (centerData?.departmentLogos && departmentName) {
      const deptKeys = Object.keys(centerData.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );

      if (matchedKey) {
        departmentLogo = centerData.departmentLogos[matchedKey];
        console.log("✅ Found department logo path:", departmentLogo);
      } else {
        console.log("⚠️ No matching department logo found. Available keys:", deptKeys);
      }
    }

    // 2️⃣ Load background image
    const bgPath = path.join(__dirname, "../public/images/Marklist-bg.jpg");
    const bgBytes = fs.readFileSync(bgPath);

    // 3️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load Arial fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold = arial;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    }
    
    // Load Square 721 BT
    const squareFontPath = path.join(__dirname, "../public/fonts/SQR721N.TTF");
    let squareFont = arial; // fallback
    if (fs.existsSync(squareFontPath)) {
      const squareBytes = fs.readFileSync(squareFontPath);
      squareFont = await pdfDoc.embedFont(squareBytes);
    }
    
    const calibriPath = path.join(__dirname, "../public/fonts/CALIBRI.TTF");
    let calibri = arial; // fallback to Arial if Calibri not available
    if (fs.existsSync(calibriPath)) {
      const calibriBytes = fs.readFileSync(calibriPath);
      calibri = await pdfDoc.embedFont(calibriBytes);
    }

    const calibriBoldPath = path.join(__dirname, "../public/fonts/CALIBRIB.TTF");
    let calibriBold = calibri; // fallback to regular Calibri
    if (fs.existsSync(calibriBoldPath)) {
      const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
      calibriBold = await pdfDoc.embedFont(calibriBoldBytes);
    }
    
    const zurichLightPath = path.join(__dirname, "../public/fonts/ZurichLightBT.ttf");
    let zurichLight = arial; // fallback to Arial if not found
    if (fs.existsSync(zurichLightPath)) {
      try {
        const zurichLightBytes = fs.readFileSync(zurichLightPath);
        zurichLight = await pdfDoc.embedFont(zurichLightBytes);
        console.log("✅ Zurich Light BT font loaded successfully");
      } catch (err) {
        console.error("❌ Failed to load Zurich Light BT font:", err);
      }
    } else {
      console.log("⚠️ Zurich Light BT font file not found at:", zurichLightPath);
    }

    // 5️⃣ Page size
    const pageWidth = 8.543 * 72;
    const pageHeight = 11.367 * 72;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 6️⃣ Background
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    page.drawImage(bgImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });

    const { rgb } = require("pdf-lib");

    // ===========================
    // LINE CONTROL CONFIG
    // ===========================
    const SHOW_TABLE_LINES = true;
    const lineSettings = {
      thickness: SHOW_TABLE_LINES ? 0.3 : 0,
      color: SHOW_TABLE_LINES ? rgb(0, 0, 0) : rgb(1, 1, 1),
    };

    // ===========================
    // DETAILS
    // ===========================
    let yPosition = pageHeight - 240;

    const details = [
      `Registration Number                            : ${student.marks.registrationNo || ""}`,
      `This mark sheet is Award to                  : ${student.marks.candidateName || ""}`,
      `On successful Completion of the Course : ${student.marks.course || ""}`,
      `Of Duration                                          : ${student.marks.courseDuration || ""}`,
      `From our Authorized Training centre      : ${student.marks.institute || ""}`
    ];

    details.forEach((text) => {
      page.drawText(text, { x: 45, y: yPosition, size: 12, font: squareFont, color: rgb(0,0,0) });
      yPosition -= 22;
    });

    yPosition -= 5;

    // ===========================
    // TABLE HEADER - FIXED CENTERING
    // ===========================
    const xStart = 45;
    const colWidths = [28, 180, 30, 30, 30, 30, 30, 30, 30, 30, 30, 48];
    const rowHeight = 24;
    const headerBg = rgb(0.83, 0.90, 0.98);
    const tableTop = yPosition;

    let xPos = xStart;

    page.drawRectangle({
      x: xPos,
      y: tableTop - 32,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: 32,
      color: headerBg,
      borderColor: lineSettings.color,
      borderWidth: lineSettings.thickness,
    });

    const mainHeaders = [
      "S.No", "Name of Subject",
      "Theory Marks", "", "",
      "Practical Marks", "", "",
      "Total Marks", "", "",
      "Result"
    ];

    const subHeaders = [
      "", "", "Max", "Min", "Obt",
      "Max", "Min", "Obt",
      "Max", "Min", "Obt", ""
    ];

    // FIXED: Draw main headers like combined marklist
    xPos = xStart;
    for (let i = 0; i < mainHeaders.length; i++) {
      if (!mainHeaders[i]) {
        // Skip empty header positions but still advance column width
        xPos += colWidths[i];
        continue;
      }

      let groupWidth = colWidths[i];
      let columnsToSkip = 0;

      // Check if this is a grouped header (spanning multiple columns)
      if (mainHeaders[i] === "Theory Marks" || 
          mainHeaders[i] === "Practical Marks" || 
          mainHeaders[i] === "Total Marks") {
        
        // Span 3 columns
        groupWidth = colWidths[i] + colWidths[i+1] + colWidths[i+2];
        columnsToSkip = 2; // Skip the next 2 empty slots
        
        // Draw the header centered over the 3 columns
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        page.drawText(mainHeaders[i], {
          x: xPos + (groupWidth - textWidth) / 2,
          y: tableTop - 13, // Lower Y position
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += groupWidth;
        
        // Skip the columns we've already accounted for
        i += columnsToSkip;
      } else {
        // Regular single column header (S.No, Name of Subject, Result)
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        
        // Use same Y position as combined marklist
        page.drawText(mainHeaders[i], {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 18, // Adjusted Y position to match combined
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += colWidths[i];
      }
    }

    // Draw sub headers - FIXED CENTERING
    xPos = xStart;
    subHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = calibriBold.widthOfTextAtSize(header, 10); // Use 10 size like combined
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 28, // Adjusted Y position
          size: 10, // Use 10 like combined
          font: calibriBold,
          color: rgb(0,0,0)
        });
      }
      xPos += colWidths[i];
    });

    // Draw horizontal separator lines for grouped headers
    if (SHOW_TABLE_LINES) {
      const headerMid = tableTop - 16;

      // THEORY MARKS separator
      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      // PRACTICAL MARKS separator
      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      // TOTAL MARKS separator
      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7] + colWidths[8] + colWidths[9] + colWidths[10], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });
    }

    // Draw vertical lines
    if (SHOW_TABLE_LINES) {
      xPos = xStart;
      const shortLines = [2, 3, 5, 6, 8, 9];  // Max/Min/Obt separators

      colWidths.forEach((width, i) => {
        if (i < colWidths.length - 1) {
          const lineX = xPos + width;

          if (shortLines.includes(i)) {
            // Draw short line inside sub-header
            page.drawLine({
              start: { x: lineX, y: tableTop - 16 },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          } else {
            // Draw full boundary line
            page.drawLine({
              start: { x: lineX, y: tableTop },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          }
        }
        xPos += width;
      });
    }

    // ===========================
    // ROWS - FIXED CENTERING LIKE COMBINED MARKLIST
    // ===========================
    yPosition = tableTop - 32;

    student.marks.subjects.forEach((subject, index) => {
      xPos = xStart;

      // Prepare row data
      const rowData = [
        (index + 1).toString(),
        subject.subject || "",
        subject.theoryMax || "",
        subject.theoryMin || "",
        subject.theoryObt || "",
        subject.practicalMax || "",
        subject.practicalMin || "",
        subject.practicalObt || "",
        subject.totalMax || "",
        subject.totalMin || "",
        subject.totalObt || "",
        subject.result || "",
      ];

      // Wrap subject name
      const subjectText = rowData[1];
      const maxSubjectWidth = colWidths[1] - 8;
      const words = subjectText.split(" ");
      let lines = [];
      let line = "";

      words.forEach(word => {
        const testLine = line ? line + " " + word : word;
        const testWidth = calibri.widthOfTextAtSize(testLine, 11);
        if (testWidth > maxSubjectWidth) {
          lines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      });
      lines.push(line);

      // Adjust rowHeight dynamically
      const dynamicRowHeight = rowHeight + (lines.length - 1) * 10;

      // Draw row rectangle
      page.drawRectangle({
        x: xPos,
        y: yPosition - dynamicRowHeight,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: dynamicRowHeight,
        borderWidth: lineSettings.thickness,
        borderColor: lineSettings.color,
      });

      // Draw each cell - FIXED LIKE COMBINED MARKLIST
      rowData.forEach((data, i) => {
        let textX;
        
        // EXACT SAME LOGIC AS COMBINED MARKLIST:
        // Center align for numeric columns (S.No, all marks columns, Result)
        if (i === 0 || [2,3,4,5,6,7,8,9,10,11].includes(i)) {
          // Use calibri font for width calculation like combined marklist
          textX = xPos + (colWidths[i] - calibri.widthOfTextAtSize(String(data), 11)) / 2;
        } else {
          textX = xPos + 4; // Left align for subject only
        }

        if (i === 1) {
          // Draw wrapped subject text
          const totalTextHeight = lines.length * 10;
          const subjectStartY = yPosition - (dynamicRowHeight / 2) + (totalTextHeight / 2) - 9;
        
          lines.forEach((lineText, lineIndex) => {
            page.drawText(lineText, {
              x: textX,
              y: subjectStartY - (lineIndex * 10),
              size: 11,
              font: calibri,
              color: rgb(0,0,0),
            });
          });
        } else if (i === 11) {
          // Result cell - centered like combined marklist
          const resultColor = data === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibriBold, // Use bold for result like combined
            color: resultColor,
          });
        } else {
          // Regular cells (S.No and marks) - centered
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibri,
            color: rgb(0,0,0),
          });
        }

        // Draw vertical lines
        if (SHOW_TABLE_LINES && i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + colWidths[i], y: yPosition - dynamicRowHeight },
            end: { x: xPos + colWidths[i], y: yPosition },
            color: lineSettings.color,
            thickness: lineSettings.thickness
          });
        }

        xPos += colWidths[i];
      });

      yPosition -= dynamicRowHeight;
    });

    // ===========================
    // TOTAL ROW - FIXED CENTERING
    // ===========================
    xPos = xStart;

    page.drawRectangle({
      x: xPos,
      y: yPosition - rowHeight,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: rowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderWidth: lineSettings.thickness,
      borderColor: lineSettings.color,
    });
    
    // Draw vertical lines
    const verticalLineIndexes = [1, 7, 9, 10];
    let lineXPos = xStart;
    
    colWidths.forEach((width, i) => {
      if (verticalLineIndexes.includes(i)) {
        page.drawLine({
          start: { x: lineXPos + width, y: yPosition - rowHeight },
          end: { x: lineXPos + width, y: yPosition },
          thickness: lineSettings.thickness,
          color: lineSettings.color,
        });
      }
      lineXPos += width;
    });
    
    // Total in words - left aligned
    page.drawText("Total in words", {
      x: xStart + 5,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Total words - centered like combined marklist
    const totalWordsText = `${student.marks.totalWords || ""}`;
    const totalWordsWidth = zurichLight.widthOfTextAtSize(totalWordsText, 10.5);
    const totalWordsX = xStart + 205 + (colWidths[1] - totalWordsWidth) / 2;
    
    page.drawText(totalWordsText, {
      x: totalWordsX,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Max Total - centered
    const maxTotalText = `${student.marks.maxTotal || ""}`;
    const maxTotalWidth = zurichLight.widthOfTextAtSize(maxTotalText, 10.5);
    const maxTotalX = xStart + 410 + (colWidths[8] - maxTotalWidth) / 2;
    
    page.drawText(maxTotalText, {
      x: maxTotalX,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Obtained Total - centered
    const obtainedTotalText = `${student.marks.obtainedTotal || ""}`;
    const obtainedTotalWidth = zurichLight.widthOfTextAtSize(obtainedTotalText, 10.5);
    const obtainedTotalX = xStart + 450 + (colWidths[10] - obtainedTotalWidth) / 2;
    
    page.drawText(obtainedTotalText, {
      x: obtainedTotalX,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Overall Result - centered
    const overallResultText = student.marks.overallResult || "";
    const overallResultWidth = zurichLight.widthOfTextAtSize(overallResultText, 10);
    const overallResultX = xStart + 480 + (colWidths[11] - overallResultWidth) / 2;
    
    page.drawText(overallResultText, {
      x: overallResultX,
      y: yPosition - rowHeight + 8,
      size: 10,
      font: zurichLight,
      color: student.marks.overallResult === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0)
    });

    // ===========================
    // FOOTER
    // ===========================
    yPosition -= 40;
    page.drawText(`Place of Issue : NETD (HO)`, {
      x: 45,
      y: yPosition,
      size: 10,
      font: arial,
      color: rgb(0,0,0)
    });

    const issueDate = student.marks.createdAt
      ? new Date(student.marks.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString();

    page.drawText(`Date of Issue : ${issueDate}`, {
      x: 45,
      y: yPosition - 15,
      size: 10,
      font: arial,
      color: rgb(0,0,0)
    });

    // Grade - centered
    const gradeText = ` ${student.marks.grade || ""} `;
    const gradeWidth = arialBold.widthOfTextAtSize(gradeText, 10);
    const gradeX = pageWidth - 123 + (45 - gradeWidth) / 2;
    
    page.drawText(gradeText, {
      x: gradeX,
      y: yPosition + 2,
      size: 10,
      font: arialBold,
      color: rgb(0,0,0),
    });

    

    // ===========================
    // LOGOS
    // ===========================
    const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
      if (!logoUrl) return;

      const logoPath = path.join(__dirname, "../public", logoUrl);
      if (!fs.existsSync(logoPath)) return;

      const bytes = fs.readFileSync(logoPath);
      const image = logoPath.endsWith(".png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

      const { width, height } = image.scale(1);
      const aspectRatio = width / height;

      let widthLimit = maxWidth;
      let heightLimit = maxHeight;
      if (allowWider && aspectRatio > 1.4) {
        widthLimit *= 1.3;
      }

      const widthRatio = widthLimit / width;
      const heightRatio = heightLimit / height;
      const scale = Math.min(widthRatio, heightRatio);

      const displayWidth = width * scale;
      const displayHeight = height * scale;

      const offsetX = x + (maxWidth - displayWidth) / 2;
      const offsetY = y + (maxHeight - displayHeight) / 2;

      page.drawImage(image, {
        x: offsetX,
        y: offsetY,
        width: displayWidth,
        height: displayHeight,
      });
    };

    await embedLogo(institutionLogo, 239, 125, 80, 80, true);
    await embedLogo(departmentLogo, 140, 125, 85.7, 86.7);

    // ===========================
    // OUTPUT HTML
    // ===========================
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <head>
          <title>Marklist Preview</title>
          <style>
            body { 
              margin: 0;
              padding: 0;
              font-family: Arial, sans-serif;
              background: #f5f5f5;
              overflow: hidden;
            }

            .header {
              width: 100%;
              background: #2a3d66;
              color: white;
              padding: 12px;
              text-align: center;
              font-size: 20px;
              font-weight: bold;
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              z-index: 1000;
              box-shadow: 0px 2px 6px rgba(0,0,0,0.3);
            }

            iframe {
              position: fixed;
              top: 60px;
              left: 0;
              right: 0;
              bottom: 0;
              width: 100%;
              height: calc(100vh - 60px);
              border: none;
            }

            .download-btn {
              position: fixed;
              top: 70px;
              right: 20px;
              background: #2a3d66;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: 0.3s;
              z-index: 1001;
            }

            .download-btn:hover {
              background: #1d2a47;
              transform: translateY(-2px);
            }
          </style>
        </head>
        <body>
          <div class="header">Marklist Preview - ${student.marks.candidateName || "Student"}</div>
          <iframe src="data:application/pdf;base64,${base64}"></iframe>
          <a href="/admin/download-marklist/${studentId}" class="download-btn">
            📥 Download Marklist
          </a>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ Error generating marklist preview:", err);
    res.status(500).send("Error generating marklist preview");
  }
});
// ===========================
// DOWNLOAD MARKLIST (FIXED USING CERTIFICATE PATTERN)
// ===========================
router.get("/download-marklist/:id", verifyAdminLogin, async (req, res) => {
  try {
    console.log("📥 Download marklist for student:", req.params.id);
    
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student || !student.marks) {
      return res.status(404).send("Student or marks not found");
    }
    
    // ✅ Fetch center and logo data
    const centreId = student.centreId;
    const centerData = await centerHelpers.getCenterById(centreId);
    const institutionLogo = centerData?.institutionLogo || null;
    
    // ✅ Fetch and match Department Logo
    let departmentLogo = null;
    const departmentName = student.department || student.courseDepartmentName;

    if (centerData?.departmentLogos && departmentName) {
      const deptKeys = Object.keys(centerData.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );

      if (matchedKey) {
        departmentLogo = centerData.departmentLogos[matchedKey];
      }
    }

    // 2️⃣ Load background image
    const bgPath = path.join(__dirname, "../public/images/Marklist-bg.jpg");
    const bgBytes = fs.readFileSync(bgPath);

    // 3️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold = arial;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    }
    
    const squareFontPath = path.join(__dirname, "../public/fonts/SQR721N.TTF");
    let squareFont = arial;
    if (fs.existsSync(squareFontPath)) {
      const squareBytes = fs.readFileSync(squareFontPath);
      squareFont = await pdfDoc.embedFont(squareBytes);
    }
    
    const calibriPath = path.join(__dirname, "../public/fonts/CALIBRI.TTF");
    let calibri = arial;
    if (fs.existsSync(calibriPath)) {
      const calibriBytes = fs.readFileSync(calibriPath);
      calibri = await pdfDoc.embedFont(calibriBytes);
    }

    const calibriBoldPath = path.join(__dirname, "../public/fonts/CALIBRIB.TTF");
    let calibriBold = calibri;
    if (fs.existsSync(calibriBoldPath)) {
      const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
      calibriBold = await pdfDoc.embedFont(calibriBoldBytes);
    }
    
    const zurichLightPath = path.join(__dirname, "../public/fonts/ZurichLightBT.ttf");
    let zurichLight = arial;
    if (fs.existsSync(zurichLightPath)) {
      try {
        const zurichLightBytes = fs.readFileSync(zurichLightPath);
        zurichLight = await pdfDoc.embedFont(zurichLightBytes);
      } catch (err) {
        console.error("❌ Failed to load Zurich Light BT font:", err);
      }
    }

    // 5️⃣ Page size
    const pageWidth = 8.543 * 72;
    const pageHeight = 11.367 * 72;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 6️⃣ Background
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    page.drawImage(bgImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });

    const { rgb } = require("pdf-lib");

    // ===========================
    // LINE CONTROL CONFIG
    // ===========================
    const SHOW_TABLE_LINES = true;
    const lineSettings = {
      thickness: SHOW_TABLE_LINES ? 0.3 : 0,
      color: SHOW_TABLE_LINES ? rgb(0, 0, 0) : rgb(1, 1, 1),
    };

    // ===========================
    // DETAILS
    // ===========================
    let yPosition = pageHeight - 240;

    const details = [
      `Registration Number                            : ${student.marks.registrationNo || ""}`,
      `This mark sheet is Award to                  : ${student.marks.candidateName || ""}`,
      `On successful Completion of the Course : ${student.marks.course || ""}`,
      `Of Duration                                          : ${student.marks.courseDuration || ""}`,
      `From our Authorized Training centre      : ${student.marks.institute || ""}`
    ];

    details.forEach((text) => {
      page.drawText(text, { x: 45, y: yPosition, size: 12, font: squareFont, color: rgb(0,0,0) });
      yPosition -= 22;
    });

    yPosition -= 5;

    // ===========================
    // TABLE HEADER
    // ===========================
    const xStart = 45;
    const colWidths = [28, 180, 30, 30, 30, 30, 30, 30, 30, 30, 30, 48];
    const rowHeight = 24;
    const headerBg = rgb(0.83, 0.90, 0.98);
    const tableTop = yPosition;

    let xPos = xStart;

    page.drawRectangle({
      x: xPos,
      y: tableTop - 32,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: 32,
      color: headerBg,
      borderColor: lineSettings.color,
      borderWidth: lineSettings.thickness,
    });

    const mainHeaders = [
      "S.No", "Name of Subject",
      "Theory Marks", "", "",
      "Practical Marks", "", "",
      "Total Marks", "", "",
      "Result"
    ];

    const subHeaders = [
      "", "", "Max", "Min", "Obt",
      "Max", "Min", "Obt",
      "Max", "Min", "Obt", ""
    ];

    // Draw main headers
    xPos = xStart;
    for (let i = 0; i < mainHeaders.length; i++) {
      if (!mainHeaders[i]) {
        xPos += colWidths[i];
        continue;
      }

      let groupWidth = colWidths[i];
      let columnsToSkip = 0;

      if (mainHeaders[i] === "Theory Marks" || 
          mainHeaders[i] === "Practical Marks" || 
          mainHeaders[i] === "Total Marks") {
        
        groupWidth = colWidths[i] + colWidths[i+1] + colWidths[i+2];
        columnsToSkip = 2;
        
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        page.drawText(mainHeaders[i], {
          x: xPos + (groupWidth - textWidth) / 2,
          y: tableTop - 13,
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += groupWidth;
        i += columnsToSkip;
      } else {
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        
        page.drawText(mainHeaders[i], {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 18,
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += colWidths[i];
      }
    }

    // Draw sub headers
    xPos = xStart;
    subHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = calibriBold.widthOfTextAtSize(header, 10);
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 28,
          size: 10,
          font: calibriBold,
          color: rgb(0,0,0)
        });
      }
      xPos += colWidths[i];
    });

    // Draw horizontal separator lines
    if (SHOW_TABLE_LINES) {
      const headerMid = tableTop - 16;

      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7] + colWidths[8] + colWidths[9] + colWidths[10], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });
    }

    // Draw vertical lines
    if (SHOW_TABLE_LINES) {
      xPos = xStart;
      const shortLines = [2, 3, 5, 6, 8, 9];

      colWidths.forEach((width, i) => {
        if (i < colWidths.length - 1) {
          const lineX = xPos + width;

          if (shortLines.includes(i)) {
            page.drawLine({
              start: { x: lineX, y: tableTop - 16 },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          } else {
            page.drawLine({
              start: { x: lineX, y: tableTop },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          }
        }
        xPos += width;
      });
    }

    // ===========================
    // ROWS
    // ===========================
    yPosition = tableTop - 32;

    student.marks.subjects.forEach((subject, index) => {
      xPos = xStart;

      const rowData = [
        (index + 1).toString(),
        subject.subject || "",
        subject.theoryMax || "",
        subject.theoryMin || "",
        subject.theoryObt || "",
        subject.practicalMax || "",
        subject.practicalMin || "",
        subject.practicalObt || "",
        subject.totalMax || "",
        subject.totalMin || "",
        subject.totalObt || "",
        subject.result || "",
      ];

      // Wrap subject name
      const subjectText = rowData[1];
      const maxSubjectWidth = colWidths[1] - 8;
      const words = subjectText.split(" ");
      let lines = [];
      let line = "";

      words.forEach(word => {
        const testLine = line ? line + " " + word : word;
        const testWidth = calibri.widthOfTextAtSize(testLine, 11);
        if (testWidth > maxSubjectWidth) {
          lines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      });
      lines.push(line);

      const dynamicRowHeight = rowHeight + (lines.length - 1) * 10;

      // Draw row rectangle
      page.drawRectangle({
        x: xPos,
        y: yPosition - dynamicRowHeight,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: dynamicRowHeight,
        borderWidth: lineSettings.thickness,
        borderColor: lineSettings.color,
      });

      // Draw each cell
      rowData.forEach((data, i) => {
        let textX;
        
        if (i === 0 || [2,3,4,5,6,7,8,9,10,11].includes(i)) {
          textX = xPos + (colWidths[i] - calibri.widthOfTextAtSize(String(data), 11)) / 2;
        } else {
          textX = xPos + 4;
        }

        if (i === 1) {
          const totalTextHeight = lines.length * 10;
          const subjectStartY = yPosition - (dynamicRowHeight / 2) + (totalTextHeight / 2) - 9;
        
          lines.forEach((lineText, lineIndex) => {
            page.drawText(lineText, {
              x: textX,
              y: subjectStartY - (lineIndex * 10),
              size: 11,
              font: calibri,
              color: rgb(0,0,0),
            });
          });
        } else if (i === 11) {
          const resultColor = data === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibriBold,
            color: resultColor,
          });
        } else {
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibri,
            color: rgb(0,0,0),
          });
        }

        if (SHOW_TABLE_LINES && i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + colWidths[i], y: yPosition - dynamicRowHeight },
            end: { x: xPos + colWidths[i], y: yPosition },
            color: lineSettings.color,
            thickness: lineSettings.thickness
          });
        }

        xPos += colWidths[i];
      });

      yPosition -= dynamicRowHeight;
    });

    // ===========================
    // TOTAL ROW
    // ===========================
    xPos = xStart;

    page.drawRectangle({
      x: xPos,
      y: yPosition - rowHeight,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: rowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderWidth: lineSettings.thickness,
      borderColor: lineSettings.color,
    });
    
    // Draw vertical lines
    const verticalLineIndexes = [1, 7, 9, 10];
    let lineXPos = xStart;
    
    colWidths.forEach((width, i) => {
      if (verticalLineIndexes.includes(i)) {
        page.drawLine({
          start: { x: lineXPos + width, y: yPosition - rowHeight },
          end: { x: lineXPos + width, y: yPosition },
          thickness: lineSettings.thickness,
          color: lineSettings.color,
        });
      }
      lineXPos += width;
    });
    
    // Total in words
    page.drawText("Total in words", {
      x: xStart + 5,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Total words
    const totalWordsText = `${student.marks.totalWords || ""}`;
    const totalWordsWidth = zurichLight.widthOfTextAtSize(totalWordsText, 10.5);
    const totalWordsX = xStart + 205 + (colWidths[1] - totalWordsWidth) / 2;
    
    page.drawText(totalWordsText, {
      x: totalWordsX,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Max Total
    const maxTotalText = `${student.marks.maxTotal || ""}`;
    const maxTotalWidth = zurichLight.widthOfTextAtSize(maxTotalText, 10.5);
    const maxTotalX = xStart + 410 + (colWidths[8] - maxTotalWidth) / 2;
    
    page.drawText(maxTotalText, {
      x: maxTotalX,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Obtained Total
    const obtainedTotalText = `${student.marks.obtainedTotal || ""}`;
    const obtainedTotalWidth = zurichLight.widthOfTextAtSize(obtainedTotalText, 10.5);
    const obtainedTotalX = xStart + 450 + (colWidths[10] - obtainedTotalWidth) / 2;
    
    page.drawText(obtainedTotalText, {
      x: obtainedTotalX,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    // Overall Result
    const overallResultText = student.marks.overallResult || "";
    const overallResultWidth = zurichLight.widthOfTextAtSize(overallResultText, 10);
    const overallResultX = xStart + 480 + (colWidths[11] - overallResultWidth) / 2;
    
    page.drawText(overallResultText, {
      x: overallResultX,
      y: yPosition - rowHeight + 8,
      size: 10,
      font: zurichLight,
      color: student.marks.overallResult === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0)
    });

    // ===========================
    // FOOTER
    // ===========================
    yPosition -= 40;
    page.drawText(`Place of Issue : NETD (HO)`, {
      x: 45,
      y: yPosition,
      size: 10,
      font: arial,
      color: rgb(0,0,0)
    });

    const issueDate = student.marks.createdAt
      ? new Date(student.marks.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString();

    page.drawText(`Date of Issue : ${issueDate}`, {
      x: 45,
      y: yPosition - 15,
      size: 10,
      font: arial,
      color: rgb(0,0,0)
    });

    // Grade
    const gradeText = ` ${student.marks.grade || ""} `;
    const gradeWidth = arialBold.widthOfTextAtSize(gradeText, 10);
    const gradeX = pageWidth - 123 + (45 - gradeWidth) / 2;
    
    page.drawText(gradeText, {
      x: gradeX,
      y: yPosition + 2,
      size: 10,
      font: arialBold,
      color: rgb(0,0,0),
    });

  

    // ===========================
    // LOGOS
    // ===========================
    const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
      if (!logoUrl) return;

      const logoPath = path.join(__dirname, "../public", logoUrl);
      if (!fs.existsSync(logoPath)) return;

      const bytes = fs.readFileSync(logoPath);
      let image;
      
      try {
        if (logoPath.endsWith(".png")) {
          image = await pdfDoc.embedPng(bytes);
        } else {
          image = await pdfDoc.embedJpg(bytes);
        }
      } catch (err) {
        console.error("❌ Error embedding logo:", logoUrl, err);
        return;
      }

      const { width, height } = image.scale(1);
      const aspectRatio = width / height;

      let widthLimit = maxWidth;
      let heightLimit = maxHeight;
      if (allowWider && aspectRatio > 1.4) {
        widthLimit *= 1.3;
      }

      const widthRatio = widthLimit / width;
      const heightRatio = heightLimit / height;
      const scale = Math.min(widthRatio, heightRatio);

      const displayWidth = width * scale;
      const displayHeight = height * scale;

      const offsetX = x + (maxWidth - displayWidth) / 2;
      const offsetY = y + (maxHeight - displayHeight) / 2;

      page.drawImage(image, {
        x: offsetX,
        y: offsetY,
        width: displayWidth,
        height: displayHeight,
      });
    };

    await embedLogo(institutionLogo, 239, 125, 80, 80, true);
    await embedLogo(departmentLogo, 140, 125, 85.7, 86.7);

    // ===========================
    // ✅ FIXED: USE CERTIFICATE PATTERN FOR DOWNLOAD
    // ===========================
    const pdfBytes = await pdfDoc.save();
    
    console.log("✅ PDF generated successfully, size:", pdfBytes.length, "bytes");

    // ✅ EXACT SAME PATTERN AS WORKING CERTIFICATE ROUTE
    const fileName = `marklist_${student.marks.registrationNo || studentId}.pdf`;
    
    // ✅ Set headers exactly like certificate route
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    // ✅ Send exactly like certificate route
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error downloading marklist:", err);
    console.error("🔍 Stack trace:", err.stack);
    
    // Send error response
    res.status(500).json({
      error: "Error generating PDF",
      message: err.message,
      stack: err.stack
    });
  }
});

// ===========================
// COMBINED MARKLIST PREVIEW (PDF-Lib Version)
// ===========================
router.get("/preview-combined-marklist/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;
    console.log("🔄 Combined marklist PDF generation for:", studentId);

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    if (!student.marks) {
      return res.status(400).send("No regular marks found");
    }

    if (!student.supplyMarks) {
      return res.status(400).send("No supply marks found");
    }

    // 2️⃣ Combine regular and supply marks
    const combinedSubjects = [];
    let maxTotal = 0;
    let obtainedTotal = 0;
    let allPassed = true;

    // Regular subjects (only PASSED)
    if (Array.isArray(student.marks.subjects)) {
      student.marks.subjects.forEach(subject => {
        if (subject.result === 'PASSED') {
          combinedSubjects.push({ ...subject, source: 'regular' });
          maxTotal += parseInt(subject.totalMax) || 0;
          obtainedTotal += parseInt(subject.totalObt) || 0;
        }
      });
    }

    // Supply subjects (PASSED + FAILED)
    if (Array.isArray(student.supplyMarks.subjects)) {
      student.supplyMarks.subjects.forEach(supplySubject => {
        combinedSubjects.push({ ...supplySubject, source: 'supply' });
        maxTotal += parseInt(supplySubject.totalMax) || 0;
        obtainedTotal += parseInt(supplySubject.totalObt) || 0;
        if (supplySubject.result === 'FAILED') allPassed = false;
      });
    }

    // Calculate percentage & grade
    const percentage = maxTotal > 0 ? (obtainedTotal / maxTotal) * 100 : 0;
    let grade = 'FAILED';

    if (allPassed) {
      if (percentage >= 80) grade = 'PASSED WITH A+ GRADE';
      else if (percentage >= 70) grade = 'PASSED WITH A GRADE ';
      else if (percentage >= 60) grade = 'PASSED WITH B+ GRADE ';
      else if (percentage >= 50) grade = 'PASSED WITH B GRADE ';
      else if (percentage >= 40) grade = 'PASSED WITH C GRADE';
      else allPassed = false;
    }

    // Prepare combined marks object
    const combinedMarks = {
      ...student.marks,
      subjects: combinedSubjects,
      maxTotal: maxTotal.toString(),
      obtainedTotal: obtainedTotal.toString(),
      overallResult: allPassed ? 'PASSED' : 'FAILED',
      grade,
      totalWords: numberToWords(obtainedTotal),
      isCombined: true,
      combinedDate: new Date()
    };

    // ✅ Fetch center and logo data
    const centreId = student.centreId;
    const centerData = await centerHelpers.getCenterById(centreId);
    const institutionLogo = centerData?.institutionLogo || null;

    // ✅ Fetch department logo
    let departmentLogo = null;
    const departmentName = student.department || student.courseDepartmentName;

    if (centerData?.departmentLogos && departmentName) {
      const deptKeys = Object.keys(centerData.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );

      if (matchedKey) {
        departmentLogo = centerData.departmentLogos[matchedKey];
        console.log("✅ Found department logo path:", departmentLogo);
      }
    }

    // 3️⃣ Load background image
    const bgPath = path.join(__dirname, "../public/images/Marklist-bg.jpg");
    const bgBytes = fs.readFileSync(bgPath);

    // 4️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 5️⃣ Load fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold = arial;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    }

    const squareFontPath = path.join(__dirname, "../public/fonts/SQR721N.TTF");
    let squareFont = arial;
    if (fs.existsSync(squareFontPath)) {
      const squareBytes = fs.readFileSync(squareFontPath);
      squareFont = await pdfDoc.embedFont(squareBytes);
    }

    const calibriPath = path.join(__dirname, "../public/fonts/CALIBRI.TTF");
    let calibri = arial;
    if (fs.existsSync(calibriPath)) {
      const calibriBytes = fs.readFileSync(calibriPath);
      calibri = await pdfDoc.embedFont(calibriBytes);
    }

    const calibriBoldPath = path.join(__dirname, "../public/fonts/CALIBRIB.TTF");
    let calibriBold = calibri;
    if (fs.existsSync(calibriBoldPath)) {
      const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
      calibriBold = await pdfDoc.embedFont(calibriBoldBytes);
    }
    const zurichLightPath = path.join(__dirname, "../public/fonts/ZurichLightBT.ttf"); // or .otf depending on your file
let zurichLight = arial; // fallback to Arial if not found
if (fs.existsSync(zurichLightPath)) {
  try {
    const zurichLightBytes = fs.readFileSync(zurichLightPath);
    zurichLight = await pdfDoc.embedFont(zurichLightBytes);
    console.log("✅ Zurich Light BT font loaded successfully");
  } catch (err) {
    console.error("❌ Failed to load Zurich Light BT font:", err);
  }
} else {
  console.log("⚠️ Zurich Light BT font file not found at:", zurichLightPath);
}

    // 6️⃣ Page size
    const pageWidth = 8.543 * 72;
    const pageHeight = 11.367 * 72;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 7️⃣ Background
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    page.drawImage(bgImage, { 
      x: 0, 
      y: 0, 
      width: pageWidth, 
      height: pageHeight 
    });

    const { rgb } = require("pdf-lib");

    // ===========================
    // LINE CONTROL CONFIG
    // ===========================
    const SHOW_TABLE_LINES = true;
    const lineSettings = {
      thickness: SHOW_TABLE_LINES ? 0.3 : 0,
      color: SHOW_TABLE_LINES ? rgb(0, 0, 0) : rgb(1, 1, 1),
    };

    // ===========================
    // HEADER NOTICE
    // ===========================
    let yPosition = pageHeight - 180;
    
   

    yPosition -= 25;
    
   

    yPosition -= 13;

    // ===========================
    // STUDENT DETAILS
    // ===========================
    const details = [
      `Registration Number                            : ${combinedMarks.registrationNo || ""}`,
      `This combined mark sheet is Awarded to: ${combinedMarks.candidateName || ""}`,
      `On successful Completion of the Course : ${combinedMarks.course || ""}`,
      `Of Duration                                          : ${combinedMarks.courseDuration || ""}`,
      `From our Authorized Training centre      : ${combinedMarks.institute || ""}`,
      `Examination Type                                  : Regular + Supply Combined`
    ];

    details.forEach((text) => {
      page.drawText(text, { 
        x: 45, 
        y: yPosition, 
        size: 12, 
        font: squareFont, 
        color: rgb(0,0,0) 
      });
      yPosition -= 22;
    });

    yPosition -= 3;

    // ===========================
    // TABLE HEADER
    // ===========================
    const xStart = 45;
    const colWidths = [28, 145, 30, 30, 30, 30, 30, 30, 30, 30, 30, 45, 40]; // Added source column
    const rowHeight = 24;
    const headerBg = rgb(0.83, 0.90, 0.98);
    const tableTop = yPosition;

    let xPos = xStart;

    // Draw header background
    page.drawRectangle({
      x: xPos,
      y: tableTop - 32,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: 32,
      color: headerBg,
      borderColor: lineSettings.color,
      borderWidth: lineSettings.thickness,
    });

    const mainHeaders = [
      "S.No", "Name of Subject",
      "Theory Marks", "", "",
      "Practical Marks", "", "",
      "Total Marks", "", "",
      "Result", "Source"
    ];

    const subHeaders = [
      "", "", "Max", "Min", "Obt",
      "Max", "Min", "Obt",
      "Max", "Min", "Obt", "", ""
    ];

    // FIXED: Draw main headers - Fixed version
    xPos = xStart;
    for (let i = 0; i < mainHeaders.length; i++) {
      if (!mainHeaders[i]) {
        // Skip empty header positions but still advance column width
        xPos += colWidths[i];
        continue;
      }

      let groupWidth = colWidths[i];
      let columnsToSkip = 0;

      // Check if this is a grouped header
      if (mainHeaders[i] === "Theory Marks" || 
          mainHeaders[i] === "Practical Marks" || 
          mainHeaders[i] === "Total Marks") {
        
        // Span 3 columns
        groupWidth = colWidths[i] + colWidths[i+1] + colWidths[i+2];
        columnsToSkip = 2; // Skip the next 2 empty slots
        
        // Draw the header centered over the 3 columns
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        page.drawText(mainHeaders[i], {
          x: xPos + (groupWidth - textWidth) / 2,
          y: tableTop - 13,
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += groupWidth;
        
        // Skip the columns we've already accounted for
        i += columnsToSkip;
      } else {
        // Regular single column header
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        page.drawText(mainHeaders[i], {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 18,
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += colWidths[i];
      }
    }

    // Draw sub headers
    xPos = xStart;
    subHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = calibriBold.widthOfTextAtSize(header, 11);
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 28,
          size: 10,
          font: calibriBold,
          color: rgb(0,0,0)
        });
      }
      xPos += colWidths[i];
    });

    // Draw horizontal separator lines for grouped headers
    if (SHOW_TABLE_LINES) {
      const headerMid = tableTop - 16;

      // Theory Marks separator
      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      // Practical Marks separator
      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      // Total Marks separator
      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7] + colWidths[8] + colWidths[9] + colWidths[10], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });
    }

    // Draw vertical lines
    if (SHOW_TABLE_LINES) {
      xPos = xStart;
      const shortLines = [2, 3, 5, 6, 8, 9];

      colWidths.forEach((width, i) => {
        if (i < colWidths.length - 1) {
          const lineX = xPos + width;

          if (shortLines.includes(i)) {
            // Draw short line inside sub-header
            page.drawLine({
              start: { x: lineX, y: tableTop - 16 },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          } else {
            // Draw full boundary line
            page.drawLine({
              start: { x: lineX, y: tableTop },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          }
        }
        xPos += width;
      });
    }

    // ===========================
    // SUBJECT ROWS
    // ===========================
    yPosition = tableTop - 32;

    combinedMarks.subjects.forEach((subject, index) => {
      xPos = xStart;

      // Prepare row data
      const rowData = [
        (index + 1).toString(),
        subject.subject || "",
        subject.theoryMax || "",
        subject.theoryMin || "",
        subject.theoryObt || "",
        subject.practicalMax || "",
        subject.practicalMin || "",
        subject.practicalObt || "",
        subject.totalMax || "",
        subject.totalMin || "",
        subject.totalObt || "",
        subject.result || "",
        subject.source === 'supply' ? 'Supply' : 'Regular'
      ];

      // Wrap subject name
      const subjectText = rowData[1];
      const maxSubjectWidth = colWidths[1] - 8;
      const words = subjectText.split(" ");
      let lines = [];
      let line = "";

      words.forEach(word => {
        const testLine = line ? line + " " + word : word;
        const testWidth = calibri.widthOfTextAtSize(testLine, 11);
        if (testWidth > maxSubjectWidth) {
          lines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      });
      lines.push(line);

      // Adjust row height for wrapped text
      const dynamicRowHeight = rowHeight + (lines.length - 1) * 10;

      // Draw row rectangle
      page.drawRectangle({
        x: xPos,
        y: yPosition - dynamicRowHeight,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: dynamicRowHeight,
        borderWidth: lineSettings.thickness,
        borderColor: lineSettings.color,
      });

      // Draw each cell
      rowData.forEach((data, i) => {
        let textX;
        
        // Center align for numeric columns
        if (i === 0 || [2,3,4,5,6,7,8,9,10,12].includes(i)) {
          textX = xPos + (colWidths[i] - calibri.widthOfTextAtSize(String(data), 11)) / 2;
        } else {
          textX = xPos + 4; // Left align for subject and result
        }

        if (i === 1) {
          // Draw wrapped subject text
          const totalTextHeight = lines.length * 10;
          const subjectStartY = yPosition - (dynamicRowHeight / 2) + (totalTextHeight / 2) - 9;
        
          lines.forEach((lineText, lineIndex) => {
            page.drawText(lineText, {
              x: textX,
              y: subjectStartY - (lineIndex * 10),
              size: 11,
              font: calibri,
              color: rgb(0,0,0),
            });
          });

          // Draw source indicator below subject
          const sourceText = subject.source === 'supply' ? '(Supply)' : '(Regular)';
          const sourceColor = subject.source === 'supply' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          
         
        } else if (i === 11) {
          // Result cell with color coding
          const resultColor = data === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibriBold,
            color: resultColor,
          });
        } else if (i === 12) {
          // Source column
          const sourceColor = data === 'Supply' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibriBold,
            color: sourceColor,
          });
        } else {
          // Regular cells
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibri,
            color: rgb(0,0,0),
          });
        }

        // Draw vertical lines
        if (SHOW_TABLE_LINES && i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + colWidths[i], y: yPosition - dynamicRowHeight },
            end: { x: xPos + colWidths[i], y: yPosition },
            color: lineSettings.color,
            thickness: lineSettings.thickness
          });
        }

        xPos += colWidths[i];
      });

      yPosition -= dynamicRowHeight;
    });

    // ===========================
    // TOTAL ROWS
    // ===========================
    xPos = xStart;

    // First total row: Total in words
    page.drawRectangle({
      x: xPos,
      y: yPosition - rowHeight,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: rowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderWidth: lineSettings.thickness,
      borderColor: lineSettings.color,
    });

    // Draw vertical lines
    let lineXPos = xStart;
    colWidths.forEach((width, i) => {
      if ([1,7,9,10,11, 12].includes(i)) {
        page.drawLine({
          start: { x: lineXPos + width, y: yPosition - rowHeight },
          end: { x: lineXPos + width, y: yPosition },
          thickness: lineSettings.thickness,
          color: lineSettings.color,
        });
      }
      lineXPos += width;
    });

    page.drawText("Total in words", {
      x: xStart + 5,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
    });

    page.drawText(`${combinedMarks.totalWords || ""}`, {
      x: xStart + 178,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
    });
    page.drawText(`${combinedMarks.maxTotal || ""}`, {
      x: xStart + 370,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
    });
    page.drawText(`${combinedMarks.obtainedTotal || ""}`, {
      x: xStart + 419,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
    });

    page.drawText(`${combinedMarks.overallResult || ""}`, {
      x: xStart + 448,
      y: yPosition - rowHeight + 8,
      size: 10,
      font: zurichLight,
      color: combinedMarks.overallResult === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0),
    });

    yPosition -= rowHeight;


    page.drawText(`${combinedMarks.grade || ""}`, {
      x: xStart + 426,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: calibriBold,
      color: combinedMarks.overallResult === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0),
    });

    // ===========================
    // FOOTER
    // ===========================
    yPosition -= 15;
    page.drawText(`Place of Issue : NETD (HO)`, { 
      x: 45, 
      y: yPosition, 
      size: 10, 
      font: arial 
    });

    const issueDate = combinedMarks.createdAt
      ? new Date(combinedMarks.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString();

    page.drawText(`Date of Issue : ${issueDate}`, {
      x: 45,
      y: yPosition - 15,
      size: 10,
      font: arial
    });

   

    // ===========================
    // EMBED LOGOS
    // ===========================
    const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
      if (!logoUrl) return;
    
      const logoPath = path.join(__dirname, "../public", logoUrl);
      if (!fs.existsSync(logoPath)) return;
    
      const bytes = fs.readFileSync(logoPath);
      const image = logoPath.endsWith(".png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
    
      const { width, height } = image.scale(1);
      const aspectRatio = width / height;
    
      let widthLimit = maxWidth;
      let heightLimit = maxHeight;
      if (allowWider && aspectRatio > 1.4) {
        widthLimit *= 1.3;
      }
    
      const widthRatio = widthLimit / width;
      const heightRatio = heightLimit / height;
      const scale = Math.min(widthRatio, heightRatio);
    
      const displayWidth = width * scale;
      const displayHeight = height * scale;
    
      const offsetX = x + (maxWidth - displayWidth) / 2;
      const offsetY = y + (maxHeight - displayHeight) / 2;
    
      page.drawImage(image, {
        x: offsetX,
        y: offsetY,
        width: displayWidth,
        height: displayHeight,
      });
    };

    // Embed logos
    await embedLogo(institutionLogo, 236, 120, 80, 80, true);
    await embedLogo(departmentLogo, 134, 120, 85.7, 86.7);

    // ===========================
    // OUTPUT HTML PREVIEW
    // ===========================
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <head>
          <title>Combined Marklist Preview</title>
          <style>
            body { 
              margin: 0;
              padding: 0;
              font-family: Arial, sans-serif;
              background: #f5f5f5;
              overflow: hidden;
            }

            .header {
              width: 100%;
              background: #2a3d66;
              color: white;
              padding: 12px;
              text-align: center;
              font-size: 20px;
              font-weight: bold;
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              z-index: 1000;
              box-shadow: 0px 2px 6px rgba(0,0,0,0.3);
            }

            iframe {
              position: fixed;
              top: 60px;
              left: 0;
              right: 0;
              bottom: 0;
              width: 100%;
              height: calc(100vh - 60px);
              border: none;
            }

            .download-btn {
              position: fixed;
              top: 70px;
              right: 20px;
              background: #2a3d66;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: 0.3s;
              z-index: 1001;
            }

            .download-btn:hover {
              background: #1d2a47;
              transform: translateY(-2px);
            }
          </style>
        </head>
        <body>
          <div class="header">Combined Marklist Preview - ${combinedMarks.candidateName || "Student"}</div>
          <iframe src="data:application/pdf;base64,${base64}"></iframe>
          <a href="/admin/download-combined-marklist/${studentId}" class="download-btn">
            📥 Download Combined Marklist
          </a>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ Error generating combined marklist preview:", err);
    res.status(500).send("Error generating combined marklist preview");
  }
});
// ===========================
// DOWNLOAD COMBINED MARKLIST
// ===========================
router.get("/download-combined-marklist/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;
    console.log("📥 Download combined marklist for student:", studentId);

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    if (!student.marks) {
      return res.status(400).send("No regular marks found");
    }

    if (!student.supplyMarks) {
      return res.status(400).send("No supply marks found");
    }

    // 2️⃣ Combine regular and supply marks
    const combinedSubjects = [];
    let maxTotal = 0;
    let obtainedTotal = 0;
    let allPassed = true;

    // Regular subjects (only PASSED)
    if (Array.isArray(student.marks.subjects)) {
      student.marks.subjects.forEach(subject => {
        if (subject.result === 'PASSED') {
          combinedSubjects.push({ ...subject, source: 'regular' });
          maxTotal += parseInt(subject.totalMax) || 0;
          obtainedTotal += parseInt(subject.totalObt) || 0;
        }
      });
    }

    // Supply subjects (PASSED + FAILED)
    if (Array.isArray(student.supplyMarks.subjects)) {
      student.supplyMarks.subjects.forEach(supplySubject => {
        combinedSubjects.push({ ...supplySubject, source: 'supply' });
        maxTotal += parseInt(supplySubject.totalMax) || 0;
        obtainedTotal += parseInt(supplySubject.totalObt) || 0;
        if (supplySubject.result === 'FAILED') allPassed = false;
      });
    }

    // Calculate percentage & grade
    const percentage = maxTotal > 0 ? (obtainedTotal / maxTotal) * 100 : 0;
    let grade = 'FAILED';

    if (allPassed) {
      if (percentage >= 80) grade = 'PASSED WITH A+ GRADE';
      else if (percentage >= 70) grade = 'PASSED WITH A GRADE ';
      else if (percentage >= 60) grade = 'PASSED WITH B+ GRADE ';
      else if (percentage >= 50) grade = 'PASSED WITH B GRADE ';
      else if (percentage >= 40) grade = 'PASSED WITH C GRADE';
      else allPassed = false;
    }

    // Prepare combined marks object
    const combinedMarks = {
      ...student.marks,
      subjects: combinedSubjects,
      maxTotal: maxTotal.toString(),
      obtainedTotal: obtainedTotal.toString(),
      overallResult: allPassed ? 'PASSED' : 'FAILED',
      grade,
      totalWords: numberToWords(obtainedTotal),
      isCombined: true,
      combinedDate: new Date()
    };

    // ✅ Fetch center and logo data
    const centreId = student.centreId;
    const centerData = await centerHelpers.getCenterById(centreId);
    const institutionLogo = centerData?.institutionLogo || null;

    // ✅ Fetch department logo
    let departmentLogo = null;
    const departmentName = student.department || student.courseDepartmentName;

    if (centerData?.departmentLogos && departmentName) {
      const deptKeys = Object.keys(centerData.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );

      if (matchedKey) {
        departmentLogo = centerData.departmentLogos[matchedKey];
      }
    }

    // 3️⃣ Load background image
    const bgPath = path.join(__dirname, "../public/images/Marklist-bg.jpg");
    const bgBytes = fs.readFileSync(bgPath);

    // 4️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 5️⃣ Load fonts
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold = arial;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    }

    const squareFontPath = path.join(__dirname, "../public/fonts/SQR721N.TTF");
    let squareFont = arial;
    if (fs.existsSync(squareFontPath)) {
      const squareBytes = fs.readFileSync(squareFontPath);
      squareFont = await pdfDoc.embedFont(squareBytes);
    }

    const calibriPath = path.join(__dirname, "../public/fonts/CALIBRI.TTF");
    let calibri = arial;
    if (fs.existsSync(calibriPath)) {
      const calibriBytes = fs.readFileSync(calibriPath);
      calibri = await pdfDoc.embedFont(calibriBytes);
    }

    const calibriBoldPath = path.join(__dirname, "../public/fonts/CALIBRIB.TTF");
    let calibriBold = calibri;
    if (fs.existsSync(calibriBoldPath)) {
      const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
      calibriBold = await pdfDoc.embedFont(calibriBoldBytes);
    }

    const zurichLightPath = path.join(__dirname, "../public/fonts/ZurichLightBT.ttf");
    let zurichLight = arial;
    if (fs.existsSync(zurichLightPath)) {
      try {
        const zurichLightBytes = fs.readFileSync(zurichLightPath);
        zurichLight = await pdfDoc.embedFont(zurichLightBytes);
      } catch (err) {
        console.error("❌ Failed to load Zurich Light BT font:", err);
      }
    }

    // 6️⃣ Page size
    const pageWidth = 8.543 * 72;
    const pageHeight = 11.367 * 72;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 7️⃣ Background
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    page.drawImage(bgImage, { 
      x: 0, 
      y: 0, 
      width: pageWidth, 
      height: pageHeight 
    });

    const { rgb } = require("pdf-lib");

    // ===========================
    // LINE CONTROL CONFIG
    // ===========================
    const SHOW_TABLE_LINES = true;
    const lineSettings = {
      thickness: SHOW_TABLE_LINES ? 0.3 : 0,
      color: SHOW_TABLE_LINES ? rgb(0, 0, 0) : rgb(1, 1, 1),
    };

    // ===========================
    // STUDENT DETAILS
    // ===========================
    let yPosition = pageHeight - 180;
    
    yPosition -= 25;
    yPosition -= 13;

    const details = [
      `Registration Number                            : ${combinedMarks.registrationNo || ""}`,
      `This combined mark sheet is Awarded to: ${combinedMarks.candidateName || ""}`,
      `On successful Completion of the Course : ${combinedMarks.course || ""}`,
      `Of Duration                                          : ${combinedMarks.courseDuration || ""}`,
      `From our Authorized Training centre      : ${combinedMarks.institute || ""}`,
      `Examination Type                                  : Regular + Supply Combined`
    ];

    details.forEach((text) => {
      page.drawText(text, { 
        x: 45, 
        y: yPosition, 
        size: 12, 
        font: squareFont, 
        color: rgb(0,0,0) 
      });
      yPosition -= 22;
    });

    yPosition -= 3;

    // ===========================
    // TABLE HEADER
    // ===========================
    const xStart = 45;
    const colWidths = [28, 145, 30, 30, 30, 30, 30, 30, 30, 30, 30, 45, 40];
    const rowHeight = 24;
    const headerBg = rgb(0.83, 0.90, 0.98);
    const tableTop = yPosition;

    let xPos = xStart;

    // Draw header background
    page.drawRectangle({
      x: xPos,
      y: tableTop - 32,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: 32,
      color: headerBg,
      borderColor: lineSettings.color,
      borderWidth: lineSettings.thickness,
    });

    const mainHeaders = [
      "S.No", "Name of Subject",
      "Theory Marks", "", "",
      "Practical Marks", "", "",
      "Total Marks", "", "",
      "Result", "Source"
    ];

    const subHeaders = [
      "", "", "Max", "Min", "Obt",
      "Max", "Min", "Obt",
      "Max", "Min", "Obt", "", ""
    ];

    // Draw main headers
    xPos = xStart;
    for (let i = 0; i < mainHeaders.length; i++) {
      if (!mainHeaders[i]) {
        xPos += colWidths[i];
        continue;
      }

      let groupWidth = colWidths[i];
      let columnsToSkip = 0;

      if (mainHeaders[i] === "Theory Marks" || 
          mainHeaders[i] === "Practical Marks" || 
          mainHeaders[i] === "Total Marks") {
        
        groupWidth = colWidths[i] + colWidths[i+1] + colWidths[i+2];
        columnsToSkip = 2;
        
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        page.drawText(mainHeaders[i], {
          x: xPos + (groupWidth - textWidth) / 2,
          y: tableTop - 13,
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += groupWidth;
        i += columnsToSkip;
      } else {
        const textWidth = zurichLight.widthOfTextAtSize(mainHeaders[i], 11);
        page.drawText(mainHeaders[i], {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 18,
          size: 11,
          font: zurichLight,
          color: rgb(0,0,0)
        });

        xPos += colWidths[i];
      }
    }

    // Draw sub headers
    xPos = xStart;
    subHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = calibriBold.widthOfTextAtSize(header, 11);
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 28,
          size: 10,
          font: calibriBold,
          color: rgb(0,0,0)
        });
      }
      xPos += colWidths[i];
    });

    // Draw horizontal separator lines for grouped headers
    if (SHOW_TABLE_LINES) {
      const headerMid = tableTop - 16;

      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });

      page.drawLine({
        start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
        end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7] + colWidths[8] + colWidths[9] + colWidths[10], y: headerMid },
        thickness: lineSettings.thickness,
        color: lineSettings.color
      });
    }

    // Draw vertical lines
    if (SHOW_TABLE_LINES) {
      xPos = xStart;
      const shortLines = [2, 3, 5, 6, 8, 9];

      colWidths.forEach((width, i) => {
        if (i < colWidths.length - 1) {
          const lineX = xPos + width;

          if (shortLines.includes(i)) {
            page.drawLine({
              start: { x: lineX, y: tableTop - 16 },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          } else {
            page.drawLine({
              start: { x: lineX, y: tableTop },
              end: { x: lineX, y: tableTop - 32 },
              thickness: lineSettings.thickness,
              color: lineSettings.color,
            });
          }
        }
        xPos += width;
      });
    }

    // ===========================
    // SUBJECT ROWS
    // ===========================
    yPosition = tableTop - 32;

    combinedMarks.subjects.forEach((subject, index) => {
      xPos = xStart;

      const rowData = [
        (index + 1).toString(),
        subject.subject || "",
        subject.theoryMax || "",
        subject.theoryMin || "",
        subject.theoryObt || "",
        subject.practicalMax || "",
        subject.practicalMin || "",
        subject.practicalObt || "",
        subject.totalMax || "",
        subject.totalMin || "",
        subject.totalObt || "",
        subject.result || "",
        subject.source === 'supply' ? 'Supply' : 'Regular'
      ];

      // Wrap subject name
      const subjectText = rowData[1];
      const maxSubjectWidth = colWidths[1] - 8;
      const words = subjectText.split(" ");
      let lines = [];
      let line = "";

      words.forEach(word => {
        const testLine = line ? line + " " + word : word;
        const testWidth = calibri.widthOfTextAtSize(testLine, 11);
        if (testWidth > maxSubjectWidth) {
          lines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      });
      lines.push(line);

      const dynamicRowHeight = rowHeight + (lines.length - 1) * 10;

      // Draw row rectangle
      page.drawRectangle({
        x: xPos,
        y: yPosition - dynamicRowHeight,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: dynamicRowHeight,
        borderWidth: lineSettings.thickness,
        borderColor: lineSettings.color,
      });

      // Draw each cell
      rowData.forEach((data, i) => {
        let textX;
        
        if (i === 0 || [2,3,4,5,6,7,8,9,10,12].includes(i)) {
          textX = xPos + (colWidths[i] - calibri.widthOfTextAtSize(String(data), 11)) / 2;
        } else {
          textX = xPos + 4;
        }

        if (i === 1) {
          const totalTextHeight = lines.length * 10;
          const subjectStartY = yPosition - (dynamicRowHeight / 2) + (totalTextHeight / 2) - 9;
        
          lines.forEach((lineText, lineIndex) => {
            page.drawText(lineText, {
              x: textX,
              y: subjectStartY - (lineIndex * 10),
              size: 11,
              font: calibri,
              color: rgb(0,0,0),
            });
          });
        } else if (i === 11) {
          const resultColor = data === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibriBold,
            color: resultColor,
          });
        } else if (i === 12) {
          const sourceColor = data === 'Supply' ? rgb(0, 0, 0) : rgb(0, 0, 0);
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibriBold,
            color: sourceColor,
          });
        } else {
          const centerY = yPosition - (dynamicRowHeight / 2) - 4;
          page.drawText(String(data), {
            x: textX,
            y: centerY,
            size: 11,
            font: calibri,
            color: rgb(0,0,0),
          });
        }

        if (SHOW_TABLE_LINES && i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + colWidths[i], y: yPosition - dynamicRowHeight },
            end: { x: xPos + colWidths[i], y: yPosition },
            color: lineSettings.color,
            thickness: lineSettings.thickness
          });
        }

        xPos += colWidths[i];
      });

      yPosition -= dynamicRowHeight;
    });

    // ===========================
    // TOTAL ROWS
    // ===========================
    xPos = xStart;

    // First total row: Total in words
    page.drawRectangle({
      x: xPos,
      y: yPosition - rowHeight,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: rowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderWidth: lineSettings.thickness,
      borderColor: lineSettings.color,
    });

    // Draw vertical lines
    let lineXPos = xStart;
    colWidths.forEach((width, i) => {
      if ([1,7,9,10,11, 12].includes(i)) {
        page.drawLine({
          start: { x: lineXPos + width, y: yPosition - rowHeight },
          end: { x: lineXPos + width, y: yPosition },
          thickness: lineSettings.thickness,
          color: lineSettings.color,
        });
      }
      lineXPos += width;
    });

    page.drawText("Total in words", {
      x: xStart + 5,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    page.drawText(`${combinedMarks.totalWords || ""}`, {
      x: xStart + 178,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });
    
    page.drawText(`${combinedMarks.maxTotal || ""}`, {
      x: xStart + 370,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });
    
    page.drawText(`${combinedMarks.obtainedTotal || ""}`, {
      x: xStart + 419,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: zurichLight,
      color: rgb(0,0,0)
    });

    page.drawText(`${combinedMarks.overallResult || ""}`, {
      x: xStart + 448,
      y: yPosition - rowHeight + 8,
      size: 10,
      font: zurichLight,
      color: combinedMarks.overallResult === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0),
    });

    yPosition -= rowHeight;

    page.drawText(`${combinedMarks.grade || ""}`, {
      x: xStart + 426,
      y: yPosition - rowHeight + 8,
      size: 10.5,
      font: calibriBold,
      color: combinedMarks.overallResult === 'PASSED' ? rgb(0, 0, 0) : rgb(0, 0, 0),
    });

    // ===========================
    // FOOTER
    // ===========================
    yPosition -= 15;
    page.drawText(`Place of Issue : NETD (HO)`, { 
      x: 45, 
      y: yPosition, 
      size: 10, 
      font: arial,
      color: rgb(0,0,0)
    });

    const issueDate = combinedMarks.createdAt
      ? new Date(combinedMarks.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString();

    page.drawText(`Date of Issue : ${issueDate}`, {
      x: 45,
      y: yPosition - 15,
      size: 10,
      font: arial,
      color: rgb(0,0,0)
    });

   

    // ===========================
    // EMBED LOGOS
    // ===========================
    const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
      if (!logoUrl) return;
    
      const logoPath = path.join(__dirname, "../public", logoUrl);
      if (!fs.existsSync(logoPath)) return;
    
      const bytes = fs.readFileSync(logoPath);
      let image;
      
      try {
        if (logoPath.endsWith(".png")) {
          image = await pdfDoc.embedPng(bytes);
        } else {
          image = await pdfDoc.embedJpg(bytes);
        }
      } catch (err) {
        console.error("❌ Error embedding logo:", logoUrl, err);
        return;
      }
    
      const { width, height } = image.scale(1);
      const aspectRatio = width / height;
    
      let widthLimit = maxWidth;
      let heightLimit = maxHeight;
      if (allowWider && aspectRatio > 1.4) {
        widthLimit *= 1.3;
      }
    
      const widthRatio = widthLimit / width;
      const heightRatio = heightLimit / height;
      const scale = Math.min(widthRatio, heightRatio);
    
      const displayWidth = width * scale;
      const displayHeight = height * scale;
    
      const offsetX = x + (maxWidth - displayWidth) / 2;
      const offsetY = y + (maxHeight - displayHeight) / 2;
    
      page.drawImage(image, {
        x: offsetX,
        y: offsetY,
        width: displayWidth,
        height: displayHeight,
      });
    };

    // Embed logos
    await embedLogo(institutionLogo, 236, 120, 80, 80, true);
    await embedLogo(departmentLogo, 134, 120, 85.7, 86.7);

    // ===========================
    // ✅ FIXED: USE CERTIFICATE PATTERN FOR DOWNLOAD
    // ===========================
    const pdfBytes = await pdfDoc.save();
    
    console.log("✅ PDF generated successfully, size:", pdfBytes.length, "bytes");

    // ✅ EXACT SAME PATTERN AS WORKING CERTIFICATE ROUTE
    const fileName = `combined_marklist_${combinedMarks.registrationNo || studentId}.pdf`;
    
    // ✅ Set headers exactly like certificate route
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    // ✅ Send exactly like certificate route
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error downloading combined marklist:", err);
    console.error("🔍 Stack trace:", err.stack);
    
    res.status(500).json({
      error: "Error generating combined PDF",
      message: err.message,
      stack: err.stack
    });
  }
});

// ===========================
// EDIT MARK PAGE
// ===========================
router.get('/edit-mark/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;
    
    // Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    if (!student.marks) {
      return res.redirect(`/admin/add-mark/${studentId}`);
    }

    // Fetch center data for logos
    const centerData = await centerHelpers.getCenterById(student.centreId);
    
    res.render('admin/edit-mark', {
      student,
      centerData,
      hideNavbar: false
    });

  } catch (err) {
    console.error("❌ Error loading edit mark page:", err);
    res.status(500).send("Error loading edit mark page");
  }
});

// ===========================
// UPDATE MARK
// ===========================
router.post('/update-mark/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;
    const updatedMarks = req.body;

    console.log("🔄 Updating marks for student:", studentId);
    console.log("Updated data:", updatedMarks);

    // Prepare the updated marks object
    const updatedData = {
      "marks.registrationNo": updatedMarks.registrationNo,
      "marks.candidateName": updatedMarks.candidateName,
      "marks.course": updatedMarks.course,
      "marks.courseDuration": updatedMarks.courseDuration,
      "marks.institute": updatedMarks.institute,
      "marks.subjects": [],
      "marks.updatedAt": new Date()
    };

    // Process subjects
    if (Array.isArray(updatedMarks.subjectName)) {
      updatedMarks.subjectName.forEach((subjectName, index) => {
        const subject = {
          subject: subjectName,
          theoryMax: parseInt(updatedMarks.theoryMax?.[index]) || 0,
          theoryMin: parseInt(updatedMarks.theoryMin?.[index]) || 0,
          theoryObt: parseInt(updatedMarks.theoryObt?.[index]) || 0,
          practicalMax: parseInt(updatedMarks.practicalMax?.[index]) || 0,
          practicalMin: parseInt(updatedMarks.practicalMin?.[index]) || 0,
          practicalObt: parseInt(updatedMarks.practicalObt?.[index]) || 0,
          totalMax: parseInt(updatedMarks.totalMax?.[index]) || 0,
          totalMin: parseInt(updatedMarks.totalMin?.[index]) || 0,
          totalObt: parseInt(updatedMarks.totalObt?.[index]) || 0,
          result: updatedMarks.result?.[index] || 'FAILED'
        };
        
        // Calculate totals if not provided
        if (subject.totalMax === 0) {
          subject.totalMax = subject.theoryMax + subject.practicalMax;
        }
        if (subject.totalObt === 0) {
          subject.totalObt = subject.theoryObt + subject.practicalObt;
        }
        
        updatedData["marks.subjects"].push(subject);
      });
    }

    // Calculate overall totals
    const maxTotal = updatedData["marks.subjects"].reduce((sum, subject) => sum + subject.totalMax, 0);
    const obtainedTotal = updatedData["marks.subjects"].reduce((sum, subject) => sum + subject.totalObt, 0);
    
    updatedData["marks.maxTotal"] = maxTotal;
    updatedData["marks.obtainedTotal"] = obtainedTotal;
    updatedData["marks.totalWords"] = numberToWords(obtainedTotal);
    
    // Calculate percentage and grade
    const percentage = maxTotal > 0 ? (obtainedTotal / maxTotal) * 100 : 0;
    const allPassed = updatedData["marks.subjects"].every(subject => subject.result === 'PASSED');
    
    if (allPassed) {
      if (percentage >= 80) updatedData["marks.grade"] = 'PASSED WITH A+ GRADE';
      else if (percentage >= 70) updatedData["marks.grade"] = 'PASSED WITH A GRADE';
      else if (percentage >= 60) updatedData["marks.grade"] = 'PASSED WITH B+ GRADE';
      else if (percentage >= 50) updatedData["marks.grade"] = 'PASSED WITH B GRADE';
      else if (percentage >= 40) updatedData["marks.grade"] = 'PASSED WITH C GRADE';
      else updatedData["marks.overallResult"] = 'FAILED';
    } else {
      updatedData["marks.overallResult"] = 'FAILED';
      updatedData["marks.grade"] = 'FAILED';
    }

    // Update the student record
    const result = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .updateOne(
        { _id: new ObjectId(studentId) },
        { $set: updatedData }
      );

    if (result.modifiedCount === 1) {
      console.log("✅ Marks updated successfully");
      req.session.studentMessage = "Marks updated successfully!";
      res.redirect(`/admin/view-bstudent`);
    } else {
      console.log("⚠️ No changes made or student not found");
      req.session.studentMessage = "No changes were made.";
      res.redirect(`/admin/edit-mark/${studentId}`);
    }

  } catch (err) {
    console.error("❌ Error updating marks:", err);
    req.session.studentMessage = "Error updating marks. Please try again.";
    res.redirect(`/admin/edit-mark/${req.params.id}`);
  }
});
// Helper function for number to words
function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
                'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  if (num === 0) return 'Zero';
  
  let words = '';
  
  if (num >= 1000) {
      words += ones[Math.floor(num / 1000)] + ' Thousand ';
      num %= 1000;
  }
  
  if (num >= 100) {
      words += ones[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
  }
  
  if (num >= 20) {
      words += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
  }
  
  if (num > 0) {
      words += ones[num] + ' ';
  }
  
  return words.trim() + ' Only';
}
// ===========================
// CERTIFICATE PREVIEW (SDC Style with Auto-Rotation)
// ===========================
router.get('/preview-certificate/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: studentId });

    if (!student) return res.status(404).send("Student not found");
    
    // ✅ Extract application form details (if exists)
    const form = student.applicationForm || {};

    // ✅ Fetch center and logo data
    const centreId = student.centreId;
    const centerData = await centerHelpers.getCenterById(centreId);
    const institutionLogo = centerData?.institutionLogo || null;

    // ✅ Fetch batch data to get start & end dates
    let batchData = null;
    if (student.batchId) {
      batchData = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .findOne({ _id: new ObjectId(student.batchId) });
    }
    

    // ✅ Fetch and match Department Logo
    let departmentLogo = null;
    const departmentName = student.department || student.courseDepartmentName;

    if (centerData?.departmentLogos && departmentName) {
      const deptKeys = Object.keys(centerData.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );

      if (matchedKey) {
        departmentLogo = centerData.departmentLogos[matchedKey];
        console.log("✅ Found department logo path:", departmentLogo);
      } else {
        console.log("⚠️ No matching department logo found. Available keys:", deptKeys);
      }
    }

    // ✅ GRADE CALCULATION SYSTEM
    let percentage = null;
    let grade = "A";
    let totalMarks = 0;
    let maxMarks = 0;

    if (student.marks?.subjects?.length > 0) {
      totalMarks = student.marks.obtainedTotal || 0;
      maxMarks = student.marks.maxTotal || 600;

      if (maxMarks > 0) {
        percentage = ((totalMarks / maxMarks) * 100).toFixed(2);
        if (percentage >= 80) grade = "A+";
        else if (percentage >= 70) grade = "A";
        else if (percentage >= 60) grade = "B+";
        else if (percentage >= 50) grade = "B";
        else if (percentage >= 40) grade = "C";
        else grade = "FAILED";
      }
    }

    student.grade = grade;

    // ✅ Choose certificate type + background
    const certificateType = student.certificateType || "one";
    const bgFile = certificateType === "two"
      ? "certificate-bg2.jpg"
      : "certificate-bg.jpg";

    const bgPath = path.join(__dirname, `../public/images/${bgFile}`);
    const bgImageBytes = fs.readFileSync(bgPath);

    // ✅ Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([8.543 * 72, 11.367 * 72]);

    const bgImage = bgPath.endsWith(".png")
      ? await pdfDoc.embedPng(bgImageBytes)
      : await pdfDoc.embedJpg(bgImageBytes);

    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: 8.543 * 72,
      height: 11.367 * 72,
    });

    // ✅ SDC FONTS - Using CourierBold like SDC certificate
    const courierbold = await pdfDoc.embedFont(StandardFonts.Courier);
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    
pdfDoc.registerFontkit(fontkit);  // <-- REQUIRED

    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    } else {
      arialBold = arial;
    }


    // ✅ SDC HELPER: Centered text function
    function drawCenteredText(page, text, y, centerX, font, size) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2;
      page.drawText(text, { x, y, size, font });
    }

    // ✅ SDC HELPER: Format date
    const formatDate = (val) => {
      if (!val) return "";
      const d = new Date(val);
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    };

    const issueDate = formatDate(student.issueDate || new Date());
    const startDate = formatDate(batchData?.courseStartDate);
    const endDate = formatDate(batchData?.courseEndDate);
    const examDate = formatDate(form.examDate);

    // ✅ Student Photo with AUTO-ROTATION (like hall ticket)
    const imageDir = path.join(__dirname, "../public/studentImages/");
    const possibleExtensions = [".jpg", ".jpeg", ".png"];
    let photoFound = false;

    for (const ext of possibleExtensions) {
      const photoPath = path.join(imageDir, `${student._id}${ext}`);
      if (fs.existsSync(photoPath)) {
        let photoBytes = fs.readFileSync(photoPath);
        let photo;

        if (ext === ".png") {
          photo = await pdfDoc.embedPng(photoBytes);
        } else {
          try {
            photoBytes = await fixImageOrientation(photoBytes);
          } catch (err) {
            console.log("No rotation needed or not a JPEG");
          }
          photo = await pdfDoc.embedJpg(photoBytes);
        }

        // Draw student photo with certificate positioning
        if (certificateType === "one") {
          page.drawImage(photo, {
            x: 489.2,
            y: 423.3,
            width: 57.8,
            height: 77.3,
          });
        } else {
          page.drawImage(photo, {
            x: 489.2,
            y: 423.3,
            width: 57.8,
            height: 77.3,
          });
        }
        
        photoFound = true;
        break;
      }
    }

    if (!photoFound) {
      console.log("ℹ️ No student photo found for certificate");
    }

    // ✅ DRAW TEXT FIELDS (SDC STYLE)
    if (certificateType === "one") {
      // Type 1 - SDC Style
      drawCenteredText(page, student.regNo || "", 753.1, 141, arial, 8.67);
      drawCenteredText(page, student.fullName?.toUpperCase() || "", 395, 400, courierbold, 11.67);
      drawCenteredText(page, student.shortName || "", 368, 489, courierbold, 11.67);
      drawCenteredText(page, `(${student.courseName || ""})`, 340.5, 255, courierbold, 11.67);
      drawCenteredText(page, student.courseDuration || "", 314, 100, courierbold, 11.67);
      drawCenteredText(page, student.grade || "", 287, 82, courierbold, 11.67);

      // Course Dates
      page.drawText(startDate || "", { x: 290, y: 314, size: 11.67, font: courierbold });
      page.drawText(endDate || "", { x: 435, y: 314, size: 11.67, font: courierbold });
      page.drawText(issueDate, { x: 165, y: 260, size: 11.67, font: courierbold });

    } else {
      // Type 2 - SDC Style  
      drawCenteredText(page, student.regNo || "", 756.9, 130, arial, 7);
      drawCenteredText(page, student.fullName?.toUpperCase() || "", 396, 385, courierbold, 11.67);
      drawCenteredText(page, student.shortName || "", 370, 450, courierbold, 11.67);
      drawCenteredText(page, `(${student.courseName || ""})`, 347, 265, courierbold, 11.67);
      drawCenteredText(page, student.courseDuration || "", 319.5, 225, courierbold, 11.67);
      
      if (centerData?.centreName) {
        const text = `${centerData.centreName}${centerData.address ? ", " + centerData.address : ""}`;
        const words = text.split(/(?<=,)\s*/);
      
        const fontSize = 11.67;
        let yPos = 319;
        const xStartFirstLine = 463;
        const xStartNextLines = 55;
        const maxWidth = 120;
        let currentLine = "";
        let isFirstLine = true;
      
        for (let i = 0; i < words.length; i++) {
          const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
          const textWidth = courierbold.widthOfTextAtSize(testLine, fontSize);
      
          if (isFirstLine && textWidth > maxWidth && currentLine) {
            page.drawText(currentLine.trim(), {
              x: xStartFirstLine,
              y: yPos,
              size: fontSize,
              font: courierbold,
            });
            yPos -= 26;
            currentLine = words[i];
            isFirstLine = false;
          } else {
            currentLine = testLine;
          }
        }
      
        if (currentLine) {
          page.drawText(currentLine.trim(), {
            x: isFirstLine ? xStartFirstLine : xStartNextLines,
            y: yPos,
            size: fontSize,
            font: courierbold,
          });
        }
      }
      
      if (form.examDate) {
        const examDate = formatDate(form.examDate);
        page.drawText(examDate, {
          x: 437,
          y: 266,
          size: 11,
          font: courierbold,
        });
      }
      
      drawCenteredText(page, student.grade || "", 268, 139, courierbold, 11.67);
      page.drawText(issueDate, { x: 312, y: 240.5, size: 11.67, font: courierbold });
    }

    // ✅ LOGOS (auto-scale and preserve aspect ratio)
    const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
      if (!logoUrl) return;
    
      const logoPath = path.join(__dirname, "../public", logoUrl);
      if (!fs.existsSync(logoPath)) return;
    
      const bytes = fs.readFileSync(logoPath);
      const image = logoPath.endsWith(".png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
    
      const { width, height } = image.scale(1);
      const aspectRatio = width / height;
    
      let widthLimit = maxWidth;
      let heightLimit = maxHeight;
      if (allowWider && aspectRatio > 1.4) {
        widthLimit *= 1.3;
      }
    
      const widthRatio = widthLimit / width;
      const heightRatio = heightLimit / height;
      const scale = Math.min(widthRatio, heightRatio);
    
      const displayWidth = width * scale;
      const displayHeight = height * scale;
    
      const offsetX = x + (maxWidth - displayWidth) / 2;
      const offsetY = y + (maxHeight - displayHeight) / 2;
    
      page.drawImage(image, {
        x: offsetX,
        y: offsetY,
        width: displayWidth,
        height: displayHeight,
      });
    };

    // ✅ Different logo placement for each certificate type
    if (certificateType === "one") {
      // Type 1 (SDC style)
      await embedLogo(institutionLogo, 173, 160, 80, 80, true);
      await embedLogo(departmentLogo, 80, 160, 81.7, 82.7);
    } else {
      // Type 2 (Alternative layout)
      await embedLogo(institutionLogo, 173, 140, 80, 80, true);
      await embedLogo(departmentLogo, 80, 137, 81.7, 82.7);
    }

    // ✅ Send inline preview WITH DOWNLOAD BUTTON
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <head>
          <title>Certificate Preview</title>
          <style>
            body { 
              margin: 0; 
              padding: 0; 
              font-family: Arial, sans-serif; 
            }
            .download-btn {
              position: fixed;
              top: 20px;
              right: 20px;
              background: #1f3555;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-family: sans-serif;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: all 0.3s ease;
              z-index: 1000;
            }
            .download-btn:hover {
              background: #152642;
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
          </style>
        </head>
        <body>
          <iframe src="data:application/pdf;base64,${base64}" 
                  width="100%" height="100%" 
                  style="border:none;height:100vh;"></iframe>
          
          <div style="position:fixed;top:20px;right:20px;z-index:1000;">
            <a href="/admin/download-certificate/${student._id}" class="download-btn">
              Download Certificate
            </a>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error("❌ Error generating certificate preview:", error);
    res.status(500).send("Error generating certificate preview: " + error.message);
  }
});
// ===========================
// CERTIFICATE DOWNLOAD (SDC Style with Auto-Rotation)
// ===========================
router.get('/download-certificate/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: studentId });

    if (!student) return res.status(404).send("Student not found");
    
    // ✅ Extract application form details (if exists)
    const form = student.applicationForm || {};

    // ✅ Fetch center and logo data
    const centreId = student.centreId;
    const centerData = await centerHelpers.getCenterById(centreId);
    const institutionLogo = centerData?.institutionLogo || null;

    // ✅ Fetch batch data to get start & end dates
    let batchData = null;
    if (student.batchId) {
      batchData = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .findOne({ _id: new ObjectId(student.batchId) });
    }
    

    // ✅ Fetch and match Department Logo
    let departmentLogo = null;
    const departmentName = student.department || student.courseDepartmentName;

    if (centerData?.departmentLogos && departmentName) {
      const deptKeys = Object.keys(centerData.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );

      if (matchedKey) {
        departmentLogo = centerData.departmentLogos[matchedKey];
        console.log("✅ Found department logo path:", departmentLogo);
      } else {
        console.log("⚠️ No matching department logo found. Available keys:", deptKeys);
      }
    }

    // ✅ GRADE CALCULATION SYSTEM
    let percentage = null;
    let grade = "A";
    let totalMarks = 0;
    let maxMarks = 0;

    if (student.marks?.subjects?.length > 0) {
      totalMarks = student.marks.obtainedTotal || 0;
      maxMarks = student.marks.maxTotal || 600;

      if (maxMarks > 0) {
        percentage = ((totalMarks / maxMarks) * 100).toFixed(2);
        if (percentage >= 80) grade = "A+";
        else if (percentage >= 70) grade = "A";
        else if (percentage >= 60) grade = "B+";
        else if (percentage >= 50) grade = "B";
        else if (percentage >= 40) grade = "C";
        else grade = "FAILED";
      }
    }

    student.grade = grade;

    // ✅ Choose certificate type + background
    const certificateType = student.certificateType || "one";
    const bgFile = certificateType === "two"
      ? "certificate-bg2.jpg"
      : "certificate-bg.jpg";

    const bgPath = path.join(__dirname, `../public/images/${bgFile}`);
    const bgImageBytes = fs.readFileSync(bgPath);

    // ✅ Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([8.543 * 72, 11.367 * 72]);

    const bgImage = bgPath.endsWith(".png")
      ? await pdfDoc.embedPng(bgImageBytes)
      : await pdfDoc.embedJpg(bgImageBytes);

    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: 8.543 * 72,
      height: 11.367 * 72,
    });

    // ✅ SDC FONTS - Using CourierBold like SDC certificate
    const courierbold = await pdfDoc.embedFont(StandardFonts.Courier);
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    
    pdfDoc.registerFontkit(fontkit);  // <-- REQUIRED

    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    } else {
      arialBold = arial;
    }

    // ✅ SDC HELPER: Centered text function
    function drawCenteredText(page, text, y, centerX, font, size) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2;
      page.drawText(text, { x, y, size, font });
    }

    // ✅ SDC HELPER: Format date
    const formatDate = (val) => {
      if (!val) return "";
      const d = new Date(val);
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    };

    const issueDate = formatDate(student.issueDate || new Date());
    const startDate = formatDate(batchData?.courseStartDate);
    const endDate = formatDate(batchData?.courseEndDate);
    const examDate = formatDate(form.examDate);

    // ✅ Student Photo with AUTO-ROTATION (like hall ticket)
    const imageDir = path.join(__dirname, "../public/studentImages/");
    const possibleExtensions = [".jpg", ".jpeg", ".png"];
    let photoFound = false;

    for (const ext of possibleExtensions) {
      const photoPath = path.join(imageDir, `${student._id}${ext}`);
      if (fs.existsSync(photoPath)) {
        let photoBytes = fs.readFileSync(photoPath);
        let photo;

        if (ext === ".png") {
          photo = await pdfDoc.embedPng(photoBytes);
        } else {
          try {
            photoBytes = await fixImageOrientation(photoBytes);
          } catch (err) {
            console.log("No rotation needed or not a JPEG");
          }
          photo = await pdfDoc.embedJpg(photoBytes);
        }

        // Draw student photo with certificate positioning
        if (certificateType === "one") {
          page.drawImage(photo, {
            x: 489.2,
            y: 423.3,
            width: 57.8,
            height: 77.3,
          });
        } else {
          page.drawImage(photo, {
            x: 489.2,
            y: 423.3,
            width: 57.8,
            height: 77.3,
          });
        }
        
        photoFound = true;
        break;
      }
    }

    if (!photoFound) {
      console.log("ℹ️ No student photo found for certificate");
    }

    // ✅ DRAW TEXT FIELDS (SDC STYLE)
    if (certificateType === "one") {
      // Type 1 - SDC Style
      drawCenteredText(page, student.regNo || "", 753.1, 141, arial, 8.67);
      drawCenteredText(page, student.fullName?.toUpperCase() || "", 395, 400, courierbold, 11.67);
      drawCenteredText(page, student.shortName || "", 368, 489, courierbold, 11.67);
      drawCenteredText(page, `(${student.courseName || ""})`, 340.5, 255, courierbold, 11.67);
      drawCenteredText(page, student.courseDuration || "", 314, 100, courierbold, 11.67);
      drawCenteredText(page, student.grade || "", 287, 82, courierbold, 11.67);

      // Course Dates
      page.drawText(startDate || "", { x: 290, y: 314, size: 11.67, font: courierbold });
      page.drawText(endDate || "", { x: 435, y: 314, size: 11.67, font: courierbold });
      page.drawText(issueDate, { x: 165, y: 260, size: 11.67, font: courierbold });

    } else {
      // Type 2 - SDC Style  
      drawCenteredText(page, student.regNo || "", 756.9, 130, arial, 7);
      drawCenteredText(page, student.fullName?.toUpperCase() || "", 396, 385, courierbold, 11.67);
      drawCenteredText(page, student.shortName || "", 370, 450, courierbold, 11.67);
      drawCenteredText(page, `(${student.courseName || ""})`, 347, 265, courierbold, 11.67);
      drawCenteredText(page, student.courseDuration || "", 319.5, 225, courierbold, 11.67);
      
      if (centerData?.centreName) {
        const text = `${centerData.centreName}${centerData.address ? ", " + centerData.address : ""}`;
        const words = text.split(/(?<=,)\s*/);
      
        const fontSize = 11.67;
        let yPos = 319;
        const xStartFirstLine = 463;
        const xStartNextLines = 55;
        const maxWidth = 120;
        let currentLine = "";
        let isFirstLine = true;
      
        for (let i = 0; i < words.length; i++) {
          const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
          const textWidth = courierbold.widthOfTextAtSize(testLine, fontSize);
      
          if (isFirstLine && textWidth > maxWidth && currentLine) {
            page.drawText(currentLine.trim(), {
              x: xStartFirstLine,
              y: yPos,
              size: fontSize,
              font: courierbold,
            });
            yPos -= 26;
            currentLine = words[i];
            isFirstLine = false;
          } else {
            currentLine = testLine;
          }
        }
      
        if (currentLine) {
          page.drawText(currentLine.trim(), {
            x: isFirstLine ? xStartFirstLine : xStartNextLines,
            y: yPos,
            size: fontSize,
            font: courierbold,
          });
        }
      }
      
      if (form.examDate) {
        const examDate = formatDate(form.examDate);
        page.drawText(examDate, {
          x: 437,
          y: 266,
          size: 11,
          font: courierbold,
        });
      }
      
      drawCenteredText(page, student.grade || "", 268, 139, courierbold, 11.67);
      page.drawText(issueDate, { x: 312, y: 240.5, size: 11.67, font: courierbold });
    }

    // ✅ LOGOS (auto-scale and preserve aspect ratio)
    const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
      if (!logoUrl) return;
    
      const logoPath = path.join(__dirname, "../public", logoUrl);
      if (!fs.existsSync(logoPath)) return;
    
      const bytes = fs.readFileSync(logoPath);
      const image = logoPath.endsWith(".png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
    
      const { width, height } = image.scale(1);
      const aspectRatio = width / height;
    
      let widthLimit = maxWidth;
      let heightLimit = maxHeight;
      if (allowWider && aspectRatio > 1.4) {
        widthLimit *= 1.3;
      }
    
      const widthRatio = widthLimit / width;
      const heightRatio = heightLimit / height;
      const scale = Math.min(widthRatio, heightRatio);
    
      const displayWidth = width * scale;
      const displayHeight = height * scale;
    
      const offsetX = x + (maxWidth - displayWidth) / 2;
      const offsetY = y + (maxHeight - displayHeight) / 2;
    
      page.drawImage(image, {
        x: offsetX,
        y: offsetY,
        width: displayWidth,
        height: displayHeight,
      });
    };

    // ✅ Different logo placement for each certificate type
    if (certificateType === "one") {
      // Type 1 (SDC style)
      await embedLogo(institutionLogo, 173, 160, 80, 80, true);
      await embedLogo(departmentLogo, 80, 160, 81.7, 82.7);
    } else {
      // Type 2 (Alternative layout)
      await embedLogo(institutionLogo, 173, 140, 80, 80, true);
      await embedLogo(departmentLogo, 80, 137, 81.7, 82.7);
    }

    // ✅ Convert PDF to bytes and send as download
    const pdfBytes = await pdfDoc.save();
    
    // Set download headers
    const fileName = `certificate-${student.regNo || studentId}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    // Send the PDF as download
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error("❌ Error downloading certificate:", error);
    res.status(500).send("Error downloading certificate: " + error.message);
  }
});
// ===========================
// BATCH CERTIFICATES - DOWNLOAD ALL (Using Individual Formatting)
// ===========================
router.get("/batch-certificates-download/:batchId", verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log(`🔄 Processing batch certificates: ${batchId}`);

    // 1️⃣ Fetch all students in the batch
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: new ObjectId(batchId) })
      .toArray();

    console.log(`📋 Found ${students.length} students in batch`);

    if (!students || students.length === 0) {
      return res.status(404).send("No students found in this batch");
    }

    // 2️⃣ Load background images for both certificate types
    const bg1Path = path.join(__dirname, "../public/images/certificate-bg.jpg");
    const bg2Path = path.join(__dirname, "../public/images/certificate-bg2.jpg");
    
    const bg1Bytes = fs.readFileSync(bg1Path);
    const bg2Bytes = fs.readFileSync(bg2Path);

    // 3️⃣ Create main PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load fonts (EXACTLY like individual)
    const courierbold = await pdfDoc.embedFont(StandardFonts.Courier);
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);

    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    } else {
      arialBold = arial;
    }

    // 5️⃣ Helper functions (EXACTLY like individual)
    function drawCenteredText(page, text, y, centerX, font, size) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2;
      page.drawText(text, { x, y, size, font });
    }

    const formatDate = (val) => {
      if (!val) return "";
      const d = new Date(val);
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    };

    // 6️⃣ Process each student with COMPLETE error handling
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const student of students) {
      let studentProcessed = false;
      
      try {
        console.log(`🎓 Processing certificate: ${student.fullName || student.name}`);

        // ✅ Extract application form details (if exists)
        const form = student.applicationForm || {};

        // ✅ Fetch center and logo data
        const centreId = student.centreId;
        const centerData = await centerHelpers.getCenterById(centreId);
        const institutionLogo = centerData?.institutionLogo || null;

        // ✅ Fetch batch data to get start & end dates
        let batchData = null;
        if (student.batchId) {
          batchData = await db.get()
            .collection(collection.BATCH_COLLECTION)
            .findOne({ _id: new ObjectId(student.batchId) });
        }

        // ✅ Fetch and match Department Logo
        let departmentLogo = null;
        const departmentName = student.department || student.courseDepartmentName;

        if (centerData?.departmentLogos && departmentName) {
          const deptKeys = Object.keys(centerData.departmentLogos);
          const matchedKey = deptKeys.find(
            key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
          );
          if (matchedKey) {
            departmentLogo = centerData.departmentLogos[matchedKey];
          }
        }

        // ✅ GRADE CALCULATION SYSTEM (EXACTLY like individual)
        let percentage = null;
        let grade = "A";
        let totalMarks = 0;
        let maxMarks = 0;

        if (student.marks?.subjects?.length > 0) {
          totalMarks = student.marks.obtainedTotal || 0;
          maxMarks = student.marks.maxTotal || 600;

          if (maxMarks > 0) {
            percentage = ((totalMarks / maxMarks) * 100).toFixed(2);
            if (percentage >= 80) grade = "A+";
            else if (percentage >= 70) grade = "A";
            else if (percentage >= 60) grade = "B+";
            else if (percentage >= 50) grade = "B";
            else if (percentage >= 40) grade = "C";
            else grade = "FAILED";
          }
        }

        student.grade = grade;

        // ✅ Choose certificate type + background
        const certificateType = student.certificateType || "one";
        const bgBytes = certificateType === "two" ? bg2Bytes : bg1Bytes;

        // ✅ Dates
        const issueDate = formatDate(student.issueDate || new Date());
        const startDate = formatDate(batchData?.courseStartDate);
        const endDate = formatDate(batchData?.courseEndDate);
        const examDate = formatDate(form.examDate);

        // CREATE CERTIFICATE PAGE
        const page = pdfDoc.addPage([8.543 * 72, 11.367 * 72]);
        const bgImage = await pdfDoc.embedJpg(bgBytes);
        page.drawImage(bgImage, { x: 0, y: 0, width: 8.543 * 72, height: 11.367 * 72 });

        // 🖼️ Student Photo - COMPLETE error wrapping (EXACTLY like individual)
        const imageDir = path.join(__dirname, "../public/studentImages/");
        const possibleExtensions = [".jpg", ".jpeg", ".png"];
        let photoFound = false;

        for (const ext of possibleExtensions) {
          const photoPath = path.join(imageDir, `${student._id}${ext}`);
          if (fs.existsSync(photoPath)) {
            try {
              console.log(`📸 Trying to load photo: ${photoPath}`);
              let photoBytes = fs.readFileSync(photoPath);
              let photo;

              if (ext === ".png") {
                photo = await pdfDoc.embedPng(photoBytes);
              } else {
                try {
                  photoBytes = await fixImageOrientation(photoBytes);
                } catch (err) {
                  console.log("No rotation needed or not a JPEG");
                }
                photo = await pdfDoc.embedJpg(photoBytes);
              }

              // Draw student photo with certificate positioning (EXACTLY like individual)
              if (certificateType === "one") {
                page.drawImage(photo, {
                  x: 489.2,
                  y: 423.3,
                  width: 57.8,
                  height: 77.3,
                });
              } else {
                page.drawImage(photo, {
                  x: 489.2,
                  y: 423.3,
                  width: 57.8,
                  height: 77.3,
                });
              }
              
              photoFound = true;
              console.log(`✅ Added photo for ${student.fullName}`);
              break;
            } catch (embedError) {
              console.log(`⚠️ SKIPPED PHOTO: ${student.fullName} - Cannot embed image: ${embedError.message}`);
              break;
            }
          }
        }

        if (!photoFound) {
          console.log(`📷 No photo available for ${student.fullName}`);
        }

        // ✅ DRAW TEXT FIELDS (EXACTLY like individual)
        if (certificateType === "one") {
          // Type 1 - SDC Style (EXACTLY like individual)
          drawCenteredText(page, student.regNo || "", 753.1, 141, arial, 8.67);
          drawCenteredText(page, student.fullName?.toUpperCase() || "", 395, 400, courierbold, 11.67);
          drawCenteredText(page, student.shortName || "", 368, 489, courierbold, 11.67);
          drawCenteredText(page, `(${student.courseName || ""})`, 340.5, 255, courierbold, 11.67);
          drawCenteredText(page, student.courseDuration || "", 314, 100, courierbold, 11.67);
          drawCenteredText(page, student.grade || "", 287, 82, courierbold, 11.67);

          // Course Dates (EXACTLY like individual)
          page.drawText(startDate || "", { x: 290, y: 314, size: 11.67, font: courierbold });
          page.drawText(endDate || "", { x: 435, y: 314, size: 11.67, font: courierbold });
          page.drawText(issueDate, { x: 165, y: 260, size: 11.67, font: courierbold });

        } else {
          // Type 2 - SDC Style (EXACTLY like individual)
          drawCenteredText(page, student.regNo || "", 756.9, 130, arial, 7);
          drawCenteredText(page, student.fullName?.toUpperCase() || "", 396, 385, courierbold, 11.67);
          drawCenteredText(page, student.shortName || "", 370, 450, courierbold, 11.67);
          drawCenteredText(page, `(${student.courseName || ""})`, 347, 265, courierbold, 11.67);
          drawCenteredText(page, student.courseDuration || "", 319.5, 225, courierbold, 11.67);
          
          // Center name and address wrapping (EXACTLY like individual)
          if (centerData?.centreName) {
            const text = `${centerData.centreName}${centerData.address ? ", " + centerData.address : ""}`;
            const words = text.split(/(?<=,)\s*/);
          
            const fontSize = 11.67;
            let yPos = 319;
            const xStartFirstLine = 463;
            const xStartNextLines = 55;
            const maxWidth = 120;
            let currentLine = "";
            let isFirstLine = true;
          
            for (let i = 0; i < words.length; i++) {
              const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
              const textWidth = courierbold.widthOfTextAtSize(testLine, fontSize);
          
              if (isFirstLine && textWidth > maxWidth && currentLine) {
                page.drawText(currentLine.trim(), {
                  x: xStartFirstLine,
                  y: yPos,
                  size: fontSize,
                  font: courierbold,
                });
                yPos -= 26;
                currentLine = words[i];
                isFirstLine = false;
              } else {
                currentLine = testLine;
              }
            }
          
            if (currentLine) {
              page.drawText(currentLine.trim(), {
                x: isFirstLine ? xStartFirstLine : xStartNextLines,
                y: yPos,
                size: fontSize,
                font: courierbold,
              });
            }
          }
          
          // Exam date (EXACTLY like individual)
          if (form.examDate) {
            const examDate = formatDate(form.examDate);
            page.drawText(examDate, {
              x: 437,
              y: 266,
              size: 11,
              font: courierbold,
            });
          }
          
          drawCenteredText(page, student.grade || "", 268, 139, courierbold, 11.67);
          page.drawText(issueDate, { x: 312, y: 240.5, size: 11.67, font: courierbold });
        }

        // ✅ LOGOS (EXACTLY like individual)
        const embedLogo = async (logoUrl, x, y, maxWidth, maxHeight, allowWider = false) => {
          if (!logoUrl) return;
        
          const logoPath = path.join(__dirname, "../public", logoUrl);
          if (!fs.existsSync(logoPath)) return;
        
          const bytes = fs.readFileSync(logoPath);
          const image = logoPath.endsWith(".png")
            ? await pdfDoc.embedPng(bytes)
            : await pdfDoc.embedJpg(bytes);
        
          const { width, height } = image.scale(1);
          const aspectRatio = width / height;
        
          let widthLimit = maxWidth;
          let heightLimit = maxHeight;
          if (allowWider && aspectRatio > 1.4) {
            widthLimit *= 1.3;
          }
        
          const widthRatio = widthLimit / width;
          const heightRatio = heightLimit / height;
          const scale = Math.min(widthRatio, heightRatio);
        
          const displayWidth = width * scale;
          const displayHeight = height * scale;
        
          const offsetX = x + (maxWidth - displayWidth) / 2;
          const offsetY = y + (maxHeight - displayHeight) / 2;
        
          page.drawImage(image, {
            x: offsetX,
            y: offsetY,
            width: displayWidth,
            height: displayHeight,
          });
        };

        // ✅ Different logo placement for each certificate type (EXACTLY like individual)
        if (certificateType === "one") {
          // Type 1 (SDC style) - EXACTLY like individual
          await embedLogo(institutionLogo, 173, 160, 80, 80, true);
          await embedLogo(departmentLogo, 80, 160, 81.7, 82.7);
        } else {
          // Type 2 (Alternative layout) - EXACTLY like individual
          await embedLogo(institutionLogo, 173, 140, 80, 80, true);
          await embedLogo(departmentLogo, 80, 137, 81.7, 82.7);
        }

        processedCount++;
        studentProcessed = true;
        console.log(`✅ SUCCESS: Added certificate for ${student.fullName}`);

      } catch (studentError) {
        console.log(`❌ SKIPPED STUDENT: ${student.fullName || student.name} - ${studentError.message}`);
        skippedCount++;
        
        // Remove the last added page if student processing failed mid-way
        if (!studentProcessed) {
          const pages = pdfDoc.getPages();
          if (pages.length > 0) {
            pdfDoc.removePage(pages.length - 1);
          }
        }
        continue;
      }
    }

    // 7️⃣ Check if any students were processed
    if (processedCount === 0) {
      return res.status(400).send("No students could be processed. All students were skipped due to errors.");
    }

    // 8️⃣ Save combined PDF
    const pdfBytes = await pdfDoc.save();
    const batch = await db.get().collection(collection.BATCH_COLLECTION).findOne({ _id: new ObjectId(batchId) });
    const batchName = batch ? batch.batchName.replace(/\s+/g, '-') : 'Batch';
    const fileName = `Certificates-${batchName}.pdf`;

    console.log(`📊 BATCH CERTIFICATES PROCESSING COMPLETE:`);
    console.log(`   ✅ Processed: ${processedCount} students`);
    console.log(`   ⏭️ Skipped: ${skippedCount} students`);
    console.log(`   📄 Total certificates: ${pdfDoc.getPages().length}`);

    // 9️⃣ Mark this batch as downloaded (for 5 min expiry)
    await db.get()
      .collection(collection.BATCH_COLLECTION)
      .updateOne(
        { _id: new ObjectId(batchId) },
        {
          $set: {
            certificateDownloadAt: new Date()
          }
        }
      );

    console.log("⏳ certificateDownloadAt updated for batch:", batchId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ CRITICAL Error generating batch certificates:", err);
    res.status(500).send("Error generating batch certificates");
  }
});

// // ===============================
// // Prepare certificate data
// // ===============================
// function prepareCertificateData(student) {
//   let percentage = null;
//   let grade = "A";
//   let totalMarks = 0;
//   let maxMarks = 0;

//   if (student.marks && student.marks.subjects && student.marks.subjects.length > 0) {
//     totalMarks = student.marks.obtainedTotal || 0;
//     maxMarks = student.marks.maxTotal || 600;

//     if (maxMarks > 0) {
//       percentage = ((totalMarks / maxMarks) * 100).toFixed(2);

//       if (percentage >= 80) grade = 'A+';
//       else if (percentage >= 70) grade = 'A';
//       else if (percentage >= 60) grade = 'B+';
//       else if (percentage >= 50) grade = 'B';
//       else if (percentage >= 40) grade = 'C';
//       else grade = 'FAILED';
//     }
//   }

//   return {
//     student: {
//       fullName: student.fullName || 'N/A',
//       enrollmentNumber: student.regNo || 'N/A',
//       courseName: student.courseName || (student.marks ? student.marks.course : 'N/A'),
//       duration: student.duration || (student.marks ? student.marks.courseDuration : "2 Years"),
//       startDate: student.startDate || "start",
//       endDate: student.endDate || "end",
//       examLocation: student.examLocation || "Not Specified",
      
//       grade: grade, // ✅ use calculated grade only
//       totalMarks: totalMarks.toString(),
//       maxMarks: maxMarks.toString(),
//       percentage: percentage || "53.17",
//       photo: `/studentImages/${student._id}.jpg`
//     },
//     logos: {
//       institution: `/images/institution_logos/logo_1001_16788888.png`,
//       department: `/images/department_logos/deplogo_1001_CourseName_16788888.png`
//     }
//     ,
//     issueDate: new Date().toLocaleDateString('en-GB', {
//       day: '2-digit',
//       month: '2-digit',
//       year: 'numeric'
//     })
//   };
// }


// router.get('/certificate/:studentId', verifyAdminLogin, async (req, res) => {
//   try {
//     const studentId = req.params.studentId;

//     if (!ObjectId.isValid(studentId)) {
//       return res.status(400).send('Invalid Student ID');
//     }

//     // ✅ 1️⃣ Find student
//     const student = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .findOne({ _id: new ObjectId(studentId) });

//     if (!student) return res.status(404).send('Student not found');

//     // ✅ 2️⃣ Find batch (to get schedule details)
//     const batch = await db.get()
//       .collection(collection.BATCH_COLLECTION)
//       .findOne({ _id: new ObjectId(student.batchId) });

//     // ✅ 3️⃣ Merge batch data into student temporarily
//     if (batch) {
//       student.courseStartDate = batch.courseStartDate || student.courseStartDate;
//       student.courseEndDate = batch.courseEndDate || student.courseEndDate;
//       student.examLocation = batch.examLocation || student.examLocation;
//     }

//     // ✅ 4️⃣ Prepare certificate data (now includes batch schedule)
//     const certificateData = prepareCertificateData(student);

//     // ✅ 5️⃣ Choose correct certificate design
//     const template = student.certificateType === "two"
//       ? 'admin/certificate-two'
//       : 'admin/certificate-one';

//     res.render(template, {
//       hideNavbar: true,
//       ...certificateData
//     });

//   } catch (error) {
//     console.error("❌ Error generating certificate:", error);
//     res.status(500).send('Error generating certificate: ' + error.message);
//   }
// });


// ===============================
// Toggle certificate type - BATCH WISE
// ===============================
router.post('/toggle-certificate-batch/:batchId', verifyAdminLogin, async (req, res) => {
  try {
    const batchId = new ObjectId(req.params.batchId);
    
    // 1️⃣ Fetch all students in the batch
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: batchId })
      .toArray();

    if (!students || students.length === 0) {
      return res.status(404).send('No students found in this batch');
    }

    // 2️⃣ Determine the new certificate type based on first student
    const firstStudent = students[0];
    const newType = firstStudent.certificateType === "two" ? "one" : "two";

    // 3️⃣ Update ALL students in the batch
    const result = await db.get().collection(collection.STUDENT_COLLECTION).updateMany(
      { batchId: batchId },
      { $set: { certificateType: newType } }
    );

    console.log(`✅ Batch certificate type updated: ${result.modifiedCount} students changed to type "${newType}"`);

    res.redirect('back');
  } catch (error) {
    console.error('❌ Error toggling batch certificate:', error);
    res.status(500).send('Error toggling batch certificate: ' + error.message);
  }
});

/* ================================
 INSTITUTION LOGO MANAGEMENT (USING express-fileupload .mv())
 ================================ */

// GET: Display the form (No change needed here)
router.get('/add-inlogo', verifyAdminLogin, (req, res) => {
  res.render('admin/add-inlogo', { 
    hideNavbar: true,
    success: req.query.success, 
    error: req.query.error    
  });
  });
  
  // POST: Handle logo file upload and database update using .mv()
  // 🛑 IMPORTANT: Multer middleware (e.g., upload.single('logo')) is REMOVED
  router.post('/add-inlogo', verifyAdminLogin, async (req, res) => {
      
      const centreId = req.body.centreId; 
      
      if (!centreId) {
        return res.redirect('/admin/add-inlogo?error=Centre ID is required.');
      }
  
      // 1. Get the file object from express-fileupload (req.files)
      const logoFile = req.files ? req.files.logo : null;
  
      if (!logoFile) {
          // If the file is missing, it often means the file was too large or the form data was corrupt.
          console.error("❌ express-fileupload failed to receive the file.");
          return res.redirect('/admin/add-inlogo?error=Logo file upload failed. Check file size.');
      }
  
      // 2. Define the final save path
      const ext = path.extname(logoFile.name); // .name is used by express-fileupload
      // Define unique filename: logo_1001_16788888.png
      const fileName = `logo_${centreId}_${Date.now()}${ext}`;
      const filePathOnServer = path.join(uploadDir, fileName);
  
      try {
          // 3. Use the .mv() function to save the file
          await new Promise((resolve, reject) => {
              logoFile.mv(filePathOnServer, (err) => {
                  if (err) {
                      console.error("❌ Error moving file:", err);
                      return reject(err);
                  }
                  resolve();
              });
          });
  
          // 4. Update the database
          // Path saved to DB must be relative to the public directory
          const logoPathForDB = `/images/institution_logos/${fileName}`;
          
          await centerHelpers.updateCenterLogo(centreId, logoPathForDB);
  
          console.log(`✅ Logo updated for Centre ID: ${centreId}`);
          
          // Redirect with success message
          res.redirect('/admin/add-inlogo?success=true'); 
  
      } catch (error) {
          console.error("❌ Error in file upload or DB update:", error);
          res.redirect(`/admin/add-inlogo?error=Failed to save logo. ${error.message || 'Check server permissions/ID existence.'}`);
      }
  });
  

// Ensure the department logo directory exists

if (!fs.existsSync(deptUploadDir)) {
  fs.mkdirSync(deptUploadDir, { recursive: true });
}

/* ================================
   DEPARTMENT LOGO MANAGEMENT ROUTES
   ================================ */

// GET: Display the form to upload Department Logo (Renders admin/add-deplogo.hbs)
router.get('/add-deplogo', verifyAdminLogin, (req, res) => {
  const { success, error, department, centreId } = req.query; // fetch from query

  res.render('admin/add-deplogo', {
    hideNavbar: true,
    success,
    error,
    department, // pre-select the department
    centreId    // pre-fill the centre ID
  });
});


// POST: Handle Department Logo upload using .mv() from express-fileupload
router.post('/add-deplogo', verifyAdminLogin, async (req, res) => {
    
    const centreId = req.body.centreId; 
    const departmentName = req.body.department; // Get the selected department name
    
    // Basic validation
    if (!centreId) {
      return res.redirect('/admin/add-deplogo?error=Centre ID is required.');
    }
    if (!departmentName) {
        return res.redirect('/admin/add-deplogo?error=Department is required.');
    }

    // 1. Get the file object from express-fileupload (name="deptLogo")
    // NOTE: We keep the input NAME as 'deptLogo' as it's the simplest name for the form input.
    const logoFile = req.files ? req.files.deptLogo : null; 

    if (!logoFile) {
        return res.redirect('/admin/add-deplogo?error=Department Logo file upload failed.');
    }

    // 2. Define the final save path
    const ext = path.extname(logoFile.name); 
    const safeDeptName = departmentName.replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize department name
    
    // 🛑 Filename prefix changed to 'deplogo'
    const fileName = `deplogo_${centreId}_${safeDeptName}_${Date.now()}${ext}`; 
    const filePathOnServer = path.join(deptUploadDir, fileName);

    try {
        // 3. Use the .mv() function to save the file
        await new Promise((resolve, reject) => {
            logoFile.mv(filePathOnServer, (err) => {
                if (err) {
                    console.error("❌ Error moving department file:", err);
                    return reject(err);
                }
                resolve();
            });
        });

        // 4. Update the database
        const logoPathForDB = `/images/department_logos/${fileName}`;
        
        // Use the helper to update the Center/Department record
        await centerHelpers.updateDepartmentLogo(centreId, departmentName, logoPathForDB);

        console.log(`✅ Dep Logo updated for Centre ID: ${centreId}, Dept: ${departmentName}`);
        
        // 🛑 Final redirection changed to 'deplogo'
        res.redirect('/admin/add-deplogo?success=true'); 

    } catch (error) {
        console.error("❌ Error in dep logo upload or DB update:", error);
        // 🛑 Error redirection changed to 'deplogo'
        res.redirect(`/admin/add-deplogo?error=Failed to save dep logo: ${error.message || 'Check Centre ID/Dept existence.'}`);
    }
});




// ==============================
// GET: Render course schedule form for a batch
// ==============================
router.get('/course-schedule/:batchId', verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    if (!ObjectId.isValid(batchId)) {
      return res.status(400).send('Invalid Batch ID');
    }

    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    if (!batch) {
      return res.status(404).send('Batch not found');
    }

    res.render('admin/course-schedule', {
      hideNavbar: true,
      batchId: batchId,
      batch
    });

  } catch (error) {
    console.error('❌ Error loading course schedule:', error);
    res.status(500).send('Error loading course schedule');
  }
});


// ==============================
// POST: Save course schedule and apply certificate
router.post('/course-schedule/:batchId', verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    const { startDate, endDate, examLocation } = req.body;

    if (!ObjectId.isValid(batchId)) {
      return res.status(400).send('Invalid Batch ID');
    }

    const result = await db.get().collection(collection.BATCH_COLLECTION).updateOne(
      { _id: new ObjectId(batchId) },
      { 
        $set: { 
          courseStartDate: startDate,
          courseEndDate: endDate,
          examLocation: examLocation,
          appliedForCertificate: true,
          certificateAppliedAt: new Date()
        } 
      }
    );

    console.log('✅ Update result:', result);

    // Fetch the updated batch to get centreId for redirect
    const updatedBatch = await db.get().collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    console.log('📝 Updated batch:', updatedBatch);

    // ✅ Redirect with centreId
    res.redirect(`/admin/view-cbatch/${updatedBatch.centreId}`);

  } catch (error) {
    console.error('❌ Error saving schedule:', error);
    res.status(500).send('Error saving course schedule');
  }
});



//edit-schedule
// =======================
// EDIT COURSE SCHEDULE - GET
// =======================
router.get('/edit-schedule/:batchId', verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    if (!batch) return res.status(404).send("Batch not found");

    res.render('admin/edit-schedule', { 
      admin: true,
      batch 
    });
  } catch (err) {
    res.status(500).send('Error loading edit schedule: ' + err.message);
  }
});
// =======================
// EDIT COURSE SCHEDULE - POST (Fixed)
// =======================
router.post('/edit-schedule/:batchId', verifyAdminLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    const { startDate, endDate, examLocation } = req.body;

    // Update batch
    const result = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .updateOne(
        { _id: new ObjectId(batchId) },
        {
          $set: {
            courseStartDate: startDate,
            courseEndDate: endDate,
            examLocation: examLocation
          }
        }
      );

    console.log("✅ Schedule updated successfully!");

    // ✅ Get the updated batch to retrieve centreId
    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    if (!batch) return res.status(404).send("Batch not found");

    // Redirect to /view-cbatch/:centreId
    res.redirect(`/admin/view-cbatch/${batch.centreId}`);

  } catch (err) {
    console.error("❌ Error updating schedule:", err);
    res.status(500).send('Error updating schedule: ' + err.message);
  }
});
// GET - Add Supply Mark Page// GET - Add Supply Mark Page
router.get('/add-supply-mark/:id', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await db.get().collection(collection.STUDENT_COLLECTION).findOne({ _id: studentId });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    if (!student.marks) {
      return res.status(400).send("No regular marks found for this student");
    }

    // Identify failed subjects
    const failedSubjects = student.marks.subjects.filter(subject => 
      subject.result === 'FAILED'
    );

    if (failedSubjects.length === 0) {
      return res.status(400).send("Student has no failed subjects");
    }

    res.render('admin/add-supply-mark', {
      hideNavbar: true,
      studentId: req.params.id,
      student,
      failedSubjects,
      regularMarks: student.marks
    });
  } catch (err) {
    console.error("❌ Error loading supply mark page:", err);
    res.status(500).send("Error loading supply mark page");
  }
});

// POST - Save Supply Marks - FIXED PATH
router.post('/add-supply-mark', verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.body.studentId;
    console.log("📝 Received supply marks for student:", studentId);

    if (!ObjectId.isValid(studentId)) {
      return res.status(400).send("Invalid Student ID");
    }

    // Get student data
    const student = await db.get().collection(collection.STUDENT_COLLECTION).findOne({ 
      _id: new ObjectId(studentId) 
    });

    if (!student || !student.marks) {
      return res.status(400).send("Student or regular marks not found");
    }

    // Prepare supply marks data
    const supplyMarksData = {
      candidateName: student.marks.candidateName,
      address: student.marks.address,
      institute: student.marks.institute,
      examination: "SUPPLY EXAMINATION",
      course: student.marks.course,
      courseDuration: student.marks.courseDuration,
      registrationNo: student.marks.registrationNo,
      department: student.marks.department,
      examTitle: `SUPPLY - ${student.marks.examTitle}`,
      
      subjects: [],
      isSupply: true,
      originalMarksId: student.marks._id || studentId,
      
      totalWords: req.body.totalWords,
      maxTotal: parseInt(req.body.maxTotal) || 0,
      obtainedTotal: parseInt(req.body.obtainedTotal) || 0,
      overallResult: req.body.overallResult,
      grade: req.body.grade,
      
      createdAt: new Date()
    };

    // Process supply subjects
    if (req.body.subjectName && Array.isArray(req.body.subjectName)) {
      for (let i = 0; i < req.body.subjectName.length; i++) {
        if (req.body.subjectName[i].trim() !== '') {
          const subjectData = {
            subject: req.body.subjectName[i],
            theoryMax: parseInt(req.body.theoryMax[i]) || 0,
            theoryMin: parseInt(req.body.theoryMin[i]) || 0,
            theoryObt: parseInt(req.body.theoryObt[i]) || 0,
            practicalMax: parseInt(req.body.practicalMax[i]) || 0,
            practicalMin: parseInt(req.body.practicalMin[i]) || 0,
            practicalObt: parseInt(req.body.practicalObt[i]) || 0,
            totalMax: (parseInt(req.body.theoryMax[i]) || 0) + (parseInt(req.body.practicalMax[i]) || 0),
            totalMin: (parseInt(req.body.theoryMin[i]) || 0) + (parseInt(req.body.practicalMin[i]) || 0),
            totalObt: (parseInt(req.body.theoryObt[i]) || 0) + (parseInt(req.body.practicalObt[i]) || 0),
            result: (parseInt(req.body.theoryObt[i]) >= parseInt(req.body.theoryMin[i]) && 
                    parseInt(req.body.practicalObt[i]) >= parseInt(req.body.practicalMin[i])) ? 'PASSED' : 'FAILED',
            isSupply: true,
            originalResult: student.marks.subjects.find(s => s.subject === req.body.subjectName[i])?.result || 'FAILED'
          };
          
          supplyMarksData.subjects.push(subjectData);
        }
      }
    }

    console.log("📊 Supply marks data to save:", JSON.stringify(supplyMarksData, null, 2));

    // Update student with supply marks
    const result = await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
      { _id: new ObjectId(studentId) },
      { 
        $set: { 
          supplyMarks: supplyMarksData,
          hasSupply: true,
          updatedAt: new Date()
        } 
      }
    );

    console.log("💾 Supply marks saved successfully");
    
    // FIXED: Redirect to admin combined marklist
    res.redirect('/admin/combined-marklist/' + studentId);
    
  } catch (err) {
    console.error("❌ Error saving supply marks:", err);
    res.status(500).send("Error submitting supply marks");
  }
});

// // // Combined Marklist Route - FIXED

// router.get('/combined-marklist/:id', verifyAdminLogin, async (req, res) => {
//   try {
//     console.log("🔄 Combined marklist route accessed for:", req.params.id);
    
//     const studentId = new ObjectId(req.params.id);
//     const student = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .findOne({ _id: studentId });

//     if (!student) return res.status(404).send("Student not found");
//     if (!student.marks) return res.status(400).send("No regular marks found");
//     if (!student.supplyMarks) return res.status(400).send("No supply marks found");

//     console.log("✅ Student data loaded successfully");

//     // Combine regular and supply marks
//     const combinedSubjects = [];
//     let maxTotal = 0;
//     let obtainedTotal = 0;
//     let allPassed = true;

//     // Regular subjects (only PASSED)
//     if (Array.isArray(student.marks.subjects)) {
//       student.marks.subjects.forEach(subject => {
//         if (subject.result === 'PASSED') {
//           combinedSubjects.push({ ...subject, source: 'regular' });
//           maxTotal += subject.totalMax || 0;
//           obtainedTotal += subject.totalObt || 0;
//         }
//       });
//     }

//     // Supply subjects (PASSED + FAILED)
//     if (Array.isArray(student.supplyMarks.subjects)) {
//       student.supplyMarks.subjects.forEach(supplySubject => {
//         combinedSubjects.push({ ...supplySubject, source: 'supply' });
//         maxTotal += supplySubject.totalMax || 0;
//         obtainedTotal += supplySubject.totalObt || 0;
//         if (supplySubject.result === 'FAILED') allPassed = false;
//       });
//     }

//     // Calculate percentage & grade
//     const percentage = maxTotal > 0 ? (obtainedTotal / maxTotal) * 100 : 0;
//     let grade = 'FAILED';

//     if (allPassed) {
//       if (percentage >= 80) grade = 'PASSED WITH A+ GRADE (EXCELLENT)';
//       else if (percentage >= 70) grade = 'PASSED WITH A GRADE (VERY GOOD)';
//       else if (percentage >= 60) grade = 'PASSED WITH B+ GRADE (GOOD)';
//       else if (percentage >= 50) grade = 'PASSED WITH B GRADE (SATISFACTORY)';
//       else if (percentage >= 40) grade = 'PASSED WITH C GRADE';
//       else allPassed = false;
//     }

//     // Prepare combined marks object
//     const combinedMarks = {
//       ...student.marks,
//       subjects: combinedSubjects,
//       maxTotal,
//       obtainedTotal,
//       overallResult: allPassed ? 'PASSED' : 'FAILED',
//       grade,
//       totalWords: numberToWords(obtainedTotal),
//       isCombined: true,
//       combinedDate: new Date()
//     };

//     // ✅ Fetch logos
//     const centreId = student.centreId;
//     const departmentName = student.department; // 🔹 correct field name
//     const centerData = await centerHelpers.getCenterById(centreId);

//     // ✅ Fetch department logo properly
//     const departmentLogo = await centerHelpers.getDepartmentLogo(centreId, departmentName);

//     console.log("✅ Combined Marklist Debug:", {
//       centreId,
//       departmentName,
//       institutionLogo: centerData?.institutionLogo,
//       departmentLogo
//     });

//     // ✅ Render with both logos
//     res.render('admin/combined-marklist', {
//       hideNavbar: true,
//       studentId: req.params.id,
//       student,
//       combinedMarks,
//       logoPath: centerData?.institutionLogo || '/images/default-institution-logo.png',
//       departmentLogoPath: departmentLogo || '/images/default-department-logo.png',
//       currentDate: new Date()
//     });

//   } catch (err) {
//     console.error("❌ Error loading combined mark list:", err);
//     res.status(500).send("Error loading combined mark list");
//   }
// });




//supply marklist
// Supply Mark List Route - Shows ONLY supply marks
// ✅ FIXED Supply Marklist Route
router.get('/supply-mark-list/:id', verifyAdminLogin, async (req, res) => {
  try {
    console.log("🔄 Supply marklist route accessed for:", req.params.id);
    
    const studentId = new ObjectId(req.params.id);
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: studentId });

    if (!student) {
      console.log("❌ Student not found");
      return res.status(404).send("Student not found");
    }

    if (!student.supplyMarks) {
      console.log("❌ No supply marks found");
      return res.status(400).send("No supply marks found");
    }

    console.log("✅ Supply marks data loaded successfully");

    // ✅ Fetch center and department details
    const centreId = student.centreId;
    const departmentName = student.department; // use same field as marklist
    const centerData = await centerHelpers.getCenterById(centreId);

    // ✅ Get logos properly
    const institutionLogo = centerData?.institutionLogo || '/images/default-institution-logo.png';
    const departmentLogo = await centerHelpers.getDepartmentLogo(centreId, departmentName);

    // Debug log
    console.log("✅ Supply Marklist Debug:", {
      centreId,
      departmentName,
      institutionLogo,
      departmentLogo
    });

    // ✅ Render supply marklist
    res.render('admin/supply-mark-list', {
      hideNavbar: true,
      studentId: req.params.id,
      student,
      logoPath: institutionLogo,
      departmentLogoPath: departmentLogo || '/images/default-department-logo.png',
      currentDate: new Date()
    });

  } catch (err) {
    console.error("❌ Error loading supply mark list:", err);
    res.status(500).send("Error loading supply mark list");
  }
});
// ==============================
// ADD SKILL DEVELOPMENT STUDENT
// ==============================
router.get('/add-sdstudent', verifyAdminLogin, (req, res) => {
  res.render('admin/add-sdstudent', { hideNavbar: true });
});
//post
router.post('/add-sdstudent', verifyAdminLogin, async (req, res) => {
  try {
    const studentData = {
      ...req.body,
      type: "Skill Development",
      activated: false,
      appliedForHallTicket: false,
      dob: new Date(req.body.dob),
      courseStartDate: new Date(req.body.courseStartDate),
      courseEndDate: new Date(req.body.courseEndDate),
      issueDate: new Date(req.body.issueDate),
    };

    studentHelpers.addStudent(studentData, (id) => {
      if (req.files && req.files.image) {
        const imageFile = req.files.image;
        const uploadPath = path.join(__dirname, '../public/studentImages/', id + '.jpg');
        imageFile.mv(uploadPath, (err) => {
          if (err) console.error("❌ Error saving image:", err);
        });
      }
      res.redirect('/admin/view-student');
    });
  } catch (error) {
    console.error("❌ Error adding student:", error);
    res.status(500).send("Error adding student");
  }
});

//view-sd student
router.get('/view-sdstudent', verifyAdminLogin, async (req, res) => {
  try {
    const sdstudents = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ type: "Skill Development" })
      .toArray();

    res.render('admin/view-sdstudent', { admin: true, sdstudents });
  } catch (error) {
    console.error("❌ Error fetching Skill Development students:", error);
    res.status(500).send("Error loading Skill Development students");
  }
});

// ===========================
// SKILL DEVELOPMENT CERTIFICATE - DOWNLOAD
// ===========================
router.get("/sdcertificate-pdf/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // ✅ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) return res.status(404).send("Student not found");

    // ✅ Background image
    const bgPath = path.join(__dirname, "../public/images/sdc-bg.jpg");
    const bgImageBytes = fs.readFileSync(bgPath);

    // ✅ Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([8.543 * 72, 11.367 * 72]);

    const bgImage = await pdfDoc.embedJpg(bgImageBytes);
    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: 8.543 * 72,
      height: 11.367 * 72,
    });

    // ✅ Fonts
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const bold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const courierbold = await pdfDoc.embedFont(StandardFonts.CourierBold);

    // ✅ Helper for centered text
    function drawCenteredText(page, text, y, centerX, font, size) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2;
      page.drawText(text, { x, y, size, font });
    }

    // ✅ Student Photo
    const photoPath = path.join(__dirname, "../public/studentImages/", `${student._id}.jpg`);
    if (fs.existsSync(photoPath)) {
      const photoBytes = fs.readFileSync(photoPath);
      const photoImage = await pdfDoc.embedJpg(photoBytes);
      page.drawImage(photoImage, {
        x: 495.5,
        y: 451,
        width: 57.8,
        height: 77.3,
      });
    }

    // ✅ Format Dates
    function formatDate(dateValue) {
      if (!dateValue) return "";
      const date = new Date(dateValue);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }

    const dob = student.dob instanceof Date
      ? student.dob.toDateString()
      : (student.dob || "");

    const startDate = formatDate(student.courseStartDate);
    const endDate = formatDate(student.courseEndDate);
    const issueDate = formatDate(student.issueDate);

    // ✅ Draw Fields (matching preview)
    page.drawText(student.regNo || "", { x: 80, y: 681, size: 6.86, font });
    drawCenteredText(page, student.fullName?.toUpperCase() || "", 424, 350, courierbold, 11.67);
    drawCenteredText(page, student.skill || "", 363.559, 340, courierbold, 11.67);
    drawCenteredText(page, student.centreName || "", 304, 300, courierbold, 11.67);
    page.drawText(dob, { x: 100, y: 404, size: 11.67, font: courierbold });

    // ✅ Address wrapping logic
    if (student.address) {
      const address = student.address.trim().replace(/,/g, ", ");
      const words = address.split(/\s+/);

      let currentLine = "";
      let yPos = 403;
      const fontSize = 11.67;
      const xStartFirstLine = 319;  // after “resident of”
      const xStartNextLines = 55;   // next line starts left
      const maxWidth = 260;
      let isFirstLine = true;

      for (let i = 0; i < words.length; i++) {
        const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
        const textWidth = courierbold.widthOfTextAtSize(testLine, fontSize);

        if (textWidth > maxWidth) {
          page.drawText(currentLine.trim(), {
            x: isFirstLine ? xStartFirstLine : xStartNextLines,
            y: yPos,
            size: fontSize,
            font: courierbold,
          });
          yPos -= 20;
          currentLine = words[i];
          isFirstLine = false;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        page.drawText(currentLine.trim(), {
          x: isFirstLine ? xStartFirstLine : xStartNextLines,
          y: yPos,
          size: fontSize,
          font: courierbold,
        });
      }
    }

    // ✅ Course Dates + Issue Date
    page.drawText(startDate, { x: 90, y: 344, size: 11.67, font: courierbold });
    page.drawText(endDate, { x: 255, y: 344, size: 11.67, font: courierbold });
    page.drawText(issueDate, { x: 469, y: 265, size: 11.67, font: courierbold });

    // ✅ Save and Send PDF
    const pdfBytes = await pdfDoc.save();
    res.contentType("application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=SkillCertificate_${student.fullName || studentId}.pdf`
    );
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error generating PDF:", err);
    res.status(500).send("Error generating PDF");
  }
});


// ===========================
// SKILL DEVELOPMENT CERTIFICATE - PREVIEW (no download)
// ===========================
router.get("/sdcertificate-preview/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) return res.status(404).send("Student not found");
    console.log("📅 Issue Date from DB:", student.issueDate);

    const bgPath = path.join(__dirname, "../public/images/sdc-bg.jpg");
    const bgImageBytes = fs.readFileSync(bgPath);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([8.543 * 72, 11.367 * 72]);

    const bgImage = await pdfDoc.embedJpg(bgImageBytes);
    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: 8.543 * 72,
      height: 11.367 * 72,
    });

    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const bold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const courierbold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    function drawCenteredText(page, text, y, centerX, font, size) {
      if (!text) return;
      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2; // shift left by half width
      page.drawText(text, { x, y, size, font });
    }
    

    // ✅ Student Photo
    const photoPath = path.join(__dirname, "../public/studentImages/", `${student._id}.jpg`);
    if (fs.existsSync(photoPath)) {
      const photoBytes = fs.readFileSync(photoPath);
      const photoImage = await pdfDoc.embedJpg(photoBytes);
      page.drawImage(photoImage, {
        x: 495.5,
        y: 451,
        width: 57.8,
        height: 77.3,
      });
    }

    // ✅ Convert Dates to Strings (so pdf-lib won’t throw error)
  // ✅ Convert Dates safely (avoids timezone shift)
  function formatDate(dateValue) {
    if (!dateValue) return "";
    const date = new Date(dateValue);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }
  

const dob = student.dob instanceof Date 
  ? student.dob.toDateString()  // shows like "Fri Oct 31 2025"
  : (student.dob || "");
const startDate = formatDate(student.courseStartDate);
const endDate = formatDate(student.courseEndDate);
const issueDate = formatDate(student.issueDate);


    // ✅ Draw Text Fields
    page.drawText(student.regNo || "", { x: 136, y: 753.4, size: 6.86, font });
    drawCenteredText(page, student.fullName?.toUpperCase() || "", 424,350 , courierbold, 11.67);

    drawCenteredText(page, student.skill || "", 363.559, 340, courierbold, 11.67);

    drawCenteredText(page, student.centreName || "", 304, 300, courierbold, 11.67);

    page.drawText(dob, { x: 100, y: 404, size: 11.67, font: courierbold });
    if (student.address) {
      // Add a space after every comma for natural spacing
      const address = student.address.trim().replace(/,/g, ", ");
    
      // Split by space to handle wrapping smoothly
      const words = address.split(/\s+/);
    
      let currentLine = "";
      let yPos = 403; // starting Y position
      const fontSize = 11.67;
    
      // X positions and layout limits
      const xStartFirstLine = 324;  // after "resident of"
      const xStartNextLines = 55;   // from left for next lines
      const maxWidth = 250;         // max width before wrapping
    
      let isFirstLine = true;
    
      for (let i = 0; i < words.length; i++) {
        const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
        const textWidth = courierbold.widthOfTextAtSize(testLine, fontSize);
    
        if (textWidth > maxWidth) {
          // Draw the current line
          page.drawText(currentLine.trim(), {
            x: isFirstLine ? xStartFirstLine : xStartNextLines,
            y: yPos,
            size: fontSize,
            font: courierbold,
          });
    
          // Move to the next line
          yPos -= 20; // adjust spacing as needed
          currentLine = words[i];
          isFirstLine = false;
        } else {
          currentLine = testLine;
        }
      }
    
      // Draw remaining text
      if (currentLine) {
        page.drawText(currentLine.trim(), {
          x: isFirstLine ? xStartFirstLine : xStartNextLines,
          y: yPos,
          size: fontSize,
          font: courierbold,
        });
      }
    }
    
    


    // ✅ Course Dates and Issue Date
    page.drawText(startDate, { x: 90, y: 344, size: 11.67, font: courierbold });
    page.drawText(endDate, { x: 255, y: 344, size: 11.67, font: courierbold });
    page.drawText(issueDate, { x: 469, y: 265, size: 11.67, font: courierbold });

    // ✅ Preview PDF inline
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <body style="margin:0;padding:0;">
          <iframe src="data:application/pdf;base64,${base64}" width="100%" height="100%" style="border:none;height:100vh;"></iframe>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ Error generating preview:", err);
    res.status(500).send("Error generating preview");
  }
});

// ===========================
// SKILL DEVELOPMENT ID CARD - PREVIEW
// ===========================
router.get("/sdc-idcard-preview/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) return res.status(404).send("Student not found");

    // 🟢 Load front & back images
    const frontPath = path.join(__dirname, "../public/images/sd-id-front.jpg");
    const backPath = path.join(__dirname, "../public/images/sd-id-back.jpg");
    const frontBytes = fs.readFileSync(frontPath);
    const backBytes = fs.readFileSync(backPath);

    // 🟢 Create PDF (ID card size 3.37 × 2.13 inches)
    const pdfDoc = await PDFDocument.create();

    // FRONT SIDE
    const front = pdfDoc.addPage([3.37 * 72, 2.13 * 72]);
    const frontImg = await pdfDoc.embedJpg(frontBytes);
    front.drawImage(frontImg, { x: 0, y: 0, width: 3.37 * 72, height: 2.13 * 72 });

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 🟢 Student Photo
    const photoPath = path.join(__dirname, "../public/studentImages/", `${student._id}.jpg`);
    if (fs.existsSync(photoPath)) {
      const photoBytes = fs.readFileSync(photoPath);
      const photo = await pdfDoc.embedJpg(photoBytes);
      front.drawImage(photo, {
        x: 188, // adjust horizontal position
        y: 45, // adjust vertical position
        width: 44,
        height: 53,
      });
    }
  
    

    // 🟢 Front Text Fields
    front.drawText(student.fullName?.toUpperCase() || "", { x: 46, y: 54, size: 9, font: bold });
    front.drawText("Reg No: " + (student.regNo || ""), { x: 46, y: 43, size: 9, font });
    // Draw "Skill:" in bold style (by positioning)
front.drawText("Skill- ", { x: 12, y: 16, size: 9.5, font:bold });
front.drawText(student.skill || "", { x: 36, y: 16, size: 9.5, font }); // Adjust x position
    front.drawText("Adhaar No: " + (student.adharNo || ""), { x: 46, y: 32, size: 9, font });

    // BACK SIDE
    const back = pdfDoc.addPage([3.37 * 72, 2.13 * 72]);
    const backImg = await pdfDoc.embedJpg(backBytes);
    back.drawImage(backImg, { x: 0, y: 0, width: 3.37 * 72, height: 2.13 * 72 });

    // 🟢 Back Text Fields
    const formatDate = (dateVal) => {
      if (!dateVal) return "";
      const d = new Date(dateVal);
      return `${d.getDate().toString().padStart(2, "0")}-${(d.getMonth()+1)
        .toString()
        .padStart(2, "0")}-${d.getFullYear()}`;
    };
    back.drawText("Address", { x: 10, y: 129, size: 9.5, font: bold });

    if (student.address) {
      const address = student.address.trim();
      // split by space or comma, keeping commas as separate tokens
      const parts = address.split(/([ ,])/).filter(p => p.trim() !== "");
      
      let currentLine = '';
      let yPos = 120;
      const maxWidth = 155; // adjust based on your card width
      const fontSize = 9.5;
    
      for (let i = 0; i < parts.length; i++) {
        const testLine = currentLine ? `${currentLine}${parts[i]}` : parts[i];
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);
    
        if (textWidth > maxWidth) {
          // draw current line
          back.drawText(currentLine.trim(), { x: 10, y: yPos, size: fontSize, font });
          yPos -= 10;
          currentLine = parts[i].trim();
        } else {
          currentLine = testLine;
        }
      }
    
      if (currentLine) {
        back.drawText(currentLine.trim(), { x: 10, y: yPos, size: fontSize, font });
      }
    }
    
    
    back.drawText("Mobile Number: " , { x: 10, y: 80, size: 9.5, font });
    back.drawText((student.number || ""), { x: 10, y: 70, size: 9.5, font });
    back.drawText("Blood Group: ", { x: 10, y: 50, size: 9, font });
    back.drawText( (student.bloodGroup || ""), { x: 10, y: 40, size: 9.5, font });
    back.drawText("Issue Date ", { x: 182, y: 53, size: 9, font });
    back.drawText(formatDate(student.issueDate), { x: 180, y: 43, size: 9, font });
    back.drawText("Registered Office:MC Building, 3rd floor,Main Road,Kottakkal ", { x: 12, y: 24, size: 7.5, font });
    back.drawText("Malappuram(Dist) Kerala,pin-676503,www.netd.org.in", { x: 21, y: 14.5, size: 7.5, font });

    // 🟢 Generate Base64 Preview
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <body style="margin:0;padding:0;">
          <iframe src="data:application/pdf;base64,${base64}" width="100%" height="100%" style="border:none;height:100vh;"></iframe>
          <div style="position:fixed;bottom:20px;right:40px;">
            <a href="/admin/sdc-idcard-pdf/${student._id}" 
               style="background:#28a745;color:white;padding:10px 20px;border-radius:6px;
                      text-decoration:none;font-family:sans-serif;">
               Download as PDF
            </a>
          </div>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ Error generating ID card preview:", err);
    res.status(500).send("Error generating ID card preview");
  }
});



// ===========================
// SKILL DEVELOPMENT ID CARD - DOWNLOAD (Fixed Layout)
// ===========================
router.get("/sdc-idcard-pdf/:id", verifyAdminLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) return res.status(404).send("Student not found");

    // 🖼 Load background images
    const frontPath = path.join(__dirname, "../public/images/sd-id-front.jpg");
    const backPath = path.join(__dirname, "../public/images/sd-id-back.jpg");
    const frontBytes = fs.readFileSync(frontPath);
    const backBytes = fs.readFileSync(backPath);

    // 📝 Create PDF (ID card size)
    const pdfDoc = await PDFDocument.create();

    // FRONT SIDE
    const front = pdfDoc.addPage([3.37 * 72, 2.13 * 72]);
    const frontImg = await pdfDoc.embedJpg(frontBytes);
    front.drawImage(frontImg, { x: 0, y: 0, width: 3.37 * 72, height: 2.13 * 72 });

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 🧍‍♂️ Student Photo
    const photoPath = path.join(__dirname, "../public/studentImages/", `${student._id}.jpg`);
    if (fs.existsSync(photoPath)) {
      const photoBytes = fs.readFileSync(photoPath);
      const photo = await pdfDoc.embedJpg(photoBytes);
      front.drawImage(photo, {
        x: 188,
        y: 45,
        width: 44,
        height: 53,
      });
    }

    // 🟢 Front Text Fields
    front.drawText(student.fullName?.toUpperCase() || "", { x: 46, y: 54, size: 9, font: bold });
    front.drawText("Reg No: " + (student.regNo || ""), { x: 46, y: 43, size: 9, font });
    front.drawText("Adhaar No: " + (student.adharNo || ""), { x: 46, y: 32, size: 9, font });
    front.drawText("Skill- ", { x: 12, y: 16, size: 9.5, font: bold });
    front.drawText(student.skill || "", { x: 36, y: 16, size: 9.5, font });

    // BACK SIDE
    const back = pdfDoc.addPage([3.37 * 72, 2.13 * 72]);
    const backImg = await pdfDoc.embedJpg(backBytes);
    back.drawImage(backImg, { x: 0, y: 0, width: 3.37 * 72, height: 2.13 * 72 });

    // 🗓 Format Dates
    const formatDate = (dateVal) => {
      if (!dateVal) return "";
      const d = new Date(dateVal);
      return `${d.getDate().toString().padStart(2, "0")}-${(d.getMonth() + 1)
        .toString()
        .padStart(2, "0")}-${d.getFullYear()}`;
    };

    // 🏠 Address
    back.drawText("Address", { x: 10, y: 129, size: 9.5, font: bold });

    if (student.address) {
      const address = student.address.trim();
      // split by space or comma, keeping commas as separate tokens
      const parts = address.split(/([ ,])/).filter(p => p.trim() !== "");
      
      let currentLine = '';
      let yPos = 120;
      const maxWidth = 155; // adjust to fit card width
      const fontSize = 9.5;
    
      for (let i = 0; i < parts.length; i++) {
        const testLine = currentLine ? `${currentLine}${parts[i]}` : parts[i];
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);
    
        if (textWidth > maxWidth) {
          // draw current line
          back.drawText(currentLine.trim(), { x: 10, y: yPos, size: fontSize, font });
          yPos -= 10;
          currentLine = parts[i].trim();
        } else {
          currentLine = testLine;
        }
      }
    
      if (currentLine) {
        back.drawText(currentLine.trim(), { x: 10, y: yPos, size: fontSize, font });
      }
    }

    // 📱 Mobile, Blood, Issue Date
    back.drawText("Mobile Number: ", { x: 10, y: 80, size: 9.5, font });
    back.drawText(student.number || "", { x: 10, y: 70, size: 9.5, font });

    back.drawText("Blood Group: ", { x: 10, y: 50, size: 9, font });
    back.drawText(student.bloodGroup || "", { x: 10, y: 40, size: 9.5, font });

    back.drawText("Issue Date", { x: 182, y: 53, size: 9, font });
    back.drawText(formatDate(student.issueDate), { x: 180, y: 43, size: 9, font });

    // 🏢 Registered Office (same as preview)
    back.drawText("Registered Office:MC Building, 3rd floor,Main Road,Kottakkal ", { x: 12, y: 24, size: 7.5, font });
    back.drawText("Malappuram(Dist) Kerala,pin-676503,www.netd.org.in", { x: 21, y: 14.5, size: 7.5, font });

    // 🧾 Generate PDF
    const pdfBytes = await pdfDoc.save();
    res.contentType("application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=SkillDev_IDCard_${student.fullName || studentId}.pdf`
    );
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error generating ID card PDF:", err);
    res.status(500).send("Error generating ID card PDF");
  }
});

// GET route to show background change form
router.get('/bg-change/:type', verifyAdminLogin, async (req, res) => {
  try {
      const bgType = req.params.type;
      
      // Map type to actual file names
      const bgMap = {
        'sd-certificate': 'sdc-bg.jpg',
        'certificate1': 'certificate-bg.jpg', 
        'certificate2': 'certificate-bg2.jpg',
        'marksheet': 'Marklist-bg.jpg',
        'id-card': 'id-card.jpg',
        'sd-id-front': 'sd-id-front.jpg',
        'sd-id-back': 'sd-id-back.jpg'
    };

      const currentBg = bgMap[bgType];
      const bgPath = path.join(__dirname, `../public/images/${currentBg}`);
      
      // Check if file actually exists
      const fileExists = fs.existsSync(bgPath);
      
      console.log(`🔍 Background Check:`);
      console.log(`   Type: ${bgType}`);
      console.log(`   Expected file: ${currentBg}`);
      console.log(`   Full path: ${bgPath}`);
      console.log(`   File exists: ${fileExists}`);

      res.render('admin/bg-change', {
          admin: true,
          bgType: bgType,
          currentBg: currentBg,
          fileExists: fileExists, // Pass this to template
          success: req.query.success, // Pass success message
          bgTypes: {
            'sd-certificate': 'SD Certificate',
            'certificate1': 'Certificate Type 1', 
            'certificate2': 'Certificate Type 2',
            'marksheet': 'Mark Sheet',
            'id-card': 'ID Card',
            'sd-id-front': 'SD ID Front',
            'sd-id-back': 'SD ID Back'
        }
      });

  } catch (error) {
      console.error("❌ Error loading background change:", error);
      res.status(500).send("Error loading background change page");
  }
});
// POST route to handle background image upload (using express-fileupload)
router.post('/bg-change/:type', verifyAdminLogin, async (req, res) => {
  try {
      const bgType = req.params.type;
      
      if (!req.files || !req.files.bgImage) {
          return res.status(400).send("Please select an image file");
      }

      const bgImage = req.files.bgImage;

      // Validate file type
      if (!bgImage.mimetype.startsWith('image/')) {
          return res.status(400).send("Only image files are allowed");
      }

      // Validate file size (10MB limit)
      if (bgImage.size > 10 * 1024 * 1024) {
          return res.status(400).send("File size must be less than 10MB");
      }

      // Map type to actual file names
      const bgMap = {
        'sd-certificate': 'sdc-bg.jpg',
        'certificate1': 'certificate-bg.jpg',
        'certificate2': 'certificate-bg2.jpg', 
        'marksheet': 'Marklist-bg.jpg',
        'id-card': 'id-card.jpg',
        'sd-id-front': 'sd-id-front.jpg',
        'sd-id-back': 'sd-id-back.jpg'
    };

      const targetFileName = bgMap[bgType];
      const targetPath = path.join(__dirname, `../public/images/${targetFileName}`);

      // Delete old file if exists
      if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
      }

      // Move uploaded file to target location using .mv()
      await bgImage.mv(targetPath);

      console.log(`✅ Background image updated: ${targetFileName}`);
      res.redirect('/admin/bg-change/' + bgType + '?success=true');

  } catch (error) {
      console.error("❌ Error updating background:", error);
      res.status(500).send("Error updating background image: " + error.message);
  }
});



module.exports = router;