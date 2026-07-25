const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// -------------------------------------------------------------
// DIAGNOSTICS & SYSTEM LOGGING (Isolated block)
// -------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error('DIAGNOSTICS - UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('DIAGNOSTICS - UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const app = express();

app.use((req, res, next) => {
  req.id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const safeHeaders = { ...req.headers };
  delete safeHeaders.authorization;
  delete safeHeaders.cookie;
  delete safeHeaders.token;
  
  console.log(`[REQ ID: ${req.id}] [${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`[REQ ID: ${req.id}] Headers:`, JSON.stringify(safeHeaders));
  next();
});
// -------------------------------------------------------------

const PORT = process.env.PORT || 3000;

// Directories and Platform Detection
const isWindows = process.platform === 'win32';
const YT_DLP_BINARY_NAME = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_DIR = path.join(__dirname, 'bin');
const DOWNLOADS_DIR = path.join(__dirname, 'temp_downloads');

// If running in Docker container, check for pre-installed global yt-dlp first
let YT_DLP_PATH = path.join(BIN_DIR, YT_DLP_BINARY_NAME);
if (!isWindows && fs.existsSync('/usr/local/bin/yt-dlp')) {
  YT_DLP_PATH = '/usr/local/bin/yt-dlp';
}

// Ensure directories exist
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper function to download file with redirects
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = https.get(url, (response) => {
      // Handle HTTP redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`Server returned status code: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Ensure yt-dlp is available and download it if missing
async function ensureYtDlp() {
  if (YT_DLP_PATH === '/usr/local/bin/yt-dlp' || fs.existsSync(YT_DLP_PATH)) {
    console.log(`${YT_DLP_BINARY_NAME} is ready to use.`);
    return;
  }
  console.log(`${YT_DLP_BINARY_NAME} not found. Downloading latest version from GitHub...`);
  const url = isWindows
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  try {
    await downloadFile(url, YT_DLP_PATH);
    if (!isWindows) {
      fs.chmodSync(YT_DLP_PATH, '755');
    }
    console.log(`${YT_DLP_BINARY_NAME} downloaded successfully.`);
  } catch (err) {
    console.error(`Failed to download ${YT_DLP_BINARY_NAME}:`, err.message);
    throw err;
  }
}

// Route to fetch video info (metadata preview)
app.get('/api/info', async (req, res) => {
  const reqId = req.id || 'N/A';
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    await ensureYtDlp();
  } catch (err) {
    console.error(`[REQ ID: ${reqId}] Downloader binary error:`, err);
    return res.status(500).json({ error: 'Downloader binary is not ready.' });
  }

  console.log(`[REQ ID: ${reqId}] Fetching info for: ${videoUrl}`);
  logEnvironmentDetails(reqId);

  // Fetch metadata using yt-dlp -J (JSON output)
  const args = ['-J', '--no-playlist', '--impersonate', 'chrome'];
  if (process.env.PROXY_URL) {
    args.push('--proxy', process.env.PROXY_URL);
  }
  args.push(videoUrl);
  
  console.log(`[REQ ID: ${reqId}] Spawning command: "${YT_DLP_PATH}" with args:`, JSON.stringify(args));
  const child = spawn(YT_DLP_PATH, args);

  child.on('error', (err) => {
    console.error(`[REQ ID: ${reqId}] Failed to start yt-dlp process in /api/info:`, err);
    return res.status(500).json({ error: 'Failed to start downloader.' });
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    const chunk = data.toString();
    console.log(`[REQ ID: ${reqId}] yt-dlp stdout chunk (${chunk.length} chars)`);
    stdout += chunk;
  });

  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    console.log(`[REQ ID: ${reqId}] yt-dlp stderr:`, chunk.trim());
    stderr += chunk;
  });

  child.on('close', (code) => {
    console.log(`[REQ ID: ${reqId}] yt-dlp process closed with code: ${code}`);
    if (code !== 0) {
      console.error(`[REQ ID: ${reqId}] yt-dlp info failed with code ${code}. Stderr:`, stderr);
      return res.status(400).json({ error: 'Failed to retrieve video information. Check the URL.' });
    }

    try {
      const info = JSON.parse(stdout);
      
      // Determine best thumbnail
      let thumbnailUrl = '/assets/placeholder.jpg';
      if (info.thumbnail) {
        thumbnailUrl = info.thumbnail;
      } else if (info.thumbnails && info.thumbnails.length > 0) {
        thumbnailUrl = info.thumbnails[info.thumbnails.length - 1].url;
      }

      res.json({
        title: info.title || 'Unknown Title',
        thumbnail: thumbnailUrl,
        duration: info.duration || 0,
        uploader: info.uploader || info.channel || 'Unknown Creator',
        id: info.id
      });
    } catch (parseErr) {
      console.error('Error parsing yt-dlp JSON response:', parseErr);
      res.status(500).json({ error: 'Failed to parse video details.' });
    }
  });
});

// Route to trigger conversion & download with Server-Sent Events (SSE) progress update
app.get('/api/download', async (req, res) => {
  const reqId = req.id || 'N/A';
  const videoUrl = req.query.url;
  const format = req.query.format || 'mp4'; // mp3 or mp4
  const quality = req.query.quality || 'best'; // 320, 256, 192, 128 for mp3, or 1080, 720, 480 for mp4

  if (!videoUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    await ensureYtDlp();
  } catch (err) {
    console.error(`[REQ ID: ${reqId}] Downloader binary error in /api/download:`, err);
    return res.status(500).json({ error: 'Downloader binary is not ready.' });
  }

  console.log(`[REQ ID: ${reqId}] Triggering download format: ${format}, quality: ${quality} for: ${videoUrl}`);
  logEnvironmentDetails(reqId);

  // Setup SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const ffmpegDir = path.dirname(ffmpegPath);
  
  let args = [];
  let finalExtension = format === 'mp3' ? 'mp3' : 'mp4';
  const outputPath = path.join(DOWNLOADS_DIR, `${fileId}.%(ext)s`);

  // General configuration
  args.push('--ffmpeg-location', ffmpegDir);
  args.push('--no-playlist');
  args.push('--progress');
  args.push('--newline');
  args.push('--impersonate', 'chrome');
  if (process.env.PROXY_URL) {
    args.push('--proxy', process.env.PROXY_URL);
  }

  if (format === 'mp3') {
    args.push('-x');
    args.push('--audio-format', 'mp3');
    // Map quality options
    let qMap = { '320': '320K', '256': '256K', '192': '192K', '128': '128K' };
    let kbps = qMap[quality] || '320K';
    args.push('--audio-quality', kbps);
  } else {
    // MP4 Video download options
    // Map resolutions:
    let resolutionFilter = '';
    if (quality === '1080') {
      resolutionFilter = '[height<=1080]';
    } else if (quality === '720') {
      resolutionFilter = '[height<=720]';
    } else if (quality === '480') {
      resolutionFilter = '[height<=480]';
    }
    
    // Combine video stream (up to resolution) with best audio, format to mp4
    args.push('-f', `bestvideo${resolutionFilter}[ext=mp4]+bestaudio[ext=m4a]/best${resolutionFilter}[ext=mp4]/best`);
    args.push('--merge-output-format', 'mp4');
  }

  args.push('-o', outputPath);
  args.push(videoUrl);

  console.log(`[REQ ID: ${reqId}] Spawning command: "${YT_DLP_PATH}" with args:`, JSON.stringify(args));
  sendEvent('status', { phase: 'starting', message: 'Initializing download queue...' });

  const child = spawn(YT_DLP_PATH, args);

  child.on('error', (err) => {
    console.error(`[REQ ID: ${reqId}] Failed to start yt-dlp process in /api/download:`, err);
    sendEvent('error', { message: 'Failed to start downloader process.' });
    res.end();
  });

  // Regex to extract percent, size, speed, and eta from yt-dlp stdout
  // Example: [download]  12.3% of 45.67MiB at  3.45MiB/s ETA 00:10
  const progressRegex = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/;
  
  child.stdout.on('data', (data) => {
    const rawChunk = data.toString();
    console.log(`[REQ ID: ${reqId}] yt-dlp stdout:`, rawChunk.trim());
    
    const lines = rawChunk.split('\n');
    for (const line of lines) {
      if (line.trim() === '') continue;

      // Extract progress if available
      const match = line.match(progressRegex);
      if (match) {
        const percent = parseFloat(match[1]);
        const size = match[2];
        const speed = match[3];
        const eta = match[4];
        sendEvent('progress', { percent, size, speed, eta, phase: 'downloading' });
      } else if (line.includes('[Merger]')) {
        sendEvent('status', { phase: 'merging', message: 'Merging video and audio streams...' });
      } else if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
        sendEvent('status', { phase: 'converting', message: 'Converting file format...' });
      }
    }
  });

  child.stderr.on('data', (data) => {
    const line = data.toString().trim();
    console.log(`[REQ ID: ${reqId}] yt-dlp stderr:`, line);
  });

  child.on('close', (code) => {
    console.log(`[REQ ID: ${reqId}] yt-dlp process closed with code: ${code}`);
    if (code !== 0) {
      console.error(`[REQ ID: ${reqId}] yt-dlp failed on download with code ${code}`);
      sendEvent('error', { message: 'Conversion or download failed. Please check the link and try again.' });
      res.end();
      return;
    }

    // Verify file exists
    const expectedFilePath = path.join(DOWNLOADS_DIR, `${fileId}.${finalExtension}`);
    if (fs.existsSync(expectedFilePath)) {
      console.log(`Download completed successfully: ${expectedFilePath}`);
      sendEvent('complete', { 
        fileId: fileId,
        extension: finalExtension,
        downloadUrl: `/api/file/${fileId}?ext=${finalExtension}`
      });
    } else {
      console.error(`Expected output file does not exist: ${expectedFilePath}`);
      sendEvent('error', { message: 'File was processed but could not be located on the server.' });
    }
    res.end();
  });

  // If connection is closed by client, kill the downloader process
  req.on('close', () => {
    console.log(`Client disconnected. Terminating yt-dlp spawn for fileId: ${fileId}`);
    try {
      child.kill('SIGTERM');
    } catch (e) {
      // already terminated or error
    }
  });
});

// Route to serve the completed file for downloading
app.get('/api/file/:id', (req, res) => {
  const fileId = req.params.id;
  const ext = req.query.ext || 'mp4';
  
  // Prevent directory traversal
  const safeId = path.basename(fileId);
  const safeExt = path.basename(ext);
  const filePath = path.join(DOWNLOADS_DIR, `${safeId}.${safeExt}`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found or link expired.');
  }

  // Set download headers
  // Try to determine a clean original file name (or just use default)
  res.download(filePath, `download-${safeId}.${safeExt}`, (err) => {
    if (err) {
      console.error('Error during file transfer:', err);
    } else {
      // Queue deletion after a small delay to ensure file lock is released
      setTimeout(() => {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Failed to clean up file after download:', unlinkErr);
          else console.log(`Cleaned up temp file: ${filePath}`);
        });
      }, 5000);
    }
  });
});

// Admin Route to manually trigger yt-dlp update
app.post('/api/update', async (req, res) => {
  try {
    await ensureYtDlp();
    console.log('Running yt-dlp update...');
    const child = spawn(YT_DLP_PATH, ['-U']);
    let output = '';
    child.stdout.on('data', data => output += data.toString());
    child.stderr.on('data', data => output += data.toString());
    child.on('close', (code) => {
      res.json({ success: code === 0, message: output });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DIAGNOSTICS ENDPOINTS & HELPERS (Isolated block)
// -------------------------------------------------------------
function logEnvironmentDetails(reqId) {
  console.log(`[REQ ID: ${reqId}] --- Diagnostics Environment Info ---`);
  console.log(`[REQ ID: ${reqId}] YT_DLP_PATH: ${YT_DLP_PATH}`);
  console.log(`[REQ ID: ${reqId}] Platform: ${process.platform}`);
  console.log(`[REQ ID: ${reqId}] Arch: ${process.arch}`);
  console.log(`[REQ ID: ${reqId}] Cwd: ${process.cwd()}`);
  console.log(`[REQ ID: ${reqId}] Node Version: ${process.version}`);
  console.log(`[REQ ID: ${reqId}] PATH: ${process.env.PATH}`);
  
  const binChecks = [
    { name: 'python', cmd: 'python', args: ['--version'] },
    { name: 'python3', cmd: 'python3', args: ['--version'] },
    { name: 'yt-dlp', cmd: YT_DLP_PATH, args: ['--version'] },
    { name: 'ffmpeg', cmd: ffmpegPath || 'ffmpeg', args: ['-version'] }
  ];
  
  binChecks.forEach(c => {
    let pathResult = 'unknown';
    try {
      if (path.isAbsolute(c.cmd)) {
        pathResult = fs.existsSync(c.cmd) ? c.cmd : 'not found';
      } else {
        const whichCmd = isWindows ? `where "${c.cmd}"` : `which "${c.cmd}"`;
        pathResult = execSync(whichCmd, { stdio: 'pipe' }).toString().trim().split('\n')[0];
      }
      console.log(`[REQ ID: ${reqId}] which ${c.name} -> ${pathResult}`);
    } catch (e) {
      console.log(`[REQ ID: ${reqId}] which ${c.name} -> NOT FOUND / ERROR: ${e.message}`);
    }
    try {
      const versionResult = execSync(`"${c.cmd}" ${c.args.join(' ')}`, { stdio: 'pipe' }).toString().trim().split('\n')[0];
      console.log(`[REQ ID: ${reqId}] ${c.name} version -> ${versionResult}`);
    } catch (e) {
      console.log(`[REQ ID: ${reqId}] ${c.name} version -> ERROR: ${e.message}`);
    }
  });
  console.log(`[REQ ID: ${reqId}] ------------------------------------------`);
}

app.get('/api/debug', (req, res) => {
  const getDetails = (name, cmd, args = ['--version']) => {
    let resolvedPath = 'unknown';
    let resolvedVersion = 'unknown';
    try {
      if (path.isAbsolute(cmd)) {
        resolvedPath = fs.existsSync(cmd) ? cmd : 'not found';
      } else {
        const whichCmd = isWindows ? `where "${cmd}"` : `which "${cmd}"`;
        resolvedPath = execSync(whichCmd, { stdio: 'pipe' }).toString().trim().split('\n')[0];
      }
    } catch (e) {
      resolvedPath = `not found: ${e.message}`;
    }
    try {
      resolvedVersion = execSync(`"${cmd}" ${args.join(' ')}`, { stdio: 'pipe' }).toString().trim().split('\n')[0];
    } catch (e) {
      resolvedVersion = `error: ${e.message}`;
    }
    return { path: resolvedPath, version: resolvedVersion };
  };

  const pythonInfo = getDetails('python', 'python', ['--version']);
  const python3Info = getDetails('python3', 'python3', ['--version']);
  const ytDlpInfo = getDetails('yt-dlp', YT_DLP_PATH, ['--version']);
  const ffmpegInfo = getDetails('ffmpeg', ffmpegPath || 'ffmpeg', ['-version']);

  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    python: pythonInfo.path,
    pythonVersion: pythonInfo.version,
    python3: python3Info.path,
    ytDlp: ytDlpInfo.path,
    ytDlpVersion: ytDlpInfo.version,
    ffmpeg: ffmpegInfo.path,
    ffmpegVersion: ffmpegInfo.version,
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    status: 'OK'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
// -------------------------------------------------------------

// Automatic clean up routine for orphaned downloads (older than 15 mins)
setInterval(() => {
  fs.readdir(DOWNLOADS_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    const expiryTime = 15 * 60 * 1000; // 15 minutes

    for (const file of files) {
      const filePath = path.join(DOWNLOADS_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        if (now - stats.mtimeMs > expiryTime) {
          fs.unlink(filePath, (unlinkErr) => {
            if (!unlinkErr) console.log(`Auto-cleaned expired temp file: ${file}`);
          });
        }
      });
    }
  });
}, 5 * 60 * 1000); // run every 5 mins

// Initialize yt-dlp on startup
ensureYtDlp().catch(err => {
  console.error('Initial yt-dlp download failed, will retry on demand.');
});

// Start Server
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  Silent Downloader Server Running      `);
  console.log(`  Local URL: http://localhost:${PORT}   `);
  console.log(`========================================`);
});
