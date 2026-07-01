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

console.log('Loading task log from:', taskDir);
const run = load(taskDir);
const taskId = run.taskId;
const safeTaskId = encodeURIComponent(taskId);

// Output paths
const offlineSidecarDir = path.join(taskDir, 'sidecar');
const webTaskDir = path.join(__dirname, 'web', 'tasks', safeTaskId);
const webSidecarDir = path.join(webTaskDir, 'sidecar');

// Backwards compatibility output paths
const outDir = path.join(__dirname, 'out');
const sidecarDir = path.join(outDir, 'sidecar');
const webOutDir = path.join(__dirname, 'web');
const webSidecarDirLegacy = path.join(webOutDir, 'sidecar');

// Ensure output directories exist
if (!fs.existsSync(offlineSidecarDir)) {
  fs.mkdirSync(offlineSidecarDir, { recursive: true });
}
if (!fs.existsSync(webSidecarDir)) {
  fs.mkdirSync(webSidecarDir, { recursive: true });
}
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
if (!fs.existsSync(sidecarDir)) {
  fs.mkdirSync(sidecarDir, { recursive: true });
}
if (!fs.existsSync(webSidecarDirLegacy)) {
  fs.mkdirSync(webSidecarDirLegacy, { recursive: true });
}

console.log('Building flow data (threshold: 200 tokens)...');
const flow = buildFlow(run, {
  thresholdTokens: 200,
  sink: (sidecarId, text) => {
    // Write task-specific sidecars
    fs.writeFileSync(path.join(offlineSidecarDir, sidecarId), text, 'utf-8');
    fs.writeFileSync(path.join(webSidecarDir, sidecarId), text, 'utf-8');
    
    // Write legacy sidecars for backward compatibility
    fs.writeFileSync(path.join(sidecarDir, sidecarId), text, 'utf-8');
    fs.writeFileSync(path.join(webSidecarDirLegacy, sidecarId), text, 'utf-8');
  }
});

// Save task-specific files
const flowDataPath = path.join(taskDir, `${taskId}_flow_data.json`);
const webFlowDataPath = path.join(webTaskDir, 'flow_data.json');
fs.writeFileSync(flowDataPath, JSON.stringify(flow, null, 2), 'utf-8');
fs.writeFileSync(webFlowDataPath, JSON.stringify(flow, null, 2), 'utf-8');
console.log('Saved flow data to:', flowDataPath, 'and', webFlowDataPath);

// Render and save flow_report.md
const markdownReport = renderMarkdown(flow);
const flowReportPath = path.join(taskDir, `${taskId}_flow_report.md`);
fs.writeFileSync(flowReportPath, markdownReport, 'utf-8');
console.log('Saved flow report to:', flowReportPath);

// Render and save error_report.md
const errorReport = renderErrorMarkdown(flow, __dirname);
const errorReportPath = path.join(taskDir, `${taskId}_error_report.md`);
fs.writeFileSync(errorReportPath, errorReport, 'utf-8');
console.log('Saved error report to:', errorReportPath);

// Write legacy files for backward compatibility
const flowDataPathLegacy = path.join(__dirname, 'flow_data.json');
const webFlowDataPathLegacy = path.join(webOutDir, 'flow_data.json');
fs.writeFileSync(flowDataPathLegacy, JSON.stringify(flow, null, 2), 'utf-8');
fs.writeFileSync(webFlowDataPathLegacy, JSON.stringify(flow, null, 2), 'utf-8');

const flowReportPathLegacy = path.join(__dirname, 'flow_report.md');
fs.writeFileSync(flowReportPathLegacy, markdownReport, 'utf-8');

const errorReportPathLegacy = path.join(__dirname, 'error_report.md');
fs.writeFileSync(errorReportPathLegacy, errorReport, 'utf-8');

// Update web/tasks.json catalog
const tasksJsonPath = path.join(__dirname, 'web', 'tasks.json');
let tasksList = [];
if (fs.existsSync(tasksJsonPath)) {
  try {
    tasksList = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf-8'));
  } catch (err) {
    tasksList = [];
  }
}

const taskMeta = {
  taskId: taskId,
  prompt: flow.prompt.length > 80 ? flow.prompt.slice(0, 77) + '...' : flow.prompt,
  model: flow.model ? flow.model.modelId : 'Unknown',
  totals: {
    turns: flow.totals.turns,
    cost: flow.totals.cost,
    durationMs: flow.totals.durationMs
  },
  parsedAt: new Date().toISOString()
};

// Filter out existing and insert current at the beginning
tasksList = [taskMeta, ...tasksList.filter(t => t.taskId !== taskId)];
fs.writeFileSync(tasksJsonPath, JSON.stringify(tasksList, null, 2), 'utf-8');
console.log('Updated tasks catalog:', tasksJsonPath);

console.log('Parsing completed successfully.');

