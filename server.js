const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const port = 8080;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    // COOP / COEP ヘッダーの付与 (SharedArrayBufferの動作に必須)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    let urlPath = req.url === '/' ? 'index.html' : req.url;

    // 特殊ルート: Tailwind CSS をローカルキャッシュしてCOEPブロックを回避
    if (urlPath === '/js/tailwindcss.js') {
        let localTailwindPath = path.join(__dirname, 'js', 'tailwindcss.js');
        if (fs.existsSync(localTailwindPath)) {
            serveFile(localTailwindPath, res);
        } else {
            console.log('[Server] Downloading Tailwind CSS CDN script to local cache to bypass COEP block...');
            downloadFile('https://cdn.tailwindcss.com', localTailwindPath, (err) => {
                if (err) {
                    res.statusCode = 500;
                    res.end(`Failed to download Tailwind CSS: ${err.message}`);
                } else {
                    serveFile(localTailwindPath, res);
                }
            });
        }
        return;
    }

    let filePath = path.join(__dirname, urlPath);
    
    // 安全対策
    if (!filePath.startsWith(__dirname)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }

    serveFile(filePath, res);
});

function downloadFile(url, localPath, callback) {
    https.get(url, (res) => {
        // リダイレクト (301/302) の処理
        if (res.statusCode === 301 || res.statusCode === 302) {
            let nextUrl = res.headers.location;
            if (nextUrl.startsWith('/')) {
                nextUrl = 'https://cdn.tailwindcss.com' + nextUrl;
            }
            downloadFile(nextUrl, localPath, callback);
            return;
        }

        if (res.statusCode !== 200) {
            callback(new Error(`Failed to download: Status Code ${res.statusCode}`));
            return;
        }

        let data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => {
            let buffer = Buffer.concat(data);
            try {
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                fs.writeFileSync(localPath, buffer);
                console.log('[Server] Tailwind CSS cached successfully!');
                callback(null);
            } catch (err) {
                callback(err);
            }
        });
    }).on('error', (err) => {
        callback(err);
    });
}

function serveFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.statusCode = 404;
                res.end('404 Not Found');
            } else {
                res.statusCode = 500;
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
