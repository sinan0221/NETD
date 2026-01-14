let adminPassword = process.env.ADMIN_PASSWORD;

module.exports = {
  getPassword() {
    return adminPassword;
  },
  setPassword(newPassword) {
    adminPassword = newPassword;
  }
};
