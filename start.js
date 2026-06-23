/**
 * start.js - VeloceDL All-in-One Bootstrap
 *
 * This script:
 *   1. Installs NPM dependencies (npm install --production)
 *   2. Downloads yt-dlp binary (if not already present)
 *   3. Downloads FFmpeg static binary on Linux (if not already present)
 *   4. Starts the Express server (src/server.js)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const isWindows = process.platform === 'win32';
const isLinux   = process.platform === 'linux';

const ROOT = __dirname;

// Binary destination paths
const ytDlpDest  = path.join(ROOT, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
const ffmpegDest = path.join(ROOT, isWindows ? 'ffmpeg.exe' : 'ffmpeg');

// Download URLs
// On Linux we use 'yt-dlp_linux' — a true standalone compiled binary
// that requires NO Python runtime (avoids runpy.py errors on Python 3.9 servers)
const YT_DLP_URL = isWindows
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : isLinux
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const FFMPEG_TAR_URL =
  'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

// ─────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────
function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.warn(`  ⚠️  ${msg}`); }
function fail(msg) { console.error(`  ❌ ${msg}`); }

function section(title) {
  console.log(`\n==================================================`);
  console.log(`  ${title}`);
  console.log(`==================================================`);
}

// ─────────────────────────────────────────────
// Step 1 – Install NPM packages
// ─────────────────────────────────────────────
function installPackages() {
  section('Step 1 / 3 — Installing NPM packages');
  log('Running: npm install --production ...');
  try {
    execSync('npm install --production', { stdio: 'inherit', cwd: ROOT });
    ok('NPM packages installed successfully.');
  } catch (err) {
    fail(`npm install failed: ${err.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// Shared: download a file following redirects
// ─────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const file = fs.createWriteStream(dest);
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        process.stdout.write(`\r    Downloaded: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => { process.stdout.write('\n'); resolve(); }));
      file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
    }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
  });
}

// ─────────────────────────────────────────────
// Step 2 – Download yt-dlp
// ─────────────────────────────────────────────
async function setupYtDlp() {
  section('Step 2 / 3 — Setting up yt-dlp');

  if (fs.existsSync(ytDlpDest)) {
    ok(`yt-dlp already present at ${ytDlpDest}. Skipping.`);
    return;
  }

  log(`Downloading yt-dlp from GitHub...`);
  try {
    await downloadFile(YT_DLP_URL, ytDlpDest);
    if (!isWindows) fs.chmodSync(ytDlpDest, '755');
    ok(`yt-dlp installed → ${ytDlpDest}`);
  } catch (err) {
    fail(`Could not download yt-dlp: ${err.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// Step 2b – Download FFmpeg (Linux only)
// ─────────────────────────────────────────────
async function setupFfmpegLinux() {
  if (fs.existsSync(ffmpegDest)) {
    ok(`FFmpeg already present at ${ffmpegDest}. Skipping.`);
    return;
  }

  log('Downloading FFmpeg static build for Linux...');
  const tarPath = path.join(ROOT, 'ffmpeg.tar.xz');

  try {
    await downloadFile(FFMPEG_TAR_URL, tarPath);
  } catch (err) {
    warn(`Could not download FFmpeg: ${err.message}`);
    warn('Try manually: sudo apt update && sudo apt install -y ffmpeg');
    return;
  }

  log('Extracting FFmpeg archive...');
  try {
    execSync(`tar -xf "${tarPath}"`, { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    fs.unlink(tarPath, () => {});
    warn(`Extraction failed: ${err.message}`);
    warn('Try manually: sudo apt update && sudo apt install -y ffmpeg');
    return;
  }

  // Locate the extracted 'ffmpeg' binary inside the unpacked folder
  const dirs = fs.readdirSync(ROOT).filter(
    (f) => f.startsWith('ffmpeg-') && f.endsWith('-static')
  );
  if (dirs.length === 0) {
    warn('Could not locate extracted FFmpeg folder.');
    return;
  }

  const extracted = path.join(ROOT, dirs[0], 'ffmpeg');
  try {
    fs.copyFileSync(extracted, ffmpegDest);
    fs.chmodSync(ffmpegDest, '755');
    // Cleanup
    fs.unlinkSync(tarPath);
    fs.rmSync(path.join(ROOT, dirs[0]), { recursive: true, force: true });
    ok(`FFmpeg installed → ${ffmpegDest}`);
  } catch (err) {
    warn(`Failed to copy FFmpeg binary: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// Step 3 – Start the server
// ─────────────────────────────────────────────
function startServer() {
  section('Step 3 / 3 — Starting VeloceDL server');
  log('Launching src/server.js ...\n');

  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env
  });

  server.on('error', (err) => {
    fail(`Server failed to start: ${err.message}`);
    process.exit(1);
  });

  server.on('exit', (code) => {
    if (code !== 0) {
      fail(`Server exited with code ${code}`);
      process.exit(code);
    }
  });

  // Forward termination signals to child
  ['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig, () => {
      server.kill(sig);
    });
  });
}

// ─────────────────────────────────────────────
// Main – run all steps in order
// ─────────────────────────────────────────────
(async () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  VeloceDL — Bootstrap & Start`);
  console.log(`  Platform : ${process.platform} (${process.arch})`);
  console.log(`  Node.js  : ${process.version}`);
  console.log(`${'='.repeat(50)}`);

  // 1. NPM packages
  installPackages();

  // 2. Binaries
  await setupYtDlp();
  if (isLinux) {
    await setupFfmpegLinux();
  } else if (!isWindows) {
    warn('macOS detected. Please install FFmpeg via: brew install ffmpeg');
  }

  // 3. Start server
  startServer();
})();
