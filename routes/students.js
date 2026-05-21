const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const Student = require('../models/Student');
const {
  CLOUDINARY_UPLOAD_FOLDER,
  getCloudinaryStatus,
  uploadImagesToCloudinary,
} = require('../utils/cloudinary');
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

function cleanFaceLabel(faceLabel) {
  return String(faceLabel || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function cleanStudentPayload(body) {
  return {
    name: String(body.name || '').trim(),
    faceLabel: cleanFaceLabel(body.faceLabel),
    rollNumber: String(body.rollNumber || '').trim(),
    joiningDate: body.joiningDate,
    department: String(body.department || '').trim(),
    email: String(body.email || '').trim(),
    enrollmentImages: body.enrollmentImages || [],
  };
}

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
  await syncDatasetFromCloudinary();

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

async function uploadEnrollmentImagesToCloudinary(faceLabel, images) {
  return uploadImagesToCloudinary(images, `${CLOUDINARY_UPLOAD_FOLDER}/enrollment/${faceLabel}`);
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to download Cloudinary image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
}

async function syncDatasetFromCloudinary() {
  const students = await Student.find({
    cloudinaryImages: {
      $elemMatch: {
        secureUrl: {
          $ne: '',
        },
      },
    },
  }).lean();

  await Promise.all(
    students.map(async (student) => {
      const labelDir = path.join(DATASET_ROOT, student.faceLabel);
      await fs.rm(labelDir, { recursive: true, force: true });
      await fs.mkdir(labelDir, { recursive: true });

      const images = Array.isArray(student.cloudinaryImages) ? student.cloudinaryImages : [];
      await Promise.all(
        images
          .filter((image) => image.secureUrl)
          .map((image, index) => downloadImage(image.secureUrl, path.join(labelDir, `${String(index).padStart(3, '0')}.jpg`)))
      );
    })
  );
}

function queueTraining(faceLabel) {
  trainingQueue = trainingQueue
    .catch(() => undefined)
    .then(async () => {
      await trainEmbeddings();
      process.emit('face-model-updated');
      console.log(`Face model trained after saving ${faceLabel}`);
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

router.get('/face-data-status', async (req, res, next) => {
  try {
    const datasetEntries = await fs.readdir(DATASET_ROOT, { withFileTypes: true }).catch(() => []);
    const dataset = await Promise.all(
      datasetEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const labelDir = path.join(DATASET_ROOT, entry.name);
          const files = await fs.readdir(labelDir).catch(() => []);
          return {
            label: entry.name,
            images: files.filter((file) => file.toLowerCase().endsWith('.jpg')).length,
          };
        })
    );

    const modelPath = path.join(FACE_DATA_DIR, 'models', 'face_embeddings.npz');

    res.json({
      success: true,
      faceDataDir: FACE_DATA_DIR,
      datasetRoot: DATASET_ROOT,
      dataset,
      model: {
        path: modelPath,
        exists: await fs.access(modelPath).then(() => true).catch(() => false),
      },
      cloudinary: getCloudinaryStatus(),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, faceLabel, rollNumber, joiningDate, department, email, enrollmentImages } = cleanStudentPayload(req.body);

    if (!name || !faceLabel || !joiningDate) {
      return res.status(400).json({
        success: false,
        message: 'Student name, face label, and internship start date are required',
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

    const existingStudent = await Student.findOne({ faceLabel });
    if (existingStudent) {
      return res.status(409).json({
        success: false,
        message: `Student code "${faceLabel}" already exists. Use a unique Face Label / Student Code.`,
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

    let cloudinaryUpload = {
      enabled: false,
      images: [],
      message: 'Cloudinary upload skipped.',
    };

    try {
      cloudinaryUpload = await uploadEnrollmentImagesToCloudinary(faceLabel, enrollmentImages);
      if (cloudinaryUpload.images.length) {
        student.cloudinaryImages = cloudinaryUpload.images;
        await student.save();
      }
    } catch (error) {
      await Student.findByIdAndDelete(student._id);
      await fs.rm(path.join(DATASET_ROOT, faceLabel), { recursive: true, force: true });

      return res.status(500).json({
        success: false,
        message: 'Student could not be saved because Cloudinary image upload failed.',
        details: error.message,
      });
    }

    try {
      await queueTraining(faceLabel);
    } catch (error) {
      console.error(`Face model training failed for ${faceLabel}:`, error.message);
      console.error(getPythonSetupMessage());

      return res.status(500).json({
        success: false,
        student,
        imagesSaved: true,
        trainingStarted: false,
        message: 'Face images were saved, but AI model training failed. Fix Python setup or face image quality, then run `npm run py:train`.',
        details: error.message,
      });
    }

    res.status(201).json({
      success: true,
      student,
      imagesSaved: true,
      trainingStarted: true,
      trainingCompleted: true,
      cloudinaryUpload,
      message: cloudinaryUpload.enabled
        ? 'Face images saved locally, uploaded to Cloudinary, and model training completed successfully.'
        : 'Face images saved locally and model training completed successfully. Cloudinary upload was skipped because credentials are not configured.',
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
