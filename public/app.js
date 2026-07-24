// --- Silent Downloader Frontend Logic ---

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const urlInput = document.getElementById('urlInput');
  const inputGroup = urlInput.closest('.input-group');
  const urlIconPrefix = document.getElementById('urlIconPrefix');
  const iconDefault = urlIconPrefix.querySelector('.icon-default');
  const iconYoutube = urlIconPrefix.querySelector('.icon-youtube');
  const iconInstagram = urlIconPrefix.querySelector('.icon-instagram');
  const analyzeBtn = document.getElementById('analyzeBtn');

  const videoPreview = document.getElementById('videoPreview');
  const previewThumb = document.getElementById('previewThumb');
  const previewDuration = document.getElementById('previewDuration');
  const previewTitle = document.getElementById('previewTitle');
  const previewUploader = document.getElementById('previewUploader');

  const formatMp3 = document.getElementById('formatMp3');
  const formatMp4 = document.getElementById('formatMp4');
  const qualitySelect = document.getElementById('qualitySelect');
  const downloadBtn = document.getElementById('downloadBtn');

  const progressPanel = document.getElementById('progressPanel');
  const statusBadge = document.getElementById('statusBadge');
  const speedIndicator = document.getElementById('speedIndicator');
  const progressBar = document.getElementById('progressBar');
  const etaIndicator = document.getElementById('etaIndicator');
  const percentIndicator = document.getElementById('percentIndicator');
  const miniLogs = document.getElementById('miniLogs');
  const cancelBtn = document.getElementById('cancelBtn');

  const historySection = document.getElementById('historySection');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const coreStatusDot = document.getElementById('coreStatusDot');
  const coreStatusText = document.getElementById('coreStatusText');
  const updateCoreBtn = document.getElementById('updateCoreBtn');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');

  // App State
  let currentFormat = 'mp3';
  let activeEventSource = null;
  let fetchedMetadata = null;
  let isAnalyzing = false;
  let lastLoggedPercent = -10; // throttle logs

  // --- Quality options database ---
  const qualityOptions = {
    mp3: [
      { value: '320', label: '320 kbps (High Quality)' },
      { value: '256', label: '256 kbps' },
      { value: '192', label: '192 kbps (Medium Quality)' },
      { value: '128', label: '128 kbps (Low Quality)' }
    ],
    mp4: [
      { value: 'best', label: 'Best Quality Available' },
      { value: '1080', label: '1080p (Full HD)' },
      { value: '720', label: '720p (HD)' },
      { value: '480', label: '480p (Standard)' }
    ]
  };

  // --- Helper: Format Duration (seconds to mm:ss) ---
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // --- Helper: Toast Notification ---
  function showToast(message, type = 'error') {
    toastMessage.textContent = message;
    if (type === 'error') {
      toast.style.border = '1px solid rgba(239, 68, 68, 0.25)';
    } else {
      toast.style.border = '1px solid rgba(16, 185, 129, 0.25)';
    }
    toast.classList.remove('hidden');
    
    // Auto-hide toast after 4s
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 4000);
  }

  // --- Check Backend Core status on start ---
  async function checkCoreStatus() {
    try {
      const res = await fetch('/api/info?url=test'); // simple ping check
      // It will return 400 because 'test' is an invalid URL, but if the server answers, we know connection is live.
      coreStatusDot.className = 'status-dot green';
      coreStatusText.textContent = 'Core: Connected';
      updateCoreBtn.classList.remove('hidden');
    } catch (e) {
      coreStatusDot.className = 'status-dot red';
      coreStatusText.textContent = 'Core: Offline';
      updateCoreBtn.classList.add('hidden');
    }
  }

  // --- URL Detection Logic ---
  function detectPlatform(url) {
    const isYoutube = /youtube\.com|youtu\.be/i.test(url);
    const isInstagram = /instagram\.com/i.test(url);

    inputGroup.classList.remove('youtube', 'instagram');
    iconDefault.classList.add('hidden');
    iconYoutube.classList.add('hidden');
    iconInstagram.classList.add('hidden');

    const bgCharacter = document.querySelector('.background-character');
    if (bgCharacter) {
      bgCharacter.classList.remove('youtube-tint', 'instagram-tint');
    }

    if (isYoutube) {
      inputGroup.classList.add('youtube');
      iconYoutube.classList.remove('hidden');
      if (bgCharacter) bgCharacter.classList.add('youtube-tint');
    } else if (isInstagram) {
      inputGroup.classList.add('instagram');
      iconInstagram.classList.remove('hidden');
      if (bgCharacter) bgCharacter.classList.add('instagram-tint');
    } else {
      iconDefault.classList.remove('hidden');
    }
  }

  let typingTimer;
  const doneTypingInterval = 800; // wait 800ms after last keypress

  urlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    detectPlatform(url);

    clearTimeout(typingTimer);
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (url.length > 15) {
        typingTimer = setTimeout(() => {
          if (!isAnalyzing && (!fetchedMetadata || fetchedMetadata.url !== url)) {
            fetchVideoInfo(url);
          }
        }, doneTypingInterval);
      }
    } else {
      resetPreview();
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(typingTimer);
      const url = urlInput.value.trim();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        if (!isAnalyzing && (!fetchedMetadata || fetchedMetadata.url !== url)) {
          fetchVideoInfo(url);
        }
      }
    }
  });

  // Re-fetch on focus out or paste
  urlInput.addEventListener('paste', (e) => {
    // Wait for paste to complete
    setTimeout(() => {
      const url = urlInput.value.trim();
      detectPlatform(url);
      if (url.startsWith('http://') || url.startsWith('https://')) {
        fetchVideoInfo(url);
      }
    }, 100);
  });

  analyzeBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url) {
      fetchVideoInfo(url);
    }
  });

  // --- Fetch Video Metadata ---
  async function fetchVideoInfo(url) {
    if (isAnalyzing) return;
    isAnalyzing = true;
    
    // Disable inputs and buttons during metadata fetch
    urlInput.disabled = true;
    analyzeBtn.disabled = true;
    downloadBtn.disabled = true;
    
    // Spin icon status or style change
    analyzeBtn.style.opacity = '0.5';
    
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      
      if (res.status !== 200 || data.error) {
        throw new Error(data.error || 'Failed to fetch details');
      }

      fetchedMetadata = { ...data, url };
      
      // Update Preview UI
      previewThumb.src = data.thumbnail;
      previewTitle.textContent = data.title;
      previewUploader.textContent = data.uploader;
      previewDuration.textContent = formatTime(data.duration);
      
      videoPreview.classList.remove('hidden');
      downloadBtn.disabled = false;
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not parse link metadata. Please make sure it is a valid public URL.');
      resetPreview();
    } finally {
      isAnalyzing = false;
      urlInput.disabled = false;
      analyzeBtn.disabled = false;
      analyzeBtn.style.opacity = '1';
    }
  }

  function resetPreview() {
    videoPreview.classList.add('hidden');
    previewThumb.src = '';
    previewTitle.textContent = '';
    previewUploader.textContent = '';
    previewDuration.textContent = '';
    downloadBtn.disabled = true;
    fetchedMetadata = null;
  }

  // --- Toggle Format Buttons ---
  function updateQualityDropdown(format) {
    qualitySelect.innerHTML = '';
    const options = qualityOptions[format];
    options.forEach(opt => {
      const optionElement = document.createElement('option');
      optionElement.value = opt.value;
      optionElement.textContent = opt.label;
      qualitySelect.appendChild(optionElement);
    });
  }

  formatMp3.addEventListener('click', () => {
    formatMp3.classList.add('active');
    formatMp4.classList.remove('active');
    currentFormat = 'mp3';
    updateQualityDropdown('mp3');
  });

  formatMp4.addEventListener('click', () => {
    formatMp4.classList.add('active');
    formatMp3.classList.remove('active');
    currentFormat = 'mp4';
    updateQualityDropdown('mp4');
  });

  // --- SSE Progress Logger ---
  function addLog(text, color = '#10b981') {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.style.color = color;
    line.textContent = text;
    miniLogs.appendChild(line);
    miniLogs.scrollTop = miniLogs.scrollHeight;
  }

  // --- Handle Download Button Action ---
  downloadBtn.addEventListener('click', () => {
    if (!fetchedMetadata) return;

    // Trigger visual slash reward on convert start
    window.dispatchEvent(new CustomEvent('trigger-slash'));

    const url = fetchedMetadata.url;
    const quality = qualitySelect.value;
    
    // Disable inputs to lock UI
    urlInput.disabled = true;
    analyzeBtn.disabled = true;
    formatMp3.disabled = true;
    formatMp4.disabled = true;
    qualitySelect.disabled = true;
    downloadBtn.disabled = true;
    
    // Reset Progress Panel & Show
    progressBar.style.width = '0%';
    percentIndicator.textContent = '0%';
    speedIndicator.textContent = '0.0 MB/s';
    etaIndicator.textContent = 'ETA: --:--';
    statusBadge.textContent = 'CONNECTING...';
    statusBadge.className = 'status-badge';
    miniLogs.innerHTML = '';
    
    progressPanel.classList.remove('hidden');
    
    addLog('Connecting to conversion server...', '#9ca3af');
    lastLoggedPercent = -10;

    // Connect Server-Sent Events
    const sseUrl = `/api/download?url=${encodeURIComponent(url)}&format=${currentFormat}&quality=${quality}`;
    activeEventSource = new EventSource(sseUrl);

    activeEventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      statusBadge.textContent = data.phase.toUpperCase();
      statusBadge.className = `status-badge ${data.phase}`;
      addLog(data.message, '#8b5cf6');
    });

    activeEventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      progressBar.style.width = `${data.percent}%`;
      percentIndicator.textContent = `${data.percent}%`;
      speedIndicator.textContent = data.speed;
      etaIndicator.textContent = `ETA: ${data.eta}`;
      
      statusBadge.textContent = 'DOWNLOADING';
      statusBadge.className = 'status-badge downloading';
      
      // Throttle downloading logs to avoid visual clutter
      if (data.percent - lastLoggedPercent >= 10) {
        addLog(`Download progress: ${data.percent}% (Size: ${data.size}, Speed: ${data.speed})`, '#3b82f6');
        lastLoggedPercent = data.percent;
      }
    });

    activeEventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      progressBar.style.width = '100%';
      percentIndicator.textContent = '100%';
      speedIndicator.textContent = 'Finished';
      etaIndicator.textContent = 'ETA: 00:00';
      statusBadge.textContent = 'READY';
      statusBadge.className = 'status-badge success';
      
      addLog('Process completed! Retrieving file...', '#10b981');
      
      // Trigger Browser Download
      const dlLink = document.createElement('a');
      dlLink.href = data.downloadUrl;
      dlLink.style.display = 'none';
      document.body.appendChild(dlLink);
      dlLink.click();
      document.body.removeChild(dlLink);

      // Save to History
      saveToHistory(fetchedMetadata.title, fetchedMetadata.thumbnail, currentFormat, data.downloadUrl);
      
      cleanupSSE();
      
      // Auto-hide progress pane after 3 seconds
      setTimeout(() => {
        progressPanel.classList.add('hidden');
      }, 3000);
    });

    activeEventSource.addEventListener('error', (e) => {
      let msg = 'An unexpected error occurred during processing.';
      if (e.data) {
        try {
          const errData = JSON.parse(e.data);
          msg = errData.message || msg;
        } catch (err) {}
      }
      
      showToast(msg);
      addLog(`Error: ${msg}`, '#ef4444');
      cleanupSSE();
    });
  });

  // --- Cancel Process ---
  cancelBtn.addEventListener('click', () => {
    addLog('Process cancelled by user.', '#ef4444');
    cleanupSSE();
    setTimeout(() => {
      progressPanel.classList.add('hidden');
    }, 1000);
  });

  function cleanupSSE() {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    
    // Re-enable input options
    urlInput.disabled = false;
    analyzeBtn.disabled = false;
    formatMp3.disabled = false;
    formatMp4.disabled = false;
    qualitySelect.disabled = false;
    downloadBtn.disabled = false;
  }

  // --- History Management ---
  function saveToHistory(title, thumbnail, format, downloadUrl) {
    const history = JSON.parse(localStorage.getItem('silent_history') || '[]');
    
    // Add new download at the top
    history.unshift({
      id: Date.now(),
      title,
      thumbnail,
      format,
      downloadUrl,
      timestamp: new Date().toLocaleDateString()
    });

    // Limit to last 5 downloads
    if (history.length > 5) {
      history.pop();
    }

    localStorage.setItem('silent_history', JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const history = JSON.parse(localStorage.getItem('silent_history') || '[]');
    if (history.length === 0) {
      historySection.classList.add('hidden');
      return;
    }

    historySection.classList.remove('hidden');
    historyList.innerHTML = '';

    history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <img src="${item.thumbnail}" alt="Thumbnail" class="history-thumb" onerror="this.src='/assets/placeholder.jpg'">
        <div class="history-info">
          <div class="history-title" title="${item.title}">${item.title}</div>
          <div class="history-meta">
            <span class="badge-format">${item.format}</span>
            <span>Downloaded on ${item.timestamp}</span>
          </div>
        </div>
        <div class="history-actions">
          <a href="${item.downloadUrl}" class="btn-history-dl" title="Download again">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-icon">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </a>
        </div>
      `;
      historyList.appendChild(el);
    });
  }

  clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem('silent_history');
    renderHistory();
  });

  // --- Update Downloader Binary Core ---
  updateCoreBtn.addEventListener('click', async () => {
    coreStatusDot.className = 'status-dot orange';
    coreStatusText.textContent = 'Core: Updating...';
    updateCoreBtn.classList.add('hidden');
    showToast('Checking and updating downloader binary core. This might take a moment...', 'success');
    
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json();
      if (res.status === 200 && data.success) {
        showToast('Downloader core updated successfully!', 'success');
      } else {
        throw new Error(data.message || 'Update failed');
      }
    } catch (err) {
      showToast(`Core update failed: ${err.message}`);
    } finally {
      checkCoreStatus();
    }
  });

  // --- Background Canvas Animation (Anime Speed Lines & Slashes) ---
  function initBackgroundAnimation() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;
    
    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const speedLines = [];
    const maxSpeedLines = 35;
    const slashes = [];
    const particles = [];
    
    // Initialize Speed Lines
    for (let i = 0; i < maxSpeedLines; i++) {
      speedLines.push({
        x: Math.random() * width,
        y: Math.random() * height,
        length: 80 + Math.random() * 120,
        speed: 15 + Math.random() * 20,
        width: 0.5 + Math.random() * 1.5,
        opacity: 0.01 + Math.random() * 0.04
      });
    }

    // Trigger Screen Shake
    function triggerShake() {
      const card = document.getElementById('converterCard');
      if (card) {
        card.classList.add('shake-effect');
        setTimeout(() => {
          card.classList.remove('shake-effect');
        }, 350);
      }
    }

    // Spawn a sword slash
    function createSlash(sx, sy, ex, ey, customColor = null) {
      const colors = ['#00f2fe', '#8b5cf6', '#ef4444', '#ee2a7b'];
      const color = customColor || colors[Math.floor(Math.random() * colors.length)];
      
      const slash = {
        sx, sy, ex, ey,
        width: 2 + Math.random() * 3,
        life: 1.0,
        color: color
      };
      
      slashes.push(slash);
      triggerShake();
      
      // Spawn impact particles along the path
      const particleCount = 20 + Math.floor(Math.random() * 15);
      const dx = ex - sx;
      const dy = ey - sy;
      
      for (let i = 0; i < particleCount; i++) {
        const ratio = Math.random();
        const px = sx + dx * ratio;
        const py = sy + dy * ratio;
        
        // Random velocity perpendicular and parallel
        const angle = Math.atan2(dy, dx) + (Math.random() > 0.5 ? Math.PI/2 : -Math.PI/2) * (0.2 + Math.random() * 0.8);
        const speed = 2 + Math.random() * 8;
        
        particles.push({
          x: px,
          y: py,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 1 + Math.random() * 2.5,
          life: 1.0,
          decay: 0.02 + Math.random() * 0.04,
          color: color
        });
      }
    }

    // Trigger random slash in background
    function triggerRandomSlash() {
      const margin = 100;
      const sx = margin + Math.random() * (width - margin * 2);
      const sy = margin + Math.random() * (height - margin * 2);
      const angle = Math.random() * Math.PI * 2;
      const length = 400 + Math.random() * 500;
      
      const ex = sx + Math.cos(angle) * length;
      const ey = sy + Math.sin(angle) * length;
      
      // Select platform colors if active
      let slashColor = null;
      if (inputGroup.classList.contains('youtube')) {
        slashColor = '#ef4444';
      } else if (inputGroup.classList.contains('instagram')) {
        slashColor = '#ee2a7b';
      }
      
      createSlash(sx, sy, ex, ey, slashColor);
    }

    // Auto trigger random slashes
    let lastSlashTime = 0;
    const slashInterval = 5000; // 5 seconds
    
    // Add Click handler for custom slashes
    window.addEventListener('mousedown', (e) => {
      // Do not slash if clicking form controls
      if (e.target.closest('#converterCard') || e.target.closest('#historySection') || e.target.closest('.toast-container')) {
        return;
      }
      
      const sx = e.clientX - 250;
      const sy = e.clientY - 150;
      const ex = e.clientX + 250;
      const ey = e.clientY + 150;
      createSlash(sx, sy, ex, ey);
    });

    // Make triggerRandomSlash accessible globally or via event
    window.addEventListener('trigger-slash', () => {
      // Trigger multiple rapid slashes for convert start!
      triggerRandomSlash();
      setTimeout(triggerRandomSlash, 150);
      setTimeout(triggerRandomSlash, 300);
    });

    function animate() {
      ctx.clearRect(0, 0, width, height);
      
      // 1. Draw Speed Lines
      for (const line of speedLines) {
        ctx.beginPath();
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x - line.length, line.y + line.length * 0.4);
        
        ctx.strokeStyle = `rgba(255, 255, 255, ${line.opacity})`;
        ctx.lineWidth = line.width;
        ctx.stroke();
        
        // Update line position
        line.x -= line.speed;
        line.y += line.speed * 0.4;
        
        // Reset if offscreen
        if (line.x < -line.length || line.y > height + line.length) {
          line.x = width + line.length;
          line.y = Math.random() * height - 100;
        }
      }
      
      // 2. Draw Slashes
      for (let i = slashes.length - 1; i >= 0; i--) {
        const s = slashes[i];
        
        ctx.shadowBlur = 15;
        ctx.shadowColor = s.color;
        
        // Draw outer glow trail
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(s.ex, s.ey);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width * s.life * 4;
        ctx.globalAlpha = s.life * 0.3;
        ctx.stroke();
        
        // Draw sharp inner white core
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(s.ex, s.ey);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = s.width * s.life;
        ctx.globalAlpha = s.life;
        ctx.stroke();
        
        ctx.shadowBlur = 0; // reset
        ctx.globalAlpha = 1.0; // reset
        
        // Age slash
        s.life -= 0.04;
        if (s.life <= 0) {
          slashes.splice(i, 1);
        }
      }
      
      // 3. Draw & Update Impact Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life * 0.8;
        ctx.fill();
        
        if (p.radius > 2) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = p.life;
          ctx.fill();
        }
        
        ctx.globalAlpha = 1.0; // reset
        
        // Update particle physics
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96; // drag
        p.vy *= 0.96; // drag
        
        p.life -= p.decay;
        if (p.life <= 0) {
          particles.splice(i, 1);
        }
      }
      
      // Auto spawn background slashes
      const now = Date.now();
      if (now - lastSlashTime > slashInterval) {
        triggerRandomSlash();
        lastSlashTime = now + (Math.random() * 2000 - 1000);
      }
      
      requestAnimationFrame(animate);
    }
    
    // Start loop
    lastSlashTime = Date.now();
    requestAnimationFrame(animate);
  }

  // --- Initial Runs ---
  updateQualityDropdown('mp3');
  checkCoreStatus();
  renderHistory();
  initBackgroundAnimation();
});
