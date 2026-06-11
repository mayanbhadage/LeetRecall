const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8777;
const DIR = __dirname;

// Serve static files from store-assets and icons
const server = http.createServer((req, res) => {
  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(DIR, 'resize.html');
  } else {
    // Try store-assets first, then project root
    filePath = path.join(DIR, req.url);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(DIR, '..', req.url);
    }
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found: ' + req.url);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };

  res.writeHead(200, { 
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log('Resize server running at http://localhost:' + PORT);
  console.log('Open this URL in your browser to generate store assets.');
});
