const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { validateYoutubeUrl, cleanupExpiredFiles, checkFfmpeg } = require('./utils');
const { tasks, fileMappings, getVideoInfo, startDownload, cancelDownload } = require('./downloader');

const app = express();

// Standard middlewares
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate Limiting
const generalLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// A slightly stricter limit for initiating downloads
const downloadLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: 15, // 15 downloads per 15 mins per IP
  message: { error: 'Too many download requests, please wait before requesting another download.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiter to APIs
app.use('/api/', generalLimiter);

/**
 * Endpoint: POST /api/info
 * Retrieves metadata for a YouTube video/Shorts URL
 */
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required.' });
  }
  
  if (!validateYoutubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid video or Shorts link.' });
  }
  
  try {
    const info = await getVideoInfo(url);
    info.isFfmpegAvailable = config.isFfmpegAvailable;
    res.json(info);
  } catch (error) {
    console.error(`Error retrieving info for ${url}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint: POST /api/download/start
 * Initiates downloading process in the background
 */
app.post('/api/download/start', downloadLimiter, (req, res) => {
  const { url, type, formatId, metadata } = req.body;
  
  if (!url || !type || !formatId || !metadata) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }
  
  if (!validateYoutubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }
  
  // Validate FFmpeg requirements
  const isVideo = type === 'video';
  let requiresFfmpeg = true;
  if (isVideo) {
    const chosenRes = metadata.resolutions && metadata.resolutions.find(r => r.formatId === formatId);
    if (chosenRes && chosenRes.isCombined) {
      requiresFfmpeg = false;
    }
  }
  
  if (requiresFfmpeg && !config.isFfmpegAvailable) {
    return res.status(400).json({ 
      error: 'FFmpeg is not installed or configured on the server. High-resolution downloads (1080p+) and MP3 extractions require FFmpeg. Please install FFmpeg or choose a combined resolution (360p or 720p).' 
    });
  }
  
  // Count active downloads
  let activeCount = 0;
  for (const task of tasks.values()) {
    if (['preparing', 'downloading', 'processing'].includes(task.status)) {
      activeCount++;
    }
  }
  
  if (activeCount >= config.MAX_CONCURRENT_DOWNLOADS) {
    return res.status(429).json({ 
      error: 'The server is currently busy with multiple downloads. Please try again in a few moments.' 
    });
  }
  
  const taskId = require('uuid').v4();
  
  // Start the background process
  startDownload(taskId, url, type, formatId, metadata);
  
  res.json({ taskId });
});

/**
 * Endpoint: GET /api/download/progress/:taskId
 * Server-Sent Events (SSE) to push download updates to client
 */
app.get('/api/download/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  
  if (!task) {
    return res.status(404).json({ error: 'Download task not found.' });
  }
  
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Establish stream
  
  // Send initial state immediately
  res.write(`data: ${JSON.stringify({
    status: task.status,
    progress: task.progress,
    speed: task.speed,
    eta: task.eta,
    totalSize: task.totalSize,
    fileId: task.fileId,
    filename: task.filename,
    error: task.error
  })}\n\n`);
  
  // Setup interval to poll and stream changes
  const intervalId = setInterval(() => {
    const currentTask = tasks.get(taskId);
    
    if (!currentTask) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Task deleted or lost.' })}\n\n`);
      clearInterval(intervalId);
      res.end();
      return;
    }
    
    res.write(`data: ${JSON.stringify({
      status: currentTask.status,
      progress: currentTask.progress,
      speed: currentTask.speed,
      eta: currentTask.eta,
      totalSize: currentTask.totalSize,
      fileId: currentTask.fileId,
      filename: currentTask.filename,
      error: currentTask.error
    })}\n\n`);
    
    // Close connection if complete
    if (['ready', 'error', 'cancelled'].includes(currentTask.status)) {
      clearInterval(intervalId);
      res.end();
    }
  }, 800); // Poll task status every 800ms
  
  // Cleanup interval on connection close
  req.on('close', () => {
    clearInterval(intervalId);
  });
});

/**
 * Endpoint: POST /api/download/cancel/:taskId
 * Cancels a running download task
 */
app.post('/api/download/cancel/:taskId', (req, res) => {
  const { taskId } = req.params;
  const success = cancelDownload(taskId);
  
  if (success) {
    res.json({ success: true, message: 'Download task successfully cancelled.' });
  } else {
    res.status(404).json({ error: 'Active download task not found.' });
  }
});

/**
 * Endpoint: GET /api/download/file/:fileId
 * Downloads the compiled video or audio file
 */
app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  const mapping = fileMappings.get(fileId);
  
  if (!mapping) {
    return res.status(404).send('Download link has expired or is invalid.');
  }
  
  // Prevent path traversal
  const resolvedPath = path.resolve(mapping.path);
  const resolvedDownloadDir = path.resolve(config.DOWNLOAD_DIR);
  
  if (!resolvedPath.startsWith(resolvedDownloadDir)) {
    return res.status(403).send('Forbidden request.');
  }
  
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).send('File not found on server storage.');
  }
  
  // Serve the file as attachment download
  res.download(resolvedPath, mapping.name, (err) => {
    if (err) {
      if (!res.headersSent) {
        console.error(`File download transfer error: ${err.message}`);
        res.status(500).send('Error occurred during file transfer.');
      }
      return;
    }
    
    // Delete file immediately after successful download
    try {
      const taskDir = path.dirname(resolvedPath);
      fs.rm(taskDir, { recursive: true, force: true }, (rmErr) => {
        if (rmErr) console.error(`Failed to clean up files for fileId ${fileId}:`, rmErr.message);
      });
      fileMappings.delete(fileId);
    } catch (cleanupErr) {
      console.error(`Post-download cleanup error:`, cleanupErr);
    }
  });
});

// Periodic Cleanup Task for Expired Files
setInterval(() => {
  console.log('Running automatic cleanup worker...');
  cleanupExpiredFiles(config.DOWNLOAD_DIR, config.EXPIRATION_TIME_MS);
}, config.CLEANUP_INTERVAL_MS);

// Start the Express server
app.listen(config.PORT, () => {
  console.log(`==================================================`);
  console.log(` YouTube Downloader Server is running successfully`);
  console.log(` Port: ${config.PORT}`);
  console.log(` Mode: Production-ready`);
  console.log(` Environment: Node.js ${process.version}`);
  console.log(` Temp Directory: ${config.DOWNLOAD_DIR}`);
  console.log(`==================================================`);
  
  // Check FFmpeg availability at startup
  checkFfmpeg(config.FFMPEG_PATH).then(available => {
    config.isFfmpegAvailable = available;
    if (!available) {
      console.log(' WARNING: FFmpeg was not found on this system!');
      console.log(' - High-resolution downloads (1080p+) are disabled');
      console.log(' - Audio-only MP3 extractions are disabled');
      console.log(' - Only combined 360p/720p formats will work');
      console.log(' Please download FFmpeg and place it in the project');
      console.log(' root or configure FFMPEG_PATH in your .env file.');
      console.log('==================================================');
    } else {
      console.log(' FFmpeg verification: INSTALLED AND ACTIVE');
      console.log('==================================================');
    }
  });
});
