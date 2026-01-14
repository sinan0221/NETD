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
const mammoth = require("mammoth")
const multer = require('multer');
const crypto = require("crypto");
const nodemailer = require("nodemailer");


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
router.get('/forgot-password', (req, res) => {
  res.render('user/forgot-password');
});
router.post('/forgot-password', async (req, res) => {
  try {
    const { centreId } = req.body;

    const centre = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .findOne({ centreId });

    if (!centre || !centre.email) {
      return res.render('user/forgot-password', {
        err: "Centre not found or email not set"
      });
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP + expiry (10 mins)
    await db.get().collection(collection.CENTER_COLLECTION).updateOne(
      { _id: centre._id },
      {
        $set: {
          resetOtp: otp,
          resetOtpExpires: new Date(Date.now() + 10 * 60 * 1000)
        }
      }
    );

    // Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    

    await transporter.sendMail({
      to: centre.email,
      subject: "NETD Password Reset OTP",
      html: `<h3>Your OTP: ${otp}</h3><p>Valid for 10 minutes</p>`
    });

    res.redirect(`/user/verify-otp/${centre._id}`);

  } catch (err) {
    console.error(err);
    res.render('user/forgot-password', { err: "Something went wrong" });
  }
});
router.get('/verify-otp/:id', (req, res) => {
  res.render('user/verify-otp', { id: req.params.id });
});
router.post('/verify-otp/:id', async (req, res) => {
  try {
    const { otp } = req.body;

    const centre = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .findOne({ _id: new ObjectId(req.params.id) });

    if (
      !centre ||
      centre.resetOtp !== otp ||
      centre.resetOtpExpires < new Date()
    ) {
      return res.render('user/verify-otp', {
        id: req.params.id,
        err: "Invalid or expired OTP"
      });
    }

    res.redirect(`/user/reset-password/${centre._id}`);
  } catch (err) {
    console.error("❌ Verify OTP error:", err);
    res.status(500).send("Internal error");
  }
});

router.get('/reset-password/:id', async (req, res) => {
  res.render('user/reset-password', { id: req.params.id });
});
router.post('/reset-password/:id', async (req, res) => {
  try {
    const hashed = await bcrypt.hash(req.body.password, 10);

    const centre = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!centre) {
      return res.status(400).send("Invalid centre");
    }

    await db.get()
      .collection(collection.USER_COLLECTION)
      .updateOne(
        { centreId: centre.centreId },
        { $set: { password: hashed } }
      );

    await db.get()
      .collection(collection.CENTER_COLLECTION)
      .updateOne(
        { _id: centre._id },
        { $unset: { resetOtp: "", resetOtpExpires: "" } }
      );

    res.redirect('/user/login');

  } catch (err) {
    console.error("❌ Reset password error:", err);
    res.status(500).send("Error resetting password");
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



// router.get('/', verifyUserLogin, async (req, res) => {
//   try {
//     let user = req.session.user;
//     let centreId = req.session.centreId; // ✅ Saved during login

//     // 1️⃣ Get all batches belonging to this center
//     const batches = await batchHelpers.getBatchesByCentre(centreId);

//     // 2️⃣ Get all centers (with grade + stars automatically added by helper)
//     const centers = await centerHelpers.getAllCenters();

//     // 3️⃣ Find the logged-in user's center
//     const center = centers.find(c => c._id.toString() === centreId.toString());

//     // 4️⃣ Render the page with grade and stars
//     res.render('user/view-batch', {
//       batches,
//       user,
//       grade: center?.grade || '',
//       stars: center?.stars || '',
//       center
//     });

//   } catch (err) {
//     console.error("❌ Error loading batches:", err);
//     res.status(500).send("Error loading batches");
//   }
// });


router.get('/', verifyUserLogin, async (req, res) => {
  try {
    let user = req.session.user;
    let centreId = req.session.centreId;

    const centers = await centerHelpers.getAllCenters();
    const center = centers.find(c => c._id.toString() === centreId.toString());

    // Get stats (already includes pendingStudents)
    const stats = await batchHelpers.getDashboardStatsByCentre(centreId);

    res.render('user/dashboard', {
      user,
      center,
      grade: center?.grade || '',
      stars: center?.stars || '',
      stats,          // includes totalStudents, pendingStudents, activeBatches, inactiveBatches
      hideNavbar: true
    });

  } catch (err) {
    console.error("❌ Error loading dashboard:", err);
    res.status(500).send("Error loading dashboard");
  }
});


// router.get('/view-batch', verifyUserLogin, async (req, res) => {
//   try {
//     let user = req.session.user;
//     let centreId = req.session.centreId;

//     const batches = await batchHelpers.getBatchesByCentre(centreId);
//     const centers = await centerHelpers.getAllCenters();

//     const center = centers.find(c => c._id.toString() === centreId.toString());

//     res.render('user/view-batch', {
//       batches,
//       user,
//       grade: center?.grade || '',
//       stars: center?.stars || '',
//       center
//     });

//   } catch (err) {
//     console.error("❌ Error loading batches:", err);
//     res.status(500).send("Error loading batches");
//   }
// });


router.get('/view-batch', verifyUserLogin, async (req, res) => {
  try {
    let user = req.session.user;
    let centreId = req.session.centreId;

    let batches = await batchHelpers.getBatchesByCentre(centreId);
    const centers = await centerHelpers.getAllCenters();
    const center = centers.find(c => c._id.toString() === centreId.toString());

    batches = await Promise.all(
      batches.map(async (batch) => {

        const appliedCount = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .countDocuments({
            batchId: new ObjectId(batch._id), // ✅ FIX
            appliedForHallTicket: true
          });

        console.log(
          `👤 USER VIEW → Batch ${batch._id} | appliedCount = ${appliedCount}`
        );

        return {
          ...batch,
          appliedForHallTicket: appliedCount > 0
        };
      })
    );

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
// View INACTIVE Batches
// View INACTIVE Batches (User)
router.get('/inactive-batches', verifyUserLogin, async (req, res) => {
  try {
    let user = req.session.user;
    let centreId = req.session.centreId;

    // Get inactive batches for this centre
    const batches = await batchHelpers.getBatchesByStatusAndCentre(false, centreId);
    
    res.render('user/inactive-batches', {
      batches,
      user,
      pageTitle: 'Inactive Batches',
      hideNavbar:true
    });

  } catch (err) {
    console.error("❌ Error loading inactive batches:", err);
    res.status(500).send("Error loading inactive batches");
  }
});

//edit batch:
// edit batch (GET)
router.get('/edit-batch/:id', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.id;

    const batch = await batchHelpers.getBatchById(batchId);

    if (!batch) {
      return res.status(404).send("Batch not found");
    }

    res.render('user/edit-batch', {
      user: true,
      hideNavbar: true,
      batch
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
  try {
    // 🟢 Get centreId from SESSION (Mongo _id)
    const centreId = req.session.centreId;

    console.log("🟢 Session centreId:", centreId);

    if (!centreId) {
      return res.redirect('/user/login');
    }

    // 🟢 Use helper that expects Mongo _id
    const center = await centerHelpers.getCenterDetails(centreId);

    if (!center) {
      return res.status(404).send("Center not found");
    }

    // 🟢 Fetch batches using same centre _id
    const batches = await batchHelpers.getBatchesByCentre(centreId);

    res.render('user/add-student', {
      user: req.session.user,
      hideNavbar: true,

      // for form
      centreId: center.centreId,     // CTR001 (display)
      centreName: center.centreName,
      centre: center,
      department: center.department,
      courseNames: center.courseName,
      batches
    });

  } catch (err) {
    console.error("❌ Error loading add-student page:", err);
    res.status(500).send("Error loading add-student page");
  }
});



router.post('/add-student', verifyUserLogin, (req, res) => {
  try {
    // 🟢 Raw form data
    console.log("📥 Raw Form Data:", req.body);

    // 🟢 Prepare qualification objects
    let qualifications = [];

    // Check if data is coming as arrays or single values
    let eduArr = req.body['education[]'];
    let maxArr = req.body['maxMarks[]'];
    let minArr = req.body['minMarks[]'];
    let obtArr = req.body['obtainedMarks[]'];
    let gradeArr = req.body['grade[]'];
    let yearArr = req.body['year[]'];
    let boardArr = req.body['board[]'];

    // Convert to arrays if they're not already
    if (!Array.isArray(eduArr) && eduArr) {
      eduArr = [eduArr];
      maxArr = [maxArr];
      minArr = [minArr];
      obtArr = [obtArr];
      gradeArr = [gradeArr];
      yearArr = [yearArr];
      boardArr = [boardArr];
    }

    // Process qualifications
    if (eduArr && Array.isArray(eduArr)) {
      eduArr.forEach((edu, i) => {
        if (edu && edu.trim() !== '' && maxArr[i] && maxArr[i].toString().trim() !== '') {
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
    }

    console.log("🎓 Qualifications Parsed:", qualifications);
    console.log("🔢 Qualification count:", qualifications.length);

    // Merge qualifications into req.body
    let studentData = {
      ...req.body,
      qualifications
    };
    
    // Remove the array fields since we're passing them as structured objects
    delete studentData['education[]'];
    delete studentData['maxMarks[]'];
    delete studentData['minMarks[]'];
    delete studentData['obtainedMarks[]'];
    delete studentData['grade[]'];
    delete studentData['year[]'];
    delete studentData['board[]'];

    // Add additional fields
    studentData.activated = false;
    studentData.createdAt = new Date();
    
    // 🟢 IMPORTANT: Use the same field names expected by studentHelpers
    // The helper expects: education, maxMarks, minMarks, obtainedMarks, grade, year, board
    // But we're passing them as qualifications array
    
    console.log("📤 Student Data ready for insertion:", JSON.stringify(studentData, null, 2));

    // Call the helper with the data
    studentHelpers.addStudent(studentData, (insertedId) => {
      if (!insertedId) {
        console.error("❌ No ID returned from addStudent");
        return res.status(500).send("Error adding student");
      }
      
      console.log("✅ Student added with ID:", insertedId);
      
      // Save student image if uploaded
      if (req.files && req.files.image) {
        let imageFile = req.files.image;
        let uploadPath = path.join(__dirname, '../public/studentImages/', insertedId + '.jpg');

        imageFile.mv(uploadPath, (err) => {
          if (err) {
            console.error("❌ Error saving image:", err);
          } else {
            console.log("✅ Student image saved:", uploadPath);
          }
        });
      }
      
      // Redirect to registration form preview
      console.log("🔄 Redirecting to preview:", `/user/preview-registration/${insertedId}`);
      res.redirect(`/user/preview-registration/${insertedId}`);
    });

  } catch (err) {
    console.error("❌ Error in POST /add-student route:", err);
    res.status(500).send("Server error: " + err.message);
  }
});
// EDIT STUDENT ROUTE
router.get('/edit-student/:id', verifyUserLogin, async (req, res) => {
  try {
    const studentId = req.params.id;
    const centreId = req.session.centreId;
    
    console.log("🟢 Edit Student - Student ID:", studentId);
    console.log("🟢 Edit Student - Centre ID:", centreId);
    
    if (!centreId) {
      return res.redirect('/user/login');
    }
    
    // Fetch student details
    const student = await studentHelpers.getStudentById(studentId);
    
    if (!student) {
      console.log("❌ Student not found:", studentId);
      return res.status(404).send("Student not found");
    }
    
    console.log("🟢 Student data for edit:", {
      id: student._id,
      centreId: student.centreId,
      courseName: student.courseName,
      department: student.department,
      dob: student.dob,
      batchId: student.batchId
    });
    
    // Fetch centre details
    const centre = await centerHelpers.getCenterDetails(centreId);
    console.log("🟢 Center found:", { 
      centreId: centre.centreId, 
      department: centre.department,
      courseName: centre.courseName 
    });
    
    // Fetch batches for this centre
    const batches = await batchHelpers.getBatchesByCentre(centreId);
    
    // Get qualifications
    const qualifications = student.qualifications || [];
    
    res.render('user/edit-student', {
      user: req.session.user,
      hideNavbar: true,
      student: {
        id: student._id,
        admissionYear: student.admissionYear,
        mode: student.mode,
        centreId: student.centreId || [centreId],
        courseName: student.courseName,
        courseCode: student.courseCode,
        shortName: student.shortName,
        courseDuration: student.courseDuration,
        medium: student.medium,
        department: student.department,
        batchId: student.batchId,
        regNo: student.regNo,
        fullName: student.fullName,
        motherName: student.motherName,
        fatherName: student.fatherName,
        fatherOcc: student.fatherOcc,
        candOcc: student.candOcc,
        gender: student.gender,
        dob: student.dob,
        number: student.number,
        emerNum: student.emerNum,
        email: student.email,
        bpl: student.bpl,
        ph: student.ph,
        caste: student.caste,
        adharNo: student.adharNo,
        address: student.address,
        pinCode: student.pinCode,
        city: student.city,
        district: student.district,
        state: student.state,
        nationality: student.nationality,
        qualifications: qualifications,
        hasImage: student.hasImage || false
      },
      centre: centre,
      courseNames: centre.courseName || [],
      batches: batches || []
    });
    
  } catch (err) {
    console.error("❌ Error loading edit-student page:", err);
    res.status(500).send("Error loading edit-student page: " + err.message);
  }
});

// UPDATE STUDENT ROUTE
router.post('/update-student/:id', verifyUserLogin, async (req, res) => {
  try {
    const studentId = req.params.id;
    
    console.log("📥 Updating student:", studentId);
    console.log("📥 Update Data:", req.body);
    
    // Parse qualifications
    let qualifications = [];
    let eduArr = req.body['education[]'];
    let maxArr = req.body['maxMarks[]'];
    let minArr = req.body['minMarks[]'];
    let obtArr = req.body['obtainedMarks[]'];
    let gradeArr = req.body['grade[]'];
    let yearArr = req.body['year[]'];
    let boardArr = req.body['board[]'];
    
    // Convert to arrays if needed
    if (!Array.isArray(eduArr) && eduArr) {
      eduArr = [eduArr];
      maxArr = [maxArr];
      minArr = [minArr];
      obtArr = [obtArr];
      gradeArr = [gradeArr];
      yearArr = [yearArr];
      boardArr = [boardArr];
    }
    
    // Process qualifications
    if (eduArr && Array.isArray(eduArr)) {
      eduArr.forEach((edu, i) => {
        if (edu && edu.trim() !== '' && maxArr[i] && maxArr[i].toString().trim() !== '') {
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
    }
    
    // Prepare update data
    const updateData = {
      ...req.body,
      qualifications: qualifications
    };
    
    // Remove array fields
    delete updateData['education[]'];
    delete updateData['maxMarks[]'];
    delete updateData['minMarks[]'];
    delete updateData['obtainedMarks[]'];
    delete updateData['grade[]'];
    delete updateData['year[]'];
    delete updateData['board[]'];
    
    // Handle image upload
    if (req.files && req.files.image) {
      let imageFile = req.files.image;
      let uploadPath = path.join(__dirname, '../public/studentImages/', studentId + '.jpg');
      
      await imageFile.mv(uploadPath);
      console.log("✅ Student image updated:", uploadPath);
    }
    
    // Update student in database
    const result = await studentHelpers.updateStudent(studentId, updateData);
    
    if (result) {
      console.log("✅ Student updated successfully:", studentId);
      res.redirect('/user/view-students');
    } else {
      console.error("❌ Failed to update student");
      res.status(500).send("Failed to update student");
    }
    
  } catch (err) {
    console.error("❌ Error updating student:", err);
    res.status(500).send("Error updating student: " + err.message);
  }
});

// ===========================
// REGISTRATION FORM PREVIEW (COMPLETE FIXED VERSION)
// ===========================
router.get("/preview-registration/:id", verifyUserLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    console.log("📋 Generating PDF for student:", student.fullName);

    // 2️⃣ Load background image - check if it exists
    const bgPath = path.join(__dirname, "../public/images/registration-bg.jpg");
    let bgBytes = null;
    
    if (fs.existsSync(bgPath)) {
      bgBytes = fs.readFileSync(bgPath);
    } else {
      console.log("ℹ️ No background image found, creating plain PDF");
    }

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

    // 5️⃣ Page size (A4)
    const pageWidth = 8.27 * 72;  // A4 width in points
    const pageHeight = 11.69 * 72; // A4 height in points

    // ===========================
    // PAGE 1: MAIN REGISTRATION FORM
    // ===========================
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);

    // Background (if exists)
    if (bgBytes) {
      try {
        const bgImage = await pdfDoc.embedJpg(bgBytes);
        page1.drawImage(bgImage, { 
          x: 0, 
          y: 0, 
          width: pageWidth, 
          height: pageHeight 
        });
      } catch (err) {
        console.warn("⚠️ Background image error:", err.message);
      }
    }

    const { rgb } = require("pdf-lib");

    // ===========================
    // SAFE VALUE HELPER FUNCTION
    // ===========================
    const safeValue = (value) => {
      if (value === undefined || value === null) {
        return "N/A";
      }
      
      if (typeof value === 'number') {
        return isNaN(value) || value === 0 ? "N/A" : value.toString();
      }
      
      if (typeof value === 'boolean') {
        return value ? "Yes" : "No";
      }
      
      if (value instanceof Date) {
        return value.toLocaleDateString();
      }
      
      const strValue = String(value).trim();
      return strValue === "" ? "N/A" : strValue;
    };
    const currentDate = new Date();
    const issueDate = currentDate.toLocaleDateString('en-GB'); // Format: DD/MM/YYYY
  // ✅ Student Photo - WITH SIMPLE rotation check
const imageDir = path.join(__dirname, "../public/studentImages/");
const possibleExtensions = [".jpg", ".jpeg", ".png"];
let photoFound = false;

for (const ext of possibleExtensions) {
  const photoPath = path.join(imageDir, `${student._id}${ext}`);
  if (fs.existsSync(photoPath)) {
    try {
      console.log(`✅ Found student photo at: ${photoPath}`);
      let photoBytes = fs.readFileSync(photoPath);
      let photo;

      if (ext === ".png") {
        photo = await pdfDoc.embedPng(photoBytes);
      } else {
        // Try-catch for JPG embedding
        try {
          photo = await pdfDoc.embedJpg(photoBytes);
        } catch (jpgErr) {
          console.log("⚠️ Could not embed as JPG, trying different approach");
          // Alternative: create a placeholder or skip
          continue;
        }
      }

      // Student photo position - TRY DIFFERENT VALUES IF NOT VISIBLE
      page1.drawImage(photo, {
        x: 485.5,    // Try 50 if not visible
        y: 584.3,    // Try 50 if not visible  
        width: 71.8,
        height: 91.3,
      });

      photoFound = true;
      console.log(`✅ Photo drawn successfully`);
      break;
      
    } catch (photoError) {
      console.log("❌ Error in photo processing:", photoError.message);
      continue;
    }
  }
}
function drawTextCenteredAtX(page, text, centerX, y, font, size) {
  if (!text) return;

  const textWidth = font.widthOfTextAtSize(text, size);
  const x = centerX - textWidth / 2;

  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: rgb(0, 0, 0)
  });
}


    // ===========================
    // DRAW FIELD FUNCTION
    // ===========================
    const drawField = (label, value, x, y) => {
      const displayValue = safeValue(value);
      
      page1.drawText(`${label}`, {
        x: x,
        y: y,
        size: 9,
        font: arialBold,
        color: rgb(0, 0, 0)
      });
      
      page1.drawText(displayValue, {
        x: x + 100,
        y: y,
        size: 9,
        font: arial,
        color: rgb(0.3, 0.3, 0.3) // softer black
      });
      
    };

    // ===========================
    // PAGE 1 CONTENT
    // ===========================
    
    // Registration Number (top right)
    drawField("", student.regNo, 405, 817.3);  
    
    // ACADEMIC DETAILS
    const [startYear, endYear] = (student.admissionYear || "").split("-");

    drawField("", startYear, 85, 669);

    drawField("", endYear, 160, 669);
    
    

    drawField("", student.mode, 267, 669);
    // drawField("", student.centreId, 76, 649.5);
    const centreId = Array.isArray(student.centreId)
    ? student.centreId[0]
    : student.centreId;
    const centre = await db.get()
    .collection(collection.CENTER_COLLECTION)
    .findOne({ centreId: centreId });
    const centreName = centre?.centreName || "N/A";
    drawField("", `${centreName} / ${centreId}`, 76, 649.5);


    drawField("", student.courseName, 76, 629.5);
    drawField("", student.courseCode, 76, 608.5);
    drawField("", student.courseDuration, 76, 590);
    drawField("", student.shortName, 297, 609);
    drawField("", student.medium, 285, 590);
    drawField("", student.department, 76, 550.2);
    const batchId = student.batchId;
    const batch = await batchHelpers.getBatchById(batchId);

    const batchName = batch?.batchName || "N/A";
    
    drawField("", batchName, 76, 570);

  

    // PERSONAL DETAILS
    drawField("", student.fullName, 33, 519);
    drawField("", student.fatherName, 33, 501);
    drawField("", student.motherName, 33, 484);
    const gender = (student.gender || "").trim().toLowerCase();
    const yGender = 449;

    const MALE_X   = 296;
    const FEMALE_X = 210;
    const OTHER_X  = 280;
    if (gender === "male") {
      drawField("", "X", MALE_X, yGender);
    } else if (gender === "female") {
      drawField("", "X", FEMALE_X, yGender);
    } else if (gender === "other") {
      drawField("", "X", OTHER_X, yGender);
    }
        
    
    // drawField("", student.dob, 48, 465);
    const dobStr = student.dob;

    if (dobStr) {
      const dob = new Date(dobStr);
      const today = new Date();
    
      // DOB → DD-MM-YYYY
      const day = String(dob.getDate()).padStart(2, "0");
      const month = String(dob.getMonth() + 1).padStart(2, "0");
      const year = dob.getFullYear();
      const formattedDOB = `${day}-${month}-${year}`;
    
      // Age calculation
      let years = today.getFullYear() - year;
      let months = today.getMonth() - dob.getMonth();
    
      if (today.getDate() < dob.getDate()) {
        months--;
      }
      if (months < 0) {
        years--;
        months += 12;
      }
    
      const yPos = 466.2;
    
      // ✅ Draw each value in its own column
      drawField("", formattedDOB, 33, yPos);   // DOB column
      drawField("", years.toString(), 163.5, yPos);  // Years column
      drawField("", months.toString(), 230, yPos); // Months column
    }
    

    drawField("", student.number, 33, 449);
    drawField("", student.emerNum, 33, 431);
    drawField("", student.candOcc, 33, 414);
    drawField("", student.fatherOcc, 33, 398);
    drawField("", student.adharNo, 33, 362.5);
    drawField("", student.address, 33, 347.5);
    drawField("", `${student.district}, ${student.city}`, 33, 330);

    
    const bpl = (student.bpl || "").trim().toLowerCase();

    const yBPL = 413;

    const YES_X = 350;
    const NO_X  = 296;
    if (bpl === "yes") {
      drawField("", "X", YES_X, yBPL);
    } else if (bpl === "no") {
      drawField("", "X", NO_X, yBPL);
    }
        
   
    const ph = (student.ph || "").trim().toLowerCase();
    const yPH = 397;

    if (student.ph === "Yes") {
      drawField("", "X", 350, 397);
    } else if (student.ph === "No") {
      drawField("", "X", 296, 397);
    }
    

    
    const caste = (student.caste || "").trim().toLowerCase();
const yCaste = 379;

if (caste === "gen") {
  drawField("", "X", 47, yCaste);
} else if (caste === "obc") {
  drawField("", "X", 88.5, yCaste);
} else if (caste === "sc") {
  drawField("", "X", 130, yCaste);
} else if (caste === "st") {
  drawField("", "X", 162, yCaste);
} else if (caste === "other") {
  drawField("", "X", 213, yCaste);
}

    drawField("", student.pinCode, 300.5, 362);
    drawField("", student.state, 300.5, 330.5);
    drawField("", student.nationality, 300.5, 378.7);
    drawField("", student.regNo, 110, 26);

    drawField("", student.email, 300.5, 431);
   //declaration
 
  drawTextCenteredAtX(
    page1,
    safeValue(student.fullName),
    100,     // 👈 center point for student name
    156,
    arial,
    9
  );
  
  drawTextCenteredAtX(
    page1,
    safeValue(student.fatherName),
    280,     // 👈 center point for father name
    156,
    arial,
    9
  );
  
   drawField("", issueDate, -44, 93);
   drawField("", student.city, -44, 80);
   let activatedDateText = "";

   if (student.activatedDate) {
     const d = new Date(student.activatedDate);
   
     const day = String(d.getDate()).padStart(2, "0");
     const month = String(d.getMonth() + 1).padStart(2, "0");
     const year = d.getFullYear();
   
     activatedDateText = `${day}-${month}-${year}`;
   }
   
   // Draw the field with activated date
   drawField("apd", activatedDateText, -54, 26);
   // ===========================
// QUALIFICATIONS → PDF (VALUES ONLY)
// ===========================

let y = 280;        // start Y
const gap = 15.3;

(student.qualifications || []).forEach((q) => {

  

  page1.drawText(q.maxMarks?.toString() || '', {
    x: 135,
    y,
    size: 9,
    font: arial
  });

  page1.drawText(q.minMarks?.toString() || '', {
    x: 190,
    y,
    size: 9,
    font: arial
  });

  page1.drawText(q.obtainedMarks?.toString() || '', {
    x: 245,
    y,
    size: 9,
    font: arial
  });

  page1.drawText(q.grade || '', {
    x: 290,
    y,
    size: 9,
    font: arial
  });

  page1.drawText(q.year || '', {
    x: 343,
    y,
    size: 9,
    font: arial
  });

  page1.drawText(q.board || '', {
    x: 400,
    y,
    size: 9,
    font: arial,
    maxWidth: 140
  });

  y -= gap;
});


   
    // ===========================
    // PAGE 2: SDECLARE.JPG (Student Declaration)
    // ===========================
    const page2 = pdfDoc.addPage([pageWidth, pageHeight]);

    try {
      const sdeclarePath = path.join(__dirname, "../public/images/sdeclare.jpg");
      if (fs.existsSync(sdeclarePath)) {
        const sdeclareBytes = fs.readFileSync(sdeclarePath);
        const sdeclareImage = await pdfDoc.embedJpg(sdeclareBytes);
        page2.drawImage(sdeclareImage, { 
          x: 0, 
          y: 0, 
          width: pageWidth, 
          height: pageHeight 
        });

        // Declaration page – centered fields
drawTextCenteredAtX(
  page2,
  safeValue(student.fullName),
  165,                 // 👈 center position
  pageHeight - 94,
  arial,
  9
);

drawTextCenteredAtX(
  page2,
  safeValue(student.fatherName),
  420,                 // 👈 center position
  pageHeight - 94,
  arial,
  9
);

drawTextCenteredAtX(
  page2,
  safeValue(student.courseName),
  115,
  pageHeight - 115,
  arial,
  9
);

drawTextCenteredAtX(
  page2,
  safeValue(student.courseDuration),
  285,
  pageHeight - 115,
  arial,
  9
);

drawTextCenteredAtX(
  page2,
  safeValue(student.department),
  465,
  pageHeight - 115,
  arial,
  9
);

       
const fontSize = 9;
const maxWidth = 200; // 🔴 adjust this value to fit your layout
const address = safeValue(student.address);
function splitTextByWidth(text, font, fontSize, maxWidth) {
  const words = text.split(' ');
  let line1 = '';
  let line2 = '';

  for (let i = 0; i < words.length; i++) {
    const testLine = line1 ? line1 + ' ' + words[i] : words[i];
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth <= maxWidth) {
      line1 = testLine;
    } else {
      line2 = words.slice(i).join(' ');
      break;
    }
  }

  return { line1, line2 };
}
const { line1, line2 } = splitTextByWidth(
  address,
  arial,
  fontSize,
  145 // same maxWidth
);

page2.drawText(line1, {
  x: 435,
  y: pageHeight - 137,
  size: fontSize,
  font: arial,
  color: rgb(0, 0, 0)
});

page2.drawText(line2, {
  x: 36,
  y: pageHeight - 160,
  size: fontSize,
  font: arial,
  color: rgb(0, 0, 0)
});

        page2.drawText(` ${safeValue(student.pinCode)}`, {
          x: 321,
          y: pageHeight - 160,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        page2.drawText(` ${safeValue(student.number)}`, {
          x: 450,
          y: pageHeight - 160,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
      } else {
        console.log("ℹ️ sdeclare.jpg not found, creating text declaration");
        page2.drawText("STUDENT DECLARATION", {
          x: pageWidth / 2 - 80,
          y: pageHeight - 100,
          size: 18,
          font: arialBold,
          color: rgb(0, 0, 0)
        });

        const declarationText = `I, ${safeValue(student.fullName)}, son/daughter of ${safeValue(student.fatherName)}, hereby declare that all information provided in this registration form is true and correct to the best of my knowledge.`;
        
        page2.drawText(declarationText, {
          x: 45,
          y: pageHeight - 150,
          size: 12,
          font: arial,
          color: rgb(0, 0, 0),
          maxWidth: pageWidth - 90
        });
      }
    } catch (err) {
      console.warn("⚠️ Error loading sdeclare.jpg:", err.message);
    }

    // ===========================
    // PAGE 3: PDECLARE.JPG (Parent/Guardian Declaration)
    // ===========================
    const page3 = pdfDoc.addPage([pageWidth, pageHeight]);

    try {
      const pdeclarePath = path.join(__dirname, "../public/images/pdeclare.jpg");
      if (fs.existsSync(pdeclarePath)) {
        const pdeclareBytes = fs.readFileSync(pdeclarePath);
        const pdeclareImage = await pdfDoc.embedJpg(pdeclareBytes);
        page3.drawImage(pdeclareImage, { 
          x: 0, 
          y: 0, 
          width: pageWidth, 
          height: pageHeight 
        });

        // Add student details on the parent declaration page
        page3.drawText(` ${safeValue(issueDate)}`, {
          x: 65,
          y: pageHeight - 421.8,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        page3.drawText(` ${safeValue(student.city)}`, {
          x: 65,
          y: pageHeight - 450.8,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });

        page3.drawText(` ${safeValue(student.fatherName)}`, {
          x: 70,
          y: pageHeight - 598,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        
        page3.drawText(` ${safeValue(issueDate)}`, {
          x: 65,
          y: pageHeight - 706.5,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        page3.drawText(` ${safeValue(student.city)}`, {
          x: 65,
          y: pageHeight - 733.5,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });

      
      } else {
        console.log("ℹ️ pdeclare.jpg not found, creating text declaration");
        page3.drawText("PARENT/GUARDIAN DECLARATION", {
          x: pageWidth / 2 - 120,
          y: pageHeight - 100,
          size: 18,
          font: arialBold,
          color: rgb(0, 0, 0)
        });

        const parentDeclaration = `I, ${safeValue(student.fatherName)}/${safeValue(student.motherName)}, parent/guardian of ${safeValue(student.fullName)}, hereby declare that I have read and understood all the terms and conditions and give my consent for the admission.`;
        
        page3.drawText(parentDeclaration, {
          x: 45,
          y: pageHeight - 150,
          size: 12,
          font: arial,
          color: rgb(0, 0, 0),
          maxWidth: pageWidth - 90
        });
      }
    } catch (err) {
      console.warn("⚠️ Error loading pdeclare.jpg:", err.message);
    }

    // ===========================
    // OUTPUT PDF AS PREVIEW
    // ===========================
    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    res.send(`
      <html>
        <head>
          <title>Registration Form Preview</title>
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

            .back-btn {
              position: fixed;
              top: 70px;
              left: 20px;
              background: #6c757d;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: 0.3s;
              z-index: 1001;
            }

            .back-btn:hover {
              background: #545b62;
              transform: translateY(-2px);
            }
          </style>
        </head>
        <body>
          <div class="header">Registration Form Preview - ${safeValue(student.fullName)}</div>
          <a href="/user/view-student" class="back-btn">← Back to Students</a>
          <a href="/user/download-registration/${studentId}" class="download-btn">
            📥 Download PDF
          </a>
          <iframe src="data:application/pdf;base64,${base64}"></iframe>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ Error generating registration form preview:", err);
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            .error { background: #ffe6e6; border: 1px solid #ff9999; padding: 20px; border-radius: 5px; }
            .back-btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #2a3d66; color: white; text-decoration: none; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>Error Generating PDF Preview</h2>
            <p>${err.message}</p>
            <a href="/user/all-students" class="back-btn">← Back to Students</a>
          </div>
        </body>
      </html>
    `);
  }
});
// ===========================
// DOWNLOAD REGISTRATION FORM (PDF) - WITH UPDATED COORDINATES
// ===========================
router.get("/download-registration/:id", verifyUserLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    console.log("📥 Downloading PDF for student:", student.fullName);

    // 2️⃣ Load background image - check if it exists
    const bgPath = path.join(__dirname, "../public/images/registration-bg.jpg");
    let bgBytes = null;
    
    if (fs.existsSync(bgPath)) {
      bgBytes = fs.readFileSync(bgPath);
    } else {
      console.log("ℹ️ No background image found, creating plain PDF");
    }

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

    // 5️⃣ Page size (A4)
    const pageWidth = 8.27 * 72;  // A4 width in points
    const pageHeight = 11.69 * 72; // A4 height in points

    // ===========================
    // PAGE 1: MAIN REGISTRATION FORM
    // ===========================
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);

    // Background (if exists)
    if (bgBytes) {
      try {
        const bgImage = await pdfDoc.embedJpg(bgBytes);
        page1.drawImage(bgImage, { 
          x: 0, 
          y: 0, 
          width: pageWidth, 
          height: pageHeight 
        });
      } catch (err) {
        console.warn("⚠️ Background image error:", err.message);
      }
    }

    const { rgb } = require("pdf-lib");

    // ===========================
    // SAFE VALUE HELPER FUNCTION
    // ===========================
    const safeValue = (value) => {
      if (value === undefined || value === null) {
        return "N/A";
      }
      
      if (typeof value === 'number') {
        return isNaN(value) || value === 0 ? "N/A" : value.toString();
      }
      
      if (typeof value === 'boolean') {
        return value ? "Yes" : "No";
      }
      
      if (value instanceof Date) {
        return value.toLocaleDateString();
      }
      
      const strValue = String(value).trim();
      return strValue === "" ? "N/A" : strValue;
    };
    const currentDate = new Date();
    const issueDate = currentDate.toLocaleDateString('en-GB'); // Format: DD/MM/YYYY
    
    // ✅ Student Photo - WITH SIMPLE rotation check
    const imageDir = path.join(__dirname, "../public/studentImages/");
    const possibleExtensions = [".jpg", ".jpeg", ".png"];
    let photoFound = false;

    for (const ext of possibleExtensions) {
      const photoPath = path.join(imageDir, `${student._id}${ext}`);
      if (fs.existsSync(photoPath)) {
        try {
          console.log(`✅ Found student photo at: ${photoPath}`);
          let photoBytes = fs.readFileSync(photoPath);
          let photo;

          if (ext === ".png") {
            photo = await pdfDoc.embedPng(photoBytes);
          } else {
            // Try-catch for JPG embedding
            try {
              photo = await pdfDoc.embedJpg(photoBytes);
            } catch (jpgErr) {
              console.log("⚠️ Could not embed as JPG, trying different approach");
              continue;
            }
          }

          // Student photo position
          page1.drawImage(photo, {
            x: 485.5,
            y: 584.3,
            width: 71.8,
            height: 91.3,
          });

          photoFound = true;
          console.log(`✅ Photo drawn successfully`);
          break;
          
        } catch (photoError) {
          console.log("❌ Error in photo processing:", photoError.message);
          continue;
        }
      }
    }

    function drawTextCenteredAtX(page, text, centerX, y, font, size) {
      if (!text) return;

      const textWidth = font.widthOfTextAtSize(text, size);
      const x = centerX - textWidth / 2;

      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: rgb(0, 0, 0)
      });
    }

    // ===========================
    // DRAW FIELD FUNCTION
    // ===========================
    const drawField = (label, value, x, y) => {
      const displayValue = safeValue(value);
      
      page1.drawText(`${label}`, {
        x: x,
        y: y,
        size: 9,
        font: arialBold,
        color: rgb(0, 0, 0)
      });
      
      page1.drawText(displayValue, {
        x: x + 100,
        y: y,
        size: 9,
        font: arial,
        color: rgb(0.3, 0.3, 0.3) // softer black
      });
      
    };

    // ===========================
    // PAGE 1 CONTENT
    // ===========================
    
    // Registration Number (top right)
    drawField("", student.regNo, 405, 817.3);  
    
    // ACADEMIC DETAILS
    const [startYear, endYear] = (student.admissionYear || "").split("-");

    drawField("", startYear, 85, 669);
    drawField("", endYear, 160, 669);
    drawField("", student.mode, 267, 669);
    
    const centreId = Array.isArray(student.centreId)
      ? student.centreId[0]
      : student.centreId;
    const centre = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .findOne({ centreId: centreId });
    const centreName = centre?.centreName || "N/A";
    drawField("", `${centreName} / ${centreId}`, 76, 649.5);

    drawField("", student.courseName, 76, 629.5);
    drawField("", student.courseCode, 76, 608.5);
    drawField("", student.courseDuration, 76, 590);
    drawField("", student.shortName, 297, 609);
    drawField("", student.medium, 285, 590);
    drawField("", student.department, 76, 550.2);
    
    const batchId = student.batchId;
    const batch = await batchHelpers.getBatchById(batchId);
    const batchName = batch?.batchName || "N/A";
    drawField("", batchName, 76, 570);

    // PERSONAL DETAILS
    drawField("", student.fullName, 33, 519);
    drawField("", student.fatherName, 33, 501);
    drawField("", student.motherName, 33, 484);
    
    const gender = (student.gender || "").trim().toLowerCase();
    const yGender = 449;
    const MALE_X = 296;
    const FEMALE_X = 210;
    const OTHER_X = 280;
    if (gender === "male") {
      drawField("", "X", MALE_X, yGender);
    } else if (gender === "female") {
      drawField("", "X", FEMALE_X, yGender);
    } else if (gender === "other") {
      drawField("", "X", OTHER_X, yGender);
    }
    
    const dobStr = student.dob;
    if (dobStr) {
      const dob = new Date(dobStr);
      const today = new Date();
      
      // DOB → DD-MM-YYYY
      const day = String(dob.getDate()).padStart(2, "0");
      const month = String(dob.getMonth() + 1).padStart(2, "0");
      const year = dob.getFullYear();
      const formattedDOB = `${day}-${month}-${year}`;
      
      // Age calculation
      let years = today.getFullYear() - year;
      let months = today.getMonth() - dob.getMonth();
      
      if (today.getDate() < dob.getDate()) {
        months--;
      }
      if (months < 0) {
        years--;
        months += 12;
      }
      
      const yPos = 466.2;
      
      // ✅ Draw each value in its own column
      drawField("", formattedDOB, 33, yPos);   // DOB column
      drawField("", years.toString(), 163.5, yPos);  // Years column
      drawField("", months.toString(), 230, yPos); // Months column
    }

    drawField("", student.number, 33, 449);
    drawField("", student.emerNum, 33, 431);
    drawField("", student.candOcc, 33, 414);
    drawField("", student.fatherOcc, 33, 398);
    drawField("", student.adharNo, 33, 362.5);
    drawField("", student.address, 33, 347.5);
    drawField("", `${student.district}, ${student.city}`, 33, 330);

    const bpl = (student.bpl || "").trim().toLowerCase();
    const yBPL = 413;
    const YES_X = 350;
    const NO_X = 296;
    if (bpl === "yes") {
      drawField("", "X", YES_X, yBPL);
    } else if (bpl === "no") {
      drawField("", "X", NO_X, yBPL);
    }

    const ph = (student.ph || "").trim().toLowerCase();
    const yPH = 397;
    if (student.ph === "Yes") {
      drawField("", "X", 350, 397);
    } else if (student.ph === "No") {
      drawField("", "X", 296, 397);
    }

    const caste = (student.caste || "").trim().toLowerCase();
    const yCaste = 379;
    if (caste === "gen") {
      drawField("", "X", 47, yCaste);
    } else if (caste === "obc") {
      drawField("", "X", 88.5, yCaste);
    } else if (caste === "sc") {
      drawField("", "X", 130, yCaste);
    } else if (caste === "st") {
      drawField("", "X", 162, yCaste);
    } else if (caste === "other") {
      drawField("", "X", 213, yCaste);
    }

    drawField("", student.pinCode, 300.5, 362);
    drawField("", student.state, 300.5, 330.5);
    drawField("", student.nationality, 300.5, 378.7);
    drawField("", student.regNo, 110, 26);
    drawField("", student.email, 300.5, 431);
    
    // Declaration
    drawTextCenteredAtX(
      page1,
      safeValue(student.fullName),
      100,
      156,
      arial,
      9
    );
    
    drawTextCenteredAtX(
      page1,
      safeValue(student.fatherName),
      280,
      156,
      arial,
      9
    );
    
    drawField("", issueDate, -44, 93);
    drawField("", student.city, -44, 80);
    
    let activatedDateText = "";
    if (student.activatedDate) {
      const d = new Date(student.activatedDate);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      activatedDateText = `${day}-${month}-${year}`;
    }
    
    drawField("apd", activatedDateText, -54, 26);
    
    // ===========================
    // QUALIFICATIONS → PDF (VALUES ONLY)
    // ===========================
    let y = 280; // start Y
    const gap = 15.3;

    (student.qualifications || []).forEach((q) => {
      page1.drawText(q.maxMarks?.toString() || '', {
        x: 135,
        y,
        size: 9,
        font: arial
      });

      page1.drawText(q.minMarks?.toString() || '', {
        x: 190,
        y,
        size: 9,
        font: arial
      });

      page1.drawText(q.obtainedMarks?.toString() || '', {
        x: 245,
        y,
        size: 9,
        font: arial
      });

      page1.drawText(q.grade || '', {
        x: 290,
        y,
        size: 9,
        font: arial
      });

      page1.drawText(q.year || '', {
        x: 343,
        y,
        size: 9,
        font: arial
      });

      page1.drawText(q.board || '', {
        x: 400,
        y,
        size: 9,
        font: arial,
        maxWidth: 140
      });

      y -= gap;
    });

    // ===========================
    // PAGE 2: SDECLARE.JPG (Student Declaration)
    // ===========================
    const page2 = pdfDoc.addPage([pageWidth, pageHeight]);

    try {
      const sdeclarePath = path.join(__dirname, "../public/images/sdeclare.jpg");
      if (fs.existsSync(sdeclarePath)) {
        const sdeclareBytes = fs.readFileSync(sdeclarePath);
        const sdeclareImage = await pdfDoc.embedJpg(sdeclareBytes);
        page2.drawImage(sdeclareImage, { 
          x: 0, 
          y: 0, 
          width: pageWidth, 
          height: pageHeight 
        });

        // Declaration page – centered fields
        drawTextCenteredAtX(
          page2,
          safeValue(student.fullName),
          165,
          pageHeight - 94,
          arial,
          9
        );

        drawTextCenteredAtX(
          page2,
          safeValue(student.fatherName),
          420,
          pageHeight - 94,
          arial,
          9
        );

        drawTextCenteredAtX(
          page2,
          safeValue(student.courseName),
          115,
          pageHeight - 115,
          arial,
          9
        );

        drawTextCenteredAtX(
          page2,
          safeValue(student.courseDuration),
          285,
          pageHeight - 115,
          arial,
          9
        );

        drawTextCenteredAtX(
          page2,
          safeValue(student.department),
          465,
          pageHeight - 115,
          arial,
          9
        );

        const fontSize = 9;
        const maxWidth = 200;
        const address = safeValue(student.address);
        
        function splitTextByWidth(text, font, fontSize, maxWidth) {
          const words = text.split(' ');
          let line1 = '';
          let line2 = '';

          for (let i = 0; i < words.length; i++) {
            const testLine = line1 ? line1 + ' ' + words[i] : words[i];
            const testWidth = font.widthOfTextAtSize(testLine, fontSize);

            if (testWidth <= maxWidth) {
              line1 = testLine;
            } else {
              line2 = words.slice(i).join(' ');
              break;
            }
          }

          return { line1, line2 };
        }
        
        const { line1, line2 } = splitTextByWidth(
          address,
          arial,
          fontSize,
          145
        );

        page2.drawText(line1, {
          x: 435,
          y: pageHeight - 137,
          size: fontSize,
          font: arial,
          color: rgb(0, 0, 0)
        });

        page2.drawText(line2, {
          x: 36,
          y: pageHeight - 160,
          size: fontSize,
          font: arial,
          color: rgb(0, 0, 0)
        });

        page2.drawText(` ${safeValue(student.pinCode)}`, {
          x: 321,
          y: pageHeight - 160,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        
        page2.drawText(` ${safeValue(student.number)}`, {
          x: 450,
          y: pageHeight - 160,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
      } else {
        console.log("ℹ️ sdeclare.jpg not found, creating text declaration");
        page2.drawText("STUDENT DECLARATION", {
          x: pageWidth / 2 - 80,
          y: pageHeight - 100,
          size: 18,
          font: arialBold,
          color: rgb(0, 0, 0)
        });

        const declarationText = `I, ${safeValue(student.fullName)}, son/daughter of ${safeValue(student.fatherName)}, hereby declare that all information provided in this registration form is true and correct to the best of my knowledge.`;
        
        page2.drawText(declarationText, {
          x: 45,
          y: pageHeight - 150,
          size: 12,
          font: arial,
          color: rgb(0, 0, 0),
          maxWidth: pageWidth - 90
        });
      }
    } catch (err) {
      console.warn("⚠️ Error loading sdeclare.jpg:", err.message);
    }

    // ===========================
    // PAGE 3: PDECLARE.JPG (Parent/Guardian Declaration) - WITH UPDATED COORDINATES
    // ===========================
    const page3 = pdfDoc.addPage([pageWidth, pageHeight]);

    try {
      const pdeclarePath = path.join(__dirname, "../public/images/pdeclare.jpg");
      if (fs.existsSync(pdeclarePath)) {
        const pdeclareBytes = fs.readFileSync(pdeclarePath);
        const pdeclareImage = await pdfDoc.embedJpg(pdeclareBytes);
        page3.drawImage(pdeclareImage, { 
          x: 0, 
          y: 0, 
          width: pageWidth, 
          height: pageHeight 
        });

        // Add student details on the parent declaration page - USING YOUR UPDATED COORDINATES
        page3.drawText(` ${safeValue(issueDate)}`, {
          x: 65,
          y: pageHeight - 421.8,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        
        page3.drawText(` ${safeValue(student.city)}`, {
          x: 65,
          y: pageHeight - 450.8,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });

        page3.drawText(` ${safeValue(student.fatherName)}`, {
          x: 70,
          y: pageHeight - 598,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        
        page3.drawText(` ${safeValue(issueDate)}`, {
          x: 65,
          y: pageHeight - 706.5,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });
        
        page3.drawText(` ${safeValue(student.city)}`, {
          x: 65,
          y: pageHeight - 733.5,
          size: 9,
          font: arial,
          color: rgb(0, 0, 0)
        });

      } else {
        console.log("ℹ️ pdeclare.jpg not found, creating text declaration");
        page3.drawText("PARENT/GUARDIAN DECLARATION", {
          x: pageWidth / 2 - 120,
          y: pageHeight - 100,
          size: 18,
          font: arialBold,
          color: rgb(0, 0, 0)
        });

        const parentDeclaration = `I, ${safeValue(student.fatherName)}/${safeValue(student.motherName)}, parent/guardian of ${safeValue(student.fullName)}, hereby declare that I have read and understood all the terms and conditions and give my consent for the admission.`;
        
        page3.drawText(parentDeclaration, {
          x: 45,
          y: pageHeight - 150,
          size: 12,
          font: arial,
          color: rgb(0, 0, 0),
          maxWidth: pageWidth - 90
        });
      }
    } catch (err) {
      console.warn("⚠️ Error loading pdeclare.jpg:", err.message);
    }

    // ===========================
    // OUTPUT PDF FOR DOWNLOAD
    // ===========================
    const pdfBytes = await pdfDoc.save();
    
    // Set headers for download
    const fileName = `Registration_Form_${student.regNo || student._id}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    // Send the PDF as a download
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error downloading registration form:", err);
    
    // Send error response
    res.status(500).send(`
      <html>
        <head>
          <title>Download Error</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              padding: 40px; 
              text-align: center; 
              background: #f5f5f5;
            }
            .error { 
              background: #ffe6e6; 
              border: 1px solid #ff9999; 
              padding: 30px; 
              border-radius: 10px;
              max-width: 600px;
              margin: 0 auto;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            h2 { color: #d32f2f; margin-top: 0; }
            .back-btn { 
              display: inline-block; 
              margin-top: 20px; 
              padding: 12px 24px; 
              background: #2a3d66; 
              color: white; 
              text-decoration: none; 
              border-radius: 5px;
              font-weight: bold;
              transition: background 0.3s;
            }
            .back-btn:hover {
              background: #1d2a47;
            }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>Error Downloading PDF</h2>
            <p><strong>Message:</strong> ${err.message}</p>
            <p>Please try again or contact support if the issue persists.</p>
            <a href="/user/all-students" class="back-btn">← Back to Students</a>
          </div>
        </body>
      </html>
    `);
  }
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
    
    // Get students
    const students = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .find({ batchId: new ObjectId(batchId), activated: true })
      .toArray();

    // Get batch details (including links)
    const batch = await batchHelpers.getBatchById(batchId);
    
    const processedStudents = students.map(student => {
      let hasFailed = false;

      if (student.marks?.subjects && Array.isArray(student.marks.subjects)) {
        hasFailed = student.marks.subjects.some(sub => sub.result === 'FAILED');
      }

      return {
        ...student,
        hasFailed,
        hasSupply: student.hasSupply || false,
        batchCourseLink: batch?.courseLink || null,  
        
      };
    });

    console.log(`📊 Processed ${processedStudents.length} students for batch ${batchId}`);
    
    res.render('user/view-bstudent', { 
      user: true, 
      students: processedStudents, 
      batchId,
      batch,
      hideNavbar:true // Pass the batch object with links
    });
    
  } catch (error) {
    console.error("❌ Error loading students for batch:", error);
    res.status(500).render('error', { error: "Failed to load students" });
  }
});
// Approval middleware to get pending count (only for the user's centre)
// router.use(async (req, res, next) => {
//   try {
//     const userCentreId = req.session.user.centreId; // logged-in user's centre

//     const pendingCount = await db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .countDocuments({ 
//         activated: { $ne: true },
//         centreId: userCentreId  // filter by centre
//       });

//     res.locals.pendingCount = pendingCount; // available in all views
//   } catch (err) {
//     console.error("❌ Error fetching pending count:", err);
//     res.locals.pendingCount = 0;
//   }
//   next();
// });
router.use(async (req, res, next) => {
  try {
    // ✅ SAFETY CHECK
    if (!req.session || !req.session.user || !req.session.user.centreId) {
      res.locals.pendingCount = 0;
      return next();
    }

    const userCentreId = req.session.user.centreId;

    const pendingCount = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .countDocuments({
        activated: { $ne: true },
        centreId: userCentreId
      });

    res.locals.pendingCount = pendingCount;
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
      const pendingCount = pendingStudents.length; // ✅ get count
    res.render('user/pending-students', { 
      user: true, 
      pendingStudents,
      pageTitle: 'Pending Students',
      hideNavbar:true
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
// POST /save-timetable - FIXED VERSION
router.post('/save-timetable', verifyUserLogin, async (req, res) => {
  try {
    const centreId = req.session.centreId;
    if (!centreId) return res.status(400).send("Centre ID missing in session");

    console.log("📦 Form data received:", req.body);

    // Prepare schedule array from dynamic rows
    const schedule = [];

    // Multi-row case
    if (Array.isArray(req.body['srNo[]']) || Array.isArray(req.body['date[]'])) {
      const rowCount = Array.isArray(req.body['srNo[]']) ? req.body['srNo[]'].length : 1;
      for (let i = 0; i < rowCount; i++) {
        schedule.push({
          srNo: parseInt(req.body['srNo[]']?.[i]) || i + 1,
          date: req.body['date[]']?.[i] || "",
          time: req.body['time[]']?.[i] || "",
          course: req.body['course[]']?.[i] || "",
          year: parseInt(req.body['year[]']?.[i]) || 0,
          sem: req.body['sem[]']?.[i] || "",
          paperName: req.body['paperName[]']?.[i] || ""
        });
      }
    } else {
      // Single-row case
      schedule.push({
        srNo: parseInt(req.body.srNo) || 1,
        date: req.body.date || "",
        time: req.body.time || "",
        course: req.body.course || "",
        year: parseInt(req.body.year) || 0,
        sem: req.body.sem || "",
        paperName: req.body.paperName || ""
      });
    }

    // Prepare final timetable object
    const timetableData = {
      centreId,
      batchId: new ObjectId(req.body.batchId),  // Convert to ObjectId
      firstTitle: req.body.firstTitle || "",
      secondTitle: req.body.secondTitle || "",
      examMonthYear: req.body.examMonthYear || "",
      notes: req.body.notes || "",
      subjects: schedule,                        // Use 'subjects' for PDF compatibility
      createdAt: new Date(),
      status: 'active'
    };

    console.log("💾 Prepared timetable data:", timetableData);

    // Save using helper
    const timetableId = await batchHelpers.addTimetable(timetableData);

    console.log("✅ Timetable saved with ID:", timetableId);

    res.redirect('/user/view-tbatch');

  } catch (err) {
    console.error("❌ Error saving timetable:", err);
    res.status(500).send("Server Error While Saving Timetable: " + err.message);
  }
});


// router.get('/view-tbatch', verifyUserLogin, async (req, res) => {
//   try {
//     const centreId = req.session.centreId;

//     if (!centreId) {
//       return res.render('user/view-tbatch', { batches: [] });
//     }

//     console.log("📌 VIEW-TBATCH ROUTE HIT");
//     console.log("👉 centreId:", centreId);

//     // 1️⃣ Load all batches of this centre
//     const batches = await batchHelpers.getBatchesByCentre(centreId);
//     console.log(`📌 BATCHES LOADED (${batches.length})`);

//     // 2️⃣ Load ALL timetables for this centre
//     const timetables = await batchHelpers.getTimetablesByCentre(centreId);
//     console.log(`📌 TIMETABLES LOADED (${timetables.length})`);

//     // 3️⃣ Attach LAST timetable of each batch
//     const batchData = batches.map(b => {
//       const batchIdStr = b._id.toString();

//       // find latest timetable
//       const filtered = timetables
//         .filter(t => t.batchId.toString() === batchIdStr)
//         .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

//       // attach last timetable
//       return {
//         ...b,
//         timetable: filtered.length > 0 ? filtered[0] : null
//       };
//     });

//     console.log("📌 FINAL BATCH DATA SENT TO VIEW:");
//     batchData.forEach(b => {
//       console.log(`   • ${b.batchName} → timetable: ${b.timetable ? "YES" : "NO"}`);
//     });

//     // 4️⃣ Render page
//     res.render('user/view-tbatch', {
//       hideNavbar: true,
//       batches: batchData
//     });

//   } catch (err) {
//     console.error("❌ ERROR in /view-tbatch:", err);
//     res.render('user/view-tbatch', { batches: [] });
//   }
// });


router.get('/view-tbatch', verifyUserLogin, async (req, res) => {
  try {
    const centreId = req.session.centreId;

    if (!centreId) {
      return res.render('user/view-tbatch', { batches: [] });
    }

    console.log("📌 VIEW-TBATCH ROUTE HIT");
    console.log("👉 centreId:", centreId);

    // 1️⃣ Load batches
    const batches = await batchHelpers.getBatchesByCentre(centreId);

    // 2️⃣ Load timetables
    const timetables = await batchHelpers.getTimetablesByCentre(centreId);

    // 3️⃣ Attach timetable + hall ticket status
    const batchData = await Promise.all(
      batches.map(async (b) => {
        const batchId = new ObjectId(b._id);

        // latest timetable
        const filtered = timetables
          .filter(t => t.batchId.toString() === b._id.toString())
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // 🔥 CHECK IF HALL TICKET APPLIED
        const appliedCount = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .countDocuments({
            batchId: batchId,
            appliedForHallTicket: true
          });

        console.log(
          `👤 VIEW-TBATCH → ${b.batchName} | appliedCount = ${appliedCount}`
        );

        return {
          ...b,
          timetable: filtered.length ? filtered[0] : null,
          appliedForHallTicket: appliedCount > 0 // ✅ KEY LINE
        };
      })
    );

    res.render('user/view-tbatch', {
      hideNavbar: true,
      batches: batchData
    });

  } catch (err) {
    console.error("❌ ERROR in /view-tbatch:", err);
    res.render('user/view-tbatch', { batches: [] });
  }
});

router.get('/preview-timetable/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const { batchId } = req.params;
    console.log('✅ PREVIEW TIMETABLE PDF HIT:', batchId);

    const batch = await batchHelpers.getBatchById(batchId);
    const timetable = await batchHelpers.getTimetableByBatch(batchId);

    const pdfDoc = await PDFDocument.create();

    // A4 Landscape
    let page = pdfDoc.addPage([842, 595]);
    const { width, height } = page.getSize();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 30;

    // =========================
    // BACKGROUND IMAGE
    // =========================
    const bgPath = path.join(__dirname, '../public/images/time-table.jpg');
    let bgImage = null;
    if (fs.existsSync(bgPath)) {
      bgImage = await pdfDoc.embedJpg(fs.readFileSync(bgPath));
      page.drawImage(bgImage, { x: 0, y: 0, width, height });
    }

    // =========================
    // FUNCTION TO DRAW HEADER AND TABLE ON A PAGE
    // =========================
    const drawPageHeaderAndTable = (currentPage) => {
      // Draw background if exists
      if (bgImage) {
        currentPage.drawImage(bgImage, { x: 0, y: 0, width, height });
      }
      
      const offset = 5;

      currentPage.drawRectangle({
        x: margin - offset,
        y: margin - offset,
        width: width - margin * 2 + offset * 2,
        height: height - margin * 2 + offset * 2,
        borderWidth: 1.5,
        borderColor: rgb(0, 0, 0),
      });

      // Titles and separator lines
      const line1Y = height - margin - 85;
      const firstTitleY = line1Y - 20;
      const line2Y = firstTitleY - 10;
      const secondTitleY = line2Y - 20;
      const line3Y = secondTitleY - 10;

      const lineStartX = margin - offset;
      const lineEndX = width - margin + offset;

      // Line 1
      currentPage.drawLine({
        start: { x: lineStartX, y: line1Y },
        end: { x: lineEndX, y: line1Y },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      // First title
      if (timetable?.firstTitle) {
        const t1 = String(timetable.firstTitle);
        const t1Width = fontBold.widthOfTextAtSize(t1, 14);
        currentPage.drawText(t1, {
          x: (width - t1Width) / 2,
          y: firstTitleY,
          size: 14,
          font: fontBold,
        });
      }

      // Line 2
      currentPage.drawLine({
        start: { x: lineStartX, y: line2Y },
        end: { x: lineEndX, y: line2Y },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      // Second title
      if (timetable?.secondTitle) {
        const t2 = String(timetable.secondTitle);
        const t2Width = fontBold.widthOfTextAtSize(t2, 14);
        currentPage.drawText(t2, {
          x: (width - t2Width) / 2,
          y: secondTitleY,
          size: 14,
          font: fontBold,
        });
      }

      // Line 3
      currentPage.drawLine({
        start: { x: lineStartX, y: line3Y },
        end: { x: lineEndX, y: line3Y },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      return line3Y - 10; // Return starting Y position for table
    };

    // Draw header on first page
    let y = drawPageHeaderAndTable(page);

    // =========================
    // TABLE HEADER
    // =========================
    const tableX = margin + 10;
    const tableWidth = width - (margin * 2) - 20;
    const rowHeight = 22;

    const columns = [
      { title: 'Sr. No', key: 'no', width: 50 },
      { title: 'Date', key: 'date', width: 90 },
      { title: 'Time', key: 'time', width: 120 },
      { title: 'Course', key: 'course', width: 130 },
      { title: 'Year', key: 'year', width: 60 },
      { title: 'Sem', key: 'sem', width: 60 },
      { title: 'Paper Name', key: 'paperName', width: tableWidth - 510 },
    ];

    // Helper function to format date from YYYY-MM-DD to DD-MM-YYYY
    const formatDate = (dateStr) => {
      if (!dateStr || dateStr.trim() === '') return '';
      
      // Try to parse different date formats
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        // If it's not a valid date, return as is (might be a range or other format)
        return dateStr.trim();
      }
      
      // Format as DD-MM-YYYY
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      return `${day}-${month}-${year}`;
    };

    // Helper function to draw perfectly centered text in a cell
    const drawCenteredTextInCell = (page, text, cellX, cellY, cellWidth, cellHeight, fontSize, fontObj) => {
      const textStr = String(text);
      const textWidth = fontObj.widthOfTextAtSize(textStr, fontSize);
      
      // Calculate perfect center
      const xCenter = cellX + (cellWidth / 2) - (textWidth / 2);
      const yCenter = cellY - (cellHeight / 2) - (fontSize / 2) + 3; // +4 for better visual centering
      
      page.drawText(textStr, {
        x: xCenter,
        y: yCenter,
        size: fontSize,
        font: fontObj,
      });
    };

    // Draw table header with centered text
    page.drawRectangle({
      x: tableX,
      y: y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      color: rgb(0.75, 0.85, 0.95),
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
    });

    // Draw column headers (centered horizontally and vertically)
    let xPos = tableX;
    columns.forEach(col => {
      // Draw vertical line
      page.drawLine({
        start: { x: xPos, y },
        end: { x: xPos, y: y - rowHeight },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      // Draw centered header text
      drawCenteredTextInCell(page, col.title, xPos, y, col.width, rowHeight, 9, fontBold);

      xPos += col.width;
    });

    // Draw right border
    page.drawLine({
      start: { x: tableX + tableWidth, y },
      end: { x: tableX + tableWidth, y: y - rowHeight },
      thickness: 1,
    });

    y -= rowHeight;

    // =========================
    // TABLE ROWS - FIXED: Split ALL comma-separated fields
    // =========================
    const subjects = timetable?.subjects || [];
    
    // Track row number
    let rowNumber = 1;
    
    console.log(`📊 Processing ${subjects.length} subjects`);
    
    // Helper function to split comma-separated values
    const splitCommaValues = (value) => {
      if (!value && value !== 0) return [''];
      const strValue = String(value).trim();
      if (!strValue) return [''];
      return strValue.split(',').map(v => v.trim()).filter(v => v !== '');
    };
    
    // Process each subject
    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i];
      
      // Log the raw data for debugging
      console.log(`📝 Subject ${i + 1} raw data:`, {
        date: s.date,
        time: s.time,
        course: s.course,
        year: s.year,
        sem: s.sem,
        paperName: s.paperName
      });
      
      // Split ALL fields by commas
      const dates = splitCommaValues(s.date);
      const times = splitCommaValues(s.time);
      const courses = splitCommaValues(s.course);
      const years = splitCommaValues(s.year);
      const sems = splitCommaValues(s.sem);
      const paperNames = splitCommaValues(s.paperName);
      
      // Find maximum number of entries across all fields
      const maxEntries = Math.max(
        dates.length,
        times.length,
        courses.length,
        years.length,
        sems.length,
        paperNames.length
      );
      
      console.log(`📅 Subject ${i + 1} has ${maxEntries} entries to process`);
      
      // If no entries at all, skip
      if (maxEntries === 0) continue;
      
      // Create rows for each entry
      for (let entryIndex = 0; entryIndex < maxEntries; entryIndex++) {
        // Check if we need new page
        if (y < margin + rowHeight * 3) {
          page = pdfDoc.addPage([842, 595]);
          y = drawPageHeaderAndTable(page);
          // Don't draw table header on new pages
        }
        
        // Prepare row data - use entryIndex for each array, fallback to first item
        // Format the date from YYYY-MM-DD to DD-MM-YYYY
        const rawDate = dates[entryIndex] || dates[0] || '';
        const formattedDate = formatDate(rawDate);
        
        const rowData = {
          no: rowNumber,
          date: formattedDate,
          time: times[entryIndex] || times[0] || '',
          course: courses[entryIndex] || courses[0] || '',
          year: years[entryIndex] || years[0] || '',
          sem: sems[entryIndex] || sems[0] || '',
          paperName: paperNames[entryIndex] || paperNames[0] || '',
        };
        
        // Log the row data for debugging
        console.log(`   Row ${rowNumber}:`, {
          ...rowData,
          originalDate: rawDate,
          formattedDate: formattedDate
        });
        
        // Draw row border
        page.drawRectangle({
          x: tableX,
          y: y - rowHeight,
          width: tableWidth,
          height: rowHeight,
          borderWidth: 1,
          borderColor: rgb(0, 0, 0),
        });

        // Draw row content (centered both horizontally and vertically)
        let rowX = tableX;
        columns.forEach(col => {
          // Draw vertical line
          page.drawLine({
            start: { x: rowX, y },
            end: { x: rowX, y: y - rowHeight },
            thickness: 1,
          });

          // Draw centered cell text (both horizontally and vertically)
          drawCenteredTextInCell(page, rowData[col.key], rowX, y, col.width, rowHeight, 9, font);

          rowX += col.width;
        });

        // Draw right border for the row
        page.drawLine({
          start: { x: rowX, y },
          end: { x: rowX, y: y - rowHeight },
          thickness: 1,
        });

        y -= rowHeight;
        rowNumber++;
      }
    }

    // Draw bottom border for the last row
    page.drawLine({
      start: { x: tableX, y: y },
      end: { x: tableX + tableWidth, y: y },
      thickness: 1,
    });

    // =========================
    // NOTES (only on last page)
    // =========================
    y -= 20;
    const noteX = tableX;

    page.drawText('NOTE :', {
      x: noteX,
      y,
      size: 9,
      font: fontBold,
    });

    y -= 14;

    const notes = (timetable?.notes || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    notes.forEach(line => {
      page.drawText(line, {
        x: noteX + 10,
        y,
        size: 9,
        font,
      });
      y -= 12;
    });

    // =========================
    // FOOTER (on last page only)
    // =========================
    const footerText = `Generated on: ${new Date().toLocaleDateString()}`;
    const footerWidth = font.widthOfTextAtSize(footerText, 8);

    page.drawText(footerText, {
      x: (width - footerWidth) / 2,
      y: margin - 15,
      size: 8,
      font,
    });

    const pdfBytes = await pdfDoc.save();
    
    // ✅ CONVERT TO BASE64 (Like your marklist)
    const base64 = Buffer.from(pdfBytes).toString("base64");

    // ✅ SEND HTML WITH DOWNLOAD BUTTON (Exactly like your marklist)
    res.send(`
      <html>
        <head>
          <title>Timetable Preview</title>
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

            /* Optional: Add print button */
            .print-btn {
              position: fixed;
              top: 70px;
              right: 180px;
              background: #3498db;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: 0.3s;
              z-index: 1001;
              border: none;
              cursor: pointer;
            }

            .print-btn:hover {
              background: #2980b9;
              transform: translateY(-2px);
            }
          </style>
        </head>
        <body>
          <div class="header">Timetable Preview - ${batch?.batchName || "Batch"} (${timetable?.firstTitle || ""})</div>
          
          <button class="print-btn" onclick="window.print()">
            🖨️ Print
          </button>
          
          <a href="/user/download-timetable/${batchId}" class="download-btn">
            📥 Download Timetable
          </a>
          
          <iframe src="data:application/pdf;base64,${base64}#toolbar=0"></iframe>
          
          <script>
            // Auto-focus on PDF
            window.onload = function() {
              document.querySelector('iframe').focus();
            };
          </script>
        </body>
      </html>
    `);
    
  } catch (err) {
    console.error('❌ PDF ERROR:', err);
    res.status(500).send('PDF generation failed');
  }
});
// =========================
// DOWNLOAD TIMETABLE ROUTE (Updated)
// =========================
router.get('/download-timetable/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const { batchId } = req.params;
    console.log('📥 DOWNLOAD TIMETABLE PDF FOR BATCH:', batchId);

    const batch = await batchHelpers.getBatchById(batchId);
    const timetable = await batchHelpers.getTimetableByBatch(batchId);

    if (!timetable) {
      return res.status(404).send('Timetable not found for this batch');
    }

    const pdfDoc = await PDFDocument.create();

    // A4 Landscape
    let page = pdfDoc.addPage([842, 595]);
    const { width, height } = page.getSize();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 30;

    // =========================
    // BACKGROUND IMAGE
    // =========================
    const bgPath = path.join(__dirname, '../public/images/time-table.jpg');
    let bgImage = null;
    if (fs.existsSync(bgPath)) {
      bgImage = await pdfDoc.embedJpg(fs.readFileSync(bgPath));
      page.drawImage(bgImage, { x: 0, y: 0, width, height });
    }

    // =========================
    // FUNCTION TO DRAW HEADER AND TABLE ON A PAGE
    // =========================
    const drawPageHeaderAndTable = (currentPage) => {
      // Draw background if exists
      if (bgImage) {
        currentPage.drawImage(bgImage, { x: 0, y: 0, width, height });
      }
      
      // Outer border
      currentPage.drawRectangle({
        x: margin,
        y: margin,
        width: width - margin * 2,
        height: height - margin * 2,
        borderWidth: 1.5,
        borderColor: rgb(0, 0, 0),
      });

      // Titles and separator lines
      const line1Y = height - margin - 85;
      const firstTitleY = line1Y - 20;
      const line2Y = firstTitleY - 10;
      const secondTitleY = line2Y - 20;
      const line3Y = secondTitleY - 10;

      // Line 1
      currentPage.drawLine({
        start: { x: margin, y: line1Y },
        end: { x: width - margin, y: line1Y },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      // First title
      if (timetable?.firstTitle) {
        const t1 = String(timetable.firstTitle);
        const t1Width = fontBold.widthOfTextAtSize(t1, 14);
        currentPage.drawText(t1, {
          x: (width - t1Width) / 2,
          y: firstTitleY,
          size: 14,
          font: fontBold,
        });
      }

      // Line 2
      currentPage.drawLine({
        start: { x: margin, y: line2Y },
        end: { x: width - margin, y: line2Y },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      // Second title
      if (timetable?.secondTitle) {
        const t2 = String(timetable.secondTitle);
        const t2Width = fontBold.widthOfTextAtSize(t2, 14);
        currentPage.drawText(t2, {
          x: (width - t2Width) / 2,
          y: secondTitleY,
          size: 14,
          font: fontBold,
        });
      }

      // Line 3
      currentPage.drawLine({
        start: { x: margin, y: line3Y },
        end: { x: width - margin, y: line3Y },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      return line3Y - 10; // Return starting Y position for table
    };

    // Draw header on first page
    let y = drawPageHeaderAndTable(page);

    // =========================
    // TABLE HEADER
    // =========================
    const tableX = margin + 10;
    const tableWidth = width - (margin * 2) - 20;
    const rowHeight = 22;

    const columns = [
      { title: 'Sr. No', key: 'no', width: 50 },
      { title: 'Date', key: 'date', width: 90 },
      { title: 'Time', key: 'time', width: 120 },
      { title: 'Course', key: 'course', width: 130 },
      { title: 'Year', key: 'year', width: 60 },
      { title: 'Sem', key: 'sem', width: 60 },
      { title: 'Paper Name', key: 'paperName', width: tableWidth - 510 },
    ];

    // Draw table header
    page.drawRectangle({
      x: tableX,
      y: y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      color: rgb(0.75, 0.85, 0.95),
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
    });

    let xPos = tableX;
    columns.forEach(col => {
      page.drawLine({
        start: { x: xPos, y },
        end: { x: xPos, y: y - rowHeight },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      page.drawText(col.title, {
        x: xPos + 5,
        y: y - 15,
        size: 9,
        font: fontBold,
      });

      xPos += col.width;
    });

    page.drawLine({
      start: { x: tableX + tableWidth, y },
      end: { x: tableX + tableWidth, y: y - rowHeight },
      thickness: 1,
    });

    y -= rowHeight;

    // =========================
    // TABLE ROWS - FIXED: Split ALL comma-separated fields
    // =========================
    const subjects = timetable?.subjects || [];
    
    // Track row number
    let rowNumber = 1;
    
    console.log(`📊 Processing ${subjects.length} subjects for download`);
    
    // Helper function to split comma-separated values
    const splitCommaValues = (value) => {
      if (!value && value !== 0) return [''];
      const strValue = String(value).trim();
      if (!strValue) return [''];
      return strValue.split(',').map(v => v.trim()).filter(v => v !== '');
    };
    
    // Process each subject
    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i];
      
      // Split ALL fields by commas
      const dates = splitCommaValues(s.date);
      const times = splitCommaValues(s.time);
      const courses = splitCommaValues(s.course);
      const years = splitCommaValues(s.year);
      const sems = splitCommaValues(s.sem);
      const paperNames = splitCommaValues(s.paperName);
      
      // Find maximum number of entries across all fields
      const maxEntries = Math.max(
        dates.length,
        times.length,
        courses.length,
        years.length,
        sems.length,
        paperNames.length
      );
      
      // If no entries at all, skip
      if (maxEntries === 0) continue;
      
      // Create rows for each entry
      for (let entryIndex = 0; entryIndex < maxEntries; entryIndex++) {
        // Check if we need new page
        if (y < margin + rowHeight * 3) {
          page = pdfDoc.addPage([842, 595]);
          y = drawPageHeaderAndTable(page);
          // Don't draw table header on new pages
        }
        
        // Prepare row data - use entryIndex for each array, fallback to first item
        const rowData = {
          no: rowNumber,
          date: dates[entryIndex] || dates[0] || '',
          time: times[entryIndex] || times[0] || '',
          course: courses[entryIndex] || courses[0] || '',
          year: years[entryIndex] || years[0] || '',
          sem: sems[entryIndex] || sems[0] || '',
          paperName: paperNames[entryIndex] || paperNames[0] || '',
        };
        
        // Draw row border
        page.drawRectangle({
          x: tableX,
          y: y - rowHeight,
          width: tableWidth,
          height: rowHeight,
          borderWidth: 1,
          borderColor: rgb(0, 0, 0),
        });

        // Draw row content
        let rowX = tableX;
        columns.forEach(col => {
          // Draw vertical line
          page.drawLine({
            start: { x: rowX, y },
            end: { x: rowX, y: y - rowHeight },
            thickness: 1,
          });

          // Draw cell text
          page.drawText(String(rowData[col.key]), {
            x: rowX + 5,
            y: y - 15,
            size: 9,
            font,
          });

          rowX += col.width;
        });

        y -= rowHeight;
        rowNumber++;
      }
    }

    // =========================
    // NOTES (only on last page)
    // =========================
    y -= 20;
    const noteX = tableX;

    page.drawText('NOTE :', {
      x: noteX,
      y,
      size: 9,
      font: fontBold,
    });

    y -= 14;

    const notes = (timetable?.notes || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    notes.forEach(line => {
      page.drawText(line, {
        x: noteX + 10,
        y,
        size: 9,
        font,
      });
      y -= 12;
    });

    // =========================
    // FOOTER (on last page only)
    // =========================
    const footerText = `Generated on: ${new Date().toLocaleDateString()}`;
    const footerWidth = font.widthOfTextAtSize(footerText, 8);

    page.drawText(footerText, {
      x: (width - footerWidth) / 2,
      y: margin - 15,
      size: 8,
      font,
    });

    const pdfBytes = await pdfDoc.save();
    
    console.log("✅ Timetable PDF generated for download, size:", pdfBytes.length, "bytes");

    // ✅ USE THE EXACT SAME PATTERN AS YOUR MARKLIST DOWNLOAD
    const fileName = `timetable_${batch?.batchName || batchId}_${new Date().toISOString().split('T')[0]}.pdf`;
    
    // ✅ Set headers exactly like marklist download route
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBytes.length);
    
    // ✅ Send exactly like marklist download route
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error downloading timetable PDF:", err);
    console.error("🔍 Stack trace:", err.stack);
    
    res.status(500).json({
      error: "Error generating timetable PDF for download",
      message: err.message,
      stack: err.stack
    });
  }
});
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
router.post(
  "/apply-hallticket-batch",
  verifyUserLogin,
  async (req, res) => {
    try {
      const { batchId, examDate, examTime } = req.body;

      console.log("📝 Batch Hall Ticket Apply:");
      console.log("Batch:", batchId);
      console.log("Date:", examDate);
      console.log("Time:", examTime);

      await studentHelpers.applyHallticketByBatch(batchId, examDate, examTime);

      res.redirect("/user/view-batch?success=HallTicketApplied");

    } catch (err) {
      console.error("❌ Batch hallticket apply error:", err);
      res.status(500).send("Failed to apply hall ticket");
    }
  }
);





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
//add question paper
router.get('/add-question-paper/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    if (!batch) return res.status(404).send("Batch not found");

    const centre = await db.get()
      .collection(collection.CENTER_COLLECTION)
      .findOne({ _id: new ObjectId(batch.centreId) });

    if (!centre) return res.status(404).send("Centre not found");

    // ✅ CORRECT COURSE SOURCE
    const courseNames = Array.isArray(centre.courseName)
      ? centre.courseName
      : centre.courseName
        ? [centre.courseName]
        : [];

    res.render('user/add-question-paper', {
      batch,
      centre,
      courseNames,
      user: req.session.user,
      hideNavbar: true
    });

  } catch (err) {
    console.error("❌ Error loading add question paper:", err);
    res.status(500).send("Error loading page");
  }
});



router.post("/add-question-paper/:batchId", async (req, res) => {
  console.log("========== ADD QUESTION PAPER ==========");
  console.log("REQUEST BODY:", req.body);
  console.log("INPUT METHOD:", req.body.inputMethod);
  console.log("SECTIONS JSON RAW:", req.body.sectionsJson);
  console.log("QUESTIONS JSON RAW:", req.body.questionsJson);
  console.log("TOTAL MARKS:", req.body.totalMarks);

  try {
    const { batchId } = req.params;
    const {
      courseName,          // CHANGED: Was courseCode
      subject,
      examType,
      inputMethod,
      sectionsJson,        // NEW FIELD
      questionsJson,
      totalMarks,
      duration,
      instructions,
      department ,
      qtitle1,   // <-- ADD THIS
      qtitle2,
      qpCode
                // NEW FIELD
    } = req.body;

    let pdfPath = "";
    let savedSectionsJson = "";
    let savedQuestionsJson = "";

    // ==========================
    // 🟢 MANUAL MODE
    // ==========================
    if (inputMethod === "manual") {
      // Try new sections format first
      if (sectionsJson && sectionsJson.trim() !== '') {
        try {
          const sections = JSON.parse(sectionsJson);
          if (!sections.length) {
            return res.status(400).send("No sections provided");
          }
          savedSectionsJson = sectionsJson;
          console.log(`✅ Parsed ${sections.length} sections`);
        } catch (parseError) {
          console.error("❌ Error parsing sections JSON:", parseError);
          return res.status(400).send("Invalid sections format");
        }
      }
      // Fallback to old questions format
      else if (questionsJson && questionsJson.trim() !== '') {
        try {
          const questions = JSON.parse(questionsJson);
          if (!questions.length) {
            return res.status(400).send("Questions empty");
          }
          savedQuestionsJson = questionsJson;
          console.log(`✅ Parsed ${questions.length} questions (legacy format)`);
          
          // Convert old format to new sections format
          const convertedSection = {
            sectionNumber: 1,
            sectionName: "SECTION A",
            totalQuestions: questions.length,
            marksPerQuestion: Math.round(totalMarks / questions.length),
            attemptType: "ALL",
            instructions: "",
            questions: questions.map((q, index) => ({
              questionNumber: index + 1,
              text: q.text || "",
              marks: parseInt(q.marks) || 0,
              type: q.type || "SHORT_ANSWER",
              options: q.options || []
            }))
          };
          savedSectionsJson = JSON.stringify([convertedSection]);
        } catch (parseError) {
          console.error("❌ Error parsing questions JSON:", parseError);
          return res.status(400).send("Invalid questions format");
        }
      }
      else {
        return res.status(400).send("No questions or sections provided");
      }

      // 📄 GENERATE PDF (Improved version that matches preview)
      const pdfDoc = await PDFDocument.create();
      let page = pdfDoc.addPage([595, 842]);
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Background
      const bgBytes = fs.readFileSync(
        path.join(__dirname, "../public/images/question-bg.jpg")
      );
      const bg = await pdfDoc.embedJpg(bgBytes);

      const drawBg = (pg) => {
        pg.drawImage(bg, {
          x: 0,
          y: 0,
          width: pg.getWidth(),
          height: pg.getHeight()
        });
      };

      drawBg(page);

      // 🎯 START POSITION (Matching preview format)
      let y = height - 120;
      const leftMargin = 60;
      const rightMargin = width - 60;
      const contentWidth = rightMargin - leftMargin;

      // ==========================
      // 📋 HEADER (Matching preview)
      // ==========================
     

     // Draw QTitle1
if (qtitle1) {
  const title1Width = fontBold.widthOfTextAtSize(qtitle1, 16); // smaller than main title
  page.drawText(qtitle1, {
    x: (width - title1Width) / 2,
    y: y + 95,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0)
  });
}

// Draw QTitle2 below QTitle1
if (qtitle2) {
  const title2Width = fontBold.widthOfTextAtSize(qtitle2, 14); // slightly smaller
  page.drawText(qtitle2, {
    x: (width - title2Width) / 2,
    y: y + 75,  // adjust spacing as needed
    size: 14,
    font: fontBold,
    color: rgb(0, 0, 0)
  });
}

y += 5; // continue with the rest of PDF content


      // Department
      if (department) {
        page.drawText(`Department: ${department}`, {
          x: leftMargin + 10,
          y: y + 55,
          size: 13,
          font: fontBold,
          color: rgb(0, 0, 0)
        });
      }

      // Subject
      if (subject) {
        const subjectText = `Subject: ${subject}`;
        const subjectWidth = fontBold.widthOfTextAtSize(subjectText, 16);
        page.drawText(subjectText, {
          x: (width - subjectWidth) / 2,
          y: y + 55,
          size: 16,
          font: fontBold,
          color: rgb(0, 0, 0)
        });
      }

     

      y -= 80;

      // Function to add new page
      const checkAndAddPage = () => {
        if (y < 100) {
          page = pdfDoc.addPage([595, 842]);
          drawBg(page);
          y = height - 100;
          return true;
        }
        return false;
      };

      // ==========================
      // 📝 SECTIONS & QUESTIONS
      // ==========================
      let sectionsData = [];
      if (savedSectionsJson) {
        sectionsData = JSON.parse(savedSectionsJson);
      } else if (savedQuestionsJson) {
        sectionsData = [{
          sectionNumber: 1,
          sectionName: "SECTION A",
          totalQuestions: 0,
          marksPerQuestion: 0,
          attemptType: "ALL",
          instructions: "",
          questions: JSON.parse(savedQuestionsJson)
        }];
      }

      if (sectionsData.length > 0) {
        sectionsData.forEach((section, sectionIndex) => {
          checkAndAddPage();
          
          // SECTION HEADER
          page.drawText(`${section.sectionName || `SECTION ${String.fromCharCode(65 + sectionIndex)}`}`, {
            x: leftMargin,
            y,
            size: 16,
            font: fontBold,
            color: rgb(0, 0, 0)
          });
          y -= 25;

          // QUESTIONS IN SECTION
          if (section.questions && section.questions.length > 0) {
            section.questions.forEach((question, qIndex) => {
              checkAndAddPage();
              
              const questionNumber = question.questionNumber || qIndex + 1;
              const questionText = `${questionNumber}. ${question.text}`;
              
              // Simple question display (you can enhance this later)
              page.drawText(questionText, {
                x: leftMargin,
                y,
                size: 12,
                font: font,
                maxWidth: contentWidth - 80,
                lineHeight: 15
              });

              // Marks
              if (question.marks) {
                const marksText = `[${question.marks} Marks]`;
                page.drawText(marksText, {
                  x: rightMargin - font.widthOfTextAtSize(marksText, 10) - 10,
                  y,
                  size: 10,
                  font: fontBold,
                  color: rgb(0.3, 0.3, 0.3)
                });
              }

              y -= 35;
            });
          }
        });
      }

      const pdfBytes = await pdfDoc.save();
      const pdfName = Date.now() + "-question-paper.pdf";
      const savePath = path.join(
        __dirname,
        "../public/uploads/question-papers",
        pdfName
      );

      // Ensure directory exists
      const uploadDir = path.join(__dirname, "../public/uploads/question-papers");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      fs.writeFileSync(savePath, pdfBytes);
      pdfPath = "/uploads/question-papers/" + pdfName;
    }

    // ==========================
    // 🔵 FILE MODE (DISABLED)
    // ==========================
    else {
      return res.status(400).send("File upload feature is currently disabled. Please use manual input.");
    }

    // ==========================
    // 💾 SAVE TO DB (UPDATED FIELDS)
    // ==========================
    await batchHelpers.addQuestionPaper(batchId, {
      qtitle1,   // <-- ADD THIS
  qtitle2,
  qpCode,
      courseName,          // CHANGED: courseCode → courseName
      subject,
      examType,
      totalMarks,
      duration,
      instructions,
      department,          // NEW FIELD
      pdfPath,
      inputMethod,
      sectionsJson: savedSectionsJson,  // NEW FIELD
      questionsJson: savedQuestionsJson // For backward compatibility
    });

    console.log("✅ Question paper saved successfully!");
    res.redirect("/user/view-question-papers/" + batchId + "?success=Question%20paper%20created%20successfully");

  } catch (err) {
    console.error("❌ Question paper error:", err);
    console.error("Stack trace:", err.stack);
    res.status(500).send("Server error: " + err.message);
  }
});


// ===========================
// GET: View Question Papers
// ===========================
router.get('/view-question-papers/:batchId', verifyUserLogin, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    const batch = await batchHelpers.getBatchById(batchId);
    if (!batch || !batch.questionPapers) {
      return res.render('user/view-question-papers', {
        batch,
        papers: []
      });
    }

    res.render('user/view-question-papers', {
      batch,
      papers: batch.questionPapers,
      hideNavbar: true
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading question papers");
  }
});
// DELETE question paper route
router.delete('/delete-question-paper/:batchId/:paperId', verifyUserLogin, async (req, res) => {
  try {
    const { batchId, paperId } = req.params;
    
    // Remove the question paper from the batch
    const result = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .updateOne(
        { _id: new ObjectId(batchId) },
        {
          $pull: {
            questionPapers: {
              _id: new ObjectId(paperId)
            }
          }
        }
      );
    
    if (result.modifiedCount === 1) {
      res.json({ success: true, message: 'Question paper deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Question paper not found' });
    }
    
  } catch (err) {
    console.error('❌ Error deleting question paper:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

//preview
router.get('/preview-question-paper/:batchId/:paperId', verifyUserLogin, async (req, res) => {
  try {
    const { batchId, paperId } = req.params;

    const batch = await batchHelpers.getBatchById(batchId);
    if (!batch) return res.status(404).send("Batch not found");

    const paper = batch.questionPapers.find(
      p => p._id.toString() === paperId
    );
    if (!paper) return res.status(404).send("Question paper not found");
   

    // Register fontkit instance
    
    
    // 📄 Create PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    // 🖼️ Background image - Load FIRST before any functions
    let bgImage = null;
    try {
      const bgPath = path.join(__dirname, '../public/images/question-bg.jpg');
      const bgBytes = fs.readFileSync(bgPath);
      bgImage = await pdfDoc.embedJpg(bgBytes);
    } catch (bgError) {
      console.warn("⚠️ Background image not found, using plain background");
    }
    
    // Function to add new page
    let pageNumber = 0;
    const addNewPage = () => {
      const newPage = pdfDoc.addPage([595, 842]); // A4 size
      pageNumber++;
      
      // Add background only to first page
      if (pageNumber === 1 && bgImage) {
        newPage.drawImage(bgImage, {
          x: 0,
          y: 0,
          width: newPage.getWidth(),
          height: newPage.getHeight()
        });
      }
      
      return newPage;
    };

    let page = addNewPage();
    const { width, height } = page.getSize();
// Load Calibri Regular
const calibriPath = path.join(__dirname, '../public/fonts/Arial.ttf');
const calibriBytes = fs.readFileSync(calibriPath);
const calibriFont = await pdfDoc.embedFont(calibriBytes);

// Load Calibri Bold
const calibriBoldPath = path.join(__dirname, '../public/fonts/Arial Bold.ttf');
const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
const calibriBoldFont = await pdfDoc.embedFont(calibriBoldBytes);

    // 🔤 Fonts
    const font = calibriFont;       // Regular text
const fontBold = calibriBoldFont; // Bold headers


    // 🎯 START POSITION - Start from top of page
    let y = height - 100; // Start from top with some margin
    const leftMargin = 50;
    const rightMargin = width - 50;
    const contentWidth = rightMargin - leftMargin;

    // =====================================================
    // 📋 HEADER SECTION - ALL ELEMENTS CENTERED
    // =====================================================

    // 1. DEPARTMENT (first, centered)
    if (paper.department) {
      const deptWidth = fontBold.widthOfTextAtSize(paper.department, 12);
      page.drawText(paper.department, {
        x: (width - deptWidth) / 2+40,
        y: y,
        size: 10,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 25;
    }

    // 2. QTITLE1 (centered)
    if (paper.qtitle1) {
      const title1Width = fontBold.widthOfTextAtSize(paper.qtitle1, 11);
      page.drawText(paper.qtitle1, {
        x: (width - title1Width) / 2,
        y: y,
        size: 11,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 25;
    }

    // 3. QTITLE2 (centered)
    if (paper.qtitle2) {
      const title2Width = fontBold.widthOfTextAtSize(paper.qtitle2, 10);
      page.drawText(paper.qtitle2, {
        x: (width - title2Width) / 2,
        y: y+10,
        size: 10,
        font: font,
        color: rgb(0, 0, 0)
      });
      y -= 25;
    }

    // 4. SUBJECT (centered, larger)
    if (paper.subject) {
      const subjectText = paper.subject;
      const subjectWidth = fontBold.widthOfTextAtSize(subjectText, 18);
      page.drawText(subjectText, {
        x: (width - subjectWidth) / 2,
        y: y+20,
        size: 12,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 30;
    }

    // 5. QUESTION PAPER CODE (centered)
    if (paper.qpCode) {
      const codeText = `Question Paper Code: ${paper.qpCode}`;
      const codeWidth = font.widthOfTextAtSize(codeText, 12);
      page.drawText(codeText, {
        x: (width - codeWidth) / 2-15,
        y: y+30,
        size: 12,
        font: font,
        color: rgb(0.3, 0.3, 0.3)
      });
      y -= -15;
    }

    // 6. COURSE NAME (centered)
    // if (paper.courseName) {
    //   const courseText = `Course: ${paper.courseName}`;
    //   const courseWidth = fontBold.widthOfTextAtSize(courseText, 12);
    //   page.drawText(courseText, {
    //     x: (width - courseWidth) / 2,
    //     y: y,
    //     size: 12,
    //     font: fontBold,
    //     color: rgb(0, 0, 0)
    //   });
    //   y -= 25;
    // }

    // 7. EXAM DETAILS - Two columns but still centered (ABOVE THE SEPARATOR LINE)
    y -= 5; // Little space before details
    
    // Calculate positions for two centered columns
    const totalDetailsWidth = 600; // Total width for both columns
    const detailCol1X = (width / 2) - 240; // Left column
    const detailCol2X = (width / 2) + 120; // Right column

    // Column 1 - Total Marks
    if (paper.totalMarks) {
      const marksText = `Total Marks: ${paper.totalMarks}`;
      page.drawText(marksText, {
        x: detailCol1X,
        y: y,
        size: 11,
        font: font,
        color: rgb(0.2, 0.2, 0.2)
      });
    }

    // Column 2 - Duration
    if (paper.duration) {
      const durationText = `Duration: ${paper.duration} minutes`;
      page.drawText(durationText, {
        x: detailCol2X,
        y: y,
        size: 11,
        font: font,
        color: rgb(0.2, 0.2, 0.2)
      });
    }

    y -= 10; // Space before separator line

    // 8. SEPARATOR LINE (centered, 90% of page width)
    const linePercentage = 0.9; // 90%
    const lineLength = width * linePercentage;
    const lineX = (width - lineLength) / 2;
    page.drawLine({
      start: { x: lineX, y: y },
      end: { x: lineX + lineLength, y: y },
      thickness: 1,
      color: rgb(0, 0, 0)
    });
    y -= 25;

    // Function to check and add new page
    const checkAndAddPage = () => {
      if (y < 100) {
        page = addNewPage();
        y = height - 50;
        return true;
      }
      return false;
    };

    // Helper function to wrap text
    const wrapText = (text, font, fontSize, maxWidth) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      words.forEach(word => {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        
        if (testWidth > maxWidth) {
          if (currentLine) {
            lines.push(currentLine);
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    // =====================================================
    // 📝 INSTRUCTIONS SECTION
    // =====================================================
    if (paper.instructions) {
      checkAndAddPage();
      
      // Instructions title (centered)
      const instrTitle = 'INSTRUCTIONS:';
      const instrWidth = fontBold.widthOfTextAtSize(instrTitle, 12);
      page.drawText(instrTitle, {
        x: (width - instrWidth) / 2,
        y,
        size: 12,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 20;

      // Process instructions
      const instructions = paper.instructions.split('\n').filter(line => line.trim());
      instructions.forEach(instruction => {
        checkAndAddPage();
        
        const wrappedLines = wrapText(`• ${instruction.trim()}`, font, 10, contentWidth);
        wrappedLines.forEach(line => {
          page.drawText(line, {
            x: leftMargin, // Left aligned for instructions content
            y,
            size: 10,
            font: font,
            color: rgb(0, 0, 0)
          });
          y -= 14;
        });
        y -= 3;
      });
      
      y -= 10;
    }

    // =====================================================
    // ✅ SECTIONS & QUESTIONS
    // =====================================================
    let hasQuestions = false;
    
    // 1. New format (sectionsJson)
    if (paper.sectionsJson) {
      try {
        const sections = JSON.parse(paper.sectionsJson);
        
        if (sections && sections.length > 0) {
          hasQuestions = true;
          
          sections.forEach((section, sectionIndex) => {
            checkAndAddPage();
            
            // SECTION HEADER (centered)
            const sectionName = section.sectionName || `SECTION ${String.fromCharCode(65 + sectionIndex)}`;
            const sectionNameWidth = fontBold.widthOfTextAtSize(sectionName, 16);
            page.drawText(sectionName, {
              x: (width - sectionNameWidth) / 2-120,
              y,
              size: 12,
              font: fontBold,
              color: rgb(0, 0, 0)
            });
            y -= 16;

            // Section details in one line (centered)
            let sectionDetails = [];
            if (section.totalQuestions) {
              sectionDetails.push(`Total Questions: ${section.totalQuestions}`);
            }
            if (section.marksPerQuestion) {
              sectionDetails.push(`Marks per Question: ${section.marksPerQuestion}`);
            }
            if (section.attemptType) {
              const attemptText = section.attemptType === 'ALL' ? 'Answer All' : 
                                section.attemptType === 'ANY' ? 'Attempt Any' : 
                                `Attempt: ${section.attemptType}`;
              sectionDetails.push(attemptText);
            }
            
            if (sectionDetails.length > 0) {
              const detailsText = sectionDetails.join(' | ');
              const detailsWidth = font.widthOfTextAtSize(detailsText, 11);
              page.drawText(detailsText, {
                x: (width - detailsWidth) / 2-120,
                y,
                size: 11,
                font: font,
                color: rgb(0.3, 0.3, 0.3)
              });
              y -= 20;
            }

            // Section instructions
            if (section.instructions) {
              const noteText = `Note: ${section.instructions}`;
              const noteWidth = font.widthOfTextAtSize(noteText, 10);
              page.drawText(noteText, {
                x: (width - noteWidth) / 2,
                y,
                size: 10,
                font: font,
                color: rgb(0.4, 0.4, 0.4)
              });
              y -= 15;
            }

            // Questions in section
            if (section.questions && section.questions.length > 0) {
              section.questions.forEach((question, qIndex) => {
                checkAndAddPage();
                
                const questionNumber = question.questionNumber || qIndex + 1;
                const questionText = `${questionNumber}. ${question.text}`;
                const wrappedLines = wrapText(questionText, font, 10, contentWidth);
                
                // Draw question (left aligned)
                wrappedLines.forEach((line, lineIndex) => {
                  page.drawText(line, {
                    x: leftMargin+24,
                    y,
                    size: 10,
                    font: font,
                    color: rgb(0, 0, 0)
                  });
                  y -= 1;
                });

                // Marks (right-aligned)
                if (question.marks) {
                  const marksText = `[${question.marks} Marks]`;
                  page.drawText(marksText, {
                    x: rightMargin - font.widthOfTextAtSize(marksText, 10) - 10,
                    y: y + (wrappedLines.length * 15) - 15,
                    size: 10,
                    font: fontBold,
                    color: rgb(0.3, 0.3, 0.3)
                  });
                }

                y -= 15; // Space after question

                // MCQ options
                if (question.type === 'MCQ' && question.options && question.options.length > 0) {
                  question.options.forEach((option, optIndex) => {
                    checkAndAddPage();
                    
                    const optionLetter = option.letter || String.fromCharCode(97 + optIndex);
                    const optionText = `   ${optionLetter}) ${option.text}`;
                    const optionLines = wrapText(optionText, font, 10, contentWidth - 40);
                    
                    optionLines.forEach(line => {
                      page.drawText(line, {
                        x: leftMargin + 20,
                        y,
                        size: 10,
                        font: font,
                        color: rgb(0.2, 0.2, 0.2)
                      });
                      y -= 13;
                    });
                  });
                  y -= 5;
                }
              });
            }
            
            y -= 16; // Space between sections
          });
        }
      } catch (jsonError) {
        console.error("Error parsing sections JSON:", jsonError);
      }
    }
    // 2. Legacy format (questionsJson)
    else if (paper.questionsJson) {
      try {
        const questions = JSON.parse(paper.questionsJson);
        
        if (questions && questions.length > 0) {
          hasQuestions = true;
          
          checkAndAddPage();
          const sectionTitle = 'SECTION A: ANSWER ALL QUESTIONS';
          const sectionTitleWidth = fontBold.widthOfTextAtSize(sectionTitle, 16);
          page.drawText(sectionTitle, {
            x: (width - sectionTitleWidth) / 2,
            y,
            size: 16,
            font: fontBold,
            color: rgb(0, 0, 0)
          });
          y -= 25;

          questions.forEach((q, index) => {
            checkAndAddPage();
            
            const questionNumber = q.questionNumber || index + 1;
            const questionText = `${questionNumber}. ${q.text}`;
            const wrappedLines = wrapText(questionText, font, 12, contentWidth);
            
            wrappedLines.forEach(line => {
              page.drawText(line, {
                x: leftMargin,
                y,
                size: 12,
                font: font,
                color: rgb(0, 0, 0)
              });
              y -= 15;
            });

            if (q.marks) {
              const marksText = `[${q.marks} Marks]`;
              page.drawText(marksText, {
                x: rightMargin - font.widthOfTextAtSize(marksText, 10) - 10,
                y: y + (wrappedLines.length * 15) - 15,
                size: 10,
                font: fontBold,
                color: rgb(0.3, 0.3, 0.3)
              });
            }

            y -= 20;
          });
        }
      } catch (jsonError) {
        console.error("Error parsing legacy questions JSON:", jsonError);
      }
    }

    // =====================================================
    // 📝 FOOTER
    // =====================================================
    checkAndAddPage();
    
    // Footer separator (centered, 90% width)
    const footerLinePercentage = 0.9;
    const footerLineLength = width * footerLinePercentage;
    const footerLineX = (width - footerLineLength) / 2;
    page.drawLine({
      start: { x: footerLineX, y: y + 20 },
      end: { x: footerLineX + footerLineLength, y: y + 20 },
      thickness: 0.5,
      color: rgb(0.3, 0.3, 0.3)
    });
    y -= 15;

    // Generated timestamp (centered)
    const timestamp = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const timestampText = `Generated on: ${timestamp}`;
    const timestampWidth = font.widthOfTextAtSize(timestampText, 9);
    page.drawText(timestampText, {
      x: (width - timestampWidth) / 2,
      y: 40,
      size: 9,
      font: font,
      color: rgb(0.3, 0.3, 0.3)
    });

    // Page numbers (centered on each page)
    const totalPages = pdfDoc.getPageCount();
    for (let i = 0; i < totalPages; i++) {
      const currentPage = pdfDoc.getPage(i);
      const pageText = `Page ${i + 1} of ${totalPages}`;
      const pageTextWidth = font.widthOfTextAtSize(pageText, 8);
      currentPage.drawText(pageText, {
        x: (width - pageTextWidth) / 2,
        y: 25,
        size: 8,
        font: font,
        color: rgb(0.4, 0.4, 0.4)
      });
    }

    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");

    // =====================================================
    // 📄 HTML PREVIEW PAGE
    // =====================================================
    res.send(`
      <html>
        <head>
          <title>Question Paper Preview - ${paper.subject || 'Question Paper'}</title>
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
              background: linear-gradient(135deg, #004e89, #0066cc);
              color: white;
              padding: 15px;
              text-align: center;
              font-size: 22px;
              font-weight: bold;
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              z-index: 1000;
              box-shadow: 0px 3px 10px rgba(0,0,0,0.2);
              display: flex;
              justify-content: space-between;
              align-items: center;
            }

            .header-content {
              flex: 1;
              text-align: center;
            }

            .controls {
              display: flex;
              gap: 12px;
              margin-right: 20px;
            }

            .btn {
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              transition: all 0.3s ease;
              border: none;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              font-size: 14px;
              color: white;
              min-width: 160px;
              justify-content: center;
            }

            .download-btn {
              background: linear-gradient(135deg, #28a745, #20c997);
            }

            .download-btn:hover {
              background: linear-gradient(135deg, #20c997, #28a745);
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
            }

            .back-btn {
              background: linear-gradient(135deg, #6c757d, #495057);
            }

            .back-btn:hover {
              background: linear-gradient(135deg, #495057, #6c757d);
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
            }

            iframe {
              position: fixed;
              top: 70px;
              left: 0;
              right: 0;
              bottom: 0;
              width: 100%;
              height: calc(100vh - 70px);
              border: none;
            }

            .paper-info {
              position: fixed;
              bottom: 20px;
              left: 20px;
              background: rgba(255, 255, 255, 0.9);
              padding: 10px 15px;
              border-radius: 8px;
              font-size: 12px;
              color: #333;
              box-shadow: 0 2px 5px rgba(0,0,0,0.1);
              max-width: 300px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div></div> <!-- Empty div for spacing -->
            <div class="header-content">
              📄 Question Paper Preview - ${paper.subject || 'Paper'}
            </div>
            <div class="controls">
              <a href="/user/view-question-papers/${batchId}" class="btn back-btn">
                ← Back to List
              </a>
              <a href="/user/download-question-paper/${batchId}/${paperId}" class="btn download-btn">
                📥 Download PDF
              </a>
            </div>
          </div>
          
          <iframe src="data:application/pdf;base64,${base64}#toolbar=0&navpanes=0&scrollbar=1"></iframe>
          
          <div class="paper-info">
            <strong>Paper Details:</strong><br>
            ${paper.subject ? `Subject: ${paper.subject}<br>` : ''}
            ${paper.courseName ? `Course: ${paper.courseName}<br>` : ''}
            ${paper.totalMarks ? `Marks: ${paper.totalMarks}<br>` : ''}
            ${paper.duration ? `Duration: ${paper.duration} mins` : ''}
          </div>
          
          <script>
            window.onload = function() {
              document.querySelector('iframe').focus();
            };
          </script>
        </body>
      </html>
    `);

  } catch (err) {
    console.error("❌ PDF preview error:", err);
    console.error("Error stack:", err.stack);
    res.status(500).send("Error generating PDF preview: " + err.message);
  }
});
// ===========================
// DOWNLOAD QUESTION PAPER PDF
// ===========================
router.get('/download-question-paper/:batchId/:paperId', verifyUserLogin, async (req, res) => {
  try {
    const { batchId, paperId } = req.params;

    const batch = await batchHelpers.getBatchById(batchId);
    if (!batch) return res.status(404).send("Batch not found");

    const paper = batch.questionPapers.find(
      p => p._id.toString() === paperId
    );
    if (!paper) return res.status(404).send("Question paper not found");
    
    // Register fontkit instance
    const { PDFDocument, rgb } = require('pdf-lib');
    const fontkit = require('@pdf-lib/fontkit');
    
    // 📄 Create PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    
    // 🖼️ Background image - Load FIRST before any functions
    let bgImage = null;
    try {
      const bgPath = path.join(__dirname, '../public/images/question-bg.jpg');
      const bgBytes = fs.readFileSync(bgPath);
      bgImage = await pdfDoc.embedJpg(bgBytes);
    } catch (bgError) {
      console.warn("⚠️ Background image not found, using plain background");
    }
    
    // Function to add new page
    let pageNumber = 0;
    const addNewPage = () => {
      const newPage = pdfDoc.addPage([595, 842]); // A4 size
      pageNumber++;
      
      // Add background only to first page
      if (pageNumber === 1 && bgImage) {
        newPage.drawImage(bgImage, {
          x: 0,
          y: 0,
          width: newPage.getWidth(),
          height: newPage.getHeight()
        });
      }
      
      return newPage;
    };

    let page = addNewPage();
    const { width, height } = page.getSize();
    
    // Load Calibri Regular
    const calibriPath = path.join(__dirname, '../public/fonts/Arial.ttf');
    const calibriBytes = fs.readFileSync(calibriPath);
    const calibriFont = await pdfDoc.embedFont(calibriBytes);

    // Load Calibri Bold
    const calibriBoldPath = path.join(__dirname, '../public/fonts/Arial Bold.ttf');
    const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
    const calibriBoldFont = await pdfDoc.embedFont(calibriBoldBytes);

    // 🔤 Fonts
    const font = calibriFont;       // Regular text
    const fontBold = calibriBoldFont; // Bold headers

    // 🎯 START POSITION - Start from top of page
    let y = height - 100; // Start from top with some margin
    const leftMargin = 50;
    const rightMargin = width - 50;
    const contentWidth = rightMargin - leftMargin;

    // =====================================================
    // 📋 HEADER SECTION - ALL ELEMENTS CENTERED
    // =====================================================

    // 1. DEPARTMENT (first, centered)
    if (paper.department) {
      const deptWidth = fontBold.widthOfTextAtSize(paper.department, 12);
      page.drawText(paper.department, {
        x: (width - deptWidth) / 2+40,
        y: y,
        size: 10,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 25;
    }

    // 2. QTITLE1 (centered)
    if (paper.qtitle1) {
      const title1Width = fontBold.widthOfTextAtSize(paper.qtitle1, 11);
      page.drawText(paper.qtitle1, {
        x: (width - title1Width) / 2,
        y: y,
        size: 11,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 25;
    }

    // 3. QTITLE2 (centered)
    if (paper.qtitle2) {
      const title2Width = fontBold.widthOfTextAtSize(paper.qtitle2, 10);
      page.drawText(paper.qtitle2, {
        x: (width - title2Width) / 2,
        y: y+10,
        size: 10,
        font: font,
        color: rgb(0, 0, 0)
      });
      y -= 25;
    }

    // 4. SUBJECT (centered, larger)
    if (paper.subject) {
      const subjectText = paper.subject;
      const subjectWidth = fontBold.widthOfTextAtSize(subjectText, 18);
      page.drawText(subjectText, {
        x: (width - subjectWidth) / 2,
        y: y+20,
        size: 12,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 30;
    }

    // 5. QUESTION PAPER CODE (centered)
    if (paper.qpCode) {
      const codeText = `Question Paper Code: ${paper.qpCode}`;
      const codeWidth = font.widthOfTextAtSize(codeText, 12);
      page.drawText(codeText, {
        x: (width - codeWidth) / 2-15,
        y: y+30,
        size: 12,
        font: font,
        color: rgb(0.3, 0.3, 0.3)
      });
      y -= -15;
    }

    // 6. COURSE NAME (centered)
    // if (paper.courseName) {
    //   const courseText = `Course: ${paper.courseName}`;
    //   const courseWidth = fontBold.widthOfTextAtSize(courseText, 12);
    //   page.drawText(courseText, {
    //     x: (width - courseWidth) / 2,
    //     y: y,
    //     size: 12,
    //     font: fontBold,
    //     color: rgb(0, 0, 0)
    //   });
    //   y -= 25;
    // }

    // 7. EXAM DETAILS - Two columns but still centered (ABOVE THE SEPARATOR LINE)
    y -= 5; // Little space before details
    
    // Calculate positions for two centered columns
    const totalDetailsWidth = 600; // Total width for both columns
    const detailCol1X = (width / 2) - 240; // Left column
    const detailCol2X = (width / 2) + 120; // Right column

    // Column 1 - Total Marks
    if (paper.totalMarks) {
      const marksText = `Total Marks: ${paper.totalMarks}`;
      page.drawText(marksText, {
        x: detailCol1X,
        y: y,
        size: 11,
        font: font,
        color: rgb(0.2, 0.2, 0.2)
      });
    }

    // Column 2 - Duration
    if (paper.duration) {
      const durationText = `Duration: ${paper.duration} minutes`;
      page.drawText(durationText, {
        x: detailCol2X,
        y: y,
        size: 11,
        font: font,
        color: rgb(0.2, 0.2, 0.2)
      });
    }

    y -= 10; // Space before separator line

    // 8. SEPARATOR LINE (centered, 90% of page width)
    const linePercentage = 0.9; // 90%
    const lineLength = width * linePercentage;
    const lineX = (width - lineLength) / 2;
    page.drawLine({
      start: { x: lineX, y: y },
      end: { x: lineX + lineLength, y: y },
      thickness: 1,
      color: rgb(0, 0, 0)
    });
    y -= 25;

    // Function to check and add new page
    const checkAndAddPage = () => {
      if (y < 100) {
        page = addNewPage();
        y = height - 50;
        return true;
      }
      return false;
    };

    // Helper function to wrap text
    const wrapText = (text, font, fontSize, maxWidth) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      words.forEach(word => {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        
        if (testWidth > maxWidth) {
          if (currentLine) {
            lines.push(currentLine);
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    // =====================================================
    // 📝 INSTRUCTIONS SECTION
    // =====================================================
    if (paper.instructions) {
      checkAndAddPage();
      
      // Instructions title (centered)
      const instrTitle = 'INSTRUCTIONS:';
      const instrWidth = fontBold.widthOfTextAtSize(instrTitle, 12);
      page.drawText(instrTitle, {
        x: (width - instrWidth) / 2,
        y,
        size: 12,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
      y -= 20;

      // Process instructions
      const instructions = paper.instructions.split('\n').filter(line => line.trim());
      instructions.forEach(instruction => {
        checkAndAddPage();
        
        const wrappedLines = wrapText(`• ${instruction.trim()}`, font, 10, contentWidth);
        wrappedLines.forEach(line => {
          page.drawText(line, {
            x: leftMargin, // Left aligned for instructions content
            y,
            size: 10,
            font: font,
            color: rgb(0, 0, 0)
          });
          y -= 14;
        });
        y -= 3;
      });
      
      y -= 10;
    }

    // =====================================================
    // ✅ SECTIONS & QUESTIONS
    // =====================================================
    let hasQuestions = false;
    
    // 1. New format (sectionsJson)
    if (paper.sectionsJson) {
      try {
        const sections = JSON.parse(paper.sectionsJson);
        
        if (sections && sections.length > 0) {
          hasQuestions = true;
          
          sections.forEach((section, sectionIndex) => {
            checkAndAddPage();
            
            // SECTION HEADER (centered)
            const sectionName = section.sectionName || `SECTION ${String.fromCharCode(65 + sectionIndex)}`;
            const sectionNameWidth = fontBold.widthOfTextAtSize(sectionName, 16);
            page.drawText(sectionName, {
              x: (width - sectionNameWidth) / 2-120,
              y,
              size: 12,
              font: fontBold,
              color: rgb(0, 0, 0)
            });
            y -= 16;

            // Section details in one line (centered)
            let sectionDetails = [];
            if (section.totalQuestions) {
              sectionDetails.push(`Total Questions: ${section.totalQuestions}`);
            }
            if (section.marksPerQuestion) {
              sectionDetails.push(`Marks per Question: ${section.marksPerQuestion}`);
            }
            if (section.attemptType) {
              const attemptText = section.attemptType === 'ALL' ? 'Answer All' : 
                                section.attemptType === 'ANY' ? 'Attempt Any' : 
                                `Attempt: ${section.attemptType}`;
              sectionDetails.push(attemptText);
            }
            
            if (sectionDetails.length > 0) {
              const detailsText = sectionDetails.join(' | ');
              const detailsWidth = font.widthOfTextAtSize(detailsText, 11);
              page.drawText(detailsText, {
                x: (width - detailsWidth) / 2-120,
                y,
                size: 11,
                font: font,
                color: rgb(0.3, 0.3, 0.3)
              });
              y -= 20;
            }

            // Section instructions
            if (section.instructions) {
              const noteText = `Note: ${section.instructions}`;
              const noteWidth = font.widthOfTextAtSize(noteText, 10);
              page.drawText(noteText, {
                x: (width - noteWidth) / 2,
                y,
                size: 10,
                font: font,
                color: rgb(0.4, 0.4, 0.4)
              });
              y -= 15;
            }

            // Questions in section
            if (section.questions && section.questions.length > 0) {
              section.questions.forEach((question, qIndex) => {
                checkAndAddPage();
                
                const questionNumber = question.questionNumber || qIndex + 1;
                const questionText = `${questionNumber}. ${question.text}`;
                const wrappedLines = wrapText(questionText, font, 10, contentWidth);
                
                // Draw question (left aligned)
                wrappedLines.forEach((line, lineIndex) => {
                  page.drawText(line, {
                    x: leftMargin+24,
                    y,
                    size: 10,
                    font: font,
                    color: rgb(0, 0, 0)
                  });
                  y -= 1;
                });

                // Marks (right-aligned)
                if (question.marks) {
                  const marksText = `[${question.marks} Marks]`;
                  page.drawText(marksText, {
                    x: rightMargin - font.widthOfTextAtSize(marksText, 10) - 10,
                    y: y + (wrappedLines.length * 15) - 15,
                    size: 10,
                    font: fontBold,
                    color: rgb(0.3, 0.3, 0.3)
                  });
                }

                y -= 15; // Space after question

                // MCQ options
                if (question.type === 'MCQ' && question.options && question.options.length > 0) {
                  question.options.forEach((option, optIndex) => {
                    checkAndAddPage();
                    
                    const optionLetter = option.letter || String.fromCharCode(97 + optIndex);
                    const optionText = `   ${optionLetter}) ${option.text}`;
                    const optionLines = wrapText(optionText, font, 10, contentWidth - 40);
                    
                    optionLines.forEach(line => {
                      page.drawText(line, {
                        x: leftMargin + 20,
                        y,
                        size: 10,
                        font: font,
                        color: rgb(0.2, 0.2, 0.2)
                      });
                      y -= 13;
                    });
                  });
                  y -= 5;
                }
              });
            }
            
            y -= 16; // Space between sections
          });
        }
      } catch (jsonError) {
        console.error("Error parsing sections JSON:", jsonError);
      }
    }
    // 2. Legacy format (questionsJson)
    else if (paper.questionsJson) {
      try {
        const questions = JSON.parse(paper.questionsJson);
        
        if (questions && questions.length > 0) {
          hasQuestions = true;
          
          checkAndAddPage();
          const sectionTitle = 'SECTION A: ANSWER ALL QUESTIONS';
          const sectionTitleWidth = fontBold.widthOfTextAtSize(sectionTitle, 16);
          page.drawText(sectionTitle, {
            x: (width - sectionTitleWidth) / 2,
            y,
            size: 16,
            font: fontBold,
            color: rgb(0, 0, 0)
          });
          y -= 25;

          questions.forEach((q, index) => {
            checkAndAddPage();
            
            const questionNumber = q.questionNumber || index + 1;
            const questionText = `${questionNumber}. ${q.text}`;
            const wrappedLines = wrapText(questionText, font, 12, contentWidth);
            
            wrappedLines.forEach(line => {
              page.drawText(line, {
                x: leftMargin,
                y,
                size: 12,
                font: font,
                color: rgb(0, 0, 0)
              });
              y -= 15;
            });

            if (q.marks) {
              const marksText = `[${q.marks} Marks]`;
              page.drawText(marksText, {
                x: rightMargin - font.widthOfTextAtSize(marksText, 10) - 10,
                y: y + (wrappedLines.length * 15) - 15,
                size: 10,
                font: fontBold,
                color: rgb(0.3, 0.3, 0.3)
              });
            }

            y -= 20;
          });
        }
      } catch (jsonError) {
        console.error("Error parsing legacy questions JSON:", jsonError);
      }
    }

    // =====================================================
    // 📝 FOOTER
    // =====================================================
    checkAndAddPage();
    
    // Footer separator (centered, 90% width)
    const footerLinePercentage = 0.9;
    const footerLineLength = width * footerLinePercentage;
    const footerLineX = (width - footerLineLength) / 2;
    page.drawLine({
      start: { x: footerLineX, y: y + 20 },
      end: { x: footerLineX + footerLineLength, y: y + 20 },
      thickness: 0.5,
      color: rgb(0.3, 0.3, 0.3)
    });
    y -= 15;

    // Generated timestamp (centered)
    const timestamp = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const timestampText = `Generated on: ${timestamp}`;
    const timestampWidth = font.widthOfTextAtSize(timestampText, 9);
    page.drawText(timestampText, {
      x: (width - timestampWidth) / 2,
      y: 40,
      size: 9,
      font: font,
      color: rgb(0.3, 0.3, 0.3)
    });

    // Page numbers (centered on each page)
    const totalPages = pdfDoc.getPageCount();
    for (let i = 0; i < totalPages; i++) {
      const currentPage = pdfDoc.getPage(i);
      const pageText = `Page ${i + 1} of ${totalPages}`;
      const pageTextWidth = font.widthOfTextAtSize(pageText, 8);
      currentPage.drawText(pageText, {
        x: (width - pageTextWidth) / 2,
        y: 25,
        size: 8,
        font: font,
        color: rgb(0.4, 0.4, 0.4)
      });
    }

    const pdfBytes = await pdfDoc.save();
    
    // =====================================================
    // 📥 DOWNLOAD THE PDF (Only change from preview)
    // =====================================================
    const fileName = `${paper.subject || 'Question-Paper'}_${paper.qpCode || batch.batchId}.pdf`.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pdfBytes.length
    });
    
    res.send(pdfBytes);

  } catch (err) {
    console.error("❌ PDF download error:", err);
    console.error("Error stack:", err.stack);
    res.status(500).send("Error generating PDF download: " + err.message);
  }
});

// ADD MARK PAGE
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

    res.redirect('/user/preview-marklist/' + studentId);
  } catch (err) {
    console.error("❌ Error saving marks:", err);
    res.status(500).send("Error submitting marks");
  }
});
// ===========================
// MARKLIST PREVIEW (with Download Button) - FIXED CENTERING
// ===========================
router.get("/preview-marklist/:id", verifyUserLogin, async (req, res) => {
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
          <a href="/user/download-marklist/${studentId}" class="download-btn">
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
router.get("/download-marklist/:id", verifyUserLogin, async (req, res) => {
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
    res.redirect('/user/preview-combined-marklist/' + studentId);
    
  } catch (err) {
    console.error("❌ Error saving supply marks:", err);
    res.status(500).send("Error submitting supply marks");
  }
});
// ===========================
// COMBINED MARKLIST PREVIEW (PDF-Lib Version)
// ===========================
router.get("/preview-combined-marklist/:id", verifyUserLogin, async (req, res) => {
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
          <a href="/user/download-combined-marklist/${studentId}" class="download-btn">
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
router.get("/download-combined-marklist/:id", verifyUserLogin, async (req, res) => {
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
router.get('/edit-mark/:id', verifyUserLogin, async (req, res) => {
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
      return res.redirect(`/user/add-mark/${studentId}`);
    }

    // Fetch center data for logos
    const centerData = await centerHelpers.getCenterById(student.centreId);
    
    res.render('user/edit-mark', {
      student,
      centerData,
      hideNavbar: true
    });

  } catch (err) {
    console.error("❌ Error loading edit mark page:", err);
    res.status(500).send("Error loading edit mark page");
  }
});

// ===========================
// UPDATE MARK
// ===========================
router.post('/update-mark/:id', verifyUserLogin, async (req, res) => {
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
      res.redirect(`/user/view-bstudent`);
    } else {
      console.log("⚠️ No changes made or student not found");
      req.session.studentMessage = "No changes were made.";
      res.redirect(`/user/edit-mark/${studentId}`);
    }

  } catch (err) {
    console.error("❌ Error updating marks:", err);
    req.session.studentMessage = "Error updating marks. Please try again.";
    res.redirect(`/user/edit-mark/${req.params.id}`);
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


//supply marklist
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


module.exports = router;
