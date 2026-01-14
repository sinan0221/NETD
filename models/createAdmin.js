require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

mongoose.connect(process.env.MONGODB_URI + '/' + process.env.DB_NAME);

(async () => {
  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

  await Admin.create({
    email: process.env.ADMIN_EMAIL,
    password: hashedPassword
  });

  console.log('✅ Admin created');
  process.exit();
})();
