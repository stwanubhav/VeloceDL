const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');

/**
 * Extracts the 11-character video ID from any standard YouTube or Shorts URL.
 * Returns null if the URL is invalid.
 * @param {string} url 
 * @returns {string|null}
 */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  
  // Regex to match YouTube standard, embed, shorts, mobile, and short-links (youtu.be)
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.trim().match(regExp);
  
  if (match && match[2] && match[2].length === 11) {
    return match[2];
  }
  return null;
}

/**
 * Validates whether a URL is a valid YouTube or YouTube Shorts video URL.
 * @param {string} url 
 * @returns {boolean}
 */
function validateYoutubeUrl(url) {
  return extractVideoId(url) !== null;
}

/**
 * Generates a safe filename by removing illegal characters, replacing spaces with underscores,
 * and ensuring there are no traversal attempts.
 * @param {string} title 
 * @param {string} ext 
 * @returns {string}
 */
function getSafeFilename(title, ext) {
  let sanitized = sanitize(title || 'video');
  
  sanitized = sanitized
    .replace(/[\\/:*?"<>|]/g, '') // remove illegal characters
    .replace(/\s+/g, '_')         // replace whitespace with underscores
    .replace(/_+/g, '_');         // collapse multiple underscores
    
  if (!sanitized || sanitized === '_') {
    sanitized = 'video';
  }
  
  // Ensure extension is alphanumeric and doesn't contain traversal characters
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '');
  return `${sanitized}.${cleanExt}`;
}

/**
 * Formats a duration in seconds into HH:MM:SS or MM:SS format.
 * @param {number} seconds 
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats a file size in bytes to a human-readable string (KB, MB, GB).
 * @param {number} bytes 
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) {
    return 'Unknown size';
  }
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Scans the download directory and recursively removes folders older than the expiration window.
 * @param {string} downloadDir 
 * @param {number} expirationTimeMs 
 */
function cleanupExpiredFiles(downloadDir, expirationTimeMs) {
  if (!fs.existsSync(downloadDir)) return;
  
  const now = Date.now();
  fs.readdir(downloadDir, (err, folders) => {
    if (err) {
      console.error(`Error reading download directory for cleanup: ${err.message}`);
      return;
    }
    
    folders.forEach(folder => {
      const folderPath = path.join(downloadDir, folder);
      fs.stat(folderPath, (statErr, stats) => {
        if (statErr) {
          // If folder was deleted in parallel or doesn't exist, ignore
          return;
        }
        
        if (stats.isDirectory()) {
          const age = now - stats.mtimeMs;
          if (age > expirationTimeMs) {
            console.log(`Pruning expired download folder: ${folder} (Age: ${Math.round(age / 1000 / 60)} minutes)`);
            fs.rm(folderPath, { recursive: true, force: true }, rmErr => {
              if (rmErr) {
                console.error(`Failed to delete folder ${folderPath}: ${rmErr.message}`);
              }
            });
          }
        }
      });
    });
  });
}

/**
 * Checks if FFmpeg is installed and accessible on the server.
 * @param {string} ffmpegPath
 * @returns {Promise<boolean>}
 */
function checkFfmpeg(ffmpegPath) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn(ffmpegPath, ['-version']);
    
    child.on('error', () => {
      resolve(false);
    });
    
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

module.exports = {
  extractVideoId,
  validateYoutubeUrl,
  getSafeFilename,
  formatDuration,
  formatSize,
  cleanupExpiredFiles,
  checkFfmpeg
};
