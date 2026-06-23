// Frontend state management
let currentTaskId = null;
let progressEventSource = null;

// Element references
const searchForm = document.getElementById('searchForm');
const urlInput = document.getElementById('urlInput');
const pasteBtn = document.getElementById('pasteBtn');
const searchSubmitBtn = document.getElementById('searchSubmitBtn');
const urlError = document.getElementById('urlError');

const metadataLoader = document.getElementById('metadataLoader');
const resultSection = document.getElementById('resultSection');
const ffmpegWarningBanner = document.getElementById('ffmpegWarningBanner');

const videoThumbnail = document.getElementById('videoThumbnail');
const videoDuration = document.getElementById('videoDuration');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel');
const videoDate = document.getElementById('videoDate');
const videoViews = document.getElementById('videoViews');

const videoFormatsBody = document.getElementById('videoFormatsBody');
const audioBitrate = document.getElementById('audioBitrate');
const audioSize = document.getElementById('audioSize');
const downloadAudioBtn = document.getElementById('downloadAudioBtn');

// Modal Elements
const progressModal = document.getElementById('progressModal');
const modalHeaderTitle = document.getElementById('modalHeaderTitle');
const closeModalBtn = document.getElementById('closeModalBtn');
const statusIcon = document.getElementById('statusIcon');
const statusIconBox = document.getElementById('statusIconBox');
const statusPulseRing = document.getElementById('statusPulseRing');
const progressStatusText = document.getElementById('progressStatusText');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercent = document.getElementById('progressPercent');
const progressSize = document.getElementById('progressSize');
const downloadMetrics = document.getElementById('downloadMetrics');
const metricSpeed = document.getElementById('metricSpeed');
const metricEta = document.getElementById('metricEta');
const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');
const saveFileBtn = document.getElementById('saveFileBtn');

// URL Validation Regex (matches YouTube standard, mobile, embed, shorts, youtu.be)
const YOUTUBE_REGEX = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\S+)?$/;

/**
 * Validates a string as a YouTube URL.
 */
function isValidYoutubeUrl(url) {
  return YOUTUBE_REGEX.test(url.trim());
}

/**
 * Formats a file size in bytes to a human-readable string.
 */
function formatSize(bytes) {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) {
    return 'Unknown size';
  }
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

// Clipboard Paste Integration
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      urlError.classList.add('hidden');
    }
  } catch (err) {
    console.warn('Unable to read clipboard contents. Paste manually.', err);
  }
});

// Tab Toggling
document.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => {
    // Deactivate current tabs
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Activate target tab
    button.classList.add('active');
    const targetTabId = button.getAttribute('data-tab');
    document.getElementById(targetTabId).classList.add('active');
  });
});

// Form Submit - Analyze URL
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const url = urlInput.value.trim();
  
  if (!isValidYoutubeUrl(url)) {
    urlError.classList.remove('hidden');
    urlInput.focus();
    return;
  }
  
  urlError.classList.add('hidden');
  resultSection.classList.add('hidden');
  metadataLoader.classList.remove('hidden');
  searchSubmitBtn.disabled = true;
  
  try {
    const response = await fetch('/api/info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch video information.');
    }
    
    displayMetadata(data);
  } catch (error) {
    alert(error.message);
  } finally {
    metadataLoader.classList.add('hidden');
    searchSubmitBtn.disabled = false;
  }
});

/**
 * Updates UI with the analyzed YouTube video metadata.
 */
function displayMetadata(metadata) {
  videoThumbnail.src = metadata.thumbnail;
  videoDuration.innerText = metadata.durationFormatted;
  videoTitle.innerText = metadata.title;
  videoChannel.innerText = metadata.channel;
  videoDate.innerText = metadata.uploadDate;
  videoViews.innerText = metadata.views.toLocaleString();
  
  // Show or hide warning banner based on FFmpeg presence
  if (metadata.isFfmpegAvailable === false) {
    ffmpegWarningBanner.classList.remove('hidden');
  } else {
    ffmpegWarningBanner.classList.add('hidden');
  }
  
  // Build video formats list
  videoFormatsBody.innerHTML = '';
  if (metadata.resolutions && metadata.resolutions.length > 0) {
    metadata.resolutions.forEach(res => {
      const row = document.createElement('tr');
      
      const sizeText = res.size ? formatSize(res.size) : 'Unknown size';
      const fpsText = res.fps > 30 ? ` (${res.fps}fps)` : '';
      
      const needsFfmpeg = !res.isCombined && !metadata.isFfmpegAvailable;
      const buttonHtml = needsFfmpeg 
        ? `<button class="btn-dl-row" disabled style="opacity: 0.55; cursor: not-allowed; background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.05); color: var(--text-muted);">
             <i class="fa-solid fa-lock"></i> Requires FFmpeg
           </button>`
        : `<button class="btn-dl-row" data-format-id="${res.formatId}" data-res="${res.resolution}">
             <i class="fa-solid fa-download"></i> Get Video
           </button>`;
      
      row.innerHTML = `
        <td><span class="resolution-tag">${res.resolution}${fpsText}</span></td>
        <td><span class="format-ext">${res.ext.toUpperCase()}</span></td>
        <td>${sizeText}</td>
        <td>${buttonHtml}</td>
      `;
      
      // Hook up download click event only if supported
      if (!needsFfmpeg) {
        row.querySelector('.btn-dl-row').addEventListener('click', () => {
          startDownloadTask(metadata.url, 'video', res.formatId, metadata, res.resolution);
        });
      }
      
      videoFormatsBody.appendChild(row);
    });
  } else {
    videoFormatsBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No video formats available.</td></tr>';
  }
  
  // Set up audio formats
  if (metadata.bestAudio) {
    audioBitrate.innerText = `${metadata.bestAudio.abr} kbps`;
    audioSize.innerText = metadata.bestAudio.size ? formatSize(metadata.bestAudio.size) : 'Unknown size';
    
    // Clear and clone to avoid duplicate listeners
    const newDownloadAudioBtn = downloadAudioBtn.cloneNode(true);
    downloadAudioBtn.parentNode.replaceChild(newDownloadAudioBtn, downloadAudioBtn);
    
    if (!metadata.isFfmpegAvailable) {
      newDownloadAudioBtn.disabled = true;
      newDownloadAudioBtn.style.opacity = '0.5';
      newDownloadAudioBtn.style.cursor = 'not-allowed';
      newDownloadAudioBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Requires FFmpeg`;
    } else {
      newDownloadAudioBtn.addEventListener('click', () => {
        startDownloadTask(metadata.url, 'audio', metadata.bestAudio.formatId, metadata, 'MP3 Audio');
      });
    }
  } else {
    audioSize.innerText = 'Not available';
  }
  
  // Reveal details
  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Requests backend to start a download task and monitors its progress using SSE.
 */
async function startDownloadTask(url, type, formatId, metadata, qualityLabel) {
  try {
    const response = await fetch('/api/download/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, type, formatId, metadata })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start download task.');
    }
    
    currentTaskId = data.taskId;
    openProgressModal(type, qualityLabel);
    trackProgress(currentTaskId);
  } catch (error) {
    alert(error.message);
  }
}

/**
 * Opens and initializes the progress modal.
 */
function openProgressModal(type, label) {
  modalHeaderTitle.innerText = `Downloading: ${label}`;
  progressModal.classList.remove('hidden');
  closeModalBtn.classList.add('hidden');
  saveFileBtn.classList.add('hidden');
  cancelDownloadBtn.classList.remove('hidden');
  downloadMetrics.classList.remove('hidden');
  
  // Reset bar & stats
  progressBarFill.style.width = '0%';
  progressPercent.innerText = '0%';
  progressSize.innerText = 'Calculating size...';
  metricSpeed.innerText = '--';
  metricEta.innerText = '--:--';
  
  // Reset status icons
  statusPulseRing.className = 'pulse-ring active';
  statusPulseRing.style.borderColor = 'var(--color-secondary)';
  statusIconBox.style.borderColor = 'var(--color-secondary)';
  statusIconBox.style.color = 'var(--color-secondary)';
  statusIconBox.style.boxShadow = '0 0 20px var(--color-secondary-glow)';
  statusIcon.className = 'fa-solid fa-cloud-arrow-down';
  
  progressStatusText.innerText = 'Preparing download files...';
}

/**
 * Connects to the SSE endpoint to stream task progress.
 */
function trackProgress(taskId) {
  if (progressEventSource) {
    progressEventSource.close();
  }
  
  progressEventSource = new EventSource(`/api/download/progress/${taskId}`);
  
  progressEventSource.onmessage = (event) => {
    const task = JSON.parse(event.data);
    
    // Update progress bar
    if (task.progress !== undefined) {
      progressBarFill.style.width = `${task.progress}%`;
      progressPercent.innerText = `${Math.round(task.progress)}%`;
    }
    
    // Update metrics
    if (task.totalSize) {
      progressSize.innerText = task.totalSize;
    }
    if (task.speed) {
      metricSpeed.innerText = task.speed;
    }
    if (task.eta) {
      metricEta.innerText = task.eta;
    }
    
    // Update status based on state
    switch (task.status) {
      case 'preparing':
        progressStatusText.innerText = 'Preparing media formats...';
        statusIcon.className = 'fa-solid fa-hourglass-start';
        break;
        
      case 'downloading':
        progressStatusText.innerText = 'Downloading streams from YouTube...';
        statusIcon.className = 'fa-solid fa-cloud-arrow-down';
        break;
        
      case 'processing':
        progressStatusText.innerText = task.type === 'video' 
          ? 'Merging video and audio layers... (FFmpeg)' 
          : 'Extracting and converting to MP3 audio...';
        statusIcon.className = 'fa-solid fa-arrows-spin fa-spin'; // Spin animation!
        statusPulseRing.style.borderColor = 'var(--color-primary)';
        statusIconBox.style.borderColor = 'var(--color-primary)';
        statusIconBox.style.color = 'var(--color-primary)';
        statusIconBox.style.boxShadow = '0 0 20px var(--color-primary-glow)';
        metricSpeed.innerText = 'Processing';
        metricEta.innerText = '--:--';
        break;
        
      case 'ready':
        progressStatusText.innerText = 'Media file ready for download!';
        statusIcon.className = 'fa-solid fa-circle-check';
        statusPulseRing.className = 'pulse-ring'; // Stop pulse
        statusIconBox.style.borderColor = 'var(--color-success)';
        statusIconBox.style.color = 'var(--color-success)';
        statusIconBox.style.boxShadow = '0 0 20px var(--color-success-glow)';
        
        cancelDownloadBtn.classList.add('hidden');
        downloadMetrics.classList.add('hidden');
        closeModalBtn.classList.remove('hidden');
        
        // Configure Save File button link
        saveFileBtn.href = `/api/download/file/${task.fileId}`;
        saveFileBtn.classList.remove('hidden');
        
        progressEventSource.close();
        
        // Auto trigger download!
        triggerAutoDownload(`/api/download/file/${task.fileId}`, task.filename);
        break;
        
      case 'error':
        progressStatusText.innerText = `Failed: ${task.error}`;
        statusIcon.className = 'fa-solid fa-circle-xmark';
        statusPulseRing.className = 'pulse-ring'; // Stop pulse
        statusIconBox.style.borderColor = 'var(--color-danger)';
        statusIconBox.style.color = 'var(--color-danger)';
        statusIconBox.style.boxShadow = '0 0 20px var(--color-danger-glow)';
        
        cancelDownloadBtn.classList.add('hidden');
        closeModalBtn.classList.remove('hidden');
        
        progressEventSource.close();
        break;
    }
  };
  
  progressEventSource.onerror = (err) => {
    console.error('SSE Connection error:', err);
    progressStatusText.innerText = 'Lost server connection. Attempting retry...';
  };
}

/**
 * Triggers a programmatic download file save.
 */
function triggerAutoDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Cancel Active Download Task
cancelDownloadBtn.addEventListener('click', async () => {
  if (!currentTaskId) return;
  
  try {
    const response = await fetch(`/api/download/cancel/${currentTaskId}`, {
      method: 'POST'
    });
    
    if (response.ok) {
      if (progressEventSource) {
        progressEventSource.close();
      }
      progressModal.classList.add('hidden');
      currentTaskId = null;
    } else {
      alert('Failed to cancel task on the server.');
    }
  } catch (error) {
    console.error('Error cancelling task:', error);
  }
});

// Close progress modal
closeModalBtn.addEventListener('click', () => {
  progressModal.classList.add('hidden');
  currentTaskId = null;
});
progressModal.addEventListener('click', (e) => {
  // Close if clicking outside the modal card
  if (e.target === progressModal && !closeModalBtn.classList.contains('hidden')) {
    progressModal.classList.add('hidden');
    currentTaskId = null;
  }
});
