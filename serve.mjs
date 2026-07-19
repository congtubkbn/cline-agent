import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const PORT = 8099;

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

function checkStatus(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/_status',
      method: 'GET',
      timeout: 500
    }, (res) => {
      if (res.statusCode !== 200) {
        resolve({ status: 'occupied_by_other' });
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && typeof json === 'object' && typeof json.root === 'string') {
            resolve({ status: 'occupied_by_us', root: json.root });
          } else {
            resolve({ status: 'occupied_by_other' });
          }
        } catch {
          resolve({ status: 'occupied_by_other' });
        }
      });
    });

    req.on('error', () => {
      resolve({ status: 'free' });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'free' });
    });
    req.end();
  });
}

function requestShutdown(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/_shutdown',
      method: 'POST',
      timeout: 1000
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        resolve(true);
      });
    });
    req.on('error', () => {
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// --- API helpers -----------------------------------------------------------

// Task IDs are numeric epoch strings (e.g. "1784412206488") but allow
// alphanumeric + dash/underscore up to 64 chars so custom names work too.
// The strict regex blocks any path-traversal attempt ("../", encoded slashes…)
function isValidTaskId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_\-]{1,64}$/.test(id);
}

function serveJson(s, payload) {
  const body = JSON.stringify(payload);
  s.writeHead(200, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  });
  s.end(body);
}

function apiError(s, code, message) {
  s.writeHead(code, { 'content-type': 'application/json' });
  s.end(JSON.stringify({ error: message }));
}

// Resolve a route pattern like /api/tasks/:id/analysis against the request
// pathname and return captured groups, or null if it doesn't match.
function matchRoute(pathname, pattern) {
  const re = new RegExp(
    '^' + pattern.replace(/:([a-z]+)/g, '(?<$1>[^/]+)') + '$'
  );
  const m = pathname.match(re);
  return m ? m.groups : null;
}

// ----------------------------------------------------------------------------

function startServer() {
  const server = http.createServer((q, s) => {
    if (q.url === '/_status') {
      s.setHeader('content-type', 'application/json');
      s.end(JSON.stringify({ root }));
      return;
    }

    if (q.url === '/_shutdown' && q.method === 'POST') {
      const remote = q.socket.remoteAddress;
      if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
        s.writeHead(200, { 'content-type': 'text/plain' });
        s.end('Shutting down...');
        console.log('Shutdown requested by local manager. Exiting...');
        setTimeout(() => process.exit(0), 100);
        return;
      } else {
        s.writeHead(403);
        s.end('Forbidden');
        return;
      }
    }

    // --- REST API routes (checked before static-file catch-all) -------------
    const pathname = q.url.split('?')[0];  // strip query string

    // GET /api/tasks  →  full tasks.json catalog array
    if (pathname === '/api/tasks' && q.method === 'GET') {
      fs.readFile(path.join(root, 'tasks.json'), 'utf8', (err, data) => {
        if (err) { serveJson(s, []); return; }
        try { serveJson(s, JSON.parse(data)); }
        catch { serveJson(s, []); }
      });
      return;
    }

    // GET /api/tasks/:id/meta  →  single catalog entry (parsedAt, healthScore…)
    // Cheap alternative to loading flow_data.json just to check parsedAt.
    let m;
    if ((m = matchRoute(pathname, '/api/tasks/:id/meta')) && q.method === 'GET') {
      const { id } = m;
      if (!isValidTaskId(id)) { apiError(s, 400, 'Invalid task ID'); return; }
      fs.readFile(path.join(root, 'tasks.json'), 'utf8', (err, data) => {
        if (err) { apiError(s, 404, 'tasks.json not found'); return; }
        try {
          const list = JSON.parse(data);
          const entry = list.find(t => t.taskId === id);
          if (!entry) { apiError(s, 404, `Task ${id} not found`); return; }
          serveJson(s, entry);
        } catch { apiError(s, 500, 'Parse error'); }
      });
      return;
    }

    // GET /api/tasks/:id/analysis  →  tasks/:id/analysis.json (~22 KB)
    // Use this instead of flow_data.json when you only need findings/FTA.
    if ((m = matchRoute(pathname, '/api/tasks/:id/analysis')) && q.method === 'GET') {
      const { id } = m;
      if (!isValidTaskId(id)) { apiError(s, 400, 'Invalid task ID'); return; }
      fs.readFile(path.join(root, 'tasks', id, 'analysis.json'), (err, data) => {
        if (err) { apiError(s, 404, `analysis.json not found for task ${id}`); return; }
        s.writeHead(200, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store'
        });
        s.end(data);
      });
      return;
    }

    // GET /api/tasks/:id/flow  →  tasks/:id/flow_data.json (full, large)
    if ((m = matchRoute(pathname, '/api/tasks/:id/flow')) && q.method === 'GET') {
      const { id } = m;
      if (!isValidTaskId(id)) { apiError(s, 400, 'Invalid task ID'); return; }
      fs.readFile(path.join(root, 'tasks', id, 'flow_data.json'), (err, data) => {
        if (err) { apiError(s, 404, `flow_data.json not found for task ${id}`); return; }
        s.writeHead(200, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store'
        });
        s.end(data);
      });
      return;
    }
    // -------------------------------------------------------------------------

    let f = path.join(root, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.slice(1)));
    fs.readFile(f, (e, d) => {
      if (e) {
        s.statusCode = 404;
        s.end('404');
        return;
      }
      const t = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.txt': 'text/plain'
      }[path.extname(f)] || 'text/plain';
      s.setHeader('content-type', t);
      s.end(d);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is occupied by another application. Please free it.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('serving web/ on:');
    console.log(`  http://localhost:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`  http://${ip}:${PORT}   (LAN — share this with others on the network)`);
    }
  });
}

async function init() {
  const check = await checkStatus(PORT);

  if (check.status === 'occupied_by_us') {
    const normRoot = path.normalize(root).toLowerCase();
    const normCheckRoot = path.normalize(check.root).toLowerCase();

    if (normRoot === normCheckRoot) {
      console.log(`Server is already running for this project on http://localhost:${PORT}`);
      process.exit(0);
    } else {
      console.log(`Port ${PORT} is occupied by another analyzer instance.`);
      console.log(`  Current instance root: ${root}`);
      console.log(`  Running instance root: ${check.root}`);
      console.log('Requesting shutdown of the other instance...');
      const shutdownSuccess = await requestShutdown(PORT);
      if (shutdownSuccess) {
        console.log('Other instance has been shut down.');
        await new Promise(r => setTimeout(r, 1000));
        startServer();
      } else {
        console.log('Could not shut down the other instance automatically.');
        console.error(`Port ${PORT} remains occupied. Please kill it manually or use a different port.`);
        process.exit(1);
      }
    }
  } else if (check.status === 'occupied_by_other') {
    console.error(`Port ${PORT} is occupied by a different application. Please free it.`);
    process.exit(1);
  } else {
    startServer();
  }
}

init();
