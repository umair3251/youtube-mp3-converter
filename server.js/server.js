const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// Cleanup old files every hour
setInterval(() => {
    fs.readdir(downloadsDir, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtime.getTime() > 3600000) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}, 3600000);

// Get video info
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const { stdout } = await execPromise(`yt-dlp --dump-json --no-download "${url}"`);
        const info = JSON.parse(stdout);
        
        res.json({
            title: info.title,
            duration: formatDuration(info.duration),
            thumbnail: info.thumbnail,
            uploader: info.uploader,
            id: info.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch video info' });
    }
});

// Convert to MP3
app.post('/api/convert', async (req, res) => {
    try {
        const { url, quality = '320' } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });

        const videoId = Date.now();
        const outputPath = path.join(downloadsDir, `${videoId}.mp3`);
        const audioQuality = quality === '128' ? '128K' : quality === '192' ? '192K' : '320K';
        
        const command = `yt-dlp --extract-audio --audio-format mp3 --audio-quality ${audioQuality} --output "${outputPath}" --no-playlist "${url}"`;
        
        await execPromise(command, { timeout: 300000 });
        
        if (!fs.existsSync(outputPath)) {
            throw new Error('File not created');
        }

        const stats = fs.statSync(outputPath);
        
        res.json({
            success: true,
            downloadUrl: `/api/download/${videoId}`,
            fileSize: formatBytes(stats.size),
            quality: audioQuality
        });
    } catch (error) {
        res.status(500).json({ error: 'Conversion failed', details: error.message });
    }
});

// Download file
app.get('/api/download/:id', (req, res) => {
    const filePath = path.join(downloadsDir, `${req.params.id}.mp3`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="audio-${req.params.id}.mp3"`);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('close', () => fs.unlink(filePath, () => {}));
});

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));