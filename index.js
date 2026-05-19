const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const attendanceRoutes = require('./routes/attendance');
const studentRoutes = require('./routes/students');
const systemEventRoutes = require('./routes/systemEvents');
const Attendance = require('./models/Attendance');
const Student = require('./models/Student');
const SystemEvent = require('./models/SystemEvent');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/faceAttendance';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((error) => console.error('MongoDB connection error:', error.message));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
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
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }

  res.status(500).render('error', {
    message: error.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});
