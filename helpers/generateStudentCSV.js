const fs = require('fs');

function generateStudentCSV(students, filePath) {
  const headers = [
    'candidateName',
    'registrationNo',
    'examination',
    'course',
    'subject',
    'maxMark',
    'obtainedMark',
    'resultType'
  ];

  let csv = headers.join(',') + '\n';

  students.forEach(student => {

    /* ---------- MAIN EXAM MARKS ---------- */
    if (student.marks && Array.isArray(student.marks.subjects)) {
      student.marks.subjects.forEach(sub => {
        csv += [
          student.marks.candidateName || student.fullName || '',
          student.marks.registrationNo || student.regNo || '',
          student.marks.examination || '',
          student.marks.course || '',
          sub.subject || '',
          sub.maxMark || '',
          sub.obtainedMark || '',
          'REGULAR'
        ].join(',') + '\n';
      });
    }

    /* ---------- SUPPLY EXAM MARKS ---------- */
    if (student.supplyMarks && Array.isArray(student.supplyMarks.subjects)) {
      student.supplyMarks.subjects.forEach(sub => {
        csv += [
          student.supplyMarks.candidateName || student.fullName || '',
          student.supplyMarks.registrationNo || student.regNo || '',
          student.supplyMarks.examination || '',
          student.supplyMarks.course || '',
          sub.subject || '',
          sub.maxMark || '',
          sub.obtainedMark || '',
          'SUPPLY'
        ].join(',') + '\n';
      });
    }

  });

  fs.writeFileSync(filePath, csv);
}

module.exports = generateStudentCSV;
