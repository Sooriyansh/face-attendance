# Face Recognition Attendance Management System

A web-based attendance system that uses browser camera capture, Python face recognition, MongoDB records, and a modern Node.js dashboard.

## What This App Does

- Registers internship students with face samples.
- Saves face images locally for AI model training.
- Optionally uploads enrollment images to Cloudinary when credentials are configured.
- Rebuilds the local training dataset from saved Cloudinary enrollment images before model training.
- Uploads successful attendance scan frames to Cloudinary and links them to the attendance record.
- Trains face embeddings after student enrollment.
- Marks attendance from the live camera scanner.
- Stores attendance records in MongoDB.
- Tracks time in, time out, late status, working minutes, confidence, and location.
- Shows Windows system activity events such as startup, shutdown, restart, sleep, wakeup, lock, unlock, login, and logout.

## Quick Start

### 1. Install Node dependencies

```bash
npm install
```

### 2. Install Python dependencies

```powershell
npm run setup:python
```

### 3. Start the web app

```bash
npm start
```

Open the dashboard:

```text
http://localhost:8080
```

If you change `PORT`, open that port instead.

## Student Enrollment

1. Open the dashboard.
2. Go to the student registration section.
3. Enter the student details.
4. Click `Start Camera`.
5. Click `Capture Samples`.
6. Click `Save & Train Face`.
7. Wait until the success message says the AI model is trained.

Use a simple face label such as:

```text
raj_patel
```

The app automatically normalizes face labels, so `Raj Patel` becomes `raj_patel`.

## Attendance Scanner

Open:

```text
http://localhost:8080/attendance
```

Then:

1. Click `Start Attendance Camera`.
2. Keep the student face centered.
3. Blink and slowly turn the face left or right for liveness verification.
4. The app marks attendance when the face is recognized.

## System Events

Start the web app:

```bash
npm start
```

In another terminal, start the Windows event monitor:

```bash
npm run py:system-events
```

Open:

```text
http://localhost:8080/system-events
```

The page shows system activity from 8:00 AM to the current time. After 5:00 PM, it shows the full 8:00 AM to 5:00 PM workday window.

## Cloudinary Image Upload

Enrollment images are always saved locally for model training. Cloudinary upload is optional.
When Cloudinary credentials are configured, enrollment images are uploaded to Cloudinary and then downloaded back into the local dataset before training. This keeps Cloudinary as the stored image source while still allowing the Python model to train from local image files.

Successful attendance scan frames are also uploaded to Cloudinary under:

```text
face-attendance/attendance/<student_code>/<date>
```

To enable Cloudinary for testing, set these variables before starting the server:

```powershell
$env:CLOUDINARY_API_KEY="your_api_key"
$env:CLOUDINARY_API_SECRET="your_api_secret"
npm start
```

Default Cloudinary cloud name:

```text
dp95lvewl
```

Default upload folder:

```text
face-attendance/<student_code>
```

Do not commit API secrets to GitHub.

## Useful Commands

```bash
npm start
npm test
npm run setup:python
npm run py:train
npm run py:system-events
```

## Troubleshooting

### Camera does not open

- Open the site in a browser that supports camera access.
- Allow camera permission when the browser asks.
- Use `localhost` during local testing.

### Student is not recognized

- Register the student again with clear lighting.
- Keep the face centered while capturing samples.
- Wait for the `AI model trained successfully` message.
- Run `npm run py:train` if training failed.

### No system events appear

- Keep both `npm start` and `npm run py:system-events` running.
- System event monitoring works on Windows.

### Check face data status

Open:

```text
http://localhost:8080/api/students/face-data-status
```

This shows the local dataset folder, model file status, and Cloudinary configuration status.

## Render Deployment

Use MongoDB Atlas for deployment. A local MongoDB URL such as `127.0.0.1` will not work on Render.

Recommended Render settings:

```text
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /healthz
```

Recommended environment variables:

```text
NODE_ENV=production
NODE_VERSION=22
MONGO_URI=<your MongoDB Atlas connection string>
PYTHON_EXECUTABLE=python3
FACE_DATA_DIR=/opt/render/project/src/python/data
```

For Render Linux builds, use `python/requirements-render.txt`. The Windows-only `pywin32` package is only needed for local system event monitoring.

## Important Notes

- This is an educational project.
- For production, use stronger identity verification, secure secret management, and a persistent storage strategy for face datasets and trained models.
- Do not expose database credentials or Cloudinary secrets in public repositories.
