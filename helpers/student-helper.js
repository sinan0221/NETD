

  
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
            { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
  
            // ✅ FIX: ObjectId → ObjectId join
            {
              $lookup: {
                from: collection.CENTER_COLLECTION,
                localField: "centreObjectId",
                foreignField: "_id",
                as: "centreDetails"
              }
            },
            { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } }
          ])
          .toArray();
  
        if (!student.length) {
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
  
  // // ===============================
  // // Get Student Profile with Batch Details
  // // ===============================
  // getStudentProfile: (studentId) => {
  //   return new Promise(async (resolve, reject) => {
  //     try {
  //       const student = await db.get()
  //         .collection(collection.STUDENT_COLLECTION)
  //         .aggregate([
  //           { $match: { _id: new ObjectId(studentId) } },
  //           {
  //             $lookup: {
  //               from: collection.BATCH_COLLECTION,
  //               localField: "batchId",
  //               foreignField: "_id",
  //               as: "batchDetails"
  //             }
  //           },
  //           {
  //             $lookup: {
  //               from: collection.CENTER_COLLECTION,
  //               let: { centreId: "$centreId" },
  //               pipeline: [
  //                 { 
  //                   $match: { 
  //                     $expr: { 
  //                       $eq: ["$centreId", "$$centreId"] 
  //                     } 
  //                   } 
  //                 }
  //               ],
  //               as: "centreDetails"
  //             }
  //           },
  //           { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
  //           { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } }
  //         ])
  //         .toArray();
  
  //       if (student.length === 0) {
  //         resolve({ status: false, message: "Student not found" });
  //         return;
  //       }
  
       
  
  //       resolve({ status: true, student: student[0] });
  //     } catch (err) {
  //       console.error("❌ Error fetching student profile:", err);
  //       reject(err);
  //     }
  //   });
  // },

  // ===============================
  // Add Student (your existing function)
  // ===============================
  // addStudent: (studentData, callback) => {
  //   try {
  //     let qualifications = [];

  //     // ✅ Process qualification arrays if available
  //     if (studentData.education) {
  //       qualifications = studentData.education.map((edu, i) => ({
  //         education: edu,
  //         maxMarks: studentData.maxMarks[i],
  //         minMarks: studentData.minMarks[i],
  //         obtainedMarks: studentData.obtainedMarks[i],
  //         grade: studentData.grade[i],
  //         year: studentData.year[i],
  //         board: studentData.board[i]
  //       }));
  //     }

  //     studentData.qualifications = qualifications;
  //     studentData.createdAt = new Date();

  //     // 🟢 Convert batchId to ObjectId
  //     if (studentData.batchId) {
  //       try {
  //         studentData.batchId = new ObjectId(studentData.batchId);
  //       } catch (err) {
  //         console.warn("⚠️ Invalid batchId format:", studentData.batchId);
  //       }
  //     }
  //     studentData.appliedForHallTicket = false;

  //     // Remove raw arrays
  //     delete studentData.education;
  //     delete studentData.maxMarks;
  //     delete studentData.minMarks;
  //     delete studentData.obtainedMarks;
  //     delete studentData.grade;
  //     delete studentData.year;
  //     delete studentData.board;

  //     db.get()
  //       .collection(collection.STUDENT_COLLECTION)
  //       .insertOne(studentData)
  //       .then((data) => {
  //         console.log("✅ Student added:", data.insertedId);
  //         callback(data.insertedId);
  //       })
  //       .catch((err) => {
  //         console.error("❌ DB Error while adding student:", err);
  //       });

  //   } catch (err) {
  //     console.error("❌ Error in addStudent:", err);
  //   }
  // },
  // addStudent: (studentData, callback) => {
  //   try {
  
  //     // 🟢 Do NOT rebuild qualifications
  //     // They already come as studentData.qualifications
  
  //     if (!Array.isArray(studentData.qualifications)) {
  //       studentData.qualifications = [];
  //     }
  
  //     studentData.createdAt = new Date();
  //     studentData.appliedForHallTicket = false;
  
  //     // 🟢 Convert batchId to ObjectId
  //     if (studentData.batchId) {
  //       try {
  //         studentData.batchId = new ObjectId(studentData.batchId);
  //       } catch (err) {
  //         console.warn("⚠️ Invalid batchId:", studentData.batchId);
  //       }
  //     }
  
  //     db.get()
  //       .collection(collection.STUDENT_COLLECTION)
  //       .insertOne(studentData)
  //       .then((data) => {
  //         console.log("✅ Student inserted with qualifications:", studentData.qualifications.length);
  //         callback(data.insertedId);
  //       })
  //       .catch((err) => {
  //         console.error("❌ DB Error inserting student:", err);
  //         callback(null);
  //       });
  
  //   } catch (err) {
  //     console.error("❌ Error in addStudent:", err);
  //     callback(null);
  //   }
  // },
  // addStudent: (studentData, callback) => {
  //   try {
  
  //     // ✅ FIX 1: Normalize centreId
  //     if (Array.isArray(studentData.centreId)) {
  //       studentData.centreId = studentData.centreId[0];
  //     }
  
  //     studentData.centreId = String(studentData.centreId).trim();
  
  //     // ✅ Keep qualifications safe
  //     if (!Array.isArray(studentData.qualifications)) {
  //       studentData.qualifications = [];
  //     }
  
  //     studentData.createdAt = new Date();
  //     studentData.appliedForHallTicket = false;
  
  //     // ✅ Convert batchId to ObjectId (this part was already correct)
  //     if (studentData.batchId) {
  //       try {
  //         studentData.batchId = new ObjectId(studentData.batchId);
  //       } catch (err) {
  //         console.warn("⚠️ Invalid batchId:", studentData.batchId);
  //       }
  //     }
  
  //     db.get()
  //       .collection(collection.STUDENT_COLLECTION)
  //       .insertOne(studentData)
  //       .then((data) => {
  //         console.log("✅ Student inserted with centreId:", studentData.centreId);
  //         callback(data.insertedId);
  //       })
  //       .catch((err) => {
  //         console.error("❌ DB Error inserting student:", err);
  //         callback(null);
  //       });
  
  //   } catch (err) {
  //     console.error("❌ Error in addStudent:", err);
  //     callback(null);
  //   }
  // },
  addStudent: (studentData, callback) => {
    try {
  
      // ✅ Normalize centreId (KEEP EXISTING LOGIC)
      if (Array.isArray(studentData.centreId)) {
        studentData.centreId = studentData.centreId[0];
      }
  
      studentData.centreId = String(studentData.centreId).trim();
  
      // ✅ Keep qualifications safe
      if (!Array.isArray(studentData.qualifications)) {
        studentData.qualifications = [];
      }
  
      studentData.createdAt = new Date();
      studentData.appliedForHallTicket = false;
  
      // ✅ Convert batchId to ObjectId (DO NOT TOUCH)
      if (studentData.batchId) {
        try {
          studentData.batchId = new ObjectId(studentData.batchId);
        } catch (err) {
          console.warn("⚠️ Invalid batchId:", studentData.batchId);
        }
      }
  
      // 🔹 NEW FIX: attach centreObjectId (SAFE ADD)
      db.get()
        .collection(collection.CENTER_COLLECTION)
        .findOne({ centreId: studentData.centreId })
        .then((center) => {
  
          if (center) {
            studentData.centreObjectId = center._id;
          } else {
            console.warn("⚠️ Center not found for centreId:", studentData.centreId);
          }
  
          return db.get()
            .collection(collection.STUDENT_COLLECTION)
            .insertOne(studentData);
        })
        .then((data) => {
          console.log(
            "✅ Student inserted:",
            "centreId =", studentData.centreId,
            "| centreObjectId =", studentData.centreObjectId
          );
          callback(data.insertedId);
        })
        .catch((err) => {
          console.error("❌ DB Error inserting student:", err);
          callback(null);
        });
  
    } catch (err) {
      console.error("❌ Error in addStudent:", err);
      callback(null);
    }
  },
  
  updateStudentImage: (studentId, imageName) => {
    return new Promise((resolve, reject) => {
      db.get().collection(collection.STUDENT_COLLECTION)
        .updateOne(
          { _id: new ObjectId(studentId) },
          { $set: { image: imageName } }
        )
        .then(resolve)
        .catch(reject);
    });
  },
  
  
  // // ===============================
  // // Get All Students
  // // ===============================
  // getAllStudents: () => {
  //   return new Promise(async (resolve, reject) => {
  //     try {
  //       let students = await db.get()
  //         .collection(collection.STUDENT_COLLECTION)
  //         .aggregate([
  //           {
  //             $lookup: {
  //               from: collection.BATCH_COLLECTION,
  //               localField: "batchId",
  //               foreignField: "_id",
  //               as: "batchDetails"
  //             }
  //           },
  //           { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } }
  //         ])
  //         .toArray();
  //       resolve(students);
  //     } catch (err) {
  //       reject(err);
  //     }
  //   });
  // },
  getAllStudents: () => {
    return new Promise(async (resolve, reject) => {
      try {
        const students = await db.get()
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
            {
              $lookup: {
                from: collection.CENTER_COLLECTION,
                localField: "centreObjectId",
                foreignField: "_id",
                as: "centreDetails"
              }
            },
            { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                batchName: "$batchDetails.batchName",
                centreName: "$centreDetails.centreName"
              }
            }
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

  // // ===============================
  // // Update Student
  // // ===============================
  // updateStudent: (studentId, studentDetails) => {
  //   try {
  //     let qualifications = [];

  //     // ✅ Build structured qualifications if form sent arrays
  //     if (studentDetails.education) {
  //       qualifications = studentDetails.education.map((edu, i) => ({
  //         education: edu,
  //         maxMarks: studentDetails.maxMarks[i],
  //         minMarks: studentDetails.minMarks[i],
  //         obtainedMarks: studentDetails.obtainedMarks[i],
  //         grade: studentDetails.grade[i],
  //         year: studentDetails.year[i],
  //         board: studentDetails.board[i]
  //       }));
  //     }

  //     // 🟢 Convert batchId to ObjectId if exists
  //     if (studentDetails.batchId) {
  //       try {
  //         studentDetails.batchId = new ObjectId(studentDetails.batchId);
  //       } catch (err) {
  //         console.warn("⚠️ Invalid batchId format in update:", studentDetails.batchId);
  //       }
  //     }

  //     // Remove raw arrays
  //     delete studentDetails.education;
  //     delete studentDetails.maxMarks;
  //     delete studentDetails.minMarks;
  //     delete studentDetails.obtainedMarks;
  //     delete studentDetails.grade;
  //     delete studentDetails.year;
  //     delete studentDetails.board;

  //     return db.get()
  //       .collection(collection.STUDENT_COLLECTION)
  //       .updateOne(
  //         { _id: new ObjectId(studentId) },
  //         {
  //           $set: {
  //             ...studentDetails,
  //             qualifications: qualifications
  //           }
  //         }
  //       );
  //   } catch (err) {
  //     console.error("❌ Error in updateStudent:", err);
  //   }
  // },
  // ===============================
// Update Student
// ===============================
updateStudent: async (studentId, studentDetails) => {
  try {
    let qualifications = [];

    // ✅ Normalize centreId (DO NOT remove this)
    if (studentDetails.centreId) {
      if (Array.isArray(studentDetails.centreId)) {
        studentDetails.centreId = studentDetails.centreId[0];
      }
      studentDetails.centreId = String(studentDetails.centreId).trim();

      // ✅ FIX: update centreObjectId when centreId changes
      const center = await db.get()
        .collection(collection.CENTER_COLLECTION)
        .findOne({ centreId: studentDetails.centreId });

      if (center) {
        studentDetails.centreObjectId = center._id;
      } else {
        console.warn("⚠️ Center not found for centreId:", studentDetails.centreId);
      }
    }

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

    return await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .updateOne(
        { _id: new ObjectId(studentId) },
        {
          $set: {
            ...studentDetails,
            qualifications
          }
        }
      );

  } catch (err) {
    console.error("❌ Error in updateStudent:", err);
    throw err;
  }
},

//   // ===============================
// // Update Student
// // ===============================
// updateStudent: (studentId, studentDetails) => {
//   try {
//     let qualifications = [];

//     // ✅ FIX 1: Normalize centreId (DO NOT remove this)
//     if (studentDetails.centreId) {
//       if (Array.isArray(studentDetails.centreId)) {
//         studentDetails.centreId = studentDetails.centreId[0];
//       }
//       studentDetails.centreId = String(studentDetails.centreId).trim();
//     }

//     // ✅ Build structured qualifications if form sent arrays
//     if (studentDetails.education) {
//       qualifications = studentDetails.education.map((edu, i) => ({
//         education: edu,
//         maxMarks: studentDetails.maxMarks[i],
//         minMarks: studentDetails.minMarks[i],
//         obtainedMarks: studentDetails.obtainedMarks[i],
//         grade: studentDetails.grade[i],
//         year: studentDetails.year[i],
//         board: studentDetails.board[i]
//       }));
//     }

//     // 🟢 Convert batchId to ObjectId if exists
//     if (studentDetails.batchId) {
//       try {
//         studentDetails.batchId = new ObjectId(studentDetails.batchId);
//       } catch (err) {
//         console.warn("⚠️ Invalid batchId format in update:", studentDetails.batchId);
//       }
//     }

//     // Remove raw arrays
//     delete studentDetails.education;
//     delete studentDetails.maxMarks;
//     delete studentDetails.minMarks;
//     delete studentDetails.obtainedMarks;
//     delete studentDetails.grade;
//     delete studentDetails.year;
//     delete studentDetails.board;

//     return db.get()
//       .collection(collection.STUDENT_COLLECTION)
//       .updateOne(
//         { _id: new ObjectId(studentId) },
//         {
//           $set: {
//             ...studentDetails,
//             qualifications: qualifications
//           }
//         }
//       );

//   } catch (err) {
//     console.error("❌ Error in updateStudent:", err);
//   }
// },


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
                { address: { $regex: searchTerm, $options: "i" } },
                { "qualifications.education": { $regex: searchTerm, $options: "i" } },
                { "qualifications.board": { $regex: searchTerm, $options: "i" } }
              ]
            }
          },

          // ✅ Batch join (unchanged)
          {
            $lookup: {
              from: collection.BATCH_COLLECTION,
              localField: "batchId",
              foreignField: "_id",
              as: "batchDetails"
            }
          },

          // ✅ FIX: Center join using ObjectId
          {
            $lookup: {
              from: collection.CENTER_COLLECTION,
              localField: "centreObjectId",
              foreignField: "_id",
              as: "centreDetails"
            }
          },

          { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
          { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } },

          {
            $addFields: {
              batchName: "$batchDetails.batchName",
              centreName: "$centreDetails.centreName",
              hasMarks: {
                $cond: [{ $ifNull: ["$marks", false] }, true, false]
              }
            }
          },

          {
            $sort: {
              fullName: 1,
              regNo: 1
            }
          },

          {
            $limit: 100
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

  // // ===============================
  // // Search Students
  // // ===============================
  // searchStudents: (keyword) => {
  //   return new Promise(async (resolve, reject) => {
  //     try {
  //       const searchTerm = keyword.trim();
        
  //       if (!searchTerm) {
  //         resolve([]);
  //         return;
  //       }
  
  //       const results = await db.get()
  //         .collection(collection.STUDENT_COLLECTION)
  //         .aggregate([
  //           {
  //             $match: {
  //               $or: [
  //                 { fullName: { $regex: searchTerm, $options: "i" } },
  //                 { regNo: { $regex: searchTerm, $options: "i" } },
  //                 { courseName: { $regex: searchTerm, $options: "i" } },
  //                 { email: { $regex: searchTerm, $options: "i" } },
  //                 { phone: { $regex: searchTerm, $options: "i" } },
  //                 { fatherName: { $regex: searchTerm, $options: "i" } },
  //                 { motherName: { $regex: searchTerm, $options: "i" } },
  //                 { centreName: { $regex: searchTerm, $options: "i" } },
  //                 { address: { $regex: searchTerm, $options: "i" } },
  //                 // Search in nested qualifications
  //                 { "qualifications.education": { $regex: searchTerm, $options: "i" } },
  //                 { "qualifications.board": { $regex: searchTerm, $options: "i" } }
  //               ]
  //             }
  //           },
  //           {
  //             $lookup: {
  //               from: collection.BATCH_COLLECTION,
  //               localField: "batchId",
  //               foreignField: "_id",
  //               as: "batchDetails"
  //             }
  //           },
  //           {
  //             $lookup: {
  //               from: collection.CENTER_COLLECTION,
  //               let: { centreId: "$centreId" },
  //               pipeline: [
  //                 { 
  //                   $match: { 
  //                     $expr: { 
  //                       $eq: ["$centreId", "$$centreId"] 
  //                     } 
  //                   } 
  //                 }
  //               ],
  //               as: "centreDetails"
  //             }
  //           },
  //           { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
  //           { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } },
  //           {
  //             $addFields: {
  //               batchName: "$batchDetails.batchName",
  //               centreName: "$centreDetails.centreName",
  //               hasMarks: { $cond: [{ $ifNull: ["$marks", false] }, true, false] }
  //             }
  //           },
  //           {
  //             $sort: { 
  //               fullName: 1, // Sort alphabetically by name
  //               regNo: 1
  //             }
  //           },
  //           {
  //             $limit: 100 // Limit results to prevent overload
  //           }
  //         ])
  //         .toArray();
  
  //       resolve(results);
  //     } catch (err) {
  //       console.error("❌ Error in searchStudents:", err);
  //       reject(err);
  //     }
  //   });
  // },
// Update searchStudentsByCenter to debug
// searchStudentsByCenter: (keyword, centreId) => {
//   return new Promise(async (resolve, reject) => {
//     try {
//       console.log("🔍 searchStudentsByCenter called with:");
//       console.log("Keyword:", keyword);
//       console.log("CentreId:", centreId);
//       console.log("CentreId type:", typeof centreId);
      
//       const searchTerm = keyword.trim();
      
//       if (!searchTerm) {
//         resolve([]);
//         return;
//       }

//       const results = await db.get()
//         .collection(collection.STUDENT_COLLECTION)
//         .aggregate([
//           {
//             $match: {
//               centreId: centreId, // This should match your data type
//               $or: [
//                 { fullName: { $regex: searchTerm, $options: "i" } },
//                 { regNo: { $regex: searchTerm, $options: "i" } },
//                 { courseName: { $regex: searchTerm, $options: "i" } },
//                 { email: { $regex: searchTerm, $options: "i" } },
//                 { phone: { $regex: searchTerm, $options: "i" } }
//               ]
//             }
//           },
//           // ... rest of your aggregation
//         ])
//         .toArray();

//       console.log("✅ Found", results.length, "students");
//       resolve(results);
//     } catch (err) {
//       console.error("❌ Error in searchStudentsByCenter:", err);
//       reject(err);
//     }
//   });
// },
searchStudentsByCenter: (keyword, centreId) => {
  return new Promise(async (resolve, reject) => {
    try {
      const searchTerm = keyword.trim();
      if (!searchTerm) {
        resolve([]);
        return;
      }

      let centreObjectId = null;
      try {
        centreObjectId = new ObjectId(centreId);
      } catch (e) {}

      const results = await db.get()
        .collection(collection.STUDENT_COLLECTION)
        .aggregate([
          {
            $match: {
              $or: [
                { centreObjectId: centreObjectId },
                { centreId: centreId } // fallback for old data
              ],
              $and: [
                {
                  $or: [
                    { fullName: { $regex: searchTerm, $options: "i" } },
                    { regNo: { $regex: searchTerm, $options: "i" } },
                    { courseName: { $regex: searchTerm, $options: "i" } },
                    { email: { $regex: searchTerm, $options: "i" } },
                    { phone: { $regex: searchTerm, $options: "i" } }
                  ]
                }
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
              localField: "centreObjectId",
              foreignField: "_id",
              as: "centreDetails"
            }
          },
          { $unwind: { path: "$batchDetails", preserveNullAndEmptyArrays: true } },
          { $unwind: { path: "$centreDetails", preserveNullAndEmptyArrays: true } }
        ])
        .toArray();

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
  autoApproveHallticketsByBatch: async (batchId) => {
    try {
      const students = await db.get()
        .collection(collection.STUDENT_COLLECTION)
        .find({
          batchId: batchId,
          hallticketStatus: "PENDING",
          hallticketAppliedAt: { $exists: true }
        })
        .toArray();
  
      const now = new Date();
  
      for (const student of students) {
        const appliedTime = new Date(student.hallticketAppliedAt);
        const hoursPassed = (now - appliedTime) / (1000 * 60 * 60);
  
        if (hoursPassed >= 12) {
          await db.get()
            .collection(collection.STUDENT_COLLECTION)
            .updateOne(
              { _id: student._id },
              { $set: { hallticketStatus: "APPROVED" } }
            );
  
          console.log(`✅ Auto-approved hallticket: ${student._id}`);
        }
      }
    } catch (err) {
      console.error("❌ Batch auto-approve error:", err);
    }
  },
  applyHallticketByBatch: async (batchId, examDate, examTime) => {
    try {
      const students = await db.get()
        .collection(collection.STUDENT_COLLECTION)
        .find({ batchId: new ObjectId(batchId) }) // ✅ FIX
        .toArray();
  
      if (!students.length) {
        console.log(`⚠️ No students found for batch ${batchId}`);
        return false;
      }
  
      for (const student of students) {
  
        if (student.appliedForHallTicket === true) continue;
  
        const applicationForm = {
          studentId: student._id,
          candidateName: student.fullName || student.name || "",
          courseName: student.courseName || "",
          studyCentre: student.centreName || "",
          examCentre: student.centreName || "",
          examDate,
          examTime,
          registerNumber: student.regNo || "",
          studentName: student.fullName || student.name || "",
          createdAt: new Date()
        };
  
        await db.get()
          .collection(collection.STUDENT_COLLECTION)
          .updateOne(
            { _id: student._id },
            {
              $set: {
                appliedForHallTicket: true,
                hallticketStatus: "PENDING",
                hallticketAppliedAt: new Date(),
                applicationForm
              }
            }
          );
      }
  
      console.log(`✅ Hall ticket applied for batch ${batchId}`);
      return true;
  
    } catch (err) {
      console.error("❌ applyHallticketByBatch error:", err);
      throw err;
    }
  }
  
  
    
    
};