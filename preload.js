const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytdown', {
    fetchFormats: (url) => ipcRenderer.invoke('fetch-formats', url),
    downloadVideo: (opts) => ipcRenderer.invoke('download-video', opts),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
    getDefaultDir: () => ipcRenderer.invoke('get-default-dir'),
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download-progress', (_event, data) => callback(data));
    },
});
