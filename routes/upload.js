const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const router = express.Router();
const PROJECT_ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PROJECT_ROOT, 'uploads');
const FACE_DATA_DIR = process.env.FACE_DATA_DIR || path.join(PROJECT_ROOT, 'github-face-data');
const DATASET_ROOT = path.join(FACE_DATA_DIR, 'dataset');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATASET_ROOT, { recursive: true });

function cleanFaceLabel(faceLabel) {
  return String(faceLabel || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

const imageFileFilter = (req, file, cb) => {
  if (!file.mimetype.match(/^image\/(jpeg|jpg|png)$/)) {
    return cb(new Error('Only JPG and PNG images are allowed'), false);
  }
  cb(null, true);
};

const storageUploads = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9-_\.]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const storageDataset = multer.diskStorage({
  destination: (req, file, cb) => {
    const faceLabel = cleanFaceLabel(req.body.faceLabel);
    if (!faceLabel) {
      return cb(new Error('faceLabel is required'), null);
    }

    const labelDir = path.join(DATASET_ROOT, faceLabel);
    fs.mkdirSync(labelDir, { recursive: true });
    cb(null, labelDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  },
});

const uploadToUploads = multer({
  storage: storageUploads,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadToDataset = multer({
  storage: storageDataset,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/', uploadToUploads.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Image field is required' });
  }

  res.json({
    success: true,
    message: 'Image uploaded to uploads folder',
    filePath: `/uploads/${req.file.filename}`,
  });
});

router.post('/face', uploadToDataset.array('images', 10), (req, res) => {
  const faceLabel = cleanFaceLabel(req.body.faceLabel);
  if (!faceLabel) {
    return res.status(400).json({ success: false, message: 'faceLabel is required' });
  }

  if (!req.files || !req.files.length) {
    return res.status(400).json({ success: false, message: 'Upload one or more images using the images field' });
  }

  res.json({
    success: true,
    message: 'Images uploaded to dataset folder for model training',
    faceLabel,
    files: req.files.map((file) => path.relative(PROJECT_ROOT, file.path).replace(/\\/g, '/')),
  });
});

router.get('/test', (req, res) => {
  res.send(`
    <h1>Image Upload Test</h1>
    <form action="/api/upload" method="post" enctype="multipart/form-data">
      <div>
        <label>Image:</label>
        <input type="file" name="image" accept="image/jpeg,image/png" required />
      </div>
      <button type="submit">Upload</button>
    </form>
    <p>Or upload face images to model dataset with <code>/api/upload/face</code>.</p>
  `);
});

module.exports = router;
