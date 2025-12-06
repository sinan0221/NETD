var express = require('express');
var router = express.Router();
const centerHelpers = require('../helpers/center-helpers');
const userHelpers = require('../helpers/user-helpers');
const studentHelpers = require('../helpers/student-helper');
const batchHelpers=require('../helpers/batch-helpers');
const hallticketHelpers = require('../helpers/hallticket-helpers');

const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const jpegRotate = require('jpeg-autorotate');
const path = require('path');
const fontkit = require('fontkit');

const templatePath = path.join(__dirname, '../public/pdf-templates/hall_ticket_template.pdf');

const { ObjectId } = require('mongodb');
const db = require('../config/connection');
const collection = require('../config/collections');


// ✅ Middleware: Verify User Login
function verifyUserLogin(req, res, next) {
  if (req.session.userLoggedIn) {
    next();
  } else {
    res.redirect('/user/login');
  }
}

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
// LOGIN
// LOGIN PAGE
router.get('/login', (req, res) => {
  if (req.session.userLoggedIn) {
    res.redirect('/user');
  } else {
    res.render('user/login', { loginErr: req.session.loginErr });
    req.session.loginErr = false;
  }
});

// LOGIN POST
router.post('/login', async (req, res) => {
  try {
    let response = await userHelpers.doLogin(req.body);

    if (response.status) {
      req.session.userLoggedIn = true;
      req.session.user = response.user;

      // ✅ Save centreId into session for later use (filtering batches, students, etc.)
      req.session.centreId = response.centreId;   // ✅ ObjectId from centre collection


      res.redirect('/user');
    } else {
      req.session.loginErr = response.message || "Invalid Credentials";
      res.redirect('/user/login');
    }
  } catch (err) {
    console.error("❌ Login error:", err);
    req.session.loginErr = "Something went wrong";
    res.redirect('/user/login');
  }
});

// SIGNUP PAGE
router.get('/signup', (req, res) => {
  res.render('user/signup', { signupErr: req.session.signupErr });
  req.session.signupErr = false;
});

// SIGNUP POST
router.post('/signup', async (req, res) => {
  try {
    let result = await userHelpers.doSignup(req.body);

    if (result.status) {
      // after successful signup, go to login
      res.redirect('/user/login');
    } else {
      req.session.signupErr = result.message || "Signup failed";
      res.redirect('/user/signup');
    }
  } catch (err) {
    console.error("❌ Signup error:", err);
    req.session.signupErr = "Something went wrong";
    res.redirect('/user/signup');
  }
});


/* Logout */
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/user/login');
  });
});


// Dashboard (list all batches)

// router.get('/', verifyUserLogin, async (req, res) => {
// try {
//  let user = req.session.user;
//  const batches = await batchHelpers.getAllBatchesWithCentre();
//  res.render('user/view-batch', { batches, user });
// } catch (err) {
//  console.error("❌ Error loading batches:", err);
//  res.status(500).send("Error loading centers");
// }
// });


// router.get('/', verifyUserLogin, async (req, res) => {
//   try {
//     let user = req.session.user;
//     let centreId = req.session.centreId;   // ✅ Saved during login

//     // Fetch only batches that belong to this user's centre
//     const batches = await batchHelpers.getBatchesByCentre(centreId);

//     res.render('user/view-batch', { batches, user });
//   } catch (err) {
//     console.error("❌ Error loading batches:", err);
//     res.status(500).send("Error loading batches");
//   }
// });



router.get('/', verifyUserLogin, async (req, res) => {
  try {
    let user = req.session.user;
    let centreId = req.session.centreId; // ✅ Saved during login

    // 1️⃣ Get all batches belonging to this center
    const batches = await batchHelpers.getBatchesByCentre(centreId);

    // 2️⃣ Get all centers (with grade + stars automatically added by helper)
    const centers = await centerHelpers.getAllCenters();

    // 3️⃣ Find the logged-in user's center
    const center = centers.find(c => c._id.toString() === centreId.toString());

    // 4️⃣ Render the page with grade and stars
    res.render('user/view-batch', {
      batches,
      user,
      grade: center?.grade || '',
      stars: center?.stars || '',
      center
    });

  } catch (err) {
    console.error("❌ Error loading batches:", err);
    res.status(500).send("Error loading batches");
  }
});



// Add batch
router.get('/add-batch', verifyUserLogin, (req, res) => {
  res.render('user/add-batch', { hideNavbar: true });
});

// router.post('/add-batch', verifyUserLogin, (req, res) => {
//   batchHelpers.addBatch(req.body, () => {
//     res.redirect('/user');
//   });
// });
router.post('/add-batch', verifyUserLogin, (req, res) => {
  let batchData = {
    ...req.body,
    centreId: req.session.centreId   // ✅ attach logged-in user's centreId
  };

  batchHelpers.addBatch(batchData, () => {
    res.redirect('/user');  // redirect back to batch list page
  });
});

//edit batch:
router.get('/edit-batch/:id', verifyUserLogin, async (req, res) => {
  try {
    let batchId = req.params.id;
    let batch = await batchHelpers.getBatchDetails(batchId);
    

    if (!batch) {
      return res.status(404).send("batch not found");
    }

    res.render('user/edit-batch', { 
      user: true, 
      hideNavbar: true,
      batch // 👈 pass center to hbs
    });
  } catch (err) {
    console.error("❌ Error fetching batch:", err);
    res.status(500).send("Error loading batch details");
  }
});
//post route:
router.post('/edit-batch/:id', verifyUserLogin, async (req, res) => {
  try {
    await batchHelpers.updateBatch(req.params.id, req.body);
    res.redirect('/user');
  } catch (err) {
    console.error("❌ Error updating batch:", err);
    res.status(500).send("Error updating batch");
  }
});


// Delete batch
router.get('/delete-batch/:id', verifyUserLogin, (req, res) => {
  let batchId = req.params.id;
  batchHelpers.deleteBatch(batchId).then(() => {
    res.redirect('/user');
  });
});







/* ======================
   STUDENT MANAGEMENT
   ====================== */

/* User: View Students */
// router.get('/view-student', verifyUserLogin, async (req, res) => {
//   try {
//     const students = await studentHelpers.getAllStudents();
//     res.render('user/view-student', { students, user: req.session.user });
//   } catch (err) {
//     console.error("❌ Error fetching students (user):", err);
//     res.status(500).send("Error loading students");
//   }
// });
// user/student-routes.js
router.get('/view-student', verifyUserLogin, async (req, res) => {
  try {
    // 1️⃣ Get the logged-in user's centreId
    const userCentreId = req.session.user.centreId; // assuming your login sets this

    // 2️⃣ Fetch only students belonging to this centre
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ centreId: userCentreId }) // filter by centreId
      .toArray();

    // 3️⃣ Render the view
    res.render('user/view-student', { 
      students, 
      user: true,
      pageTitle: 'My Students'
    });

  } catch (err) {
    console.error("❌ Error fetching students:", err);
    res.status(500).send("Error loading students");
  }
});

// ======================
// ADD STUDENT (USER SIDE)
// ======================

// Show Add Student Form
// router.get('/add-student', verifyUserLogin, (req, res) => {
//   res.render('user/add-student', { user: req.session.user, hideNavbar: true,centreId: req.session.centreId });
// });
router.get('/add-student', verifyUserLogin, async (req, res) => {
  const centre = await centerHelpers.getCenterDetails(req.session.centreId);
  let batches = await batchHelpers.getAllBatchesWithCentre();
  console.log(centre.department)
  
  res.render('user/add-student', { 
    user: req.session.user, 
    hideNavbar: true,
    centreId: centre.centreId,       // 👈 human-friendly ID
    centreName: centre.centreName,
    batches
        // 👈 optional
  });
});

// Handle Add Student Form Submission
router.post('/add-student', verifyUserLogin, (req, res) => {
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
    res.redirect('/user/view-student');
  });
});


/* Delete Student (User) */
router.get('/delete-student/:id', verifyUserLogin, async (req, res) => {
  try {
    let studentId = req.params.id;
    console.log("🗑️ Deleting student (user):", studentId);

    if (!studentId) {
      return res.status(400).send("Invalid student ID");
    }

    await studentHelpers.deleteStudent(studentId);
    res.redirect('/user/view-student');
  } catch (err) {
    console.error("❌ Error deleting student:", err);
    res.status(500).send("Error deleting student");
  }
});
// View Students
// router.get('/view-bstudent/:batchId', verifyUserLogin, async (req, res) => {
//   let batchId = req.params.batchId;
//   let students = await studentHelpers.getStudentsByBatch(batchId);
//   res.render('user/view-bstudent', { user: true, students, batchId });
// });
router.get('/view-bstudent/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log("🔄 Loading students for batch:", batchId);
    
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: new ObjectId(batchId), activated: true })
      .toArray();

    const processedStudents = students.map(student => {
      let hasFailed = false;

      if (student.marks?.subjects && Array.isArray(student.marks.subjects)) {
        hasFailed = student.marks.subjects.some(sub => sub.result === 'FAILED');
      }

      return {
        ...student,
        hasFailed,
        hasSupply: student.hasSupply || false
      };
    });

    console.log(`📊 Processed ${processedStudents.length} students for batch ${batchId}`);
    
    res.render('user/view-bstudent', { 
      user: true, 
      students: processedStudents, 
      batchId 
    });
    
  } catch (error) {
    console.error("❌ Error loading students for batch:", error);
    res.status(500).render('error', { error: "Failed to load students" });
  }
});
// Approval middleware to get pending count (only for the user's centre)
router.use(async (req, res, next) => {
  try {
    const userCentreId = req.session.user.centreId; // logged-in user's centre

    const pendingCount = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .countDocuments({ 
        activated: { $ne: true },
        centreId: userCentreId  // filter by centre
      });

    res.locals.pendingCount = pendingCount; // available in all views
  } catch (err) {
    console.error("❌ Error fetching pending count:", err);
    res.locals.pendingCount = 0;
  }
  next();
});

// View PENDING Students (Only not activated, only user's centre)
router.get('/pending-students', verifyUserLogin, async (req, res) => {
  try {
    const userCentreId = req.session.user.centreId; // logged-in user's centre

    const pendingStudents = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ 
        activated: { $ne: true },
        centreId: userCentreId  // filter by centre
      })
      .toArray();

    res.render('user/pending-students', { 
      user: true, 
      pendingStudents,
      pageTitle: 'Pending Students'
    });
  } catch (err) {
    console.error("❌ Error loading pending students:", err);
    res.status(500).send("Error loading pending students");
  }
});

// ===========================
// USER SEARCH STUDENTS 
// ===========================
router.get('/search-students', verifyUserLogin, async (req, res) => {
  try {
    console.log("🎯 SEARCH-STUDENTS ROUTE HIT!");
    console.log("Session user:", req.session.user);
    console.log("Query:", req.query);
    
    const keyword = req.query.q;
    
    // Get user data from session
    const userData = req.session.user;
    
    if (!userData) {
      console.log("❌ No user data in session");
      return res.redirect('/user/login');
    }
    
    // Get centreId from session.user (not req.user)
    const centreId = userData.centreId;

    if (!keyword || keyword.trim() === "") {
      console.log("⚠️ Empty search term, redirecting to view-student");
      return res.redirect('/user/view-student');
    }

    console.log("🔍 Searching for:", keyword, "in center:", centreId);

    // Search students from user's center only
    const results = await studentHelpers.searchStudentsByCenter(keyword, centreId);
    console.log("📊 Search results:", results.length, "students found");

    res.render('user/search-results', {
      user: true,
      results,
      keyword,
      centreId: centreId,
      userName: userData.name || userData.centreName || "User"
    });

  } catch (error) {
    console.error("❌ Error in user search route:", error);
    console.error("Error details:", error.message);
    req.session.errorMsg = "Search failed. Please try again.";
    res.redirect('/user/view-student');
  }
});
// ===========================
// ID CARD - PREVIEW with Download Button
// ===========================
router.get('/id-card-preview/:id', verifyUserLogin, async (req, res) => {
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
            <a href="/user/id-card-pdf/${student._id}" class="download-btn">
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
router.get('/id-card-pdf/:id', verifyUserLogin, async (req, res) => {
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
router.get("/batch-idcards-download/:batchId", verifyUserLogin, async (req, res) => {
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


/* ======================
   APPLICATION FORM + HALL TICKET
   ====================== */

// Show Application Form (with studentId)
// router.get('/app-form/:id', verifyUserLogin, (req, res) => {
//   res.render('user/app-form', { 
//     hideNavbar: true, 
//     studentId: req.params.id 
//   });
// });
// Show Application Form (with studentId)
// router.get('/app-form/:id', verifyUserLogin, async (req, res) => {
//   try {
//     const studentId = req.params.id;

//     if (!ObjectId.isValid(studentId)) {
//       console.error("❌ Invalid studentId:", studentId);
//       return res.status(400).send("Invalid Student ID");
//     }

//     // 1️⃣ Find student
//     const student = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .findOne({ _id: new ObjectId(studentId) });

//     if (!student) {
//       console.error("❌ Student not found:", studentId);
//       return res.status(404).send("Student not found");
//     }

//     // 2️⃣ Find center only if centreId is valid
//     let centre = null;
//     if (student.centreId && ObjectId.isValid(student.centreId)) {
//       centre = await db.get()
//         .collection(collection.CENTER_COLLECTION)
//         .findOne({ _id: new ObjectId(student.centreId) });
//     } else {
//       console.warn("⚠️ Invalid or missing centreId:", student.centreId);
//     }

//     // 3️⃣ Render app-form with both student and centre data
//     res.render('user/app-form', {
//       hideNavbar: true,
//       studentId,
//       student,
//       centre
//     });

//   } catch (err) {
//     console.error("❌ Error loading app form:", err);
//     res.status(500).send("Error loading application form");
//   }
// });
router.get('/app-form/:id', verifyUserLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student details
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    // 2️⃣ Fetch all centers
    const centres = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .find({})
      .toArray();

    // ✅ Pick the center that matches student's centreId, or fallback to first one
    let centre = null;
    if (student.centreId) {
      centre = centres.find(c => 
        c._id.toString() === student.centreId.toString()
      );
    }

    if (!centre && centres.length > 0) {
      centre = centres[0]; // fallback if not matched
    }
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // 3️⃣ Render app form with data
    res.render('user/app-form', { 
      hideNavbar: true,
      studentId,
      student,
      centre,
      centres,
      today
    });

  } catch (err) {
    console.error("❌ Error loading app form:", err);
    res.status(500).send("Error loading application form");
  }
});

router.post('/app-form', verifyUserLogin, async (req, res) => {
  try {
    const studentId = req.body.studentId;
    

    // 🔴 Validate student ID
    if (!ObjectId.isValid(studentId)) {
      console.error("❌ Invalid studentId:", studentId);
      return res.status(400).send("Invalid Student ID");
    }

    // 🗓️ Ensure studentDate is today if not provided
    // const today = new Date().toISOString().split('T')[0];
    const date = new Date();
const today = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;


    // 🧾 Form data - with proper examDate handling
    const formData = {
      candidateName: req.body.candidateName?.trim() || "",
      courseName: req.body.courseName?.trim() || "",
      studyCentre: req.body.studyCentre?.trim() || "",
      examCentre: req.body.examCentre?.trim() || "",
      examDate: req.body.examDate || "", // This should now have the value from form
      examTime: req.body.examTime?.trim() || "",
      registerNumber: req.body.registerNumber?.trim() || "",
      studentDate: req.body.studentDate || today,
      approved: false
    };

   

    // ✅ Update student record
    const updateResult = await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
      { _id: new ObjectId(studentId) },
      {
        $set: {
          applicationForm: formData,
          appliedForHallTicket: true,
          // Also store examDate and examTime at root level for easy access
          examDate: formData.examDate,
          examTime: formData.examTime
        }
      }
    );

    

    if (updateResult.modifiedCount === 0) {
      console.error("❌ No documents were updated");
      return res.status(500).send("Failed to save application form");
    }

    // Fetch updated student to verify
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      console.error("❌ Student not found after update:", studentId);
      return res.status(404).send("Student not found");
    }

    console.log("✅ Final student data verification:");
    console.log("   - Application Form:", student.applicationForm);
    console.log("   - Exam Date:", student.examDate);
    console.log("   - Exam Time:", student.examTime);
    console.log("   - Applied for Hall Ticket:", student.appliedForHallTicket);

    // Redirect back to batch view
    res.redirect('/user/view-bstudent/' + student.batchId);

  } catch (err) {
    console.error("❌ Error saving application form:", err);
    res.status(500).send("Error submitting application form");
  }
});



//view hall-ticket
// router.get('/hall-ticket/:id', verifyUserLogin, async (req, res) => {
//   try {
//     const studentId = new ObjectId(req.params.id);
//     const student = await db.get().collection(collection.STUDENT_COLLECTION).findOne({ _id: studentId });

//     if (!student || !student.applicationForm) {
//       return res.status(404).send("Hall Ticket not available");
//     }

//     res.render('user/hall-ticket', {
//       hideNavbar: true,
//       student
//     });
//   } catch (err) {
//     console.error("❌ Error loading hall ticket:", err);
//     res.status(500).send("Error loading hall ticket");
//   }
// });


// ===========================
// HALL TICKET - PREVIEW
// ===========================
router.get("/hall-ticket/:id", verifyUserLogin, async (req, res) => {
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
            <a href="/user/hallticket-download/${student._id}" class="download-btn">
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
router.get("/hallticket-download/:id", verifyUserLogin, async (req, res) => {
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
router.get("/batch-halltickets-download/:batchId", verifyUserLogin, async (req, res) => {
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

//add-mark
router.get('/add-mark/:id', verifyUserLogin, async (req, res) => {
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
    res.render('user/add-mark', { 
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
router.post('/add-mark', verifyUserLogin, async (req, res) => {
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

    res.redirect('/user/mark-list/' + studentId);
  } catch (err) {
    console.error("❌ Error saving marks:", err);
    res.status(500).send("Error submitting marks");
  }
});
// mark list
router.get('/mark-list/:id', verifyUserLogin, async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);

    // 1️⃣ Get student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: studentId });

    if (!student) return res.status(404).send("Student not found");

    const centreId = student.centreId;
    const departmentName = student.department;

    // 2️⃣ Fetch center data
    const centerData = await centerHelpers.getCenterById(centreId);

    // 3️⃣ Extract logos
    const institutionLogo = centerData?.institutionLogo || null;

    // ✅ Find department logo safely
    let departmentLogo = null;

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

    // 🧾 Debug info
    console.log("✅ Marklist Debug:", {
      centreId,
      departmentName,
      institutionLogo,
      departmentLogo
    });

    // 4️⃣ Render page
    res.render('user/mark-list', {
      hideNavbar: true,
      studentId: req.params.id,
      student,
      logos: {
        institution: institutionLogo,
        department: departmentLogo
      },
      currentDate: new Date()
    });

  } catch (err) {
    console.error("❌ Error loading mark list:", err);
    res.status(500).send("Error loading mark list");
  }
});


// ✅ USER: Apply for Certificate
// ✅ Apply Certificate Route
router.get('/apply-certificate/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    // Mark certificate as applied
    await db.get()
      .collection(collection.BATCH_COLLECTION)
      .updateOne(
        { _id: new ObjectId(batchId) },
        { $set: { certificateApplied: true } }
      );

    console.log("✅ Certificate marked as applied for batch:", batchId);
    res.redirect('user/view-batch');
  } catch (err) {
    console.error("❌ Error applying certificate:", err);
    res.status(500).send("Error applying certificate");
  }
});


// ===============================
// Toggle certificate type - BATCH WISE
// ===============================
router.post('/toggle-certificate-batch/:batchId', verifyUserLogin, async (req, res) => {
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


// GET: Render course schedule form for a batch
// ==============================
router.get('/course-schedule/:batchId', verifyUserLogin, async (req, res) => {
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

    res.render('user/course-schedule', {
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
// POST: Save course schedule for the batch and redirect back
// ==============================
router.post('/course-schedule/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    const { startDate, endDate, examLocation } = req.body;

    if (!ObjectId.isValid(batchId)) {
      return res.status(400).send('Invalid Batch ID');
    }

    // ✅ Save the schedule in the batch
    await db.get().collection(collection.BATCH_COLLECTION).updateOne(
      { _id: new ObjectId(batchId) },
      { 
        $set: { 
          courseStartDate: startDate, 
          courseEndDate: endDate, 
          examLocation: examLocation 
        } 
      }
    );

    // ✅ Redirect to the batch list after saving
    res.redirect('/user/view-cbatch');

  } catch (error) {
    console.error('❌ Error saving schedule:', error);
    res.status(500).send('Error saving schedule');
  }
});
//edit-schedule
// =======================
// EDIT COURSE SCHEDULE - GET
// =======================
router.get('/edit-schedule/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    if (!batch) return res.status(404).send("Batch not found");

    res.render('user/edit-schedule', { 
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
router.post('/edit-schedule/:batchId', verifyUserLogin, async (req, res) => {
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
    res.redirect(`/user/view-cbatch/${batch.centreId}`);

  } catch (err) {
    console.error("❌ Error updating schedule:", err);
    res.status(500).send('Error updating schedule: ' + err.message);
  }
});

// GET - Add Supply Mark Page// GET - Add Supply Mark Page
router.get('/add-supply-mark/:id', verifyUserLogin, async (req, res) => {
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

    res.render('user/add-supply-mark', {
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
router.post('/add-supply-mark', verifyUserLogin, async (req, res) => {
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
    res.redirect('/user/combined-marklist/' + studentId);
    
  } catch (err) {
    console.error("❌ Error saving supply marks:", err);
    res.status(500).send("Error submitting supply marks");
  }
});

// Combined Marklist Route - FIXED
router.get('/combined-marklist/:id', verifyUserLogin, async (req, res) => {
  try {
    console.log("🔄 Combined marklist route accessed for:", req.params.id);
    
    const studentId = new ObjectId(req.params.id);
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: studentId });

    if (!student) return res.status(404).send("Student not found");
    if (!student.marks) return res.status(400).send("No regular marks found");
    if (!student.supplyMarks) return res.status(400).send("No supply marks found");

    console.log("✅ Student data loaded successfully");

    // Combine regular and supply marks
    const combinedSubjects = [];
    let maxTotal = 0;
    let obtainedTotal = 0;
    let allPassed = true;

    // Regular subjects (only PASSED)
    if (Array.isArray(student.marks.subjects)) {
      student.marks.subjects.forEach(subject => {
        if (subject.result === 'PASSED') {
          combinedSubjects.push({ ...subject, source: 'regular' });
          maxTotal += subject.totalMax || 0;
          obtainedTotal += subject.totalObt || 0;
        }
      });
    }

    // Supply subjects (PASSED + FAILED)
    if (Array.isArray(student.supplyMarks.subjects)) {
      student.supplyMarks.subjects.forEach(supplySubject => {
        combinedSubjects.push({ ...supplySubject, source: 'supply' });
        maxTotal += supplySubject.totalMax || 0;
        obtainedTotal += supplySubject.totalObt || 0;
        if (supplySubject.result === 'FAILED') allPassed = false;
      });
    }

    // Calculate percentage & grade
    const percentage = maxTotal > 0 ? (obtainedTotal / maxTotal) * 100 : 0;
    let grade = 'FAILED';

    if (allPassed) {
      if (percentage >= 80) grade = 'PASSED WITH A+ GRADE (EXCELLENT)';
      else if (percentage >= 70) grade = 'PASSED WITH A GRADE (VERY GOOD)';
      else if (percentage >= 60) grade = 'PASSED WITH B+ GRADE (GOOD)';
      else if (percentage >= 50) grade = 'PASSED WITH B GRADE (SATISFACTORY)';
      else if (percentage >= 40) grade = 'PASSED WITH C GRADE';
      else allPassed = false;
    }

    // Prepare combined marks object
    const combinedMarks = {
      ...student.marks,
      subjects: combinedSubjects,
      maxTotal,
      obtainedTotal,
      overallResult: allPassed ? 'PASSED' : 'FAILED',
      grade,
      totalWords: numberToWords(obtainedTotal),
      isCombined: true,
      combinedDate: new Date()
    };

    // ✅ Fetch logos
    const centreId = student.centreId;
    const departmentName = student.department; // 🔹 correct field name
    const centerData = await centerHelpers.getCenterById(centreId);

    // ✅ Fetch department logo properly
    const departmentLogo = await centerHelpers.getDepartmentLogo(centreId, departmentName);

    console.log("✅ Combined Marklist Debug:", {
      centreId,
      departmentName,
      institutionLogo: centerData?.institutionLogo,
      departmentLogo
    });

    // ✅ Render with both logos
    res.render('user/combined-marklist', {
      hideNavbar: true,
      studentId: req.params.id,
      student,
      combinedMarks,
      logoPath: centerData?.institutionLogo || '/images/default-institution-logo.png',
      departmentLogoPath: departmentLogo || '/images/default-department-logo.png',
      currentDate: new Date()
    });

  } catch (err) {
    console.error("❌ Error loading combined mark list:", err);
    res.status(500).send("Error loading combined mark list");
  }
});



// Helper function to convert number to words
function numberToWords(num) {
  if (num === 0) return 'ZERO';
  
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 
                'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  
  let words = '';
  
  if (num >= 1000) {
    words += ones[Math.floor(num / 1000)] + ' THOUSAND ';
    num %= 1000;
  }
  
  if (num >= 100) {
    words += ones[Math.floor(num / 100)] + ' HUNDRED ';
    num %= 100;
  }
  
  if (num >= 20) {
    words += tens[Math.floor(num / 10)] + ' ';
    num %= 10;
  }
  
  if (num > 0) {
    words += ones[num] + ' ';
  }
  
  return words.trim() + ' ONLY';
}
//supply marklist
// Supply Mark List Route - Shows ONLY supply marks

router.get('/supply-mark-list/:id', verifyUserLogin, async (req, res) => {
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
router.get('/add-sdstudent', verifyUserLogin, (req, res) => {
  res.render('user/add-sdstudent', { hideNavbar: true });
});
//post
router.post('/add-sdstudent', verifyUserLogin, async (req, res) => {
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
      res.redirect('/user/view-student');
    });
  } catch (error) {
    console.error("❌ Error adding student:", error);
    res.status(500).send("Error adding student");
  }
});

//time tableeeee

router.get('/add-timetable', verifyUserLogin, async (req, res) => {
  try {
    const centreId = req.session.centreId;   // ✅ Correct centre ID from session

    if (!centreId) {
      console.error("❌ No centreId found in session");
      return res.render('user/add-timetable', {
        hideNavbar: true,
        batches: []
      });
    }

    // ✅ Get batches for this centre ONLY
    const batches = await batchHelpers.getBatchesByCentre(centreId);

    res.render('user/add-timetable', {
      hideNavbar: true,
      batches   // ✅ This will now show in the dropdown
    });

  } catch (err) {
    console.error("❌ Error in /add-timetable route:", err);
    res.render('user/add-timetable', {
      hideNavbar: true,
      batches: []
    });
  }
});
//post of time table
// POST of timetable - FIXED VERSION
router.post('/save-timetable', verifyUserLogin, async (req, res) => {
  try {
    const centreId = req.session.centreId;

    if (!centreId) {
      return res.status(400).send("Centre ID missing in session");
    }

    console.log("📦 Form data received:", req.body);

    // Prepare schedule array from dynamic rows
    const schedule = [];
    
    // Check if we have array data (multiple rows)
    if (req.body['srNo[]'] && Array.isArray(req.body['srNo[]'])) {
      for (let i = 0; i < req.body['srNo[]'].length; i++) {
        schedule.push({
          srNo: parseInt(req.body['srNo[]'][i]) || 0,
          date: req.body['date[]'][i],
          time: req.body['time[]'][i],
          course: req.body['course[]'][i],
          year: parseInt(req.body['year[]'][i]) || 0,
          sem: req.body['sem[]'][i],
          paperName: req.body['paperName[]'][i]
        });
      }
    } else if (req.body.srNo) {
      // Handle single row case
      schedule.push({
        srNo: parseInt(req.body.srNo) || 0,
        date: req.body.date,
        time: req.body.time,
        course: req.body.course,
        year: parseInt(req.body.year) || 0,
        sem: req.body.sem,
        paperName: req.body.paperName
      });
    }

    // Prepare data for the helper function
    const timetableData = {
      centreId: centreId,
      batchId: req.body.batchId,           // This will be converted to ObjectId in helper
      courseName: req.body.courseName,
      semesterTitle: req.body.semesterTitle,
      examMonthYear: req.body.examMonthYear,
      notes: req.body.notes || "",
      schedule: schedule,                  // Changed from 'subjects' to 'schedule'
      createdAt: new Date(),
      status: 'active'
    };

    console.log("💾 Prepared timetable data:", timetableData);

    // Use the helper function to save
    const timetableId = await batchHelpers.addTimetable(timetableData);
    
    console.log("✅ Timetable saved with ID:", timetableId);
    
    // Redirect to view timetables
    res.redirect('/user/view-tbatch');

  } catch (err) {
    console.error("❌ Error saving timetable:", err);
    res.status(500).send("Server Error While Saving Timetable: " + err.message);
  }
});

router.get('/view-tbatch', verifyUserLogin, async (req, res) => {
  try {
    const centreId = req.session.centreId;

    if (!centreId) {
      return res.render('user/view-tbatch', { batches: [] });
    }

    console.log("📌 VIEW-TBATCH ROUTE HIT");
    console.log("👉 centreId:", centreId);

    // 1️⃣ Load all batches of this centre
    const batches = await batchHelpers.getBatchesByCentre(centreId);
    console.log(`📌 BATCHES LOADED (${batches.length})`);

    // 2️⃣ Load ALL timetables for this centre
    const timetables = await batchHelpers.getTimetablesByCentre(centreId);
    console.log(`📌 TIMETABLES LOADED (${timetables.length})`);

    // 3️⃣ Attach LAST timetable of each batch
    const batchData = batches.map(b => {
      const batchIdStr = b._id.toString();

      // find latest timetable
      const filtered = timetables
        .filter(t => t.batchId.toString() === batchIdStr)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

      // attach last timetable
      return {
        ...b,
        timetable: filtered.length > 0 ? filtered[0] : null
      };
    });

    console.log("📌 FINAL BATCH DATA SENT TO VIEW:");
    batchData.forEach(b => {
      console.log(`   • ${b.batchName} → timetable: ${b.timetable ? "YES" : "NO"}`);
    });

    // 4️⃣ Render page
    res.render('user/view-tbatch', {
      hideNavbar: true,
      batches: batchData
    });

  } catch (err) {
    console.error("❌ ERROR in /view-tbatch:", err);
    res.render('user/view-tbatch', { batches: [] });
  }
});


router.get('/preview-pdf/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log('📄 PDF GENERATION STARTED for batch:', batchId);

    // 1️⃣ Fetch batch and timetable
    const batch = await batchHelpers.getBatchById(batchId);
    const timetable = await batchHelpers.getTimetableByBatch(batchId);

    // 2️⃣ Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 size
    const { width, height } = page.getSize();

    // Embed fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 3️⃣ Add background image
    const bgPath = path.join(__dirname, '../public/images/time-table.jpg');
    if (fs.existsSync(bgPath)) {
      const bgBytes = fs.readFileSync(bgPath);
      const bgImage = await pdfDoc.embedJpg(bgBytes);
      page.drawImage(bgImage, { x: 0, y: 0, width, height });
    } else {
      page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    }

    // 4️⃣ Header
    let y = height - 80;
    page.drawText('MEDICAL EQUIPMENT AND RESPECT', { x: 50, y, size: 18, font: fontBold, color: rgb(1, 1, 1) });
    y -= 25;
    page.drawText('NATIONAL EDUCATION TRAINING & DEVELOPMENT', { x: 50, y, size: 14, font: fontBold, color: rgb(1, 1, 1) });
    y -= 25;
    page.drawText('TECHNICAL EMPLOYMENT TRAINING CENTER', { x: 50, y, size: 12, font: fontBold, color: rgb(0.95, 0.82, 0.21) });

    // 5️⃣ Main title
    y -= 50;
    page.drawText('EXAMINATION TIMETABLE / DATE SHEET', { x: 50, y, size: 20, font: fontBold, color: rgb(0, 0, 0) });
    y -= 30;

    // Batch info
    if (timetable?.courseName) page.drawText(`Course: ${timetable.courseName}`, { x: 50, y, size: 14, font: fontBold, color: rgb(0.07, 0.24, 0.41) });
    y -= 25;
    if (timetable?.semesterTitle) page.drawText(`Semester/Year: ${timetable.semesterTitle}`, { x: 50, y, size: 12, font: fontBold, color: rgb(0.07, 0.24, 0.41) });
    y -= 25;
    if (timetable?.examMonthYear) page.drawText(`Exam Month/Year: ${timetable.examMonthYear}`, { x: 50, y, size: 12, font: fontBold, color: rgb(0.07, 0.24, 0.41) });
    y -= 25;
    if (batch) page.drawText(`Batch: ${batch.batchName} (${batch.batchId})`, { x: 50, y, size: 12, font: fontBold, color: rgb(0.07, 0.24, 0.41) });
    y -= 40;

    // 6️⃣ Table header
    page.drawRectangle({ x: 40, y: y - 5, width: width - 80, height: 25, color: rgb(0.07, 0.24, 0.41) });
    const headers = ['SR. NO', 'DATE', 'TIME', 'COURSE', 'YEAR', 'SEM', 'PAPER NAME'];
    const headerX = [50, 100, 170, 240, 320, 370, 420];
    headers.forEach((h, i) => page.drawText(h, { x: headerX[i], y, size: 10, font: fontBold, color: rgb(1, 1, 1) }));
    y -= 30;

    // 7️⃣ Table rows
    const subjects = timetable?.subjects || [];
    if (subjects.length > 0) {
      subjects.forEach((subject, i) => {
        // Alternate row color
        if (i % 2 === 0) page.drawRectangle({ x: 40, y: y - 3, width: width - 80, height: 20, color: rgb(0.95, 0.95, 0.98) });

        // Safe text function
        const safeText = (val) => val ? val.toString() : '';

        const srNo = safeText(subject.srNo || i + 1);
        const date = safeText(Array.isArray(subject.date) ? subject.date[0] : subject.date);
        const time = safeText(Array.isArray(subject.time) ? subject.time[0] : subject.time);
        const course = safeText(Array.isArray(subject.course) ? subject.course[0] : subject.course);
        const year = safeText(subject.year);
        const sem = safeText(Array.isArray(subject.sem) ? subject.sem[0] : subject.sem);
        const paperName = safeText(Array.isArray(subject.paperName) ? subject.paperName[0] : subject.paperName);

        const displayPaper = paperName.length > 25 ? paperName.substring(0, 25) + '...' : paperName;

        const rowValues = [srNo, date, time, course, year, sem, displayPaper];
        rowValues.forEach((val, idx) => page.drawText(val, { x: headerX[idx], y, size: 9, font, color: rgb(0, 0, 0) }));

        y -= 25;
      });
    } else {
      page.drawText('No examination schedule available.', { x: 150, y, size: 14, font: fontBold, color: rgb(0.9, 0, 0) });
      y -= 30;
    }

    // 8️⃣ Notes section
    if (timetable?.notes) {
      y -= 20;
      page.drawRectangle({ x: 40, y: y - 30, width: width - 80, height: 120, color: rgb(0.98, 0.98, 0.95), borderColor: rgb(0.07, 0.24, 0.41), borderWidth: 1 });
      page.drawText('IMPORTANT NOTES:', { x: 50, y, size: 12, font: fontBold, color: rgb(0.9, 0, 0) });
      y -= 25;
      timetable.notes.split('\n').forEach(note => {
        if (note.trim()) {
          page.drawText('• ' + note.trim(), { x: 60, y, size: 10, font, color: rgb(0, 0, 0) });
          y -= 18;
        }
      });
    }

    // 9️⃣ Signatures
    y -= 50;
    page.drawLine({ start: { x: 100, y: y + 10 }, end: { x: 200, y: y + 10 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: 350, y: y + 10 }, end: { x: 500, y: y + 10 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawText('Principal', { x: 130, y, size: 11, font: fontBold, color: rgb(0, 0, 0) });
    page.drawText('Controller of Examinations', { x: 380, y, size: 11, font: fontBold, color: rgb(0, 0, 0) });

    // 10️⃣ Footer
    page.drawText('© Technical Employment Training Center', { x: 180, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText('Generated on: ' + new Date().toLocaleDateString(), { x: 200, y: 35, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

    // 11️⃣ Save and send PDF
    const pdfBytes = await pdfDoc.save();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename=timetable.pdf',
      'Content-Length': pdfBytes.length
    });

    res.send(pdfBytes);

  } catch (err) {
    console.error('❌ PDF Generation Error:', err);
    res.status(500).send(`
      <html>
        <head><title>PDF Error</title></head>
        <body style="font-family: Arial; padding: 20px;">
          <h1 style="color: red;">PDF Generation Failed</h1>
          <h3>Error Details:</h3>
          <p><strong>Message:</strong> ${err.message}</p>
          <pre style="background: #f5f5f5; padding: 10px;">${err.stack}</pre>
        </body>
      </html>
    `);
  }
});

router.get('/test-simple-pdf', async (req, res) => {
  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // SOLID RED BACKGROUND
    page.drawRectangle({
      x: 0, y: 0, width: 595, height: 842,
      color: rgb(1, 0, 0)
    });
    
    // LARGE BLACK TEXT
    page.drawText('CAN YOU SEE THIS?', {
      x: 100, y: 400,
      size: 30,
      font: fontBold,
      color: rgb(0, 0, 0)
    });
    
    page.drawText('PDF Generation Test', {
      x: 150, y: 350,
      size: 20,
      font: fontBold,
      color: rgb(0, 0, 0)
    });
    
    const pdfBytes = await pdfDoc.save();
    
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=test.pdf"
    });
    
    res.send(pdfBytes);
  } catch (err) {
    res.send('Error: ' + err.message);
  }
});
router.get("/test-pdf", async (req, res) => {
  try {
    const { PDFDocument, rgb } = require("pdf-lib");

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);

    page.drawText("PDF working!", {
      x: 50,
      y: 350,
      size: 30,
      color: rgb(1, 0, 0)
    });

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.log("PDF ERROR:", err);
    res.status(500).send("PDF Failed");
  }
});


module.exports = router;

