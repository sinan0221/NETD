
const db = require('../config/connection');
const collection = require('../config/collections');
const { ObjectId } = require('mongodb');

module.exports = {

  addBatch: async (batch, callback) => {
    try {
      // Convert centreId to ObjectId
      if (batch.centreId && ObjectId.isValid(batch.centreId)) {
        batch.centreId = new ObjectId(batch.centreId);
      }
  
      // ✅ Fetch centre record to get centreName
      const centre = await db.get()
        .collection(collection.CENTER_COLLECTION)
        .findOne({ _id: batch.centreId });
  
      if (!centre) {
        console.error("❌ Centre not found while adding batch");
        return callback(null);
      }
  
      // ✅ Add centreName to batch object
      batch.centreName = centre.centreName;
  
      // Insert batch
      db.get().collection(collection.BATCH_COLLECTION)
        .insertOne(batch)
        .then((data) => {
          console.log("✅ Batch added:", batch);
          callback(data.insertedId);
        })
        .catch((err) => {
          console.error("❌ Error adding batch:", err);
        });
    } catch (err) {
      console.error("❌ Error in addBatch:", err);
    }
  },
  
// ===============================
//  GET ALL BATCHES WITH LAST TIMETABLE
// ===============================
getAllBatchesWithCentre: () => {
  return new Promise(async (resolve, reject) => {
    try {
      let batches = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .aggregate([
          {
            $lookup: {
              from: collection.CENTER_COLLECTION,
              localField: "centreId",
              foreignField: "_id",
              as: "centre"
            }
          },
          { $unwind: "$centre" },

          // Student Count
          {
            $lookup: {
              from: collection.STUDENT_COLLECTION,
              localField: "_id",
              foreignField: "batchId",
              as: "students"
            }
          },
          {
            $addFields: {
              nostudents: { $size: "$students" }
            }
          },

          // 🔥 TIMETABLE (latest only)
          {
            $lookup: {
              from: collection.TIMETABLE_COLLECTION,
              let: { batchId: "$_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$batchId", "$$batchId"] } } },
                { $sort: { createdAt: -1, _id: -1 } },
                { $limit: 1 }
              ],
              as: "timetable"
            }
          },
          {
            $addFields: {
              timetable: { $arrayElemAt: ["$timetable", 0] }
            }
          },
          // Ensure active field exists (set default if not)
          {
            $addFields: {
              active: { $ifNull: ["$active", false] }
            }
          }
        ])
        .toArray();

      resolve(batches);
    } catch (err) {
      reject(err);
    }
  });
},
getBatchesByStatusAndCentre: (status, centreId) => {
  return new Promise(async (resolve, reject) => {
    try {
      let batches = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .aggregate([
          // ✅ ENSURE active FIELD EXISTS
          {
            $addFields: {
              active: { $ifNull: ["$active", false] }
            }
          },
          {
            $match: {
              active: status,
              centreId: new ObjectId(centreId)
            }
          },
          {
            $lookup: {
              from: collection.CENTER_COLLECTION,
              localField: "centreId",
              foreignField: "_id",
              as: "centre"
            }
          },
          { $unwind: "$centre" },
          {
            $lookup: {
              from: collection.STUDENT_COLLECTION,
              localField: "_id",
              foreignField: "batchId",
              as: "students"
            }
          },
          {
            $addFields: {
              nostudents: { $size: "$students" }
            }
          }
        ])
        .toArray();

      resolve(batches);
    } catch (err) {
      reject(err);
    }
  });
},

// ===============================
//  GET BATCH BY ID  (Needed for PDF Preview)
// ===============================
getBatchById: async (batchId) => {
  try {
    if (!ObjectId.isValid(batchId)) {
      console.log("❌ Invalid batchId:", batchId);
      return null;
    }

    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne({ _id: new ObjectId(batchId) });

    return batch;

  } catch (err) {
    console.error("❌ Error in getBatchById:", err);
    return null;
  }
},
// Get batches by status (active/inactive)
getBatchesByStatus: (status) => {
  return new Promise(async (resolve, reject) => {
    try {
      let batches = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .aggregate([
          {
            $addFields: {
              active: { $ifNull: ["$active", false] }
            }
          },
          {
            $match: { active: status }
          },
          {
            $lookup: {
              from: collection.CENTER_COLLECTION,
              localField: "centreId",
              foreignField: "_id",
              as: "centre"
            }
          },
          { $unwind: { path: "$centre", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: collection.STUDENT_COLLECTION,
              localField: "_id",
              foreignField: "batchId",
              as: "students"
            }
          },
          {
            $addFields: {
              nostudents: { $size: "$students" }
            }
          }
        ])
        .toArray();

      resolve(batches);
    } catch (err) {
      reject(err);
    }
  });
},


updateBatch: (batchId, batchDetails) => {
  return new Promise((resolve, reject) => {

    let updateFields = {};

    Object.keys(batchDetails).forEach(key => {
      if (batchDetails[key] !== undefined) {
        updateFields[key] = batchDetails[key];
      }
    });

    db.get()
      .collection(collection.BATCH_COLLECTION)
      .updateOne(
        { _id: new ObjectId(batchId) },
        { $set: updateFields }
      )
      .then(resolve)
      .catch(reject);
  });
},

  
  // ✅ Get Batches By Centre (with applied certificate status)
// Get ACTIVE Batches By Centre (with certificateType and 1-month hide)
getBatchesByCentre: (centreId) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!centreId || !ObjectId.isValid(centreId)) {
        return reject("❌ Invalid centreId passed to getBatchesByCentre");
      }

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      let batches = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .aggregate([
          {
            $match: {
              centreId: new ObjectId(centreId),

              // ✅ ONLY ACTIVE & NOT DELETED
              active: true,
              isDeleted: { $ne: true },

              // ✅ Certificate download 1-month rule
              $or: [
                { certificateDownloadAt: { $exists: false } },
                { certificateDownloadAt: null },
                { certificateDownloadAt: { $gte: oneMonthAgo } }
              ]
            }
          },

          // 🔍 Fetch students for each batch
          {
            $lookup: {
              from: collection.STUDENT_COLLECTION,
              localField: "_id",
              foreignField: "batchId",
              as: "students"
            }
          },

          // 🔍 Extract certificateType from first student
          {
            $addFields: {
              certificateType: {
                $ifNull: [
                  { $arrayElemAt: ["$students.certificateType", 0] },
                  "one"
                ]
              }
            }
          },

          // ❌ Remove students array
          {
            $project: {
              students: 0
            }
          }
        ])
        .toArray();

      resolve(batches);
    } catch (err) {
      console.error("❌ Error fetching batches by centre id:", err);
      reject(err);
    }
  });
},





  // Search Batches
  searchBatches: (keyword) => {
    return new Promise(async (resolve, reject) => {
      try {
        const results = await db.get()
          .collection(collection.BATCH_COLLECTION)
          .find({ batchName: { $regex: keyword, $options: "i" } })
          .toArray();
        resolve(results);
      } catch (err) {
        reject(err);
      }
    });
  },



addTimetable: async (data) => {
  try {
    const timetable = { ...data };

    // Convert batchId to ObjectId (must match batch._id)
    if (timetable.batchId && ObjectId.isValid(timetable.batchId)) {
      timetable.batchId = new ObjectId(timetable.batchId);
    } else {
      throw new Error('Invalid batchId');
    }

    // Convert centreId to ObjectId
    if (timetable.centreId && ObjectId.isValid(timetable.centreId)) {
      timetable.centreId = new ObjectId(timetable.centreId);
    }

    // Handle subjects array
    if (!Array.isArray(timetable.subjects)) {
      if (Array.isArray(timetable.schedule)) {
        timetable.subjects = timetable.schedule;
      } else {
        timetable.subjects = [];
      }
    }

    delete timetable.schedule;

    // Add createdAt
    timetable.createdAt = new Date();

    const response = await db.get()
      .collection(collection.TIMETABLE_COLLECTION)
      .insertOne(timetable);

    console.log("📌 Timetable Saved:", response.insertedId);
    return response.insertedId;

  } catch (err) {
    console.error("❌ Error saving timetable:", err);
    throw err;
  }
},

// ===============================
// GET TIMETABLE BY BATCH (Latest)
// ===============================
getTimetableByBatch: async (batchId) => {
  try {
    let query = {};

    if (ObjectId.isValid(batchId)) {
      query.batchId = new ObjectId(batchId);
    } else {
      query.batchId = batchId; // fallback for numeric IDs
    }

    const timetable = await db.get()
      .collection(collection.TIMETABLE_COLLECTION)
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();

    return timetable[0] || null;

  } catch (err) {
    console.error("❌ Error fetching timetable:", err);
    throw err;
  }
},

// ===============================
// GET TIMETABLES BY CENTRE (Latest per batch)
// ===============================
getTimetablesByCentre: async (centreId) => {
  try {
    if (!ObjectId.isValid(centreId)) return [];

    const timetables = await db.get()
      .collection(collection.TIMETABLE_COLLECTION)
      .aggregate([
        { $match: { centreId: new ObjectId(centreId) } },
        { $sort: { batchId: 1, createdAt: -1 } },
        { $group: { _id: "$batchId", timetable: { $first: "$$ROOT" } } }
      ])
      .toArray();

    return timetables.map(t => t.timetable);

  } catch (err) {
    console.error("❌ Error fetching timetables by centre:", err);
    throw err;
  }
},
// ===============================
// DASHBOARD STATS (BY CENTRE) – FINAL FIX
// ===============================
getDashboardStatsByCentre: async (centreId) => {
  try {
    const centreObjectId = new ObjectId(centreId);

    // ✅ TOTAL STUDENTS (THIS CENTRE ONLY)
    const totalStudents = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .countDocuments({
        centreId: centreObjectId
      });

    // ✅ PENDING STUDENTS (activated = false OR missing)
    const pendingStudents = await db.get()
      .collection(collection.STUDENT_COLLECTION)
      .countDocuments({
        centreId: centreObjectId,
        $or: [
          { activated: false },
          { activated: { $exists: false } }
        ]
      });

    // ✅ ACTIVE BATCHES
    const activeBatches = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .countDocuments({
        centreId: centreObjectId,
        active: true
      });

    // ✅ INACTIVE BATCHES
    const inactiveBatches = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .countDocuments({
        centreId: centreObjectId,
        $or: [
          { active: false },
          { active: { $exists: false } }
        ]
      });

    // ✅ EXAMS
    const examsScheduled = await db.get()
      .collection(collection.TIMETABLE_COLLECTION)
      .countDocuments({
        centreId: centreObjectId
      });

    return {
      totalStudents,
      pendingStudents,
      activeBatches,
      inactiveBatches,
      examsScheduled
    };

  } catch (err) {
    console.error("❌ Dashboard stats error:", err);
    return {
      totalStudents: 0,
      pendingStudents: 0,
      activeBatches: 0,
      inactiveBatches: 0,
      examsScheduled: 0
    };
  }
},



// ===============================
//  ADD/UPDATE QUESTION PAPER TO BATCH (OVERWRITE OLD)
// ===============================

// ===============================
//  ADD/UPDATE QUESTION PAPER TO BATCH (UPDATED FOR NEW FORMAT)
// ===============================
addQuestionPaper: async (batchId, questionPaperData) => {
  try {
    if (!ObjectId.isValid(batchId)) {
      throw new Error("Invalid batch ID");
    }

    console.log("📝 Adding question paper with data:", questionPaperData);

    // Add timestamp and ID
    questionPaperData.createdAt = new Date();
    questionPaperData._id = new ObjectId();
    
    // ✅ BACKWARD COMPATIBILITY: Ensure courseCode exists for old data
    if (!questionPaperData.courseCode && questionPaperData.courseName) {
      questionPaperData.courseCode = questionPaperData.courseName;
    }
    
    // ✅ FORWARD COMPATIBILITY: Ensure courseName exists
    if (!questionPaperData.courseName && questionPaperData.courseCode) {
      questionPaperData.courseName = questionPaperData.courseCode;
    }

    // ✅ Ensure department exists (default empty string)
    if (!questionPaperData.department) {
      questionPaperData.department = '';
    }

    // ✅ Ensure sectionsJson exists (default empty string)
    if (!questionPaperData.sectionsJson) {
      questionPaperData.sectionsJson = '';
    }

    // ✅ Ensure questionsJson exists (default empty string)
    if (!questionPaperData.questionsJson) {
      questionPaperData.questionsJson = '';
    }

    // Build query to check for existing paper
    const existingQuery = {
      _id: new ObjectId(batchId),
      "questionPapers.courseCode": questionPaperData.courseCode || '',
      "questionPapers.subject": questionPaperData.subject || '',
      "questionPapers.examType": questionPaperData.examType || ''
    };

    // Check if question paper already exists
    const batch = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .findOne(existingQuery);

    let result;
    
    if (batch) {
      // Remove old question paper and add new one (overwrite)
      result = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .updateOne(
          existingQuery,
          {
            $pull: {
              questionPapers: {
                courseCode: questionPaperData.courseCode || '',
                subject: questionPaperData.subject || '',
                examType: questionPaperData.examType || ''
              }
            }
          }
        );

      console.log("🗑️ Old question paper removed for overwrite");
    }

    // Add new question paper
    result = await db.get()
      .collection(collection.BATCH_COLLECTION)
      .updateOne(
        { _id: new ObjectId(batchId) },
        {
          $push: {
            questionPapers: questionPaperData
          },
          $set: {
            updatedAt: new Date()
          }
        },
        { upsert: false }
      );

    console.log("✅ Question paper added/updated in batch:", batchId);
    console.log("📄 Paper details:", {
      courseName: questionPaperData.courseName,
      subject: questionPaperData.subject,
      examType: questionPaperData.examType,
      hasSections: !!questionPaperData.sectionsJson,
      hasQuestions: !!questionPaperData.questionsJson
    });

    return result;

  } catch (err) {
    console.error("❌ Error adding question paper to batch:", err);
    throw err;
  }
},

// ===============================
//  GET QUESTION PAPERS BY BATCH
// ===============================

// ===============================
//  GET QUESTION PAPERS BY BATCH (UPDATED)
// ===============================
getQuestionPapersByBatch: (batchId) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!ObjectId.isValid(batchId)) {
        return reject("Invalid batch ID");
      }

      const batch = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .findOne(
          { _id: new ObjectId(batchId) },
          { projection: { questionPapers: 1 } }
        );

      // Process each paper to ensure backward compatibility
      const papers = (batch?.questionPapers || []).map(paper => {
        // ✅ Ensure new fields exist
        if (!paper.courseName && paper.courseCode) {
          paper.courseName = paper.courseCode;
        }
        if (!paper.courseCode && paper.courseName) {
          paper.courseCode = paper.courseName;
        }
        if (!paper.department) {
          paper.department = '';
        }
        if (!paper.sectionsJson) {
          paper.sectionsJson = '';
        }
        if (!paper.questionsJson) {
          paper.questionsJson = '';
        }
        
        return paper;
      });

      // Sort by creation date (newest first)
      papers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      resolve(papers);
    } catch (err) {
      console.error("❌ Error fetching question papers from batch:", err);
      reject(err);
    }
  });
},
// ===============================
//  GET QUESTION PAPER BY FILTER
// ===============================

// ===============================
//  GET QUESTION PAPER BY FILTER (UPDATED)
// ===============================
getQuestionPaper: (batchId, courseCode, subject, examType) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!ObjectId.isValid(batchId)) {
        return reject("Invalid batch ID");
      }

      const batch = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .findOne(
          {
            _id: new ObjectId(batchId),
            $or: [
              { "questionPapers.courseCode": courseCode },
              { "questionPapers.courseName": courseCode }
            ],
            "questionPapers.subject": subject,
            "questionPapers.examType": examType
          },
          { projection: { "questionPapers.$": 1 } }
        );

      const paper = batch?.questionPapers?.[0] || null;
      
      // ✅ Ensure backward compatibility
      if (paper) {
        if (!paper.courseName && paper.courseCode) {
          paper.courseName = paper.courseCode;
        }
        if (!paper.courseCode && paper.courseName) {
          paper.courseCode = paper.courseName;
        }
        if (!paper.department) {
          paper.department = '';
        }
        if (!paper.sectionsJson) {
          paper.sectionsJson = '';
        }
        if (!paper.questionsJson) {
          paper.questionsJson = '';
        }
      }

      resolve(paper);
    } catch (err) {
      console.error("❌ Error fetching specific question paper:", err);
      reject(err);
    }
  });
},

// ===============================
//  GET ALL QUESTION PAPERS (FOR ADMIN VIEW)
// ===============================

getAllQuestionPapers: () => {
  return new Promise(async (resolve, reject) => {
    try {
      const batches = await db.get()
        .collection(collection.BATCH_COLLECTION)
        .aggregate([
          {
            $match: {
              questionPapers: { $exists: true, $ne: [] }
            }
          },
          {
            $unwind: "$questionPapers"
          },
          {
            $project: {
              batchName: 1,
              batchId: 1,
              centreName: 1,
              questionPaper: "$questionPapers"
            }
          },
          {
            $sort: { "questionPaper.createdAt": -1 }
          }
        ])
        .toArray();

      resolve(batches);
    } catch (err) {
      console.error("❌ Error fetching all question papers:", err);
      reject(err);
    }
  });
},


};
