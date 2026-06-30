import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targets = [
  path.join(__dirname, 'out'),
  path.join(__dirname, 'flow_data.json'),
  path.join(__dirname, 'flow_report.md'),
  path.join(__dirname, 'error_report.md'),
  path.join(__dirname, 'web/flow_data.json'),
  path.join(__dirname, 'web/sidecar')
];

console.log('Cleaning generated files and folders...');

for (const target of targets) {
  if (fs.existsSync(target)) {
    try {
      const stats = fs.statSync(target);
      if (stats.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log(`Removed directory: ${target}`);
      } else {
        fs.rmSync(target, { force: true });
        console.log(`Removed file: ${target}`);
      }
    } catch (err) {
      console.error(`Error removing ${target}:`, err.message);
    }
  }
}

console.log('Cleanup completed.');
