const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow;
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 700,
        minHeight: 500,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        backgroundColor: '#0f0f14',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

// Strip playlist/radio params from YouTube URL so yt-dlp treats it as a single video
function sanitizeYouTubeUrl(url) {
    try {
        const u = new URL(url);
        // Only strip extra params for youtube.com / youtu.be
        if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
            ['list', 'start_radio', 'index', 'pp', 'si'].forEach(p => u.searchParams.delete(p));
        }
        return u.toString();
    } catch (_) {
        return url; // not a valid URL, return as-is
    }
}

// Find yt-dlp binary dynamically (cross-platform)
function getYtDlpPath() {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const isWin = process.platform === 'win32';

    // Try system lookup first
    try {
        const cmd = isWin ? 'where yt-dlp' : 'which yt-dlp';
        const envPath = isWin ? process.env.PATH : [
            '/opt/homebrew/bin',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
            path.join(os.homedir(), '.local/bin'),
            process.env.PATH,
        ].filter(Boolean).join(':');

        const result = execSync(cmd, {
            env: { ...process.env, PATH: envPath },
            windowsHide: true,
        }).toString().trim().split('\n')[0].trim();
        if (result) return result;
    } catch (_) { }

    // Platform-specific fallbacks
    const fallbacks = isWin ? [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'yt-dlp', 'yt-dlp.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'yt-dlp.exe'),
        path.join(process.env.PROGRAMFILES || '', 'yt-dlp', 'yt-dlp.exe'),
        'C:\\yt-dlp\\yt-dlp.exe',
    ] : [
        '/opt/homebrew/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        path.join(os.homedir(), '.local/bin/yt-dlp'),
    ];

    for (const p of fallbacks) {
        try { fs.accessSync(p); return p; } catch (_) { }
    }
    return isWin ? 'yt-dlp.exe' : 'yt-dlp';
}

// Get default download dir
ipcMain.handle('get-default-dir', () => DEFAULT_DOWNLOAD_DIR);

// Fetch available formats
ipcMain.handle('fetch-formats', async (_event, url) => {
    return new Promise((resolve, reject) => {
        const ytdlp = getYtDlpPath();
        url = sanitizeYouTubeUrl(url);
        const proc = spawn(ytdlp, ['-J', '--no-playlist', '--no-warnings', url]);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr || 'Failed to fetch video info'));
                return;
            }
            try {
                const info = JSON.parse(stdout);

                // Extract video metadata
                const meta = {
                    title: info.title,
                    channel: info.channel || info.uploader,
                    duration: info.duration,
                    thumbnail: info.thumbnail,
                    viewCount: info.view_count,
                };

                // Curate format list
                const formats = [];
                const seen = new Set();

                // Audio-only (MP3)
                const audioFormats = (info.formats || [])
                    .filter(f => f.acodec !== 'none' && f.vcodec === 'none' && f.abr)
                    .sort((a, b) => (b.abr || 0) - (a.abr || 0));

                if (audioFormats.length > 0) {
                    const best = audioFormats[0];
                    formats.push({
                        id: 'mp3',
                        type: 'audio',
                        label: 'MP3 Audio',
                        quality: `${Math.round(best.abr)}kbps`,
                        size: best.filesize ? formatSize(best.filesize) : estimateSize(best.abr, info.duration, 'audio'),
                        ext: 'mp3',
                        icon: '🎵',
                    });
                }

                // Video formats
                const targetResolutions = [
                    { height: 360, label: '360p SD' },
                    { height: 480, label: '480p SD' },
                    { height: 720, label: '720p HD' },
                    { height: 1080, label: '1080p Full HD' },
                    { height: 1440, label: '1440p 2K' },
                    { height: 2160, label: '2160p 4K' },
                ];

                for (const target of targetResolutions) {
                    const videos = (info.formats || [])
                        .filter(f => f.vcodec !== 'none' && f.height && Math.abs(f.height - target.height) <= 20)
                        .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));

                    if (videos.length > 0 && !seen.has(target.height)) {
                        seen.add(target.height);
                        const best = videos[0];
                        const bestAudio = audioFormats[0];
                        const totalSize = (best.filesize || 0) + (bestAudio?.filesize || 0);

                        formats.push({
                            id: `bestvideo[height<=${target.height}]+bestaudio/best[height<=${target.height}]`,
                            type: 'video',
                            label: target.label,
                            quality: `${target.height}p${best.fps > 30 ? best.fps : ''}`,
                            fps: best.fps,
                            size: totalSize ? formatSize(totalSize) : estimateSize(best.tbr, info.duration, 'video'),
                            ext: 'mp4',
                            icon: target.height >= 2160 ? '🎬' : target.height >= 1080 ? '📺' : '🎥',
                            height: target.height,
                        });
                    }
                }

                resolve({ meta, formats });
            } catch (e) {
                reject(new Error('Failed to parse video info'));
            }
        });
    });
});

// Download video
ipcMain.handle('download-video', async (event, { url, formatId, outputDir }) => {
    url = sanitizeYouTubeUrl(url);
    outputDir = outputDir || DEFAULT_DOWNLOAD_DIR;
    return new Promise((resolve, reject) => {
        const ytdlp = getYtDlpPath();
        let args;

        if (formatId === 'mp3') {
            args = [
                '-x', '--audio-format', 'mp3',
                '--audio-quality', '0',
                '-o', path.join(outputDir, '%(title)s.%(ext)s'),
                '--newline',
                '--no-warnings',
                url,
            ];
        } else {
            args = [
                '-f', formatId,
                '--merge-output-format', 'mp4',
                '-o', path.join(outputDir, '%(title)s.%(ext)s'),
                '--newline',
                '--no-warnings',
                url,
            ];
        }

        const proc = spawn(ytdlp, args);
        let lastFile = '';

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                // Parse download progress
                const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/);
                if (progressMatch) {
                    mainWindow.webContents.send('download-progress', {
                        percent: parseFloat(progressMatch[1]),
                        totalSize: progressMatch[2],
                        speed: progressMatch[3],
                        eta: progressMatch[4],
                    });
                }

                // 100% complete
                const completeMatch = line.match(/\[download\]\s+100%\s+of/);
                if (completeMatch) {
                    mainWindow.webContents.send('download-progress', {
                        percent: 100,
                        speed: '-',
                        eta: '00:00',
                    });
                }

                // Merge step
                if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
                    mainWindow.webContents.send('download-progress', {
                        percent: 100,
                        speed: '-',
                        eta: 'Merging...',
                        merging: true,
                    });
                }

                // Get destination file
                const destMatch = line.match(/Destination:\s+(.+)/);
                if (destMatch) {
                    lastFile = destMatch[1].trim();
                }

                // Already downloaded
                if (line.includes('has already been downloaded')) {
                    const alreadyMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
                    if (alreadyMatch) lastFile = alreadyMatch[1].trim();
                }
            }
        });

        proc.stderr.on('data', (data) => {
            console.error('yt-dlp stderr:', data.toString());
        });

        proc.on('close', (code) => {
            if (code === 0) {
                // Try to find the actual output file (after merge, extension might change)
                const dir = outputDir;
                resolve({ success: true, filePath: lastFile || dir });
            } else {
                reject(new Error('Download failed'));
            }
        });
    });
});

// Select download directory
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        defaultPath: DEFAULT_DOWNLOAD_DIR,
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

// Reveal file in Finder
ipcMain.handle('reveal-file', async (_event, filePath) => {
    shell.showItemInFolder(filePath);
});

// Utils
function formatSize(bytes) {
    if (!bytes) return '?';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
}

function estimateSize(bitrate, duration, type) {
    if (!bitrate || !duration) return '~?';
    const bytes = (bitrate * 1000 * duration) / 8;
    return '~' + formatSize(bytes);
}
