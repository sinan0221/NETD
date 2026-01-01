var db = require('../config/connection');
var collection = require('../config/collections');
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');

module.exports = {
  // ✅ SIGNUP with centreId validation
  doSignup: (userData) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Check if centreId exists in centers collection
        let centre = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .findOne({ centreId: userData.centreId });

        if (!centre) {
          console.log("❌ Centre ID not found during signup");
          return resolve({ status: false, message: "Centre ID not found" });
        }

        // Hash password
        userData.password = await bcrypt.hash(userData.password, 10);

        // Insert user into DB
        let response = await db.get()
          .collection(collection.USER_COLLECTION)
          .insertOne(userData);

        console.log("✅ User inserted with ID:", response.insertedId);
        resolve({ status: true, userId: response.insertedId });

      } catch (err) {
        reject(err);
      }
    });
  },

  // ✅ LOGIN with centreId validation
  doLogin: (userData) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Find user by name + centreId
        // let user = await db.get()
        //   .collection(collection.USER_COLLECTION)
        //   .findOne({
        //     name: userData.name,
        //     centreId: userData.centreId
        //   });
       

        let user = await db.get()
        .collection(collection.USER_COLLECTION)
        .findOne({ centreId: userData.centreId }); // ✅ just a string
      
  
        if (!user) {
          console.log("❌ login failed (user not found)");
          return resolve({ status: false, message: "User not found" });
        }
  
        // Verify centreId still exists in centres collection
        let centre = await db.get()
          .collection(collection.CENTER_COLLECTION)
          .findOne({ centreId: user.centreId });
  
        if (!centre) {
          console.log("❌ login failed (centreId not valid anymore)");
          return resolve({ status: false, message: "Centre ID not found" });
        }
  
        // Compare password
        const status = await bcrypt.compare(userData.password, user.password);
        if (status) {
          console.log("✅ login success");
  
          // ✅ Return both user and the real centre._id
          resolve({ status: true, user, centreId: centre._id });
        } else {
          console.log("❌ login failed (wrong password)");
          resolve({ status: false, message: "Invalid password" });
        }
  
      } catch (err) {
        reject(err);
      }
    });
  }
  
};
