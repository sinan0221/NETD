
// const { MongoClient } = require('mongodb');

// const state = {
//   db: null
// };

// module.exports.connect = async function (done) {
  
//   const url = 'mongodb://127.0.0.1:27017';
//   const dbname = 'centers';

//   try {
//     const client = await MongoClient.connect(url); // returns a client
//     state.db = client.db(dbname);
//     done(null);
//   } catch (err) {
//     done(err);
//   }
// };

// module.exports.get = function () {
//   return state.db;
// };
const { MongoClient } = require("mongodb");

const state = {
  db: null,
};

module.exports.connect = async function (done) {
  try {
    const url = process.env.MONGODB_URI; // ✅ FROM ENV
    const dbname = process.env.DB_NAME || "centers";

    if (!url) {
      throw new Error("MONGODB_URI is not defined");
    }

    const client = await MongoClient.connect(url);
    state.db = client.db(dbname);

    console.log("MongoDB connected");
    done(null);
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    done(err);
  }
};

module.exports.get = function () {
  return state.db;
};
