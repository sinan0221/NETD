const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '../config/credentials.json');
const TOKEN_PATH = path.join(__dirname, '../config/token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Create OAuth2 client
function getOAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret, redirect_uris } = credentials.web;

  return new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
}

// Return authorized client if token.json exists
async function getAuthorizedClient() {
  const oAuth2Client = getOAuthClient();

  if (fs.existsSync(TOKEN_PATH)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
    return oAuth2Client;
  }
  return null;
}

module.exports = {
  getOAuthClient,
  getAuthorizedClient,
  TOKEN_PATH,
  SCOPES
};
