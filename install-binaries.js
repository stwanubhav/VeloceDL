const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// On Linux we use 'yt-dlp_linux' — a true standalone compiled binary
// that requires NO Python runtime (avoids runpy.py / Python 3.9 errors)
const ytDlpUrl = isWindows
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : isLinux
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const filename = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const targetPath = path.join(__dirname, filename);

console.log(`==================================================`);
console.log(` VeloceDL Dependency Auto-Installer`);
console.log(` Platform: ${process.platform} (${process.arch})`);
console.log(`==================================================\n`);

/**
 * Downloads a file handling HTTP redirects.
 */
function downloadFile(url, dest, callback) {
  https.get(url, (res) => {
    // Handle HTTP Redirects
    if (res.statusCode === 301 || res.statusCode === 302) {
      return downloadFile(res.headers.location, dest, callback);
    }
    
    if (res.statusCode !== 200) {
      return callback(new Error(`Server returned HTTP ${res.statusCode}`));
    }
    
    const fileStream = fs.createWriteStream(dest);
    res.pipe(fileStream);
    
    let downloadedBytes = 0;
    res.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const sizeMB = (downloadedBytes / 1024 / 1024).toFixed(1);
      process.stdout.write(`\rDownloading: ${sizeMB} MB... `);
    });
    
    fileStream.on('finish', () => {
      fileStream.close(() => {
        console.log('\rDownload complete!             ');
        callback(null);
      });
    });
    
    fileStream.on('error', (err) => {
      fs.unlink(dest, () => {});
      callback(err);
    });
  }).on('error', (err) => {
    fs.unlink(dest, () => {});
    callback(err);
  });
}

/**
 * Downloads and extracts static Linux builds of FFmpeg.
 */
function setupFfmpegLinux(callback) {
  const tarUrl = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
  const tarPath = path.join(__dirname, 'ffmpeg.tar.xz');
  
  console.log('Initiating FFmpeg static build download for Linux...');
  downloadFile(tarUrl, tarPath, (err) => {
    if (err) {
      return callback(new Error(`Failed to download FFmpeg: ${err.message}`));
    }
    
    console.log('Extracting FFmpeg (using system tar)...');
    exec('tar -xf ffmpeg.tar.xz', (tarErr) => {
      if (tarErr) {
        fs.unlink(tarPath, () => {});
        return callback(new Error(`Failed to extract FFmpeg: ${tarErr.message}. Make sure the 'tar' package is installed.`));
      }
      
      // Find the extracted folder containing 'ffmpeg'
      const dirs = fs.readdirSync(__dirname).filter(f => f.startsWith('ffmpeg-') && f.endsWith('-static'));
      if (dirs.length === 0) {
        fs.unlink(tarPath, () => {});
        return callback(new Error('Failed to locate extracted FFmpeg folder.'));
      }
      
      const extractedDir = dirs[0];
      const extractedFfmpeg = path.join(__dirname, extractedDir, 'ffmpeg');
      const destFfmpeg = path.join(__dirname, 'ffmpeg');
      
      try {
        fs.copyFileSync(extractedFfmpeg, destFfmpeg);
        fs.chmodSync(destFfmpeg, '755');
        
        // Clean up temporary files
        fs.unlinkSync(tarPath);
        fs.rmSync(path.join(__dirname, extractedDir), { recursive: true, force: true });
        
        console.log('✅ FFmpeg binary successfully extracted to project root!');
        callback(null);
      } catch (copyErr) {
        callback(copyErr);
      }
    });
  });
}

// 1. Download/Verify yt-dlp
function setupYtdlp(callback) {
  if (fs.existsSync(targetPath)) {
    console.log(`✅ yt-dlp already exists at ${targetPath}. Skipping download.`);
    return callback(null);
  }

  console.log('Step 1: Downloading yt-dlp...');
  downloadFile(ytDlpUrl, targetPath, (err) => {
    if (err) return callback(err);
    
    if (!isWindows) {
      try {
        fs.chmodSync(targetPath, '755');
        console.log('Successfully set execute permissions on Linux yt-dlp.');
      } catch (chmodErr) {
        console.warn(`\n⚠️ Warning: Failed to chmod yt-dlp: ${chmodErr.message}`);
      }
    }
    
    console.log(`✅ yt-dlp is successfully installed!`);
    callback(null);
  });
}

setupYtdlp((err) => {
  if (err) {
    console.error(`\n❌ Failed to setup yt-dlp: ${err.message}`);
    process.exit(1);
  }
  
  // 2. Download/Verify FFmpeg on Linux
  if (isLinux) {
    const destFfmpeg = path.join(__dirname, 'ffmpeg');
    if (fs.existsSync(destFfmpeg)) {
      console.log(`✅ FFmpeg already exists at ${destFfmpeg}. Skipping download.`);
      console.log(`\n🎉 Verification complete! Both binaries are ready in your project folder.`);
      console.log(`   Start the server: npm run dev\n`);
      return;
    }

    console.log('Step 2: Installing FFmpeg for Linux...');
    setupFfmpegLinux((ffmpegErr) => {
      if (ffmpegErr) {
        console.warn(`\n⚠️ Warning: Local FFmpeg setup failed: ${ffmpegErr.message}`);
        console.log(`Please install FFmpeg using your system package manager instead:`);
        console.log(`   sudo apt update && sudo apt install -y ffmpeg\n`);
        process.exit(0);
      }
      
      console.log(`\n🎉 Installation complete! Both binaries are ready in your project folder.`);
      console.log(`   Start the server: npm run dev\n`);
    });
  } else {
    // Windows or macOS instructions
    console.log(`==================================================`);
    console.log(` STEP 2: FFmpeg installation (Windows / macOS)`);
    console.log(`==================================================`);
    if (isWindows) {
      console.log(`1. Download Windows FFmpeg builds:`);
      console.log(`   https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z`);
      console.log(`2. Copy 'ffmpeg.exe' from the bin folder.`);
      console.log(`3. Paste it directly into this project root:`);
      console.log(`   ${__dirname}\\`);
    } else {
      console.log(`Please install FFmpeg using Homebrew:`);
      console.log(`   brew install ffmpeg`);
    }
    console.log(`==================================================\n`);
  }
});
