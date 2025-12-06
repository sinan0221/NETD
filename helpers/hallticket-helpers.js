const PDFDocument = require('pdfkit');
const { ObjectId } = require('mongodb');
const db = require('../config/connection');
const collection = require('../config/collections');

module.exports = {
  generateHallTicketPDF: async (studentId, res) => {
    const student = await db.get().collection('students').findOne({ _id: new ObjectId(studentId) });

    if (!student || !student.applicationForm) {
      throw new Error("Hall Ticket not available");
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=hallticket_${student.applicationForm.registerNumber}.pdf`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Title
    doc.fontSize(20).text("HALL TICKET", { align: "center", underline: true });
    doc.moveDown(2);

    doc.fontSize(14).text(`Name: ${student.applicationForm.candidateName}`, 60, 200);
    doc.text(`Register Number: ${student.applicationForm.registerNumber}`, 60, 230);
    doc.text(`Course: ${student.applicationForm.courseName}`, 60, 260);
    doc.text(`Study Centre: ${student.applicationForm.studyCentre}`, 60, 290);
    doc.text(`Exam Centre: ${student.applicationForm.examCentre}`, 60, 320);
    doc.text(`Exam Date: ${student.applicationForm.examDate}`, 60, 350);
    doc.text(`Exam Time: ${student.applicationForm.examTime}`, 60, 380);

    doc.rect(400, 200, 120, 150).stroke();
    doc.text('Student Photo', 420, 270);

    doc.text("Signature of Candidate", 60, 650);
    doc.text("Authorised Signatory", 400, 650);

    doc.end();
  }
};
