
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

let client;
const state = {
  db: null,
};

module.exports.connect = async function (done) {
  try {
    const url = process.env.MONGODB_URI;
    const dbname = process.env.DB_NAME || "centers";

    if (!url) {
      throw new Error("MONGODB_URI is not defined");
    }

    // Prevent reconnecting
    if (state.db) {
      console.log("MongoDB already connected");
      return done(null);
    }

    client = new MongoClient(url);
    await client.connect();

    state.db = client.db(dbname);
    console.log("✅ MongoDB connected");

    done(null);
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    done(err);
  }
};

module.exports.get = function () {
  if (!state.db) {
    throw new Error("❌ Database not connected yet");
  }
  return state.db;
};

// Optional graceful shutdown (Render friendly)
process.on("SIGTERM", async () => {
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
  }
});
