
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const exphbs = require('express-handlebars');
var session = require('express-session');
const puppeteer = require('puppeteer');
const fileUpload = require('express-fileupload');
const hbs = require('hbs');
const fs = require('fs').promises; 
// const uploadToDrive = require('./helpers/uploadToDrive');


var adminRouter = require('./routes/admin');
var userRouter = require('./routes/user');
var studentRouter = require('./routes/student');
const backupRouter = require('./routes/backup');
// const googleAuthRouter = require('./routes/googleAuth');


var app = express();
var db = require('./config/connection');

// ======================
// VIEW ENGINE (Handlebars)
// ======================
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.engine('hbs', exphbs.engine({
  extname: 'hbs',
  defaultLayout: 'layout',
  layoutsDir: path.join(__dirname, 'views/layout/'),
  partialsDir: path.join(__dirname, 'views/partials/'),
  helpers: {
    inc: (value) => parseInt(value) + 1,
    eq: (a, b) => a === b,
    formatDate: (date) => {
      if (!date) return new Date().toLocaleDateString();
      const d = new Date(date);
      return d.toLocaleDateString('en-GB'); // DD/MM/YYYY
    },
    add: (a, b) => parseInt(a) + parseInt(b),
    ifExists: (value, options) => {
      if (value && value !== '') {
        return options.fn(this);
      } else {
        return options.inverse(this);
      }
    },
     // ✅ Add this helper
     contains: (array, value) => {
      if (!array || !Array.isArray(array)) return false;
      return array.includes(value);
    },// ✅ ADD THESE FOR EDIT-STUDENT
  
    // Helper to convert any value to string
    toString: function(value) {
      if (!value) return '';
      return value.toString();
    },
    
    // Helper for comparing values (works for both ObjectId and strings)
    ifEquals: function(a, b, options) {
      if (a == b) { // Use loose comparison
        return options.fn(this);
      }
      return options.inverse(this);
    },
    
    // Helper for select option comparison (returns 'selected' if equal)
    isSelected: function(a, b) {
      return a == b ? 'selected' : '';
    },
    
    // Helper for ISO date format (YYYY-MM-DD for date inputs)
    formatDateISO: function(date) {
      if (!date) return '';
      try {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      } catch (e) {
        return '';
      }
    },
    
    // Helper to check if a value exists and is not empty
    hasValue: function(value, options) {
      if (value && value !== '' && value !== null && value !== undefined) {
        return options.fn(this);
      }
      return options.inverse(this);
    },
    
    // Helper to get array element by index (for fixing .0 error)
    getIndex: function(array, index) {
      if (!array || !Array.isArray(array)) return '';
      return array[index] || '';
    },
    
    // Helper to safely access nested properties
    get: function(obj, key) {
      return obj ? obj[key] : '';
    },
    // ✅ FIX duplicated values like "298571,298571"
splitFirst: function (value) {
  if (!value) return '';
  return value.toString().split(',')[0];
},

    
  },
}));

// ======================
// MIDDLEWARE
// ======================
app.use(logger('dev'));

// Body parsers must come BEFORE routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser & session
app.use(cookieParser());
app.use(session({
  secret: "key",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 6000000 } // 10 minutes
}));

// File upload middleware
app.use(fileUpload());



// Prevent back button after logout
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Make session available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.student = req.session.student; 
  next();
});

// ======================
// DATABASE CONNECTION
// ======================
db.connect((err) => {
  if (err) {
    console.log('❌ Database connection error:', err);
  } else {
    console.log('✅ Database connection successful');
  }
});

// ======================
// ROUTES
// ======================
app.use('/admin', adminRouter);
app.use('/user', userRouter);
app.use('/student', studentRouter); // Student router must come AFTER body parser & session
app.use('/backup', backupRouter);
// app.use('/', googleAuthRouter);





// Static files (after session & body parser to avoid route conflicts)
app.use(express.static(path.join(__dirname, 'public')));


// ======================
// ERROR HANDLING
// ======================
app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
