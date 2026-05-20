# Face Recognition Attendance Management System

Yeh project `OpenCV + TensorFlow + Node.js + MongoDB` use karke automatic face recognition attendance system banata hai.

## Features

- Student registry with `faceLabel`
- OpenCV webcam dataset capture
- TensorFlow MobileNetV2 embeddings for face matching
- MongoDB-backed attendance records
- Duplicate attendance prevention per day
- Browser dashboard for student list and attendance table
- Browser live camera access with real-time scan requests to Python recognizer
- Windows system event timeline from 8:00 AM to 5:00 PM with MongoDB storage

## Setup

### 1. Node backend

```bash
npm install
npm start
```

MongoDB local machine par run hona chahiye:

```bash
mongodb://127.0.0.1:27017/faceAttendance
```

## Render deployment

Render par app deploy karne ke liye MongoDB Atlas ka connection string use karo. Local `127.0.0.1` MongoDB Render par kaam nahi karega.

Render settings:

```text
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /healthz
```

Environment variables:

```text
NODE_ENV=production
NODE_VERSION=22
MONGO_URI=<your MongoDB Atlas connection string>
PYTHON_EXECUTABLE=python3
FACE_DATA_DIR=/opt/render/project/src/python/data
```

Repo me `render.yaml` bhi add hai, isliye Render Blueprint deploy me ye commands automatically pick ho sakti hain.

Note: Node web app production me crash nahi karega agar Python missing ho, lekin face registration/recognition ke liye Python dependencies install honi chahiye. Render Linux ke liye `python/requirements-render.txt` use karo; Windows-only `pywin32` sirf local system event monitor ke liye hai.

### 2. Python environment

```bash
npm run setup:python
```

Yeh script automatically:

- `Python 3.12` check/install karti hai
- root me `.venv` banati hai
- `python/requirements.txt` install karti hai

Virtual environment manually activate karna ho to:

```powershell
.\.venv\Scripts\Activate.ps1
```

### 3. Register student and store face from website

Open:

```text
http://localhost:3000
```

Home page par:

- student details bharo
- enrollment camera start karo
- `Capture Face Samples` click karo
- `Save Student And Train Face` click karo

Student add karte waqt `faceLabel` yaad rakho, for example `raj_patel`.

### 4. Attendance page use karo

```bash
npm start
```

Open:

```text
http://localhost:3000/attendance
```

Phir `Start Attendance Camera` click karo. Student jaise hi camera ke saamne aayega, system usko recognize karke aaj ke liye `Present` mark kar dega.

### 5. Optional manual Python tools

```bash
npm run py:capture -- --label raj_patel --samples 40
npm run py:train
npm run py:recognize -- --api-url http://localhost:3000/api/attendance/mark
```

Recognition window me `q` dabake exit kar sakte ho.

## System event activity tracking

Laptop startup, shutdown, restart, sleep, wakeup, lock, unlock, login, aur logout events save karne ke liye Node server aur Python monitor dono chalu rakho:

```bash
npm start
```

Dusre terminal me:

```bash
npm run py:system-events
```

Dashboard:

```text
http://localhost:3000/system-events
```

Yeh page daily 8:00 AM se current time tak ki activity chronological order me dikhata hai. 5:00 PM ke baad 8:00 AM se 5:00 PM tak ki complete saved activity dikhegi. Page har 30 seconds me auto-refresh hota hai, aur monitor Windows Event Viewer se naye events database me save karta rahega.

## Important note

Yeh educational starter project hai. Production use ke liye better face detector, liveness detection, multi-face support, aur stronger embedding model add karna chahiye.
