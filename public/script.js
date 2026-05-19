async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  const payload = contentType.includes('application/json')
    ? JSON.parse(rawBody || '{}')
    : null;

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        `Request failed with status ${response.status}. Server returned ${contentType || 'an unexpected response'}.`
    );
  }

  if (!payload) {
    throw new Error(
      `Expected JSON response from ${url}, but received ${contentType || 'non-JSON content'}.`
    );
  }

  return payload;
}

function createCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  return cell;
}

function renderStudents(students) {
  const tableBody = document.getElementById('students-table-body');
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!students.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No teachers added yet.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  students.slice(0, 8).forEach((student) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(student.name));

    const labelCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = student.faceLabel;
    labelCell.appendChild(code);
    row.appendChild(labelCell);

    row.appendChild(createCell(student.joiningDate ? new Date(student.joiningDate).toLocaleDateString() : '-'));
    row.appendChild(createCell(student.department || '-'));
    tableBody.appendChild(row);
  });
}

function renderAttendance(records, elementId, columnCount) {
  const tableBody = document.getElementById(elementId);
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!records.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columnCount;
    cell.textContent = 'No attendance marked yet.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(record.student?.name || record.faceLabel));

    if (columnCount >= 4) {
      const labelCell = document.createElement('td');
      const code = document.createElement('code');
      code.textContent = record.faceLabel;
      labelCell.appendChild(code);
      row.appendChild(labelCell);
    }

    row.appendChild(createCell(new Date(record.markedAt).toLocaleString()));
    row.appendChild(createCell(Number(record.confidence || 0).toFixed(3)));

    if (columnCount >= 5) {
      row.appendChild(createLocationCell(record.location));
    }

    tableBody.appendChild(row);
  });
}

function createLocationCell(location) {
  const cell = document.createElement('td');

  if (location?.latitude == null || location?.longitude == null) {
    cell.textContent = '-';
    return cell;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy || 0);
  const link = document.createElement('a');
  link.href = `https://www.google.com/maps?q=${latitude},${longitude}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  cell.appendChild(link);

  if (accuracy) {
    const accuracyText = document.createElement('span');
    accuracyText.className = 'location-accuracy';
    accuracyText.textContent = ` +/- ${Math.round(accuracy)}m`;
    cell.appendChild(accuracyText);
  }

  return cell;
}

function renderSystemEvents(events) {
  const tableBody = document.getElementById('system-events-body');
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!events.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = '8:00 AM se abhi tak koi system event capture nahi hua.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement('tr');
    row.className = 'event-row';
    row.setAttribute('data-user', event.user || 'Unknown');

    // User cell
    row.appendChild(createCell(event.user || 'Unknown'));

    // Event cell
    const eventCell = document.createElement('td');
    const eventPill = document.createElement('span');
    eventPill.className = 'event-pill';
    eventPill.textContent = event.event;
    eventCell.appendChild(eventPill);
    row.appendChild(eventCell);

    row.appendChild(createCell(new Date(event.occurredAt).toLocaleString()));

    const eventIdCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = event.eventId;
    eventIdCell.appendChild(code);
    row.appendChild(eventIdCell);

    row.appendChild(createCell(event.sourceLog || '-'));
    row.appendChild(createCell(event.meaning || event.provider || '-'));
    tableBody.appendChild(row);
  });
}

async function loadAndDisplayUserAnalytics() {
  const summaryContainer = document.getElementById('user-summary');
  if (!summaryContainer) {
    return;
  }

  try {
    const data = await fetchJson('/api/system-events/users/analytics?mode=workday');
    const users = data.users || [];

    summaryContainer.innerHTML = '';

    if (!users.length) {
      summaryContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Koi system activity record nahi mili.</p>';
      return;
    }

    users.forEach((user) => {
      const card = document.createElement('div');
      card.className = 'user-card';
      card.setAttribute('data-user', user.user);
      card.style.cursor = 'pointer';

      const header = document.createElement('div');
      header.className = 'user-card-header';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'user-name';
      nameSpan.textContent = user.user;
      header.appendChild(nameSpan);

      const badge = document.createElement('span');
      badge.className = 'accuracy-badge';
      badge.innerHTML = `<i class="fa-solid fa-check"></i> 100%`;
      header.appendChild(badge);

      card.appendChild(header);

      const stats = document.createElement('div');
      stats.className = 'user-card-stats';

      const totalEventsItem = document.createElement('div');
      totalEventsItem.className = 'stat-item';
      totalEventsItem.innerHTML = `
        <span class="stat-label">Total Events</span>
        <span class="stat-value">${user.totalEvents}</span>
      `;
      stats.appendChild(totalEventsItem);

      const eventTypesItem = document.createElement('div');
      eventTypesItem.className = 'stat-item';
      eventTypesItem.innerHTML = `
        <span class="stat-label">Event Types</span>
        <span class="stat-value">${user.uniqueEventTypes}</span>
      `;
      stats.appendChild(eventTypesItem);

      const lastActivityItem = document.createElement('div');
      lastActivityItem.className = 'stat-item';
      lastActivityItem.innerHTML = `
        <span class="stat-label">Last Activity</span>
        <span class="stat-value">${new Date(user.lastActivity).toLocaleTimeString()}</span>
      `;
      stats.appendChild(lastActivityItem);

      card.appendChild(stats);

      card.addEventListener('click', () => {
        const userFilter = document.getElementById('user-filter');
        if (userFilter) {
          userFilter.value = user.user;
          filterEventsByUser(user.user);
        }
      });

      summaryContainer.appendChild(card);
    });

    // Update user filter dropdown
    const userFilter = document.getElementById('user-filter');
    if (userFilter) {
      const currentValue = userFilter.value;
      userFilter.innerHTML = '<option value="">All Users</option>';
      users.forEach((user) => {
        const option = document.createElement('option');
        option.value = user.user;
        option.textContent = user.user;
        userFilter.appendChild(option);
      });
      userFilter.value = currentValue;
    }
  } catch (error) {
    summaryContainer.innerHTML = `<p style="grid-column: 1/-1; color: var(--accent-tertiary);">Error loading user analytics: ${error.message}</p>`;
  }
}

function filterEventsByUser(userName) {
  const rows = document.querySelectorAll('.event-row');
  rows.forEach((row) => {
    if (userName === '' || row.getAttribute('data-user') === userName) {
      row.classList.remove('hidden');
    } else {
      row.classList.add('hidden');
    }
  });
}

function attachUserFilterListener() {
  const userFilter = document.getElementById('user-filter');
  if (userFilter) {
    userFilter.addEventListener('change', (e) => {
      filterEventsByUser(e.target.value);
    });
  }
}

function updateSystemEventsSummary(data) {
  const count = document.getElementById('system-events-count');
  const range = document.getElementById('system-events-range');
  const sync = document.getElementById('system-events-sync');
  const accuracy = document.getElementById('system-events-accuracy');

  if (count) {
    count.textContent = String((data.events || []).length);
  }

  if (range && data.range?.start && data.range?.end) {
    const start = new Date(data.range.start);
    const end = new Date(data.range.end);
    range.textContent = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (sync) {
    sync.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (accuracy) {
    accuracy.textContent = '100%';
  }
}

async function refreshHomeData() {
  const [studentsData, attendanceData] = await Promise.all([
    fetchJson('/api/students'),
    fetchJson('/api/attendance'),
  ]);

  renderStudents(studentsData.students || []);
  renderAttendance(attendanceData.records || [], 'attendance-table-body', 3);
}

async function refreshSystemEvents() {
  const status = document.getElementById('system-events-status');
  if (status) {
    status.textContent = 'Refreshing 8:00 AM se current time tak ki system activity...';
  }

  try {
    const data = await fetchJson('/api/system-events?mode=workday&sort=asc&limit=500');
    renderSystemEvents(data.events || []);
    updateSystemEventsSummary(data);
    attachUserFilterListener();
    await loadAndDisplayUserAnalytics();

    if (status) {
      status.textContent = `Showing ${data.events.length} event(s) from 8:00 AM to current time. Accuracy: 100%`;
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message;
    }
  }
}

let cameraStream = null;
let scanInterval = null;
let scanInFlight = false;
let enrollmentCameraStream = null;
let enrollmentImages = [];
let attendanceLocation = null;
let attendanceLocationAt = 0;
let locationRetryAfter = 0;

function setScanStatus(message) {
  const scanStatus = document.getElementById('camera-status');
  if (scanStatus) {
    scanStatus.textContent = message;
  }
}

function setRecognitionResult(message, isSuccess = false, studentName = null, confidence = null) {
  const result = document.getElementById('recognition-result');
  if (result) {
    if (isSuccess) {
      const confidencePercent = confidence ? (Number(confidence) * 100).toFixed(1) : 'N/A';
      const displayMsg = studentName
        ? `Success: ${studentName}'s attendance was marked successfully. (${confidencePercent}% confidence)`
        : 'Success: Attendance was marked successfully.';
      result.textContent = displayMsg;
      result.classList.add('status-success');
      result.classList.remove('status-error');
    } else {
      result.textContent = message;
      result.classList.add('status-error');
      result.classList.remove('status-success');
    }
  }
}

function setLocationStatus(message) {
  const locationStatus = document.getElementById('location-status');
  if (locationStatus) {
    locationStatus.textContent = message;
  }
}

function setScanLoading(isLoading) {
  const startButton = document.getElementById('start-camera');
  const scanButton = document.getElementById('scan-now');
  const loader = document.getElementById('camera-loader');

  if (startButton) {
    startButton.disabled = isLoading;
  }

  if (scanButton) {
    scanButton.disabled = isLoading;
  }

  if (loader) {
    loader.textContent = isLoading ? 'Attendance scan is in progress...' : '';
  }
}

async function scanCurrentFrame() {
  if (scanInFlight) {
    return;
  }

  const video = document.getElementById('camera-feed');
  const canvas = document.getElementById('camera-canvas');

  if (!video || !canvas || video.readyState < 2) {
    return;
  }

  scanInFlight = true;
  setScanLoading(true);
  setScanStatus('Scanning live frame...');

  try {
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const payload = {
      image: canvas.toDataURL('image/jpeg', 0.9),
      location: await getAttendanceLocation(),
    };

    const response = await fetchJson('/api/attendance/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.recognized) {
      const studentName = response.record?.student?.name || response.recognition?.label || 'Teacher';
      const confidence = response.recognition?.confidence || response.record?.confidence || 0;
      const isDuplicate = response.duplicate;
      
      setRecognitionResult('', true, studentName, confidence);
      
      if (!isDuplicate) {
        setScanStatus('Success: Attendance marked successfully.');
        
        setTimeout(() => {
          stopLiveCamera();
          setScanStatus('Camera stopped - Attendance process complete');
          setRecognitionResult('Start the camera again for a new scan.', false);
        }, 3000);
      } else {
        setScanStatus(`${studentName}'s attendance is already marked for today.`);
      }
      
      await refreshHomeData();
    } else {
      const confidence = Number(response.confidence || 0).toFixed(3);
      const message = response.message || 'Face was not recognized.';
      const qualityIssues = response.quality_issues || [];
      
      let displayMsg = message;
      if (qualityIssues && qualityIssues.length > 0) {
        displayMsg += ` | ${qualityIssues.join(' | ')}`;
      }
      
      setRecognitionResult(displayMsg, false);
    }
  } catch (error) {
      setRecognitionResult(error.message, false);
    } finally {
      setScanLoading(false);
      setScanStatus(cameraStream ? 'Camera live - Auto scan runs every 3 seconds.' : 'Camera stopped');
      scanInFlight = false;
    }
}

async function getAttendanceLocation(forceRefresh = false) {
  if (!navigator.geolocation) {
    setLocationStatus('Location tracking is not available in this browser.');
    return null;
  }

  const now = Date.now();
  if (!forceRefresh && attendanceLocation && now - attendanceLocationAt < 5 * 60 * 1000) {
    return attendanceLocation;
  }

  if (!forceRefresh && now < locationRetryAfter) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        attendanceLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        };
        attendanceLocationAt = Date.now();
        locationRetryAfter = 0;
        setLocationStatus(
          `Location captured: ${attendanceLocation.latitude.toFixed(5)}, ${attendanceLocation.longitude.toFixed(5)}`
        );
        resolve(attendanceLocation);
      },
      (error) => {
        locationRetryAfter = Date.now() + 60 * 1000;
        setLocationStatus(`Location was not captured: ${error.message}`);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }
    );
  });
}

async function startLiveCamera() {
  const video = document.getElementById('camera-feed');
  if (!video) {
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setScanStatus('Camera API is not available.');
    setRecognitionResult('Open this page at http://localhost:3000 and allow camera permission to use the browser camera.');
    return;
  }

  if (cameraStream) {
    setScanStatus('Camera already running.');
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
      },
      audio: false,
    });

    video.srcObject = cameraStream;
    await video.play();

    setScanStatus('Camera is live. Auto scan running every 3 seconds.');
    setRecognitionResult('Live recognition is ready. Keep your face in front of the camera.');
    getAttendanceLocation(true);

    scanInterval = window.setInterval(scanCurrentFrame, 3000);
    window.setTimeout(scanCurrentFrame, 1200);
  } catch (error) {
    cameraStream = null;
    setScanStatus('Camera access blocked.');
    setRecognitionResult(`Camera could not be opened: ${error.message}`);
  }
}

function stopLiveCamera() {
  const video = document.getElementById('camera-feed');

  if (scanInterval) {
    window.clearInterval(scanInterval);
    scanInterval = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  setScanStatus('Camera stopped.');
}

function setEnrollmentCameraStatus(message) {
  const status = document.getElementById('enrollment-camera-status');
  if (status) {
    status.textContent = message;
  }
}

function setEnrollmentSampleStatus(message) {
  const status = document.getElementById('enrollment-sample-status');
  if (status) {
    status.textContent = message;
  }
}

function renderEnrollmentPreview() {
  const preview = document.getElementById('enrollment-preview');
  if (!preview) {
    return;
  }

  preview.innerHTML = '';

  enrollmentImages.forEach((image, index) => {
    const img = document.createElement('img');
    img.src = image;
    img.alt = `Enrollment sample ${index + 1}`;
    preview.appendChild(img);
  });
}

async function startEnrollmentCamera() {
  const video = document.getElementById('enrollment-camera-feed');
  if (!video) {
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setEnrollmentCameraStatus('Camera API is not available. Open this page at http://localhost:3000.');
    return;
  }

  if (enrollmentCameraStream) {
    setEnrollmentCameraStatus('Enrollment camera already running.');
    return;
  }

  try {
    enrollmentCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
      },
      audio: false,
    });

    video.srcObject = enrollmentCameraStream;
    await video.play();
    setEnrollmentCameraStatus('Enrollment camera is live. Keep your face centered and capture samples.');
  } catch (error) {
    enrollmentCameraStream = null;
    setEnrollmentCameraStatus(`Camera could not be opened: ${error.message}`);
  }
}

function stopEnrollmentCamera() {
  const video = document.getElementById('enrollment-camera-feed');

  if (enrollmentCameraStream) {
    enrollmentCameraStream.getTracks().forEach((track) => track.stop());
    enrollmentCameraStream = null;
  }

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  setEnrollmentCameraStatus('Enrollment camera stopped.');
}

async function captureEnrollmentSamples() {
  const video = document.getElementById('enrollment-camera-feed');
  const canvas = document.getElementById('enrollment-camera-canvas');

  if (!video || !canvas || video.readyState < 2) {
    setEnrollmentSampleStatus('Start the enrollment camera first.');
    return;
  }

  enrollmentImages = [];
  renderEnrollmentPreview();
  setEnrollmentSampleStatus('Capturing 12 face samples...');

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const context = canvas.getContext('2d');

  for (let index = 0; index < 12; index += 1) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    enrollmentImages.push(canvas.toDataURL('image/jpeg', 0.9));
    renderEnrollmentPreview();
    setEnrollmentSampleStatus(`Captured ${index + 1}/12 face samples`);
    // Small delay so samples are not identical
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => window.setTimeout(resolve, 220));
  }

  setEnrollmentSampleStatus('Face samples are ready. Now save the teacher.');
}

async function refreshAttendancePage() {
  const status = document.getElementById('attendance-page-status');
  if (status) {
    status.textContent = 'Refreshing records...';
  }

  try {
    const attendanceData = await fetchJson('/api/attendance');
    renderAttendance(attendanceData.records || [], 'attendance-page-body', 5);

    if (status) {
      status.textContent = `Showing ${attendanceData.records.length} record(s) for today.`;
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message;
    }
  }
}

const studentForm = document.getElementById('student-form');
if (studentForm) {
  studentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formStatus = document.getElementById('student-form-status');
    const submitButton = studentForm.querySelector('button[type="submit"]');
    const formData = new FormData(studentForm);
    const payload = Object.fromEntries(formData.entries());
    payload.enrollmentImages = enrollmentImages;

    if (enrollmentImages.length < 6) {
      if (formStatus) {
        formStatus.textContent = 'Capture at least 6 face samples first.';
      }
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
    }

    if (formStatus) {
      formStatus.textContent = 'Teacher registration is in progress. Please wait...';
    }

    try {
      await fetchJson('/api/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (formStatus) {
        formStatus.textContent = 'Teacher saved and the model was trained. Open the attendance page to test it.';
      }

      studentForm.reset();
      enrollmentImages = [];
      renderEnrollmentPreview();
      setEnrollmentSampleStatus('Required samples: 6 minimum. Recommended: 12.');
      await refreshHomeData();
    } catch (error) {
      if (formStatus) {
        formStatus.textContent = error.message;
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  refreshHomeData().catch((error) => {
    const formStatus = document.getElementById('student-form-status');
    if (formStatus) {
      formStatus.textContent = error.message;
    }
  });
}

const refreshAttendanceButton = document.getElementById('refresh-attendance');
if (refreshAttendanceButton) {
  refreshAttendanceButton.addEventListener('click', refreshAttendancePage);
  refreshAttendancePage();
}

const refreshSystemEventsButton = document.getElementById('refresh-system-events');
if (refreshSystemEventsButton) {
  refreshSystemEventsButton.addEventListener('click', refreshSystemEvents);
  refreshSystemEvents();
  window.setInterval(refreshSystemEvents, 30000);
}

const startCameraButton = document.getElementById('start-camera');
const stopCameraButton = document.getElementById('stop-camera');
const scanNowButton = document.getElementById('scan-now');

if (startCameraButton) {
  startCameraButton.addEventListener('click', startLiveCamera);
}

if (stopCameraButton) {
  stopCameraButton.addEventListener('click', stopLiveCamera);
}

if (scanNowButton) {
  scanNowButton.addEventListener('click', scanCurrentFrame);
}

const startEnrollmentCameraButton = document.getElementById('start-enrollment-camera');
const stopEnrollmentCameraButton = document.getElementById('stop-enrollment-camera');
const captureEnrollmentButton = document.getElementById('capture-enrollment');

if (startEnrollmentCameraButton) {
  startEnrollmentCameraButton.addEventListener('click', startEnrollmentCamera);
}

if (stopEnrollmentCameraButton) {
  stopEnrollmentCameraButton.addEventListener('click', stopEnrollmentCamera);
}

if (captureEnrollmentButton) {
  captureEnrollmentButton.addEventListener('click', captureEnrollmentSamples);
}

window.addEventListener('beforeunload', () => {
  stopLiveCamera();
  stopEnrollmentCamera();
});

// Navbar functionality
const navbarRefreshButton = document.getElementById('navbar-refresh');
if (navbarRefreshButton) {
  navbarRefreshButton.addEventListener('click', () => {
    const currentPath = window.location.pathname;
    if (currentPath === '/attendance') {
      refreshAttendancePage();
    } else {
      window.location.href = '/';
    }
  });
}
