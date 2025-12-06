
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

  // getAllBatchesWithCentre: () => {
  //   return new Promise(async (resolve, reject) => {
  //     try {
  //       let batches = await db.get()
  //         .collection(collection.BATCH_COLLECTION)
  //         .aggregate([
  //           {
  //             $lookup: {
  //               from: collection.CENTER_COLLECTION,
  //               localField: "centreId",
  //               foreignField: "_id",
  //               as: "centre"
  //             }
  //           },
  //           { $unwind: "$centre" },
  
  //           // 🔍 Student Count
  //           {
  //             $lookup: {
  //               from: collection.STUDENT_COLLECTION,
  //               localField: "_id",
  //               foreignField: "batchId",
  //               as: "students"
  //             }
  //           },
  //           {
  //             $addFields: {
  //               nostudents: { $size: "$students" }
  //             }
  //           },
  
  //           // 🔍 Add timetable lookup here
  //           {
  //             $lookup: {
  //               from: collection.TIMETABLE_COLLECTION,
  //               localField: "_id",
  //               foreignField: "batchId",
  //               as: "timetable"
  //             }
  //           },
  
  //           // 🔍 timetable is an array — get first element
           
  //         ])
  //         .toArray();
  
  //       resolve(batches);
  //     } catch (err) {
  //       reject(err);
  //     }
  //   });
  // },
  

  // getAllBatchesWithCentre: () => {
  //   return new Promise(async (resolve, reject) => {
  //     try {
  //       let batches = await db.get()
  //         .collection(collection.BATCH_COLLECTION)
  //         .aggregate([
  //           {
  //             $lookup: {
  //               from: collection.CENTER_COLLECTION,
  //               localField: "centreId",
  //               foreignField: "_id",
  //               as: "centre"
  //             }
  //           },
  //           { $unwind: "$centre" },
  //           // ✅ Add student count lookup
  //           {
  //             $lookup: {
  //               from: collection.STUDENT_COLLECTION,
  //               localField: "_id",
  //               foreignField: "batchId", // ✅ matches your student field
  //               as: "students"
  //             }
  //           },
  //           // ✅ Add a field for number of students
  //           {
  //             $addFields: {
  //               nostudents: { $size: "$students" }
  //             }
  //           }
  //         ])
  //         .toArray();
  
  //       resolve(batches);
  //     } catch (err) {
  //       reject(err);
  //     }
  //   });
  // },
  

  // Update Batch
  updateBatch: (batchId, batchDetails) => {
    return new Promise((resolve, reject) => {
      db.get()
        .collection(collection.BATCH_COLLECTION)
        .updateOne(
          { _id: new ObjectId(batchId) },
          {
            $set: {
              directorId: batchDetails.directorId,
              batchNo: batchDetails.batchNo,
              batchId: batchDetails.batchId,
              batchName: batchDetails.batchName,
              nostudents: batchDetails.nostudents,
            }
          }
        )
        .then((response) => resolve(response))
        .catch((err) => reject(err));
    });
  },

  
  // ✅ Get Batches By Centre (with applied certificate status)
// Get Batches By Centre (with certificateType and 1-month hide)
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
          // 🔍 Extract certificateType from the first student
          {
            $addFields: {
              certificateType:
                { $ifNull: [{ $arrayElemAt: ["$students.certificateType", 0] }, "one"] }
            }
          },
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
 // ===============================
//  ADD TIMETABLE
// ===============================

// addTimetable: async (data) => {
//   try {
//     const timetable = { ...data };

//     // Convert batchId to ObjectId
//     if (timetable.batchId && ObjectId.isValid(timetable.batchId)) {
//       timetable.batchId = new ObjectId(timetable.batchId);
//     }

//     // Force schedule to always be an array
//     if (!Array.isArray(timetable.schedule)) {
//       timetable.schedule = [timetable.schedule];
//     }

//     let response = await db.get()
//       .collection(collection.TIMETABLE_COLLECTION)
//       .insertOne(timetable);

//     console.log("📌 Timetable Saved:", response.insertedId);
//     return response.insertedId;

//   } catch (err) {
//     console.error("❌ Error saving timetable:", err);
//     throw err;
//   }
// },

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

};
