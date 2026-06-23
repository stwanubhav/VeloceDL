const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Resolve download directory absolute path
const rawDownloadDir = process.env.DOWNLOAD_DIR || 'downloads';
const DOWNLOAD_DIR = path.isAbsolute(rawDownloadDir) 
  ? rawDownloadDir 
  : path.join(__dirname, '..', rawDownloadDir);

// Ensure the directory exists
try {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    console.log(`Created temporary download directory at: ${DOWNLOAD_DIR}`);
  }
} catch (error) {
  console.error(`Failed to create downloads directory: ${error.message}`);
}

let YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';
if (YT_DLP_PATH === 'yt-dlp') {
  const localYtdlp = path.join(__dirname, '..', 'yt-dlp.exe');
  if (fs.existsSync(localYtdlp)) {
    YT_DLP_PATH = localYtdlp;
  }
}

let FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
if (FFMPEG_PATH === 'ffmpeg') {
  const localFfmpeg = path.join(__dirname, '..', 'ffmpeg.exe');
  if (fs.existsSync(localFfmpeg)) {
    FFMPEG_PATH = localFfmpeg;
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  YT_DLP_PATH,
  FFMPEG_PATH,
  DOWNLOAD_DIR,
  CLEANUP_INTERVAL_MS: parseInt(process.env.CLEANUP_INTERVAL_MS || '300000', 10),
  EXPIRATION_TIME_MS: parseInt(process.env.EXPIRATION_TIME_MS || '1800000', 10),
  MAX_CONCURRENT_DOWNLOADS: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '3', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  isFfmpegAvailable: false // Set dynamically at server start
};
