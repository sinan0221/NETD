require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./Admin');

(async () => {
  try {
    await mongoose.connect(
      `${process.env.MONGODB_URI}/${process.env.DB_NAME}`
    );

    const existingAdmin = await Admin.findOne({ email: 'admin' });

    if (existingAdmin) {
      console.log('✅ Admin already exists');
      process.exit(0);
    }

    await Admin.create({
      email: 'admin',
      password: '2025' // initial password (hashed automatically)
    });

    console.log('✅ Admin created successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Admin creation failed:', err);
    process.exit(1);
  }
})();
