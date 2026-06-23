const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { getSafeFilename, formatDuration } = require('./utils');

// In-memory task tracker
const tasks = new Map();

/**
 * Parses yt-dlp stderr output to return a user-friendly error message.
 * @param {string} stderr 
 * @returns {string}
 */
function parseYtdlpError(stderr) {
  const errLower = stderr.toLowerCase();
  
  if (errLower.includes('sign in to confirm your age') || errLower.includes('confirm your age')) {
    return 'This video is age-restricted and requires age verification. Downloading age-restricted videos is not supported.';
  }
  if (errLower.includes('private video') || errLower.includes('is private')) {
    return 'This video is private. Only public and unlisted videos can be downloaded.';
  }
  if (errLower.includes('removed by the uploader') || errLower.includes('video unavailable') || errLower.includes('does not exist')) {
    return 'This video is unavailable or has been removed by the uploader.';
  }
  if (errLower.includes('copyright') || errLower.includes('copyright claim')) {
    return 'This video is blocked or restricted due to copyright claims.';
  }
  if (errLower.includes('unsupported url') || errLower.includes('invalid') || errLower.includes('url is invalid')) {
    return 'Invalid YouTube URL. Please check the URL and try again.';
  }
  if (errLower.includes('invaid argument') || errLower.includes('regex')) {
    return 'URL validation failed. Please provide a standard YouTube video or Shorts link.';
  }
  
  // Return the raw error if nothing matches, capping length
  return stderr.length > 150 ? stderr.substring(0, 150) + '...' : stderr;
}

/**
 * Fetches YouTube video metadata using yt-dlp.
 * @param {string} url 
 * @returns {Promise<object>}
 */
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      url
    ];
    
    // If ffmpeg location is configured, provide it to yt-dlp
    if (config.FFMPEG_PATH && config.FFMPEG_PATH !== 'ffmpeg') {
      args.push('--ffmpeg-location', config.FFMPEG_PATH);
    }
    
    const child = spawn(config.YT_DLP_PATH, args);
    
    child.on('error', (err) => {
      reject(new Error(`yt-dlp executable not found or failed to execute. Please install yt-dlp and configure its path in your PATH or .env. (Details: ${err.message})`));
    });
    
    let stdoutData = '';
    let stderrData = '';
    
    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        const errorMsg = parseYtdlpError(stderrData || `Process exited with code ${code}`);
        return reject(new Error(errorMsg));
      }
      
      try {
        const info = JSON.parse(stdoutData);
        
        // Find best thumbnail
        let thumbnail = info.thumbnail;
        if (info.thumbnails && info.thumbnails.length > 0) {
          // Sort by width descending to get the highest resolution thumbnail
          const sortedThumbnails = [...info.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
          thumbnail = sortedThumbnails[0].url;
        }
        
        // Extract and group video qualities
        const formats = info.formats || [];
        
        // Best audio size estimation
        const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        let bestAudio = null;
        audioFormats.forEach(f => {
          if (!bestAudio || (f.abr || 0) > (bestAudio.abr || 0)) {
            bestAudio = f;
          }
        });
        
        const audioSize = bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || 0) : 0;
        
        // Unique heights
        const resolutionsMap = {};
        formats.forEach(f => {
          const height = f.height;
          // Filter only video streams (might be video-only or combined)
          if (!height || f.vcodec === 'none') return;
          
          const current = resolutionsMap[height];
          // We prefer mp4 containers if available, otherwise just highest bitrate
          const isMp4 = f.ext === 'mp4' || f.container === 'mp4';
          const currentIsMp4 = current ? (current.ext === 'mp4' || current.container === 'mp4') : false;
          
          if (!current || (isMp4 && !currentIsMp4) || (f.tbr || 0) > (current.tbr || 0)) {
            resolutionsMap[height] = f;
          }
        });
        
        const resolutions = Object.keys(resolutionsMap).map(height => {
          const format = resolutionsMap[height];
          const hasAudio = format.acodec !== 'none' && format.acodec !== null;
          
          let size = format.filesize || format.filesize_approx || 0;
          if (size > 0 && !hasAudio) {
            size += audioSize; // If video-only, add audio size for estimation
          }
          
          // Fallback size estimation using bitrate if filesize is missing
          if ((!size || size === 0) && format.tbr && info.duration) {
            const totalTbr = format.tbr + (!hasAudio && bestAudio ? (bestAudio.tbr || 128) : 0);
            size = Math.round((totalTbr * 1000 * info.duration) / 8);
          }
          
          return {
            height: parseInt(height, 10),
            resolution: `${height}p`,
            fps: format.fps || 30,
            ext: 'mp4', // yt-dlp will merge/transcode to mp4
            size: size > 0 ? size : null,
            formatId: format.format_id
          };
        }).sort((a, b) => b.height - a.height);
        
        // Best audio size estimation
        let bestAudioSize = audioSize;
        if ((!bestAudioSize || bestAudioSize === 0) && bestAudio && bestAudio.tbr && info.duration) {
          bestAudioSize = Math.round((bestAudio.tbr * 1000 * info.duration) / 8);
        }
        
        const result = {
          id: info.id,
          title: info.title,
          channel: info.uploader || info.channel,
          duration: info.duration,
          durationFormatted: formatDuration(info.duration),
          uploadDate: info.upload_date ? `${info.upload_date.substring(0, 4)}-${info.upload_date.substring(4, 6)}-${info.upload_date.substring(6, 8)}` : 'Unknown',
          views: info.view_count || 0,
          thumbnail,
          url: info.webpage_url || url,
          resolutions,
          bestAudio: bestAudio ? {
            formatId: bestAudio.format_id,
            ext: 'mp3', // We convert to mp3
            size: bestAudioSize > 0 ? bestAudioSize : null,
            abr: bestAudio.abr || 128
          } : null
        };
        
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse video metadata: ${err.message}`));
      }
    });
  });
}

/**
 * Initiates downloading process.
 * @param {string} taskId 
 * @param {string} url 
 * @param {string} type 'video'|'audio'
 * @param {string} formatId chosen format ID (or 'bestaudio')
 * @param {object} metadata video metadata object (title, uploader, etc.)
 */
function startDownload(taskId, url, type, formatId, metadata) {
  const task = {
    id: taskId,
    url,
    type,
    status: 'preparing',
    progress: 0,
    speed: '',
    eta: '',
    totalSize: '',
    filename: '',
    fileId: '',
    error: null,
    process: null
  };
  
  tasks.set(taskId, task);
  
  // Create task-specific download directory
  const taskDir = path.join(config.DOWNLOAD_DIR, taskId);
  try {
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
  } catch (error) {
    task.status = 'error';
    task.error = `Failed to create download directory: ${error.message}`;
    return;
  }
  
  // Set up yt-dlp arguments
  const args = [
    url,
    '--newline',
    '--no-playlist',
    '--progress'
  ];
  
  // If ffmpeg location is configured, provide it to yt-dlp
  if (config.FFMPEG_PATH && config.FFMPEG_PATH !== 'ffmpeg') {
    args.push('--ffmpeg-location', config.FFMPEG_PATH);
  }
  
  let targetFileId = uuidv4();
  let finalExt = type === 'video' ? 'mp4' : 'mp3';
  let safeName = getSafeFilename(metadata.title, finalExt);
  
  // The local file we save is fixed, e.g. "download.mp4" or "download.mp3"
  const localOutputName = `download.${finalExt}`;
  
  if (type === 'video') {
    // Standard format download: Selected video + Best audio -> merge to MP4
    args.push('-f', `${formatId}+bestaudio/bestvideo+bestaudio/best`);
    args.push('--merge-output-format', 'mp4');
    args.push('-o', path.join(taskDir, 'download.%(ext)s'));
  } else {
    // Audio extraction: Download best audio -> extract and convert to MP3
    args.push('-f', 'bestaudio/best');
    args.push('--extract-audio');
    args.push('--audio-format', 'mp3');
    args.push('--audio-quality', '0'); // Best VBR quality
    args.push('-o', path.join(taskDir, 'download.%(ext)s'));
  }
  
  try {
    const child = spawn(config.YT_DLP_PATH, args);
    
    child.on('error', (err) => {
      task.status = 'error';
      task.error = `yt-dlp executable not found or failed to execute. Please install yt-dlp and configure its path in your PATH or .env.`;
      console.error(`Download task ${taskId} spawn error:`, err);
    });
    
    task.process = child;
    task.status = 'downloading';
    
    let stdoutBuffer = '';
    
    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutBuffer += output;
      
      // Parse newline progress lines
      const lines = output.split('\n');
      lines.forEach(line => {
        line = line.trim();
        if (!line) return;
        
        // Progress parsing
        if (line.startsWith('[download]')) {
          const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
          const sizeMatch = line.match(/of\s+(~?\d+(?:\.\d+)?\w+|unknown)/i);
          const speedMatch = line.match(/at\s+(\d+(?:\.\d+)?\w+\/s|unknown\s+speed)/i);
          const etaMatch = line.match(/ETA\s+(\d+(?::\d+)+)/i);
          
          if (percentMatch) {
            task.progress = parseFloat(percentMatch[1]);
          }
          if (sizeMatch) {
            task.totalSize = sizeMatch[1];
          }
          if (speedMatch) {
            task.speed = speedMatch[1];
          }
          if (etaMatch) {
            task.eta = etaMatch[1];
          }
        }
        
        // Stage parsing
        if (line.includes('[Merger]') || line.includes('[ffmpeg]') || line.includes('[ExtractAudio]')) {
          task.status = 'processing';
          task.speed = '';
          task.eta = '';
        }
      });
    });
    
    let stderrBuffer = '';
    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });
    
    child.on('close', (code) => {
      task.process = null;
      
      if (task.status === 'cancelled') {
        // Task clean up is handled by cancel API
        return;
      }
      
      if (code !== 0) {
        task.status = 'error';
        task.error = parseYtdlpError(stderrBuffer || `Download failed with exit code ${code}`);
        console.error(`Download task ${taskId} failed: ${stderrBuffer}`);
        
        // Clean up empty directory
        fs.rm(taskDir, { recursive: true, force: true }, () => {});
        return;
      }
      
      // Verify final file exists
      const targetFilePath = path.join(taskDir, localOutputName);
      if (fs.existsSync(targetFilePath)) {
        task.status = 'ready';
        task.progress = 100;
        task.speed = '';
        task.eta = '';
        task.fileId = targetFileId;
        task.filename = safeName; // Client will receive this name
        
        // Create a separate mapping of fileId to actual filepath for secure downloads
        fileMappings.set(targetFileId, {
          path: targetFilePath,
          name: safeName,
          taskId: taskId
        });
        
        console.log(`Download task ${taskId} is ready. Saved to ${targetFilePath}`);
      } else {
        task.status = 'error';
        task.error = `Finished downloading, but the final file could not be compiled. This usually happens if FFmpeg is missing, misconfigured, or has failed. Please verify that FFmpeg is installed.`;
        console.error(`Download task ${taskId} error: Target file ${targetFilePath} was not created. (Ensure FFmpeg is installed).`);
        // Clean up empty directory
        fs.rm(taskDir, { recursive: true, force: true }, () => {});
      }
    });
  } catch (err) {
    task.status = 'error';
    task.error = `Execution error: ${err.message}`;
    console.error(`Error executing yt-dlp:`, err);
  }
}

// Map fileId to absolute file paths for downloads
const fileMappings = new Map();

/**
 * Cancels an active download task and cleans up its directory.
 * @param {string} taskId 
 * @returns {boolean}
 */
function cancelDownload(taskId) {
  const task = tasks.get(taskId);
  if (!task) return false;
  
  if (task.process) {
    task.status = 'cancelled';
    task.process.kill('SIGTERM');
  }
  
  // Clean up directory
  const taskDir = path.join(config.DOWNLOAD_DIR, taskId);
  fs.rm(taskDir, { recursive: true, force: true }, (err) => {
    if (err) console.error(`Failed to delete directory for cancelled task ${taskId}:`, err);
  });
  
  // Remove file mappings
  for (const [fileId, mapping] of fileMappings.entries()) {
    if (mapping.taskId === taskId) {
      fileMappings.delete(fileId);
    }
  }
  
  tasks.delete(taskId);
  return true;
}

module.exports = {
  tasks,
  fileMappings,
  getVideoInfo,
  startDownload,
  cancelDownload
};
