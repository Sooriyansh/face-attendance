const { spawnSync } = require('child_process');
const path = require('path');

const shouldInstall = process.env.RENDER === 'true' || process.env.INSTALL_PYTHON_DEPS === '1';

if (!shouldInstall) {
  console.log('Skipping Python dependency install. Set INSTALL_PYTHON_DEPS=1 to run it locally.');
  process.exit(0);
}

const python = process.env.PYTHON_EXECUTABLE || 'python3';
const requirements = path.join(__dirname, '..', 'python', 'requirements-render.txt');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Installing Python dependencies with ${python}...`);
run(python, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(python, ['-m', 'pip', 'install', '-r', requirements]);
