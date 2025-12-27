console.log("📌 Student Router Loaded");

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

router.all("*", (req, res, next) => {
  console.log("💡 Student router hit:", req.method, req.path);
  next();
});


// Student home check
router.get("/", (req, res) => {
  console.log("🏠 Student home route hit");

  if (req.session.student) {
    return res.redirect("/student/dashboard");
  }
  res.redirect("/student/login");
});

// Login page
router.get("/login", (req, res) => {
  console.log("🔥 Student login page loaded");
  res.render("student/login", { loginErr: req.session.loginErr,
    hideOtherHeaders: true,hideNavbar: true });
  req.session.loginErr = null;
});

router.post("/student-access", async (req, res) => {
  try {
    const { regNo, dob } = req.body;
    console.log("🔥 Student login POST hit for", regNo);

    // Use helper function
    const result = await studentHelpers.doLogin({ regNo, dob });

    if (!result.status) {
      req.session.loginErr = result.message; // Shows correct error
      return res.redirect("/student/login");
    }

    // Save session
    req.session.student = {
      _id: result.student.id,
      regNo: result.student.regNo,
      name: result.student.name,
    };

    return res.redirect("/student/dashboard");

  } catch (err) {
    console.error("❌ Error in student login route:", err);
    req.session.loginErr = "Something went wrong!";
    return res.redirect("/student/login");
  }
});



// // Student Dashboard Page
// // Student Dashboard Page
// router.get("/dashboard", verifyStudentLogin, async (req, res) => {
//   try {
//     const studentId = req.session.student._id;

//     // Auto-approve hall ticket if applicable
//     await studentHelpers.autoApproveHallticket(studentId);

//     // Get student profile
//     const result = await studentHelpers.getStudentProfile(studentId);

//     if (!result.status) {
//       req.session.loginErr = "Student profile not found!";
//       return res.redirect("/student/login");
//     }

//     const student = result.student;

//     // =====================
//     // CALCULATE GRADE
//     // =====================
//     let grade = "N/A";

//     if (student.marks && student.marks.subjects && student.marks.subjects.length > 0) {
//       const totalMarks = student.marks.obtainedTotal || 0;
//       const maxMarks = student.marks.maxTotal || 600;

//       const percent = (totalMarks / maxMarks) * 100;

//       if (percent >= 80) grade = "A+";
//       else if (percent >= 70) grade = "A";
//       else if (percent >= 60) grade = "B+";
//       else if (percent >= 50) grade = "B";
//       else if (percent >= 40) grade = "C";
//       else grade = "FAILED";
//     }

//     student.grade = grade;

//     // =====================
//     // GET DEPARTMENT LOGO
//     // =====================
//     let deptLogo = null;
//     if (student.centreId && student.course?.department) {
//       deptLogo = await centerHelpers.getDepartmentLogo(student.centreId, student.course.department);
//     }

//     // =====================
//     // HALL TICKET STATUS
//     // =====================
//     const hallticketStatus = student.hallticketStatus || "NOT_APPLIED";

//     // =====================
//     // CERTIFICATE AVAILABILITY (24 HOURS RULE)
//     // =====================
//     let certificateAvailable = false;

//     if (student.appliedForCertificate && student.certificateAppliedAt) {
//       const appliedTime = new Date(student.certificateAppliedAt).getTime();
//       const now = Date.now();
//       const hoursSinceApplied = (now - appliedTime) / (1000 * 60 * 60);

//       if (hoursSinceApplied >= 24) {
//         certificateAvailable = true;
//       }
//     }

//     // =====================
//     // RENDER DASHBOARD
//     // =====================
//     res.render("student/dashboard", { 
//       student, 
//       deptLogo,
//       hallticketStatus,
//       certificateAvailable,  // pass flag to template
//       hideOtherHeaders: true   
//     });

//   } catch (err) {
//     console.error("❌ Error loading dashboard:", err);
//     req.session.loginErr = "Something went wrong!";
//     return res.redirect("/student/login");
//   }
// });


// ===============================
// STUDENT DASHBOARD
router.get("/dashboard", verifyStudentLogin, async (req, res) => {
  try {
    const studentId = req.session.student._id;

    // Auto approve hall ticket if eligible
    await studentHelpers.autoApproveHallticket(studentId);

    // Get student profile
    const result = await studentHelpers.getStudentProfile(studentId);
    if (!result.status) {
      req.session.loginErr = "Student profile not found!";
      return res.redirect("/student/login");
    }

    const student = result.student;

    // ===============================
    // NORMALIZE centreId (pick first if array)
    // ===============================
    if (Array.isArray(student.centreId)) {
      student.centreId = student.centreId[0];
    }

    // ===============================
    // FETCH BATCH COURSES
    // ===============================
    let batchLinks = {
      courseLink1: null,
      courseName1: null,
      courseLink2: null,
      courseName2: null
    };

    if (student.batchId) {
      const batch = await batchHelpers.getBatchById(student.batchId);

      if (batch) {
        // Course 1 (with backward compatibility)
        batchLinks.courseLink1 = batch.courseLink1 || batch.courseLink || null;
        batchLinks.courseName1 = batch.courseName1 || "Free Course 1";
        
        // Course 2
        batchLinks.courseLink2 = batch.courseLink2 || null;
        batchLinks.courseName2 = batch.courseName2 || "Free Course 2";
      }
    }

    // ===============================
    // CALCULATE GRADE
    // ===============================
    let grade = "N/A";
    if (student.marks?.subjects?.length) {
      const total = student.marks.obtainedTotal || 0;
      const max = student.marks.maxTotal || 600;
      const percent = (total / max) * 100;

      if (percent >= 80) grade = "A+";
      else if (percent >= 70) grade = "A";
      else if (percent >= 60) grade = "B+";
      else if (percent >= 50) grade = "B";
      else if (percent >= 40) grade = "C";
      else grade = "FAILED";
    }
    student.grade = grade;

    // ===============================
    // CERTIFICATE AVAILABILITY (24 HOURS RULE)
    // ===============================
    let certificateAvailable = false;
    if (student.appliedForCertificate && student.certificateAppliedAt) {
      const appliedTime = new Date(student.certificateAppliedAt).getTime();
      const hours = (Date.now() - appliedTime) / (1000 * 60 * 60);
      if (hours >= 24) certificateAvailable = true;
    }

    // ===============================
    // DEPARTMENT LOGO
    // ===============================
    let deptLogo = null;
    if (student.centreId && student.course?.department) {
      deptLogo = await centerHelpers.getDepartmentLogo(
        student.centreId,
        student.course.department
      );
    }

    // ===============================
    // RENDER DASHBOARD
    // ===============================
    res.render("student/dashboard", {
      student,
      batchLinks,
      deptLogo,
      hallticketStatus: student.hallticketStatus || "NOT_APPLIED",
      certificateAvailable,
      hideOtherHeaders: true
    });

  } catch (err) {
    console.error("❌ Dashboard Error:", err);
    req.session.loginErr = "Something went wrong!";
    res.redirect("/student/login");
  }
});
// Student Logout
// Logout
router.get("/logout", (req, res) => {
  req.session.student = null;
  res.redirect("/student/login");
});

function verifyStudentLogin(req, res, next) {
  if (req.session.student) next();
  else res.redirect("/student/login");
}

// ===========================
// HALL TICKET - DOWNLOAD
// ===========================
router.get("/hallticket-download/:id", verifyStudentLogin, async (req, res) => {
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
// MARKLIST PREVIEW (with Download Button)
// ===========================
router.get("/preview-marklist/:id", verifyStudentLogin, async (req, res) => {
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

const calibriBoldPath = path.join(__dirname, "../public/fonts/CALILIBRIB.TTF");
let calibriBold = calibri; // fallback to regular Calibri
if (fs.existsSync(calibriBoldPath)) {
  const calibriBoldBytes = fs.readFileSync(calibriBoldPath);
  calibriBold = await pdfDoc.embedFont(calibriBoldBytes);
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
    const colWidths = [25, 180, 30, 30, 30, 30, 30, 30, 30, 30, 30, 45];
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

    // Main headers
    const mainHeaderOffsetX = 24;

    // Headers that should move
    const shiftIndexes = [2, 5, 8]; 
    // 2 = Theory Marks, 5 = Practical Marks, 8 = Total Marks
    
    xPos = xStart;

    for (let i = 0; i < mainHeaders.length; i++) {
      if (!mainHeaders[i]) {
        xPos += colWidths[i];
        continue;
      }
    
      let groupWidth = colWidths[i];
    
      // group spans 3 columns: Max, Min, Obt
      if (["Theory Marks", "Practical Marks", "Total Marks"].includes(mainHeaders[i])) {
        groupWidth = colWidths[i] + colWidths[i+1] + colWidths[i+2];
      }
    
      const textWidth = calibriBold.widthOfTextAtSize(mainHeaders[i], 11);
    
      page.drawText(mainHeaders[i], {
        x: xPos + (groupWidth - textWidth) / 2,
        y: tableTop - 13,
        size: 11,
        font: calibriBold
      });
    
      xPos += colWidths[i];
    }
    
    

    // Sub headers
    xPos = xStart;
    subHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = arialBold.widthOfTextAtSize(header, 8);
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 28,
          size: 11,
          font: calibriBold
        });
      }
      xPos += colWidths[i];
    });
// Draw horizontal separator lines for grouped headers (Theory/Practical/Total)
if (SHOW_TABLE_LINES) {
  const headerTop = tableTop;
  const headerMid = tableTop - 16;   // midpoint between main and sub headers
  const headerBottom = tableTop - 32;

  // THEORY MARKS (3 columns: Max, Min, Obt)
  page.drawLine({
    start: { x: xStart + colWidths[0] + colWidths[1], y: headerMid },
    end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
    thickness: lineSettings.thickness,
    color: lineSettings.color
  });

  // PRACTICAL MARKS (3 columns)
  page.drawLine({
    start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y: headerMid },
    end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
    thickness: lineSettings.thickness,
    color: lineSettings.color
  });

  // TOTAL MARKS (3 columns)
  page.drawLine({
    start: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], y: headerMid },
    end: { x: xStart + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7] + colWidths[8] + colWidths[9] + colWidths[10], y: headerMid },
    thickness: lineSettings.thickness,
    color: lineSettings.color
  });
}

    // Vertical lines
 // Vertical lines
 if (SHOW_TABLE_LINES) {
  xPos = xStart;

  const shortLines = [2, 3, 5, 6, 8, 9];  // Max/Min/Obt separators

  colWidths.forEach((width, i) => {
    if (i < colWidths.length - 1) {
      const lineX = xPos + width;

      if (shortLines.includes(i)) {
        // Draw ONLY inside sub-header area
        page.drawLine({
          start: { x: lineX, y: tableTop - 16 },
          end:   { x: lineX, y: tableTop - 32 },
          thickness: lineSettings.thickness,
          color: lineSettings.color,
        });
      } else {
        // Draw full boundary line (top to bottom)
        page.drawLine({
          start: { x: lineX, y: tableTop },
          end:   { x: lineX, y: tableTop - 32 },
          thickness: lineSettings.thickness,
          color: lineSettings.color,
        });
      }
    }

    xPos += width;
  });
}




    // ===========================
// ROWS with wrapped subject names
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
  const maxSubjectWidth = colWidths[1] - 8; // padding 4px on each side
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

  // Draw each cell
  rowData.forEach((data, i) => {
    let textX;
if (i === 0 || [2,3,4,5,6,7,8,9,10].includes(i)) {
  textX = xPos + (colWidths[i] - calibri.widthOfTextAtSize(String(data), 11)) / 2;
} else {
  textX = xPos + 4; // Subject left aligned
}

      if (i === 1) {
        // Vertical centering for wrapped subject text
        const totalTextHeight = lines.length * 10;  // each line ~10px
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
      } else {
      // Center marks vertically if subject wraps to multiple lines
      const centerY = yPosition - (dynamicRowHeight / 2) - 4;
    
      page.drawText(String(data), {
        x: textX,
        y: centerY,
        size: 11,
        font: i === 11 ? calibriBold : calibri,
        color:  rgb(0,0,0),
      });
    }
    

    // Vertical lines
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

  // Move yPosition down for next row
  yPosition -= dynamicRowHeight;
});


    // ===========================
    // TOTAL ROW
    // ===========================
    xPos = xStart;

    // Draw the total row background
    page.drawRectangle({
      x: xPos,
      y: yPosition - rowHeight,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: rowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderWidth: lineSettings.thickness,
      borderColor: lineSettings.color,
    });
    
    // ✅ Add vertical lines on specific columns
    const verticalLineIndexes = [ 1, 7,9, 10]; // specify the columns you want lines
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
    
    page.drawText("Total in words", {
      x: xStart + 5,
      y: yPosition - rowHeight + 8,
      size: 11,
      font: calibriBold,
    });

    page.drawText(`${student.marks.totalWords || ""}`, {
      x: xStart + 215,
      y: yPosition - rowHeight + 8,
      size: 11,
      font: calibriBold,
    });

    page.drawText(`${student.marks.maxTotal || ""}`, {
      x: xStart + 410,
      y: yPosition - rowHeight + 8,
      size: 11,
      font: calibriBold,
    });

    page.drawText(`${student.marks.obtainedTotal || ""}`, {
      x: xStart + 450,
      y: yPosition - rowHeight + 8,
      size: 11,
      font: calibriBold,
    });

    page.drawText(student.marks.overallResult || "", {
      x: xStart + 480,
      y: yPosition - rowHeight + 8,
      size: 11,
      font: calibriBold,
      color:  rgb(0,0,0),
    });

    // ===========================
    // FOOTER
    // ===========================
    yPosition -= 40;
    page.drawText(`Place of Issue : NETD (HO)`, { x: 45, y: yPosition, size: 10, font: arial });

    const issueDate = student.marks.createdAt
      ? new Date(student.marks.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString();

    page.drawText(`Date of Issue : ${issueDate}`, {
      x: 45,
      y: yPosition - 15,
      size: 10,
      font: arial
    });

    page.drawText(` ${student.marks.grade || ""} `, {
      x: pageWidth - 168,
      y: yPosition +2,
      size: 10,
      font: arialBold,
      color: rgb(0,0,0),
    });

    page.drawText("Chairman / Board of Examiners NETD", {
      x: pageWidth - 220,
      y: 120,
      size: 10,
      font: arialBold
    });

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
    await embedLogo(institutionLogo, 239, 125, 80, 80, true);
    await embedLogo(departmentLogo, 129, 125, 85.7, 86.7);
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

            /* 🔥 FIXED HEADER CSS BELOW — ONLY THIS PART CHANGED */
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

          <a href="/student/download-marklist/${studentId}" class="download-btn">
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
// MARKLIST - PDF DOWNLOAD (PDF-lib)
// ===========================
router.get("/download-marklist/:id", verifyStudentLogin, async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student data
    const student = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .findOne({ _id: new ObjectId(studentId) });

    if (!student || !student.marks) {
      return res.status(404).send("Student or marks not found");
    }

    // 2️⃣ Load background image
    const bgPath = path.join(__dirname, "../public/images/Marklist-bg.jpg");
    const bgBytes = fs.readFileSync(bgPath);

    // 3️⃣ Create PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 4️⃣ Load Arial fonts (fallback for Square 721 BT)
    const arialPath = path.join(__dirname, "../public/fonts/arial.ttf");
    const arialBytes = fs.readFileSync(arialPath);
    const arial = await pdfDoc.embedFont(arialBytes);

    const arialBoldPath = path.join(__dirname, "../public/fonts/arialbd.ttf");
    let arialBold = arial;
    if (fs.existsSync(arialBoldPath)) {
      const arialBoldBytes = fs.readFileSync(arialBoldPath);
      arialBold = await pdfDoc.embedFont(arialBoldBytes);
    }

    // 5️⃣ Create page with exact physical dimensions
    const pageWidth = 8.543 * 72;   // 8.543 inches
    const pageHeight = 11.367 * 72; // 11.367 inches
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 6️⃣ Draw background
    const bgImage = await pdfDoc.embedJpg(bgBytes);
    page.drawImage(bgImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });

    const { rgb } = require("pdf-lib");

    // ===========================
    // LINE CONTROL CONFIGURATION
    // ===========================
    const SHOW_TABLE_LINES = true; // ← SET TO false TO HIDE ALL TABLE LINES
    const lineSettings = {
        thickness: SHOW_TABLE_LINES ? 0.3 : 0,
        color: SHOW_TABLE_LINES ? rgb(0, 0, 0) : rgb(1, 1, 1) // White if hidden
    };

    // ===========================
    // 7️⃣ STUDENT DETAILS (Square 721 BT style → Arial Bold)
    // ===========================
    let yPosition = pageHeight - 210;
    const detailFont = arialBold; // fallback for Square 721 BT

    const details = [
      `Registration Number : ${student.marks.regNo || ""}`,
      `This mark sheet is Award to : ${student.marks.candidateName || ""}`,
      `On successful Completion of the Course : ${student.marks.course || ""}`,
      `Of Duration : ${student.marks.courseDuration || ""}`,
      `From our Authorized Training centre : ${student.marks.institute || ""}`
    ];

    details.forEach((text) => {
      page.drawText(text, {
        x: 45,
        y: yPosition,
        size: 11,
        font: detailFont,
        color: rgb(0, 0, 0),
      });
      yPosition -= 22;
    });

    yPosition -= 25;

    // ===========================
    // 8️⃣ MARKS TABLE - WITH LINE CONTROL
    // ===========================
    const xStart = 45;
    const colWidths = [25, 180, 30, 30, 30, 30, 30, 30, 30, 30, 30, 45];
    const rowHeight = 18;
    const headerBg = rgb(0.83, 0.90, 0.98);
    const tableTop = yPosition;

    // --- Draw Complete Table Header ---
    let xPos = xStart;
    
    // Draw main header background (single rectangle for the whole header)
    page.drawRectangle({
      x: xPos,
      y: tableTop - 32,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: 32,
      color: headerBg,
      borderColor: lineSettings.color,
      borderWidth: lineSettings.thickness,
    });

    // Main headers
    const mainHeaders = [
      "S.No",
      "Name of Subject",
      "Theory Marks", "", "",
      "Practical Marks", "", "",
      "Total Marks", "", "",
      "Result"
    ];

    // Sub headers
    const subHeaders = [
      "", "", "Max", "Min", "Obt",
      "Max", "Min", "Obt",
      "Max", "Min", "Obt", ""
    ];

    // --- Main Headers ---
    xPos = xStart;
    mainHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = arialBold.widthOfTextAtSize(header, 8.5);
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 12,
          size: 8.5,
          font: arialBold,
          color: rgb(0, 0, 0),
        });
      }
      xPos += colWidths[i];
    });

    // --- Sub Headers ---
    xPos = xStart;
    subHeaders.forEach((header, i) => {
      if (header) {
        const textWidth = arialBold.widthOfTextAtSize(header, 8);
        page.drawText(header, {
          x: xPos + (colWidths[i] - textWidth) / 2,
          y: tableTop - 28,
          size: 8,
          font: arialBold,
          color: rgb(0, 0, 0),
        });
      }
      xPos += colWidths[i];
    });

    // --- Draw Vertical Lines for Header ---
    if (SHOW_TABLE_LINES) {
      xPos = xStart;
      colWidths.forEach((width, i) => {
        if (i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + width, y: tableTop - 32 },
            end: { x: xPos + width, y: tableTop },
            color: lineSettings.color,
            thickness: lineSettings.thickness,
          });
        }
        xPos += width;
      });
    }

    // --- Data Rows ---
    yPosition = tableTop - 32; // Start right below header
    student.marks.subjects.forEach((subject, index) => {
      xPos = xStart;
      
      const rowData = [
        (index + 1).toString(),
        subject.subject || "",
        subject.theoryMax?.toString() || "",
        subject.theoryMin?.toString() || "",
        subject.theoryObt?.toString() || "",
        subject.practicalMax?.toString() || "",
        subject.practicalMin?.toString() || "",
        subject.practicalObt?.toString() || "",
        subject.totalMax?.toString() || "",
        subject.totalMin?.toString() || "",
        subject.totalObt?.toString() || "",
        subject.result || "",
      ];

      // Draw complete row background
      page.drawRectangle({
        x: xPos,
        y: yPosition - rowHeight,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: rowHeight,
        borderColor: lineSettings.color,
        borderWidth: lineSettings.thickness,
      });

      // Draw cell content
      rowData.forEach((data, i) => {
        const textColor =
          i === 11
            ? data === "PASSED"
              ? rgb(0, 0.5, 0)
              : rgb(1, 0, 0)
            : rgb(0, 0, 0);

        const textWidth = arial.widthOfTextAtSize(String(data), 8);
        const textX =
          [2, 3, 4, 5, 6, 7, 8, 9, 10].includes(i)
            ? xPos + (colWidths[i] - textWidth) / 2
            : xPos + 4;

        page.drawText(String(data), {
          x: textX,
          y: yPosition - rowHeight + 5,
          size: 8,
          font: i === 11 ? arialBold : arial,
          color: textColor,
        });

        // Draw vertical lines between cells (Conditional)
        if (SHOW_TABLE_LINES && i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + colWidths[i], y: yPosition - rowHeight },
            end: { x: xPos + colWidths[i], y: yPosition },
            color: lineSettings.color,
            thickness: lineSettings.thickness,
          });
        }

        xPos += colWidths[i];
      });

      yPosition -= rowHeight;
    });

    // --- Total Row ---
    xPos = xStart;
    const totalBg = rgb(0.85, 0.92, 0.98);

    // Draw complete total row background
    page.drawRectangle({
      x: xPos,
      y: yPosition - rowHeight,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: rowHeight,
      color: totalBg,
      borderColor: lineSettings.color,
      borderWidth: lineSettings.thickness,
    });

    const totalLabel = "Total in words";
    const totalText = `${student.marks.totalWords || ""}`;
    const totalMax = `${student.marks.totalMax || ""}`;
    const totalObt = `${student.marks.obtainedTotal || ""}`;
    const overallResult = student.marks.overallResult || "";

    // Draw total row content
    page.drawText(totalLabel, { 
      x: xStart + 5, 
      y: yPosition - rowHeight + 5, 
      size: 8.5, 
      font: arialBold 
    });
    
    page.drawText(totalText, { 
      x: xStart + 100, 
      y: yPosition - rowHeight + 5, 
      size: 8.5, 
      font: arial 
    });
    
    page.drawText(totalMax, { 
      x: xStart + 470, 
      y: yPosition - rowHeight + 5, 
      size: 8.5, 
      font: arial 
    });
    
    page.drawText(totalObt, { 
      x: xStart + 450, 
      y: yPosition - rowHeight + 5, 
      size: 8.5, 
      font: arial 
    });
    
    const resultColor = overallResult === "PASSED" ? rgb(0, 0.5, 0) : rgb(1, 0, 0);
    page.drawText(overallResult, { 
      x: xStart + 480, 
      y: yPosition - rowHeight + 5, 
      size: 8.5, 
      font: arialBold,
      color: resultColor
    });

    // Draw vertical lines for total row (Conditional)
    if (SHOW_TABLE_LINES) {
      xPos = xStart;
      colWidths.forEach((width, i) => {
        if (i < colWidths.length - 1) {
          page.drawLine({
            start: { x: xPos + width, y: yPosition - rowHeight },
            end: { x: xPos + width, y: yPosition },
            color: lineSettings.color,
            thickness: lineSettings.thickness,
          });
        }
        xPos += width;
      });
    }

    // ===========================
    // 9️⃣ FOOTER SECTION
    // ===========================
    yPosition -= 50;
    page.drawText(`Place of Issue : NETD (HO)`, { x: 45, y: yPosition, size: 10, font: arial });
    const issueDate = student.marks.createdAt
      ? new Date(student.marks.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString();
    page.drawText(`Date of Issue : ${issueDate}`, { x: 45, y: yPosition - 15, size: 10, font: arial });

    const gradeColor = student.marks.overallResult === "PASSED" ? rgb(0, 0.5, 0) : rgb(1, 0, 0);
    page.drawText(` ${student.marks.grade || ""} GRADE`, {
      x: pageWidth - 220,
      y: yPosition - 5,
      size: 11,
      font: arialBold,
      color: gradeColor,
    });

    page.drawText("Chairman / Board of Examiners NETD", {
      x: pageWidth - 220,
      y: 60,
      size: 10,
      font: arialBold,
    });

    // 🔟 Save & Send
    const pdfBytes = await pdfDoc.save();
    const fileName = `Marksheet-${student.marks.registrationNo || studentId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("❌ Error generating marklist PDF:", err);
    res.status(500).send("Error generating marklist PDF");
  }
});
// ===========================
// CERTIFICATE PREVIEW (SDC Style with Auto-Rotation)
// ===========================
router.get('/preview-certificate/:id', verifyStudentLogin, async (req, res) => {
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
          
          
        </body>
      </html>
    `);

  } catch (error) {
    console.error("❌ Error generating certificate preview:", error);
    res.status(500).send("Error generating certificate preview: " + error.message);
  }
});
module.exports = router;  