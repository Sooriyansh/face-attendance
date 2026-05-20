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

  return 'Set PYTHON_EXECUTABLE=python3 and install `python/requirements-render.txt`, then train the model.';
}

module.exports = {
  getPythonExecutable,
  getPythonSetupMessage,
};
