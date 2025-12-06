
// var db = require('../config/connection');
// var collection = require('../config/collections');
// const { ObjectId } = require('mongodb');   // ✅ Import ObjectId

// module.exports = {
//   // ===============================
//   // Add Student
//   // ===============================
//   addStudent: (studentData, callback) => {
//     try {
//       let qualifications = [];

//       // ✅ Process qualification arrays if available
//       if (studentData.education) {
//         qualifications = studentData.education.map((edu, i) => ({
//           education: edu,
//           maxMarks: studentData.maxMarks[i],
//           minMarks: studentData.minMarks[i],
//           obtainedMarks: studentData.obtainedMarks[i],
//           grade: studentData.grade[i],
//           year: studentData.year[i],
//           board: studentData.board[i]
//         }));
//       }

//       studentData.qualifications = qualifications;
//       studentData.createdAt = new Date();

//       // 🟢 Convert batchId to ObjectId
//       if (studentData.batchId) {
//         try {
//           studentData.batchId = new ObjectId(studentData.batchId);
//         } catch (err) {
//           console.warn("⚠️ Invalid batchId format:", studentData.batchId);
//         }
//       }
//       studentData.appliedForHallTicket = false;

//       // Remove raw arrays
//       delete studentData.education;
//       delete studentData.maxMarks;
//       delete studentData.minMarks;
//       delete studentData.obtainedMarks;
//       delete studentData.grade;
//       delete studentData.year;
//       delete studentData.board;

//       db.get()
//         .collection(collection.STUDENT_COLLECTION)
//         .insertOne(studentData)
//         .then((data) => {
//           console.log("✅ Student added:", data.insertedId);
//           callback(data.insertedId);
//         })
//         .catch((err) => {
//           console.error("❌ DB Error while adding student:", err);
//         });

//     } catch (err) {
//       console.error("❌ Error in addStudent:", err);
//     }
//   },

//   // ===============================
//   // Get All Students
//   // ===============================
// //   getAllStudents: () => {
// //     return db.get()
// //       .collection(collection.STUDENT_COLLECTION)
// //       .find({})
// //       .toArray();
// //   },
// getAllStudents: () => {
//     return new Promise(async (resolve, reject) => {
//       try {
//         let students = await db.get()
//           .collection(collection.STUDENT_COLLECTION)
//           .aggregate([
//             {
//               $lookup: {
//                 from: collection.BATCH_COLLECTION,
//                 localField: "batchId",
//                 foreignField: "_id",
//                 as: "batchDetails"
//               }
//             },
//             { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } }
//           ])
//           .toArray();
//         resolve(students);
//       } catch (err) {
//         reject(err);
//       }
//     });
//   },
  

//   // ===============================
//   // Delete Student
//   // ===============================
//   deleteStudent: (studentId) => {
//     return new Promise((resolve, reject) => {
//       db.get()
//         .collection(collection.STUDENT_COLLECTION)
//         .deleteOne({ _id: new ObjectId(studentId) })
//         .then((response) => {
//           console.log("✅ Student deleted:", response);
//           resolve(response);
//         })
//         .catch((err) => {
//           console.error("❌ Error deleting student:", err);
//           reject(err);
//         });
//     });
//   },

//   // ===============================
//   // Get Student Details
//   // ===============================
//   getStudentDetails: (studentId) => {
//     return new Promise((resolve, reject) => {
//       db.get()
//         .collection(collection.STUDENT_COLLECTION)
//         .findOne({ _id: new ObjectId(studentId) })
//         .then((student) => resolve(student))
//         .catch((err) => {
//           console.error("❌ Error fetching student details:", err);
//           reject(err);
//         });
//     });
//   },

//   // ===============================
//   // Update Student
//   // ===============================
//   updateStudent: (studentId, studentDetails) => {
//     try {
//       let qualifications = [];

//       // ✅ Build structured qualifications if form sent arrays
//       if (studentDetails.education) {
//         qualifications = studentDetails.education.map((edu, i) => ({
//           education: edu,
//           maxMarks: studentDetails.maxMarks[i],
//           minMarks: studentDetails.minMarks[i],
//           obtainedMarks: studentDetails.obtainedMarks[i],
//           grade: studentDetails.grade[i],
//           year: studentDetails.year[i],
//           board: studentDetails.board[i]
//         }));
//       }

//       // 🟢 Convert batchId to ObjectId if exists
//       if (studentDetails.batchId) {
//         try {
//           studentDetails.batchId = new ObjectId(studentDetails.batchId);
//         } catch (err) {
//           console.warn("⚠️ Invalid batchId format in update:", studentDetails.batchId);
//         }
//       }

//       // Remove raw arrays
//       delete studentDetails.education;
//       delete studentDetails.maxMarks;
//       delete studentDetails.minMarks;
//       delete studentDetails.obtainedMarks;
//       delete studentDetails.grade;
//       delete studentDetails.year;
//       delete studentDetails.board;

//       return db.get()
//         .collection(collection.STUDENT_COLLECTION)
//         .updateOne(
//           { _id: new ObjectId(studentId) },
//           {
//             $set: {
//               ...studentDetails,
//               qualifications: qualifications
//             }
//           }
//         );
//     } catch (err) {
//       console.error("❌ Error in updateStudent:", err);
//     }
//   },

//   // ===============================
//   // Get Students By Batch
//   // ===============================
//   getStudentsByBatch: (batchId) => {
//     return new Promise(async (resolve, reject) => {
//       try {
//         let students = await db.get()
//           .collection(collection.STUDENT_COLLECTION)
//           .find({ batchId: new ObjectId(batchId) })  // ✅ Proper filter
//           .toArray();

//         resolve(students);
//       } catch (err) {
//         console.error("❌ Error fetching students by batch:", err);
//         reject(err);
//       }
//     });
//   },
//   searchStudents: (keyword) => {
//     return new Promise(async (resolve, reject) => {
//       try {
//         const results = await db.get()
//           .collection(collection.STUDENT_COLLECTION)
//           .find({ name: { $regex: keyword, $options: "i" } })
//           .toArray();
//         resolve(results);
//       } catch (err) {
//         reject(err);
//       }
//     });
//   },
//   // ===============================
// // Get Student By ID (with Application Form)
// // ===============================
// getStudentById: async (studentId) => {
//     try {
//       return await db.get()
//         .collection(collection.STUDENT_COLLECTION)
//         .findOne({ _id: new ObjectId(studentId) });
//     } catch (err) {
//       console.error("❌ Error fetching student by ID:", err);
//       return null;
//     }
//   },
  
  
// };
  
var db = require('../config/connection');
var collection = require('../config/collections');
const { ObjectId } = require('mongodb');   // ✅ Import ObjectId

module.exports = {
  // ===============================
  // STUDENT LOGIN
  // ===============================
  doLogin: (loginData) => {
    return new Promise(async (resolve, reject) => {
      try {
        const { regNo, dob } = loginData;

        console.log("🟡 Login attempt for Reg No:", regNo);

        // Find student by registration number (case-insensitive)
        const student = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .findOne({ 
            regNo: { $regex: new RegExp(`^${regNo}$`, 'i') } 
          });

        if (!student) {
          console.log("❌ Student not found for Reg No:", regNo);
          resolve({ 
            status: false, 
            message: "Invalid Registration Number" 
          });
          return;
        }

        // Verify date of birth
        const studentDOB = new Date(student.dob).toISOString().split('T')[0];
        const inputDOB = new Date(dob).toISOString().split('T')[0];

        console.log("🟡 Comparing DOB - Student:", studentDOB, "Input:", inputDOB);

        if (studentDOB !== inputDOB) {
          console.log("❌ DOB mismatch for student:", student.regNo);
          resolve({ 
            status: false, 
            message: "Invalid Date of Birth" 
          });
          return;
        }

        // Check if student is active (if you have an isActive field)
        if (student.isActive === false) {
          console.log("❌ Student account inactive:", student.regNo);
          resolve({ 
            status: false, 
            message: "Your account is inactive. Please contact administrator." 
          });
          return;
        }

        console.log("✅ Login successful for student:", student.regNo);

        resolve({
          status: true,
          student: {
            id: student._id,
            name: student.name,
            regNo: student.regNo,
            email: student.email,
            phone: student.phone,
            centreId: student.centreId,
            centreName: student.centreName,
            batchId: student.batchId
          },
          regNo: student.regNo,
          studentId: student._id
        });

      } catch (err) {
        console.error("❌ Error in student login:", err);
        reject(err);
      }
    });
  },

  // ===============================
  // Get Student Profile with Batch Details
  // ===============================
  getStudentProfile: (studentId) => {
    return new Promise(async (resolve, reject) => {
      try {
        const student = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .aggregate([
            { $match: { _id: new ObjectId(studentId) } },
            {
              $lookup: {
                from: collection.BATCH_COLLECTION,
                localField: "batchId",
                foreignField: "_id",
                as: "batchDetails"
              }
            },
            {
              $lookup: {
                from: collection.CENTER_COLLECTION,
                let: { centreId: "$centreId" },
                pipeline: [
                  { 
                    $match: { 
                      $expr: { 
                        $eq: ["$centreId", "$$centreId"] 
                      } 
                    } 
                  }
                ],
                as: "centreDetails"
              }
            },
            { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } }
          ])
          .toArray();
  
        if (student.length === 0) {
          resolve({ status: false, message: "Student not found" });
          return;
        }
  
       
  
        resolve({ status: true, student: student[0] });
      } catch (err) {
        console.error("❌ Error fetching student profile:", err);
        reject(err);
      }
    });
  },

  // ===============================
  // Add Student (your existing function)
  // ===============================
  addStudent: (studentData, callback) => {
    try {
      let qualifications = [];

      // ✅ Process qualification arrays if available
      if (studentData.education) {
        qualifications = studentData.education.map((edu, i) => ({
          education: edu,
          maxMarks: studentData.maxMarks[i],
          minMarks: studentData.minMarks[i],
          obtainedMarks: studentData.obtainedMarks[i],
          grade: studentData.grade[i],
          year: studentData.year[i],
          board: studentData.board[i]
        }));
      }

      studentData.qualifications = qualifications;
      studentData.createdAt = new Date();

      // 🟢 Convert batchId to ObjectId
      if (studentData.batchId) {
        try {
          studentData.batchId = new ObjectId(studentData.batchId);
        } catch (err) {
          console.warn("⚠️ Invalid batchId format:", studentData.batchId);
        }
      }
      studentData.appliedForHallTicket = false;

      // Remove raw arrays
      delete studentData.education;
      delete studentData.maxMarks;
      delete studentData.minMarks;
      delete studentData.obtainedMarks;
      delete studentData.grade;
      delete studentData.year;
      delete studentData.board;

      db.get()
        .collection(collection.STUDENT_COLLECTION)
        .insertOne(studentData)
        .then((data) => {
          console.log("✅ Student added:", data.insertedId);
          callback(data.insertedId);
        })
        .catch((err) => {
          console.error("❌ DB Error while adding student:", err);
        });

    } catch (err) {
      console.error("❌ Error in addStudent:", err);
    }
  },

  // ===============================
  // Get All Students
  // ===============================
  getAllStudents: () => {
    return new Promise(async (resolve, reject) => {
      try {
        let students = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .aggregate([
            {
              $lookup: {
                from: collection.BATCH_COLLECTION,
                localField: "batchId",
                foreignField: "_id",
                as: "batchDetails"
              }
            },
            { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } }
          ])
          .toArray();
        resolve(students);
      } catch (err) {
        reject(err);
      }
    });
  },

  // ===============================
  // Delete Student
  // ===============================
  deleteStudent: (studentId) => {
    return new Promise((resolve, reject) => {
      db.get()
        .collection(collection.STUDENT_COLLECTION)
        .deleteOne({ _id: new ObjectId(studentId) })
        .then((response) => {
          console.log("✅ Student deleted:", response);
          resolve(response);
        })
        .catch((err) => {
          console.error("❌ Error deleting student:", err);
          reject(err);
        });
    });
  },

  // ===============================
  // Get Student Details
  // ===============================
  getStudentDetails: (studentId) => {
    return new Promise((resolve, reject) => {
      db.get()
        .collection(collection.STUDENT_COLLECTION)
        .findOne({ _id: new ObjectId(studentId) })
        .then((student) => resolve(student))
        .catch((err) => {
          console.error("❌ Error fetching student details:", err);
          reject(err);
        });
    });
  },

  // ===============================
  // Update Student
  // ===============================
  updateStudent: (studentId, studentDetails) => {
    try {
      let qualifications = [];

      // ✅ Build structured qualifications if form sent arrays
      if (studentDetails.education) {
        qualifications = studentDetails.education.map((edu, i) => ({
          education: edu,
          maxMarks: studentDetails.maxMarks[i],
          minMarks: studentDetails.minMarks[i],
          obtainedMarks: studentDetails.obtainedMarks[i],
          grade: studentDetails.grade[i],
          year: studentDetails.year[i],
          board: studentDetails.board[i]
        }));
      }

      // 🟢 Convert batchId to ObjectId if exists
      if (studentDetails.batchId) {
        try {
          studentDetails.batchId = new ObjectId(studentDetails.batchId);
        } catch (err) {
          console.warn("⚠️ Invalid batchId format in update:", studentDetails.batchId);
        }
      }

      // Remove raw arrays
      delete studentDetails.education;
      delete studentDetails.maxMarks;
      delete studentDetails.minMarks;
      delete studentDetails.obtainedMarks;
      delete studentDetails.grade;
      delete studentDetails.year;
      delete studentDetails.board;

      return db.get()
        .collection(collection.STUDENT_COLLECTION)
        .updateOne(
          { _id: new ObjectId(studentId) },
          {
            $set: {
              ...studentDetails,
              qualifications: qualifications
            }
          }
        );
    } catch (err) {
      console.error("❌ Error in updateStudent:", err);
    }
  },

  // ===============================
  // Get Students By Batch
  // ===============================
  getStudentsByBatch: (batchId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let students = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .find({ batchId: new ObjectId(batchId) })  // ✅ Proper filter
          .toArray();

        resolve(students);
      } catch (err) {
        console.error("❌ Error fetching students by batch:", err);
        reject(err);
      }
    });
  },

  // ===============================
  // Search Students
  // ===============================
  searchStudents: (keyword) => {
    return new Promise(async (resolve, reject) => {
      try {
        const searchTerm = keyword.trim();
        
        if (!searchTerm) {
          resolve([]);
          return;
        }
  
        const results = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .aggregate([
            {
              $match: {
                $or: [
                  { fullName: { $regex: searchTerm, $options: "i" } },
                  { regNo: { $regex: searchTerm, $options: "i" } },
                  { courseName: { $regex: searchTerm, $options: "i" } },
                  { email: { $regex: searchTerm, $options: "i" } },
                  { phone: { $regex: searchTerm, $options: "i" } },
                  { fatherName: { $regex: searchTerm, $options: "i" } },
                  { motherName: { $regex: searchTerm, $options: "i" } },
                  { centreName: { $regex: searchTerm, $options: "i" } },
                  { address: { $regex: searchTerm, $options: "i" } },
                  // Search in nested qualifications
                  { "qualifications.education": { $regex: searchTerm, $options: "i" } },
                  { "qualifications.board": { $regex: searchTerm, $options: "i" } }
                ]
              }
            },
            {
              $lookup: {
                from: collection.BATCH_COLLECTION,
                localField: "batchId",
                foreignField: "_id",
                as: "batchDetails"
              }
            },
            {
              $lookup: {
                from: collection.CENTER_COLLECTION,
                let: { centreId: "$centreId" },
                pipeline: [
                  { 
                    $match: { 
                      $expr: { 
                        $eq: ["$centreId", "$$centreId"] 
                      } 
                    } 
                  }
                ],
                as: "centreDetails"
              }
            },
            { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                batchName: "$batchDetails.batchName",
                centreName: "$centreDetails.centreName",
                hasMarks: { $cond: [{ $ifNull: ["$marks", false] }, true, false] }
              }
            },
            {
              $sort: { 
                fullName: 1, // Sort alphabetically by name
                regNo: 1
              }
            },
            {
              $limit: 100 // Limit results to prevent overload
            }
          ])
          .toArray();
  
        resolve(results);
      } catch (err) {
        console.error("❌ Error in searchStudents:", err);
        reject(err);
      }
    });
  },
// Update searchStudentsByCenter to debug
searchStudentsByCenter: (keyword, centreId) => {
  return new Promise(async (resolve, reject) => {
    try {
      console.log("🔍 searchStudentsByCenter called with:");
      console.log("Keyword:", keyword);
      console.log("CentreId:", centreId);
      console.log("CentreId type:", typeof centreId);
      
      const searchTerm = keyword.trim();
      
      if (!searchTerm) {
        resolve([]);
        return;
      }

      const results = await db.get()
        .collection(collection.STUDENT_COLLECTION)
        .aggregate([
          {
            $match: {
              centreId: centreId, // This should match your data type
              $or: [
                { fullName: { $regex: searchTerm, $options: "i" } },
                { regNo: { $regex: searchTerm, $options: "i" } },
                { courseName: { $regex: searchTerm, $options: "i" } },
                { email: { $regex: searchTerm, $options: "i" } },
                { phone: { $regex: searchTerm, $options: "i" } }
              ]
            }
          },
          // ... rest of your aggregation
        ])
        .toArray();

      console.log("✅ Found", results.length, "students");
      resolve(results);
    } catch (err) {
      console.error("❌ Error in searchStudentsByCenter:", err);
      reject(err);
    }
  });
},

  // ===============================
  // Get Student By ID (with Application Form)
  // ===============================
  getStudentById: async (studentId) => {
    try {
      return await db.get()
        .collection(collection.STUDENT_COLLECTION)
        .findOne({ _id: new ObjectId(studentId) });
    } catch (err) {
      console.error("❌ Error fetching student by ID:", err);
      return null;
    }
  },
  applyHallticket: (studentId) => {
    return new Promise(async (resolve, reject) => {
      try {
        await db.get().collection(collection.STUDENT_COLLECTION).updateOne(
          { _id: new ObjectId(studentId) },
          {
            $set: {
              appliedForHallTicket: true,
              hallticketStatus: "PENDING",
              hallticketAppliedAt: new Date()
            }
          }
        );
        resolve({ status: true });
      } catch (err) {
        console.error("❌ Error applying hallticket:", err);
        reject(err);
      }
    });
  },
  autoApproveHallticket: (studentId) => {
    return new Promise(async (resolve, reject) => {
      try {
        const student = await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .findOne(
            { _id: new ObjectId(studentId) },
            { projection: { hallticketStatus: 1, hallticketAppliedAt: 1 } }
          );
  
        if (!student) return resolve(false);
  
        // if already approved or not applied → skip
        if (student.hallticketStatus !== "PENDING") return resolve(false);
        if (!student.hallticketAppliedAt) return resolve(false);
  
        const appliedTime = new Date(student.hallticketAppliedAt);
        const now = new Date();
  
        const hoursPassed = (now - appliedTime) / (1000 * 60 * 60);
  
        if (hoursPassed >= 12) {
          await db.get()
            .collection(collection.STUDENT_COLLECTION)
            .updateOne(
              { _id: new ObjectId(studentId) },
              { $set: { hallticketStatus: "APPROVED" } }
            );
  
          console.log(`✅ Auto-approved hallticket for ${studentId}`);
          return resolve(true);
        }
  
        resolve(false);
  
      } catch (err) {
        console.error("❌ Error in autoApproveHallticket:", err);
        reject(err);
      }
    });
  },
    
};