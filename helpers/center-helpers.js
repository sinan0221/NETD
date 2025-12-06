
  
  
  
  
  
const db = require('../config/connection');
const collection = require('../config/collections');
const { ObjectId } = require('mongodb');

module.exports = {

  // Add a new center
  addCenter: (center, callback) => {
    db.get()
      .collection(collection.CENTER_COLLECTION)
      .insertOne(center)
      .then((data) => callback(data))
      .catch((err) => console.error("❌ Error adding center:", err));
  },


getAllCenters: () => {
    return new Promise(async (resolve, reject) => {
      try {
        const centers = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .find()
          .toArray();
  
        const now = new Date();
        const sixMonthsAgo = new Date(now);
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
        const oneYearAgo = new Date(now);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
        for (let centre of centers) {
          const centreId = centre._id;
  
          const sixMonthCount = await db.get()
            .collection(collection.STUDENT_COLLECTION)
            .countDocuments({
              centreId: centreId,
              createdAt: { $gte: sixMonthsAgo }
            });
  
          const oneYearCount = await db.get()
            .collection(collection.STUDENT_COLLECTION)
            .countDocuments({
              centreId: centreId,
              createdAt: { $gte: oneYearAgo }
            });
  
          let grade = "";
          let stars = "";
  
          if (sixMonthCount <= 9) { grade = "D"; stars = "★"; }
          else if (sixMonthCount >= 10 && sixMonthCount <= 25) { grade = "C"; stars = "★★"; }
          else if (oneYearCount >= 26 && oneYearCount <= 50) { grade = "B"; stars = "★★★"; }
          else if (oneYearCount >= 51 && oneYearCount <= 90) { grade = "A"; stars = "★★★★"; }
          else if (oneYearCount >= 91) { grade = "A+"; stars = "★★★★★"; }
  
          centre.grade = grade;
          centre.stars = stars;
        }
  
        resolve(centers);
  
      } catch (err) {
        reject(err);
      }
    });
  },
  

  // Delete a center by _id
  deleteCenter: (centerId) => {
    return new Promise((resolve, reject) => {
      db.get()
        .collection(collection.CENTER_COLLECTION)
        .deleteOne({ _id: new ObjectId(centerId) })
        .then((response) => resolve(response))
        .catch((err) => reject(err));
    });
  },

  // Get center details by _id
  getCenterDetails: (centerId) => {
    return new Promise((resolve, reject) => {
      db.get()
        .collection(collection.CENTER_COLLECTION)
        .findOne({ _id: new ObjectId(centerId) })
        .then((center) => resolve(center))
        .catch((err) => reject(err));
    });
  },

  // Update center details
  updateCenter: (centerId, centerDetails) => {
    return new Promise((resolve, reject) => {
      db.get()
        .collection(collection.CENTER_COLLECTION)
        .updateOne(
          { _id: new ObjectId(centerId) },
          {
            $set: {
              centreId: centerDetails.centreId,
              centreName: centerDetails.centreName,
              address: centerDetails.address,
              centreDirector: centerDetails.centreDirector,
              email: centerDetails.email,
              scheme: centerDetails.scheme,
              college: centerDetails.college,
              sector: centerDetails.sector,
              department: centerDetails.department,
              courseName: centerDetails.courseName
            },
          }
        )
        .then((response) => resolve(response))
        .catch((err) => reject(err));
    });
  },
  // Add new dropdown value (like department, scheme, etc.) to a specific center
addCenterFieldValue: (centerId, fieldType, value) => {
    return new Promise(async (resolve, reject) => {
      try {
        const fieldMap = {
          department: 'addedValues.departments',
          sector: 'addedValues.sectors',
          scheme: 'addedValues.schemes',
          college: 'addedValues.colleges'
        };
  
        const fieldPath = fieldMap[fieldType];
        if (!fieldPath) return reject("Invalid field type");
  
        await db.get()
          .collection(collection.CENTER_COLLECTION)
          .updateOne(
            { _id: new ObjectId(centerId) },
            { $addToSet: { [fieldPath]: value } } // avoids duplicates
          );
  
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  },
  
  
  // Get added dropdown values for a specific center
  getCenterFieldValues: (centerId) => {
    return new Promise(async (resolve, reject) => {
      try {
        const center = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .findOne({ _id: new ObjectId(centerId) });
  
        resolve(center?.addedValues || {
          departments: [],
          sectors: [],
          schemes: [],
          colleges: []
        });
      } catch (err) {
        reject(err);
      }
    });
  },
  

  // Search centers by keyword (case-insensitive)
  searchCenters: (keyword) => {
    return new Promise(async (resolve, reject) => {
      try {
        const results = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .find({ centreName: { $regex: keyword, $options: "i" } })
          .toArray();
        resolve(results);
      } catch (err) {
        reject(err);
      }
    });
  },

  // Update institution logo path
  updateCenterLogo: (centreId, logoPath) => {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .updateOne(
            { centreId: centreId },
            { $set: { institutionLogo: logoPath } }
          );

        if (result.matchedCount === 0) {
          reject(new Error("No center found with that Centre ID."));
        } else {
          resolve(result);
        }
      } catch (err) {
        reject(err);
      }
    });
  },

  // Update department logo path
  // ✅ Update department logo path (new version)
updateDepartmentLogo: (centreId, departmentName, logoPath) => {
    return new Promise(async (resolve, reject) => {
      try {
        if (!centreId || !departmentName || !logoPath) {
          return reject(new Error("Missing required parameters."));
        }
  
        const center = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .findOne({ centreId: centreId });
  
        if (!center) return reject(new Error("No center found with that Centre ID."));
  
        // Use a readable key instead of normalized one
        const keyPath = `departmentLogos.${departmentName}`;
  
        const result = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .updateOne(
            { centreId: centreId },
            { $set: { [keyPath]: logoPath } }
          );
  
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  },
  

  // Get center by Centre ID
  getCenterById: async (centreId) => {
    try {
      const center = await db.get()
        .collection(collection.CENTER_COLLECTION)
        .findOne({ centreId: centreId });
      return center || null;
    } catch (err) {
      console.error("❌ Error fetching center by ID:", err);
      return null;
    }
  },


getDepartmentLogo: async (centreId, departmentName) => {
    try {
      if (!departmentName) return null;
  
      const center = await db.get()
        .collection(collection.CENTER_COLLECTION)
        .findOne({ centreId: centreId });
  
      if (!center) {
        console.log("❌ No center found for centreId:", centreId);
        return null;
      }
  
      if (!center.departmentLogos) {
        console.log("❌ No departmentLogos field found for:", centreId);
        return null;
      }
  
      // 🟢 Case-insensitive match for department name
      const deptKeys = Object.keys(center.departmentLogos);
      const matchedKey = deptKeys.find(
        key => key.toLowerCase().trim() === departmentName.toLowerCase().trim()
      );
  
      if (!matchedKey) {
        console.log("⚠️ Department logo not found for:", departmentName);
        console.log("Available keys:", deptKeys);
        return null;
      }
  
      console.log("✅ Found department logo path:", center.departmentLogos[matchedKey]);
      return center.departmentLogos[matchedKey];
    } catch (err) {
      console.error("❌ Error fetching department logo:", err);
      return null;
    }
  }
  

};
