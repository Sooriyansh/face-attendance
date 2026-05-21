const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const { getPythonExecutable, getPythonSetupMessage } = require('../utils/pythonRuntime');

const router = express.Router();
const PROJECT_ROOT = path.join(__dirname, '..');
const PYTHON_EXECUTABLE = getPythonExecutable();
const FACE_DATA_DIR = process.env.FACE_DATA_DIR || path.join(PROJECT_ROOT, 'github-face-data');
const RECOGNIZE_WORKER = path.join(PROJECT_ROOT, 'python', 'recognition_worker.py');
const LIVENESS_SCRIPT = path.join(PROJECT_ROOT, 'python', 'liveness_sequence.py');
const execFileAsync = promisify(execFile);
const MAX_SCAN_FRAMES = 24;
const MIN_MATCHING_FRAMES = 2;
const LATE_AFTER = process.env.ATTENDANCE_LATE_AFTER || '09:15';
let workerProcess = null;
let workerReadyPromise = null;
let workerStdoutBuffer = '';
let lastWorkerError = '';
let nextRequestId = 1;
const pendingRecognitions = new Map();

function normalizeLocation(location) {
  if (!location || typeof location !== 'object') {
    return undefined;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return undefined;
  }

  const capturedAt = location.capturedAt ? new Date(location.capturedAt) : new Date();

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
  };
}

async function markAttendanceForLabel(faceLabel, confidence = 0, markedAt, location) {
  const student = await Student.findOne({ faceLabel });

  if (!student) {
    return {
      status: 404,
      body: {
        success: false,
        message: `No student found for label ${faceLabel}`,
      },
    };
  }

  const attendanceTime = markedAt ? new Date(markedAt) : new Date();
  const dateKey = attendanceTime.toISOString().slice(0, 10);
  const lateInfo = calculateLateInfo(attendanceTime);

  const existing = await Attendance.findOne({
    student: student._id,
    dateKey,
  });

  if (existing) {
    const timeIn = existing.timeIn || existing.markedAt || attendanceTime;
    const workingMinutes = Math.max(0, Math.round((attendanceTime.getTime() - timeIn.getTime()) / 60000));
    existing.timeIn = timeIn;
    existing.timeOut = attendanceTime;
    existing.workingMinutes = workingMinutes;
    existing.confidence = Math.max(Number(existing.confidence || 0), Number(confidence || 0));
    if (location) {
      existing.location = normalizeLocation(location);
    }
    await existing.save();
    const populatedExisting = await Attendance.findById(existing._id).populate('student').lean();

    return {
      status: 200,
      body: {
        success: true,
        duplicate: true,
        message: 'Attendance already marked for today. Time-out and working hours updated.',
        record: populatedExisting,
      },
    };
  }

  const record = await Attendance.create({
    student: student._id,
    faceLabel,
    confidence,
    markedAt: attendanceTime,
    timeIn: attendanceTime,
    isLate: lateInfo.isLate,
    lateByMinutes: lateInfo.lateByMinutes,
    dateKey,
    location: normalizeLocation(location),
  });

  const populated = await Attendance.findById(record._id).populate('student').lean();

  return {
    status: 201,
    body: {
      success: true,
      duplicate: false,
      message: 'Attendance marked successfully',
      record: populated,
    },
  };
}

async function runRecognition(imageBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-scan-'));
  const imagePath = path.join(tempDir, 'frame.jpg');

  try {
    await fs.writeFile(imagePath, imageBuffer);
    const worker = await getWorkerProcess();
    const requestId = String(nextRequestId++);

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRecognitions.delete(requestId);
        reject(new Error('Recognition timed out'));
      }, 120000);

      pendingRecognitions.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      worker.stdin.write(`${JSON.stringify({ id: requestId, imagePath })}\n`);
    });

    return result;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runLivenessSequence(imageBuffers) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-live-'));

  try {
    const imagePaths = await Promise.all(
      imageBuffers.map(async (imageBuffer, index) => {
        const imagePath = path.join(tempDir, `${String(index).padStart(3, '0')}.jpg`);
        await fs.writeFile(imagePath, imageBuffer);
        return imagePath;
      })
    );

    const { stdout } = await execFileAsync(PYTHON_EXECUTABLE, [LIVENESS_SCRIPT, ...imagePaths], {
      cwd: PROJECT_ROOT,
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        FACE_DATA_DIR,
        TF_CPP_MIN_LOG_LEVEL: '2',
      },
    });

    return JSON.parse(stdout.trim());
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function selectRecognitionFrames(imageBuffers) {
  if (imageBuffers.length <= 3) {
    return imageBuffers;
  }

  return [
    imageBuffers[0],
    imageBuffers[Math.floor(imageBuffers.length / 2)],
    imageBuffers[imageBuffers.length - 1],
  ];
}

function decodeImagePayload(rawImage, index) {
  if (!rawImage || typeof rawImage !== 'string') {
    throw new Error(`image ${index + 1} is required`);
  }

  const [, encoded] = rawImage.split(',');
  if (!encoded) {
    throw new Error(`Invalid image payload at index ${index}`);
  }

  return Buffer.from(encoded, 'base64');
}

function summarizeRecognitionResults(results) {
  const matchedResults = results.filter((result) => result.success && result.matched);

  if (!matchedResults.length) {
    const bestUnmatched = results
      .filter((result) => result.success)
      .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];

    return {
      matched: false,
      message: bestUnmatched?.message || 'Face not recognized',
      confidence: bestUnmatched?.confidence || 0,
      quality_issues: bestUnmatched?.quality_issues || [],
    };
  }

  const groups = matchedResults.reduce((acc, result) => {
    acc[result.label] = acc[result.label] || [];
    acc[result.label].push(result);
    return acc;
  }, {});

  const [label, group] = Object.entries(groups).sort((left, right) => {
    if (right[1].length !== left[1].length) {
      return right[1].length - left[1].length;
    }

    const rightAverage = right[1].reduce((sum, item) => sum + Number(item.confidence || 0), 0) / right[1].length;
    const leftAverage = left[1].reduce((sum, item) => sum + Number(item.confidence || 0), 0) / left[1].length;
    return rightAverage - leftAverage;
  })[0];

  if (group.length < MIN_MATCHING_FRAMES) {
    return {
      matched: false,
      message: `Face needs confirmation in at least ${MIN_MATCHING_FRAMES} clear frames. Keep face steady and try again.`,
      confidence: Math.max(...matchedResults.map((result) => Number(result.confidence || 0)), 0),
    };
  }

  const averageConfidence = group.reduce((sum, result) => sum + Number(result.confidence || 0), 0) / group.length;
  const bestMatch = group.sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];

  return {
    ...bestMatch,
    matched: true,
    label,
    confidence: Number(averageConfidence.toFixed(4)),
    matchedFrames: group.length,
    scannedFrames: results.length,
  };
}

function calculateLateInfo(attendanceTime) {
  const [hourText, minuteText] = LATE_AFTER.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { isLate: false, lateByMinutes: 0 };
  }

  const lateAfter = new Date(attendanceTime);
  lateAfter.setHours(hour, minute, 0, 0);
  const lateByMinutes = Math.max(0, Math.round((attendanceTime.getTime() - lateAfter.getTime()) / 60000));

  return {
    isLate: lateByMinutes > 0,
    lateByMinutes,
  };
}

function rejectPendingRecognitions(message) {
  for (const [requestId, pending] of pendingRecognitions.entries()) {
    pending.reject(new Error(message));
    pendingRecognitions.delete(requestId);
  }
}

function handleWorkerMessage(rawLine) {
  let message;

  try {
    message = JSON.parse(rawLine);
  } catch (error) {
    return;
  }

  if (message.type === 'result' && message.id) {
    const pending = pendingRecognitions.get(String(message.id));
    if (!pending) {
      return;
    }

    pendingRecognitions.delete(String(message.id));
    pending.resolve(message.result);
  }
}

function createWorkerProcess() {
  workerProcess = spawn(PYTHON_EXECUTABLE, [RECOGNIZE_WORKER], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FACE_DATA_DIR,
      TF_CPP_MIN_LOG_LEVEL: '2',
    },
  });

  workerProcess.stdout.setEncoding('utf8');
  workerProcess.stdout.on('data', (chunk) => {
    workerStdoutBuffer += chunk;
    const lines = workerStdoutBuffer.split(/\r?\n/);
    workerStdoutBuffer = lines.pop() || '';

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const message = JSON.parse(trimmed);
        if (message.type === 'ready') {
          if (workerReadyPromise) {
            workerReadyPromise.resolve(workerProcess);
            workerReadyPromise = null;
          }
          return;
        }

        if (message.type === 'fatal') {
          const fatalError = new Error(message.message || 'Recognition worker failed to start');
          if (workerReadyPromise) {
            workerReadyPromise.reject(fatalError);
            workerReadyPromise = null;
          }
          rejectPendingRecognitions(fatalError.message);
          return;
        }

        handleWorkerMessage(trimmed);
      } catch (error) {
      }
    });
  });

  workerProcess.stderr.setEncoding('utf8');
  workerProcess.stderr.on('data', (chunk) => {
    lastWorkerError += chunk;
  });

  workerProcess.on('error', (error) => {
    if (workerReadyPromise) {
      workerReadyPromise.reject(error);
      workerReadyPromise = null;
    }
    rejectPendingRecognitions(error.message);
    workerProcess = null;
  });

  workerProcess.on('exit', (code) => {
    const reason = lastWorkerError.trim() || `Recognition worker exited with code ${code}`;
    if (workerReadyPromise) {
      workerReadyPromise.reject(new Error(reason));
      workerReadyPromise = null;
    }
    rejectPendingRecognitions(reason);
    workerProcess = null;
    workerStdoutBuffer = '';
    lastWorkerError = '';
  });
}

function getWorkerProcess() {
  if (workerProcess && !workerProcess.killed && workerReadyPromise === null) {
    return Promise.resolve(workerProcess);
  }

  if (workerReadyPromise) {
    return workerReadyPromise.promise;
  }

  let resolveReady;
  let rejectReady;
  const promise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  workerReadyPromise = {
    promise,
    resolve: resolveReady,
    reject: rejectReady,
  };

  createWorkerProcess();
  return promise;
}

function restartRecognitionWorker() {
  rejectPendingRecognitions('Face model was updated. Please scan again.');

  if (workerProcess && !workerProcess.killed) {
    workerProcess.kill();
  }

  workerProcess = null;
  workerReadyPromise = null;
  workerStdoutBuffer = '';
  lastWorkerError = '';
}

process.on('face-model-updated', restartRecognitionWorker);

router.get('/', async (req, res, next) => {
  try {
    const dateKey = req.query.date || new Date().toISOString().slice(0, 10);
    const records = await Attendance.find({ dateKey })
      .sort({ markedAt: -1 })
      .populate('student')
      .lean();

    res.json({ success: true, records });
  } catch (error) {
    next(error);
  }
});

router.post('/mark', async (req, res, next) => {
  try {
    const { faceLabel, confidence = 0, markedAt, location, livenessConfidence = 0 } = req.body;

    if (!faceLabel) {
      return res.status(400).json({
        success: false,
        message: 'faceLabel is required',
      });
    }

    const result = await markAttendanceForLabel(faceLabel, confidence, markedAt, location);
    if (result.body.record?._id && livenessConfidence) {
      await Attendance.findByIdAndUpdate(result.body.record._id, {
        livenessConfidence,
      });
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

router.post('/scan', async (req, res, next) => {
  try {
    const { image, images, location } = req.body;
    const imagePayloads = Array.isArray(images) && images.length ? images : [image];

    if (!imagePayloads.length || imagePayloads.length > MAX_SCAN_FRAMES) {
      return res.status(400).json({
        success: false,
        message: `Send 1-${MAX_SCAN_FRAMES} scan images`,
      });
    }

    if (imagePayloads.some((payload) => !payload || typeof payload !== 'string')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image payload',
      });
    }

    let recognition;

    try {
      const imageBuffers = imagePayloads.map(decodeImagePayload);
      const liveness = await runLivenessSequence(imageBuffers);

      if (!liveness.isLive) {
        return res.json({
          success: true,
          recognized: false,
          spoofDetected: true,
          message: 'Liveness check failed. Please blink and slowly turn your face left/right during the scan.',
          liveness,
        });
      }

      const recognitionFrames = selectRecognitionFrames(imageBuffers);
      const recognitionResults = await Promise.all(recognitionFrames.map((imageBuffer) => runRecognition(imageBuffer)));
      recognition = summarizeRecognitionResults(recognitionResults);
      recognition.liveness = liveness;
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: `Python recognition service is unavailable. ${getPythonSetupMessage()}`,
        details: error.message,
      });
    }

    if (!recognition.success) {
      return res.status(500).json({
        success: false,
        message: recognition.message || 'Recognition failed',
      });
    }

    if (!recognition.matched) {
      return res.json({
        success: true,
        recognized: false,
        message: recognition.message || 'Face not recognized',
        confidence: recognition.confidence || 0,
        quality_issues: recognition.quality_issues || [],
      });
    }

    const attendanceResult = await markAttendanceForLabel(recognition.label, recognition.confidence, undefined, location);
    if (attendanceResult.body.record?._id && recognition.liveness?.confidence) {
      await Attendance.findByIdAndUpdate(attendanceResult.body.record._id, {
        livenessConfidence: recognition.liveness.confidence,
      });
    }

    return res.status(attendanceResult.status).json({
      ...attendanceResult.body,
      recognized: true,
      recognition: {
        label: recognition.label,
        confidence: recognition.confidence,
        box: recognition.box,
        matchedFrames: recognition.matchedFrames || 1,
        scannedFrames: recognition.scannedFrames || 3,
        liveness: recognition.liveness,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
