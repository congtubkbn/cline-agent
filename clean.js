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
  path.join(__dirname, 'web/sidecar'),
  path.join(__dirname, 'web/tasks'),
  path.join(__dirname, 'web/tasks.json')
];

console.log('Cleaning generated files and folders...');

// 1. Remove standard targets
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

// 2. Clean namespaced task files inside cline-log/ subdirectories (preserves raw logs)
const clineLogDir = path.join(__dirname, 'cline-log');
if (fs.existsSync(clineLogDir)) {
  try {
    const folders = fs.readdirSync(clineLogDir);
    for (const folder of folders) {
      const folderPath = path.join(clineLogDir, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          if (
            file.endsWith('_flow_data.json') ||
            file.endsWith('_flow_report.md') ||
            file.endsWith('_error_report.md')
          ) {
            fs.rmSync(filePath, { force: true });
            console.log(`Removed task output file: ${filePath}`);
          }
        }
        const taskSidecarDir = path.join(folderPath, 'sidecar');
        if (fs.existsSync(taskSidecarDir)) {
          fs.rmSync(taskSidecarDir, { recursive: true, force: true });
          console.log(`Removed task sidecar folder: ${taskSidecarDir}`);
        }
      }
    }
  } catch (err) {
    console.error(`Error cleaning cline-log directories:`, err.message);
  }
}

console.log('Cleanup completed.');
