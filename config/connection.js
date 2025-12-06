
const { MongoClient } = require('mongodb');

const state = {
  db: null
};

module.exports.connect = async function (done) {
  
  const url = 'mongodb://127.0.0.1:27017';
  const dbname = 'centers';

  try {
    const client = await MongoClient.connect(url); // returns a client
    state.db = client.db(dbname);
    done(null);
  } catch (err) {
    done(err);
  }
};

module.exports.get = function () {
  return state.db;
};
