// DOM refs — must be declared before any async code
const urlInput = document.getElementById('urlInput');
const fetchBtn = document.getElementById('fetchBtn');
const errorMsg = document.getElementById('errorMsg');
const videoInfo = document.getElementById('videoInfo');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel').querySelector('span');
const videoDuration = document.getElementById('videoDuration').querySelector('span');
const formatSection = document.getElementById('formatSection');
const formatGrid = document.getElementById('formatGrid');
const dirBtn = document.getElementById('dirBtn');
const dirLabel = document.getElementById('dirLabel');
const downloadProgress = document.getElementById('downloadProgress');
const progressLabel = document.getElementById('progressLabel');
const progressPhase = document.getElementById('progressPhase');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressSpeed = document.getElementById('progressSpeed');
const progressEta = document.getElementById('progressEta');
const progressSize = document.getElementById('progressSize');
const downloadComplete = document.getElementById('downloadComplete');
const revealBtn = document.getElementById('revealBtn');
const completeFilename = document.getElementById('completeFilename');

// State
let currentUrl = '';
let currentFormats = [];
let downloadDir = null;
let lastDownloadPath = '';
let downloadPhase = 1; // 1 = video, 2 = audio

// Init download dir from main process
(async () => {
    try {
        downloadDir = await window.ytdown.getDefaultDir();
        const home = downloadDir.match(/^\/Users\/[^/]+/);
        dirLabel.textContent = home ? downloadDir.replace(home[0], '~') : downloadDir;
    } catch (_) {
        dirLabel.textContent = '~/Downloads';
    }
})();

// ─── Event Listeners ──────────────────────────────────────────────────────────

urlInput.addEventListener('paste', () => {
    setTimeout(() => {
        const val = urlInput.value.trim();
        if (val.includes('youtube.com') || val.includes('youtu.be')) {
            handleFetch();
        }
    }, 50);
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleFetch();
});

fetchBtn.addEventListener('click', handleFetch);

dirBtn.addEventListener('click', async () => {
    const dir = await window.ytdown.selectDirectory();
    if (dir) {
        downloadDir = dir;
        const home = dir.match(/^\/Users\/[^/]+/);
        dirLabel.textContent = home ? dir.replace(home[0], '~') : dir;
    }
});

revealBtn.addEventListener('click', () => {
    if (lastDownloadPath) window.ytdown.revealFile(lastDownloadPath);
});

// ─── Fetch Formats ────────────────────────────────────────────────────────────

async function handleFetch() {
    const url = urlInput.value.trim();
    if (!url) return;
    currentUrl = url;

    setFetchLoading(true);
    hideError();
    hideAll();

    try {
        const result = await window.ytdown.fetchFormats(url);
        renderVideoInfo(result.meta);
        renderFormats(result.formats);
        currentFormats = result.formats;
    } catch (err) {
        showError(err.message || 'Failed to fetch video. Check the URL and try again.');
    } finally {
        setFetchLoading(false);
    }
}

function renderVideoInfo(meta) {
    thumbnail.src = meta.thumbnail || '';
    videoTitle.textContent = meta.title || 'Unknown';
    videoChannel.textContent = meta.channel || '';
    videoDuration.textContent = meta.duration ? formatDuration(meta.duration) : '';
    videoInfo.style.display = 'flex';
}

function renderFormats(formats) {
    formatGrid.innerHTML = '';
    formats.forEach((fmt, idx) => {
        const card = document.createElement('div');
        card.className = 'format-card';
        card.style.animationDelay = `${idx * 0.05}s`;
        const badge = getBadge(fmt);
        card.innerHTML = `
      <div class="format-icon">${fmt.icon}</div>
      <div class="format-info">
        <div class="format-label">${fmt.label}</div>
        <div class="format-quality">${fmt.quality}</div>
        <div class="format-size">${fmt.size}</div>
      </div>
      <span class="format-badge ${badge.cls}">${badge.text}</span>
      <button class="btn-download" data-idx="${idx}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download
      </button>
    `;
        formatGrid.appendChild(card);
    });
    formatSection.style.display = 'flex';
    formatGrid.querySelectorAll('.btn-download').forEach(btn => {
        btn.addEventListener('click', () => {
            const fmt = currentFormats[parseInt(btn.dataset.idx)];
            startDownload(fmt);
        });
    });
}

function getBadge(fmt) {
    if (fmt.type === 'audio') return { cls: 'badge-audio', text: 'MP3' };
    if (fmt.height >= 2160) return { cls: 'badge-4k', text: '4K' };
    if (fmt.height >= 1080) return { cls: 'badge-fhd', text: 'FHD' };
    if (fmt.height >= 720) return { cls: 'badge-hd', text: 'HD' };
    return { cls: 'badge-sd', text: 'SD' };
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function startDownload(fmt) {
    formatGrid.querySelectorAll('.btn-download').forEach(b => b.disabled = true);
    downloadComplete.style.display = 'none';
    downloadPhase = 1;

    // Reset and show progress
    updateProgress(0, fmt.type === 'audio' ? 'Downloading audio...' : 'Downloading video...', '', '');
    downloadProgress.style.display = 'flex';
    // Scroll progress into view
    downloadProgress.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const result = await window.ytdown.downloadVideo({
            url: currentUrl,
            formatId: fmt.id,
            outputDir: downloadDir,
        });

        if (result?.filePath) {
            lastDownloadPath = result.filePath;
            const parts = result.filePath.split('/');
            completeFilename.textContent = parts[parts.length - 1] || '';
        }

        // Finish animation
        updateProgress(100, 'Complete!', '', '');
        setTimeout(() => {
            downloadProgress.style.display = 'none';
            downloadComplete.style.display = 'flex';
            downloadComplete.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 800);
    } catch (err) {
        downloadProgress.style.display = 'none';
        showError('Download failed: ' + (err.message || 'Unknown error'));
    } finally {
        formatGrid.querySelectorAll('.btn-download').forEach(b => b.disabled = false);
    }
}

// ─── Progress Updates from Main Process ───────────────────────────────────────

window.ytdown.onDownloadProgress((data) => {
    if (data.merging) {
        updateProgress(100, 'Merging video & audio...', '', '', true);
        return;
    }

    // Detect phase switch: when percent drops back to near 0 after being high
    const pct = data.percent || 0;

    // Two-stream download: video first then audio
    // Phase label
    let phaseLabel;
    if (data.phase === 2) {
        downloadPhase = 2;
        phaseLabel = 'Downloading audio...';
    } else if (downloadPhase === 2) {
        phaseLabel = 'Downloading audio...';
    } else {
        phaseLabel = 'Downloading video...';
    }

    updateProgress(pct, phaseLabel, data.speed || '', data.eta || '', false, data.totalSize || '');
});

function updateProgress(pct, label, speed, eta, merging = false, size = '') {
    progressFill.style.width = `${pct}%`;
    progressPercent.textContent = `${Math.round(pct)}%`;
    progressLabel.textContent = label;
    progressSpeed.textContent = speed ? `⚡ ${speed}` : '';
    progressEta.textContent = eta && eta !== '00:00' ? `ETA ${eta}` : '';
    progressSize.textContent = size ? `📦 ${size}` : '';

    if (merging) {
        progressFill.classList.add('merging');
    } else {
        progressFill.classList.remove('merging');
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setFetchLoading(loading) {
    fetchBtn.disabled = loading;
    fetchBtn.querySelector('.btn-text').style.display = loading ? 'none' : '';
    fetchBtn.querySelector('.btn-spinner').style.display = loading ? 'block' : 'none';
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
}

function hideError() {
    errorMsg.style.display = 'none';
}

function hideAll() {
    videoInfo.style.display = 'none';
    formatSection.style.display = 'none';
    downloadProgress.style.display = 'none';
    downloadComplete.style.display = 'none';
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
