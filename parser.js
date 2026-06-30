import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './src/loader.js';
import { buildFlow } from './src/flow.js';
import { renderMarkdown, renderErrorMarkdown } from './src/render-md.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const taskInput = args[0] || '1782757522666';
const taskDir = path.isAbsolute(taskInput) 
  ? taskInput 
  : (fs.existsSync(path.join(__dirname, 'cline-log', taskInput)) 
      ? path.join(__dirname, 'cline-log', taskInput) 
      : path.join(__dirname, taskInput));

const outDir = path.join(__dirname, 'out');
const sidecarDir = path.join(outDir, 'sidecar');

const webOutDir = path.join(__dirname, 'web');
const webSidecarDir = path.join(webOutDir, 'sidecar');

// Ensure output directories exist
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
if (!fs.existsSync(sidecarDir)) {
  fs.mkdirSync(sidecarDir, { recursive: true });
}
if (!fs.existsSync(webSidecarDir)) {
  fs.mkdirSync(webSidecarDir, { recursive: true });
}

console.log('Loading task log from:', taskDir);
const run = load(taskDir);

console.log('Building flow data (threshold: 200 tokens)...');
const flow = buildFlow(run, {
  thresholdTokens: 200,
  sink: (sidecarId, text) => {
    fs.writeFileSync(path.join(sidecarDir, sidecarId), text, 'utf-8');
    fs.writeFileSync(path.join(webSidecarDir, sidecarId), text, 'utf-8');
  }
});

// Save flow_data.json to workspace root and web folder
const flowDataPath = path.join(__dirname, 'flow_data.json');
const webFlowDataPath = path.join(webOutDir, 'flow_data.json');
fs.writeFileSync(flowDataPath, JSON.stringify(flow, null, 2), 'utf-8');
fs.writeFileSync(webFlowDataPath, JSON.stringify(flow, null, 2), 'utf-8');
console.log('Saved flow data to:', flowDataPath, 'and', webFlowDataPath);

// Render and save flow_report.md to workspace root
const markdownReport = renderMarkdown(flow);
const flowReportPath = path.join(__dirname, 'flow_report.md');
fs.writeFileSync(flowReportPath, markdownReport, 'utf-8');
console.log('Saved flow report to:', flowReportPath);

// Render and save error_report.md to workspace root
const errorReport = renderErrorMarkdown(flow);
const errorReportPath = path.join(__dirname, 'error_report.md');
fs.writeFileSync(errorReportPath, errorReport, 'utf-8');
console.log('Saved error report to:', errorReportPath);

console.log('Parsing completed successfully.');

