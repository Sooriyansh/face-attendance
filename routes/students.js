const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const Student = require('../models/Student');
const { getPythonExecutable, getPythonSetupMessage } = require('../utils/pythonRuntime');

const router = express.Router();
const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.join(__dirname, '..');
const PYTHON_EXECUTABLE = getPythonExecutable();
const FACE_DATA_DIR = process.env.FACE_DATA_DIR || path.join(PROJECT_ROOT, 'github-face-data');
const DATASET_ROOT = path.join(FACE_DATA_DIR, 'dataset');
const TRAIN_SCRIPT = path.join(PROJECT_ROOT, 'python', 'train_model.py');
const MIN_ENROLLMENT_IMAGES = Number(process.env.MIN_TRAINING_IMAGES_PER_USER || 2);
const MAX_ENROLLMENT_IMAGES = Number(process.env.MAX_TRAINING_IMAGES_PER_USER || 2);
let trainingQueue = Promise.resolve();

async function saveEnrollmentImages(faceLabel, images) {
  const labelDir = path.join(DATASET_ROOT, faceLabel);
  await fs.rm(labelDir, { recursive: true, force: true });
  await fs.mkdir(labelDir, { recursive: true });

  await Promise.all(
    images.map(async (image, index) => {
      const [, encoded] = String(image).split(',');
      if (!encoded) {
        throw new Error(`Invalid image payload at index ${index}`);
      }

      const fileName = `${String(index).padStart(3, '0')}.jpg`;
      const filePath = path.join(labelDir, fileName);
      await fs.writeFile(filePath, Buffer.from(encoded, 'base64'));
    })
  );
}

async function trainEmbeddings() {
  await execFileAsync(PYTHON_EXECUTABLE, [TRAIN_SCRIPT], {
    cwd: PROJECT_ROOT,
    timeout: 300000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      FACE_DATA_DIR,
      TF_CPP_MIN_LOG_LEVEL: '2',
    },
  });
}

function trainEmbeddingsInBackground(faceLabel) {
  trainingQueue = trainingQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await trainEmbeddings();
        process.emit('face-model-updated');
        console.log(`Face model trained after saving ${faceLabel}`);
      } catch (error) {
        console.error(`Face model training failed for ${faceLabel}:`, error.message);
        console.error(getPythonSetupMessage());
      }
    });

  return trainingQueue;
}

router.get('/', async (req, res, next) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, students });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, faceLabel, rollNumber, joiningDate, department, email, enrollmentImages = [] } = req.body;

    if (!name || !faceLabel || !joiningDate) {
      return res.status(400).json({
        success: false,
        message: 'name and faceLabel are required',
      });
    }

    if (
      !Array.isArray(enrollmentImages) ||
      enrollmentImages.length < MIN_ENROLLMENT_IMAGES ||
      enrollmentImages.length > MAX_ENROLLMENT_IMAGES
    ) {
      return res.status(400).json({
        success: false,
        message: `Exactly ${MAX_ENROLLMENT_IMAGES} face scan images are required`,
      });
    }

    const student = await Student.create({
      name,
      faceLabel,
      rollNumber,
      joiningDate,
      department,
      email,
    });

    try {
      await saveEnrollmentImages(faceLabel, enrollmentImages);
    } catch (error) {
      await Student.findByIdAndDelete(student._id);
      await fs.rm(path.join(DATASET_ROOT, faceLabel), { recursive: true, force: true });

      return res.status(500).json({
        success: false,
        message: 'Student could not be saved because face images could not be stored.',
        details: error.message,
      });
    }

    trainEmbeddingsInBackground(faceLabel);

    res.status(201).json({
      success: true,
      student,
      imagesSaved: true,
      trainingStarted: true,
      message: 'Face images saved successfully. Model training is running in the background.',
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'faceLabel already exists',
      });
    }

    next(error);
  }
});

module.exports = router;
