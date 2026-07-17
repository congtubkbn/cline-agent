import { spawn, exec } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const taskInput = args.find(a => !a.startsWith('-')) || '1782757522666';
const watchMode = !args.includes('--no-watch'); // defaults to watch mode

console.log(`\n🚀 Starting Cline Agent Analyzer...`);
console.log(`📂 Log Folder: ${taskInput}`);
console.log(`🔄 Watch Mode: ${watchMode ? 'Enabled' : 'Disabled'}\n`);

// 1. Start Server
const server = spawn('node', ['serve.mjs'], { stdio: 'inherit' });

// 2. Start Parser (passing arguments)
const parserArgs = ['parser.js', taskInput];
if (watchMode) {
  parserArgs.push('--watch');
}
const parser = spawn('node', parserArgs, { stdio: 'inherit' });

// Handle process termination cleanly
const cleanup = () => {
  console.log('\nStopping server and parser...');
  try { server.kill(); } catch (e) {}
  try { parser.kill(); } catch (e) {}
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Server exited with error code ${code}`);
    parser.kill();
    process.exit(code);
  } else {
    console.log('ℹ️ Server process returned (already running or detached).');
  }
});

parser.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Parser exited with error code ${code}`);
    server.kill();
    process.exit(code);
  } else {
    console.log('ℹ️ Parser completed successfully.');
  }
});

// 3. Open browser after a short delay
setTimeout(() => {
  const url = 'http://localhost:8099/';
  console.log(`🌐 Opening browser at ${url}...`);
  try {
    if (os.platform() === 'win32') {
      exec(`start "" "${url}"`);
    } else if (os.platform() === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch (err) {
    console.error('⚠️ Could not open browser automatically:', err.message);
  }
}, 1500);
