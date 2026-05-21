const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const attendanceRoutes = require('./routes/attendance');
const studentRoutes = require('./routes/students');
const systemEventRoutes = require('./routes/systemEvents');
const uploadRoutes = require('./routes/upload');
const Attendance = require('./models/Attendance');
const Student = require('./models/Student');
const SystemEvent = require('./models/SystemEvent');

const app = express();

const PORT = process.env.PORT || 3000;

const MONGO_URI = 'mongodb://127.0.0.1:27017/faceAttendance';
// const MONGO_URI = "mongodb+srv://mahakalkheti:oI7inIFpRPh1pNrz@cluster0.m0ab8.mongodb.net/faceAttendance?retryWrites=true&w=majority";
const DATABASE_READY_TIMEOUT_MS = 20000;
let mongoConnectionPromise = null;

mongoose.set('bufferCommands', false);

function getDatabaseStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

async function connectToMongo() {
  if (!MONGO_URI) {
    console.error('MONGO_URI is not set in index.js.');
    return null;
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    })
      .then(() => {
        console.log('MongoDB connected');
        if (typeof studentRoutes.ensureTrainingDataAvailable === 'function') {
          studentRoutes.ensureTrainingDataAvailable().catch((error) => {
            console.error('Unable to rebuild face model from saved enrollment images:', error.message);
          });
        }
      })
      .catch((error) => {
        mongoConnectionPromise = null;
        console.error('MongoDB connection error:', error.message);
      });
  }

  return mongoConnectionPromise;
}

async function waitForDatabase() {
  if (!mongoConnectionPromise) {
    connectToMongo();
  }

  await Promise.race([
    mongoConnectionPromise,
    new Promise((resolve) => setTimeout(resolve, DATABASE_READY_TIMEOUT_MS)),
  ]);
}

async function requireDatabase(req, res, next) {
  if (mongoose.connection.readyState === 1) {
    return next();
  }

  if (mongoose.connection.readyState === 2 || mongoConnectionPromise) {
    await waitForDatabase();

    if (mongoose.connection.readyState === 1) {
      return next();
    }
  }

  const error = new Error('Database is unavailable. Check MONGO_URI in index.js and MongoDB network access.');
  error.status = 503;
  return next(error);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  res.locals.studentCount = 0;
  res.locals.todayAttendanceCount = 0;
  res.locals.recentAttendance = [];
  res.locals.students = [];
  res.locals.records = [];
  next();
});

app.get('/healthz', (req, res) => {
  const database = getDatabaseStatus();
  const healthy = database === 'connected' || database === 'connecting';

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: 'ok',
    database,
  });
});

app.use(requireDatabase);

app.get('/', async (req, res, next) => {
  try {
    const todayKey = new Date().toISOString().slice(0, 10);

    const [studentCount, todayAttendanceCount, recentAttendance, students] = await Promise.all([
      Student.countDocuments(),
      Attendance.countDocuments({ dateKey: todayKey }),
      Attendance.find()
        .sort({ markedAt: -1 })
        .limit(8)
        .populate('student')
        .lean(),
      Student.find().sort({ createdAt: -1 }).limit(8).lean(),
    ]);

    res.render('index', {
      studentCount,
      todayAttendanceCount,
      recentAttendance,
      safeRecentAttendance: Array.isArray(recentAttendance) ? recentAttendance : [],
      students,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/attendance', async (req, res, next) => {
  try {
    const records = await Attendance.find()
      .sort({ markedAt: -1 })
      .limit(20)
      .populate('student')
      .lean();

    res.render('attendance', { records });
  } catch (error) {
    next(error);
  }
});

app.get('/system-events', async (req, res, next) => {
  try {
    const now = new Date();
    const workdayStart = new Date(now);
    workdayStart.setHours(8, 0, 0, 0);

    const workdayEnd = new Date(now);
    workdayEnd.setHours(17, 0, 0, 0);

    const rangeEnd = now < workdayEnd ? now : workdayEnd;
    const systemEvents = await SystemEvent.find({
      occurredAt: {
        $gte: workdayStart,
        $lte: rangeEnd,
      },
    })
      .sort({ occurredAt: 1 })
      .limit(500)
      .lean();

    res.render('system-events', {
      systemEvents,
      systemEventRange: {
        start: workdayStart,
        end: rangeEnd,
        workdayEnd,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/system-events', systemEventRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  if (status >= 500 && status !== 503) {
    console.error(error);
  } else {
    console.warn(error.message || error);
  }

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }

  res.status(status).render('error', {
    message: error.message || 'Internal server error',
  });
});

connectToMongo();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
