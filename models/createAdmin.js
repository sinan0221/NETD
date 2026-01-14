require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./Admin');

(async () => {
  await mongoose.connect(
    `${process.env.MONGODB_URI}/${process.env.DB_NAME}`
  );

  const exists = await Admin.findOne({
    username: process.env.ADMIN_USERNAME
  });

  if (exists) {
    console.log('Admin already exists');
    process.exit(0);
  }

  await Admin.create({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD
  });

  console.log('Admin created successfully');
  process.exit(0);
})();
