require('dotenv').config(); // 1) load envs first

const express = require('express');
const app = express();
const path = require('path');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const LocalStrategy = require('passport-local');
const flash = require('connect-flash');
const cors = require('cors');
const multer = require('multer');

const User = require('./models/user.js');
const Project = require('./models/project.js');
// const clubb  = require("./models/clubb.js"); // not used -> remove
const Club = require('./models/club.js');
const userdetail = require('./models/userdetails.js');
const { isLoggedIn } = require('./middleware');

const PORT = process.env.PORT || 3400;
const FRONTEND_URL = process.env.FRONTEND_URL;

// ---------- DB ----------
(async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      // options optional on mongoose >= 6
    });
    console.log('✅ Database Connected');
  } catch (err) {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  }
})();

// ---------- App basics ----------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// If your frontend is on Vercel (separate origin), enable CORS:
if (FRONTEND_URL) {
  app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In case you also serve a built frontend locally (optional):
const frontendDistPath = path.join(__dirname, '..', 'FRONTEND', 'dist');
app.use(express.static(frontendDistPath));

// ---------- Sessions & Auth ----------
app.set('trust proxy', 1); // needed on Render to set secure cookies properly
const sessionOptions = {
  secret: process.env.SESSION_SECRET || 'change_this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
};
app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// ---------- Healthcheck ----------
app.get('/health', (_req, res) => res.status(200).send('ok'));

// ---------- Auth routes ----------
app.post('/signup', async (req, res) => {
  try {
    const { firstname, lastname, username, email, password, campus1 } = req.body;
    if (!campus1) throw new Error('Campus is required');

    const newUser = new User({ firstname, lastname, username, email, campus1 });
    await User.register(newUser, password);

    res.json({ status: 'success', message: 'Signup successful' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ status: 'error', message: 'Error during signup' });
  }
});

app.post('/login',
  passport.authenticate('local', { failureFlash: true }),
  (req, res) => {
    res.json({ status: 'success', message: 'Welcome' });
  }
);

app.post('/clublogin',
  passport.authenticate('local', { failureFlash: true }),
  (req, res) => {
    res.json({ status: 'success', message: 'Welcome' });
  }
);

// ---------- Data routes ----------
app.get('/listings', async (_req, res) => {
  try {
    const projects = await Project.find();
    res.json(projects);
  } catch (error) {
    console.error('Error fetching project data:', error);
    res.status(500).json({ error: 'Error fetching project data' });
  }
});

app.get('/clubpost', async (_req, res) => {
  try {
    const clubs = await Club.find();
    res.json(clubs);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// Attach details of logged-in user
const getUserDetails = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const details = await userdetail.findOne({ email: req.user.email });
    req.userDetails = details;
    next();
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ error: 'Error fetching user details' });
  }
};

app.get('/userpage', isLoggedIn, getUserDetails, (req, res) => {
  res.json(req.userDetails || {});
});

app.get('/people', async (_req, res) => {
  try {
    const people = await userdetail.find({}, 'fullName skills -_id');
    res.json(people);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/userdetails/:fullName', async (req, res) => {
  try {
    const user = await userdetail.findOne({ fullName: req.params.fullName });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Project create (must be logged in to use req.user._id)
app.post('/makeproj', isLoggedIn, async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, desc, num, type } = req.body;

    const savedProject = await new Project({ name, desc, num, type, createdBy: userId }).save();
    console.log('Project created:', savedProject._id);
    res.json({ status: 'success', id: savedProject._id });
  } catch (error) {
    console.error('Project creation error:', error);
    res.status(500).json({ status: 'error', message: 'Error during project creation' });
  }
});

// File uploads (posterImage as Buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.post('/clublisting', upload.single('posterImage'), async (req, res) => {
  try {
    const newClub = new Club({
      clubName: req.body.clubName,
      type: req.body.type,
      description: req.body.description,
      googleFormLink: req.body.googleFormLink,
      posterImage: req.file?.buffer
    });
    await newClub.save();
    res.json({ status: 'success', message: 'Club added!' });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post('/userpage', async (req, res) => {
  try {
    const {
      phone, instagram, twitter, linkedIn, github,
      fullName, email, campus, skills, projects
    } = req.body;

    let details = await userdetail.findOne({ email });
    if (!details) {
      details = new userdetail({ phone, instagram, twitter, linkedIn, github, fullName, email, campus, skills, projects });
    } else {
      Object.assign(details, { phone, instagram, twitter, linkedIn, github, fullName, campus, skills, projects });
    }

    const saved = await details.save();
    res.status(200).json(saved);
  } catch (error) {
    console.error(error);
    res.status(500).send(`An error occurred while saving user details: ${error.toString()}`);
  }
});

// ---------- Catch-all (keep this LAST) ----------
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
