/*
 * Tiny static file server for local development: `npm start` then open http://localhost:5173.
 * (index.html also works straight from disk; a server just avoids any file:// quirks.)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 5173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".md": "text/markdown", ".json": "application/json" };

http.createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.normalize(path.join(root, requested === "/" ? "index.html" : requested));
  if (!file.startsWith(root)) { res.writeHead(403).end("Forbidden"); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
  });
}).listen(port, () => console.log(`Serving on http://localhost:${port}`));
