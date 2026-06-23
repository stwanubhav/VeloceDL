# VeloceDL - YouTube Video & Audio Downloader

VeloceDL is a production-ready, high-speed YouTube Video and Audio Downloader web application. Built with a Node.js/Express backend and a responsive glassmorphism dark-themed frontend, it provides an exceptional, premium user experience.

## Features

- **Paste & Go**: One-click clipboard pasting with client-side URL validation.
- **Full Video & Audio Metadata**: Retrieves and displays thumbnails, video titles, channel names, upload dates, views, and duration.
- **Dynamic Quality Selection**: Supports all resolutions (e.g. 1080p, 720p, 480p, etc.) extracted dynamically from the YouTube stream.
- **Accurate Size Estimation**: Displays estimated size before starting the download.
- **Audio Extraction**: Converts any YouTube video or YouTube Short into high-quality `.mp3` format.
- **Shorts Support**: Fully compatible with YouTube Shorts and standard video links.
- **Real-Time Progress Tracking**: Streams progress updates (percentage, speed, and ETA) using Server-Sent Events (SSE).
- **Auto-Download & Clean Up**: Automatically triggers the browser save dialog when ready and schedules periodic cleanup of expired media files to conserve server storage.
- **Secure File Serving**: Implements rate limiting, input validation, and protection against SSRF or path traversal attacks.

---

## Prerequisites

Before running the application, make sure your system has the following installed:
1. **Node.js** (v18.0.0 or higher)
2. **yt-dlp** command-line utility
3. **FFmpeg** (required for merging audio/video streams and converting audio to MP3)

---

## Installation & Setup Guide

### 1. Install Node.js Dependencies
Navigate to the root directory of the application and run:
```bash
npm install
```

### 2. Setting Up Third-Party Dependencies (Windows)

#### **Installing FFmpeg on Windows**
1. Download the latest build from the official provider: [gyan.dev FFmpeg Git Builds](https://www.gyan.dev/ffmpeg/builds/) (choose the `ffmpeg-git-essentials.7z` file).
2. Extract the archive (e.g., using 7-Zip) to a permanent folder on your drive (e.g., `C:\Program Files\ffmpeg`).
3. Add the `bin` directory containing `ffmpeg.exe` to your Windows environment PATH variables:
   - Search for **Edit the system environment variables** in the Windows search bar.
   - Click on **Environment Variables**.
   - Under **System Variables**, double-click **Path**.
   - Click **New** and add: `C:\Program Files\ffmpeg\bin` (or the folder path where you extracted `ffmpeg.exe`).
   - Click **OK** to save.

#### **Installing yt-dlp on Windows**
1. Download the latest `yt-dlp.exe` binary from the official github repository release page: [yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases).
2. Create a folder (e.g., `C:\Program Files\yt-dlp`).
3. Move the downloaded `yt-dlp.exe` to this folder.
4. Add the folder path `C:\Program Files\yt-dlp` to your Windows environment PATH variables (following the same instructions as FFmpeg).

*Note: Alternatively, if you do not want to add these to your system PATH, you can configure their direct paths in the `.env` file instead (see below).*

---

## Configuration (`.env` Setup)

Create a `.env` file in the root directory (based on `.env.example`).

```env
# Server port
PORT=3000

# Executable Path Overrides
# Leave these empty if the binaries are added to your system PATH environment variable
# If configured, specify the absolute path to the executable file
YT_DLP_PATH=
FFMPEG_PATH=

# Storage path for temporary downloaded files
DOWNLOAD_DIR=downloads

# Cleanup interval in milliseconds (default: 5 minutes)
CLEANUP_INTERVAL_MS=300000

# Download expiration window in milliseconds (default: 30 minutes)
EXPIRATION_TIME_MS=1800000

# Maximum parallel downloads the server is allowed to process concurrently
MAX_CONCURRENT_DOWNLOADS=3
```

---

## Running the Application

### Development Mode
Runs the backend server using the direct node executor.
```bash
npm run dev
```

### Production Deployment
For deployment, use node directly or run with process managers like `pm2`:
```bash
npm start
```

---

## File Architecture

- **`src/config.js`**: Orchestrates configuration variables, directory initializations, and defaults.
- **`src/utils.js`**: Core helper library comprising YouTube URL parsing (Shorts/Standard), size/time format conversion, and filesystem garbage-collection.
- **`src/downloader.js`**: Handles binary spawns of `yt-dlp` and `ffmpeg`, and captures newline CLI output to feed into real-time state mappings.
- **`src/server.js`**: Serves static pages and defines endpoints (`/api/info`, `/api/download/start`, `/api/download/progress/:taskId`, `/api/download/file/:fileId`).
- **`public/index.html`**: Premium glassmorphism webpage markup.
- **`public/style.css`**: Styling sheets, animations, and custom scrollbar definitions.
- **`public/app.js`**: Validates input URLs, communicates with Express APIs, binds SSE connections, and triggers auto-downloads.
