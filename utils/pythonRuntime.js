const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const WINDOWS_VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
const POSIX_VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');

function commandExists(command) {
  if (!command) {
    return false;
  }

  if (path.isAbsolute(command) || command.includes(path.sep) || command.includes('/')) {
    return fs.existsSync(command);
  }

  return true;
}

function getPythonExecutable() {
  const candidates = [
    process.env.PYTHON_EXECUTABLE,
    process.platform === 'win32' ? WINDOWS_VENV_PYTHON : POSIX_VENV_PYTHON,
    process.platform === 'win32' ? 'python' : 'python3',
    'python',
  ].filter(Boolean);

  return candidates.find(commandExists) || candidates[0];
}

function getPythonSetupMessage() {
  if (process.platform === 'win32') {
    return 'Run `npm run setup:python`, then `npm run py:train`.';
  }

  return 'Render build must run `npm run render:build`, PYTHON_EXECUTABLE must be `python3`, and FACE_DATA_DIR must contain trained `models/face_embeddings.npz`.';
}

module.exports = {
  getPythonExecutable,
  getPythonSetupMessage,
};
