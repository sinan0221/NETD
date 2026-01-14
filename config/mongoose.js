const mongoose = require('mongoose');

async function connectMongoose() {
  try {
    await mongoose.connect(
      `${process.env.MONGODB_URI}/${process.env.DB_NAME}`,
      {
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    );
    console.log('✅ Mongoose connected');
  } catch (err) {
    console.error('❌ Mongoose connection error:', err);
  }
}

module.exports = connectMongoose;
