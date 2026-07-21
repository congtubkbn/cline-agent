import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './src/loader.js';
import { analyze } from './src/analyze.js';
import { buildFaultTree, ftaToMermaid } from './src/fta.js';
import { buildAnalysisRecord } from './src/report.js';
import { renderMarkdown, renderErrorMarkdown } from './src/render-md.js';
import { renderHtml } from './src/render-html.js';
import { renderViReport } from './src/render-vi-report.js';
import { withSidecarHeader } from './src/sidecar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const watchMode = args.includes('--watch') || args.includes('-w');
const taskInput = args.find(a => !a.startsWith('-')) || '1782757522666';
const taskDir = path.isAbsolute(taskInput)
  ? taskInput
  : (fs.existsSync(path.join(__dirname, 'cline-log', taskInput))
      ? path.join(__dirname, 'cline-log', taskInput)
      : path.join(__dirname, taskInput));

function runParse() {
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
  const sidecarTexts = {};
  const { flow, expected, conformance } = analyze(run, {
    thresholdTokens: 200,
    skillRoots: [
      path.join(__dirname, '.claude', 'skills'),
      path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'skills')
    ],
    sink: (sidecarId, text) => {
      // Keep the raw full text for inline embedding in the HTML report (keyed by
      // the same `sidecar/...` path the flow blocks reference).
      sidecarTexts[`sidecar/${sidecarId}`] = text;

      // On-disk sidecars get a provenance banner so, opened standalone, the file
      // says which turn it belongs to and links back to the report.
      const withHeader = withSidecarHeader(sidecarId, taskId, text);

      // Write task-specific sidecars
      fs.writeFileSync(path.join(offlineSidecarDir, sidecarId), withHeader, 'utf-8');
      fs.writeFileSync(path.join(webSidecarDir, sidecarId), withHeader, 'utf-8');

      // Write legacy sidecars for backward compatibility
      fs.writeFileSync(path.join(sidecarDir, sidecarId), withHeader, 'utf-8');
      fs.writeFileSync(path.join(webSidecarDirLegacy, sidecarId), withHeader, 'utf-8');
    }
  });

  console.log('Running fault tree analysis (FTA)...');
  const fta = buildFaultTree(flow, conformance);
  const ftaMermaid = ftaToMermaid(fta);
  const analysis = buildAnalysisRecord({ flow, expected, conformance, fta });
  // Embed in flow_data.json so the dashboard's Analysis tab can read it directly.
  flow.analysis = analysis;
  flow.ftaMermaid = ftaMermaid;

  // Save task-specific files
  const flowDataPath = path.join(taskDir, `${taskId}_flow_data.json`);
  const webFlowDataPath = path.join(webTaskDir, 'flow_data.json');
  fs.writeFileSync(flowDataPath, JSON.stringify(flow, null, 2), 'utf-8');
  fs.writeFileSync(webFlowDataPath, JSON.stringify(flow, null, 2), 'utf-8');
  console.log('Saved flow data to:', flowDataPath, 'and', webFlowDataPath);

  // Copy raw ui_messages.json if present
  const rawUiMessagesPath = path.join(taskDir, 'ui_messages.json');
  if (fs.existsSync(rawUiMessagesPath)) {
    fs.copyFileSync(rawUiMessagesPath, path.join(webTaskDir, 'ui_messages.json'));
    console.log('Copied ui_messages.json to:', path.join(webTaskDir, 'ui_messages.json'));
  }

  // Render and save flow_report.md
  const markdownReport = renderMarkdown(flow);
  const flowReportPath = path.join(taskDir, `${taskId}_flow_report.md`);
  fs.writeFileSync(flowReportPath, markdownReport, 'utf-8');
  console.log('Saved flow report to:', flowReportPath);

  // Render and save Vietnamese hierarchical report
  const viReport = renderViReport(flow);
  const viReportPath = path.join(taskDir, `${taskId}_bao_cao_chi_tiet.md`);
  const webViReportPath = path.join(webTaskDir, 'bao_cao_chi_tiet.md');
  fs.writeFileSync(viReportPath, viReport, 'utf-8');
  fs.writeFileSync(webViReportPath, viReport, 'utf-8');
  console.log('Saved Vietnamese report to:', viReportPath, 'and', webViReportPath);

  // Render and save flow_report.html (single-file debug view)
  const htmlReport = renderHtml(flow, { sidecars: sidecarTexts });
  const flowReportHtmlPath = path.join(taskDir, `${taskId}_flow_report.html`);
  const webFlowReportHtmlPath = path.join(webTaskDir, 'flow_report.html');
  fs.writeFileSync(flowReportHtmlPath, htmlReport, 'utf-8');
  fs.writeFileSync(webFlowReportHtmlPath, htmlReport, 'utf-8');
  console.log('Saved HTML report to:', flowReportHtmlPath, 'and', webFlowReportHtmlPath);

  // Render and save error_report.md
  const errorReport = renderErrorMarkdown(flow, __dirname);
  const errorReportPath = path.join(taskDir, `${taskId}_error_report.md`);
  fs.writeFileSync(errorReportPath, errorReport, 'utf-8');
  console.log('Saved error report to:', errorReportPath);

  // Save analysis record (machine-readable) and analysis report (engineer-readable)
  const analysisJson = JSON.stringify(analysis, null, 2);
  const analysisPath = path.join(taskDir, `${taskId}_analysis.json`);
  const webAnalysisPath = path.join(webTaskDir, 'analysis.json');
  fs.writeFileSync(analysisPath, analysisJson, 'utf-8');
  fs.writeFileSync(webAnalysisPath, analysisJson, 'utf-8');
  console.log('Saved analysis record to:', analysisPath, 'and', webAnalysisPath);

  // Write legacy files for backward compatibility
  const flowDataPathLegacy = path.join(__dirname, 'flow_data.json');
  const webFlowDataPathLegacy = path.join(webOutDir, 'flow_data.json');
  fs.writeFileSync(flowDataPathLegacy, JSON.stringify(flow, null, 2), 'utf-8');
  fs.writeFileSync(webFlowDataPathLegacy, JSON.stringify(flow, null, 2), 'utf-8');

  const flowReportPathLegacy = path.join(__dirname, 'flow_report.md');
  fs.writeFileSync(flowReportPathLegacy, markdownReport, 'utf-8');

  const flowReportHtmlLegacy = path.join(__dirname, 'flow_report.html');
  const webFlowReportHtmlLegacy = path.join(webOutDir, 'flow_report.html');
  fs.writeFileSync(flowReportHtmlLegacy, htmlReport, 'utf-8');
  fs.writeFileSync(webFlowReportHtmlLegacy, htmlReport, 'utf-8');

  const errorReportPathLegacy = path.join(__dirname, 'error_report.md');
  fs.writeFileSync(errorReportPathLegacy, errorReport, 'utf-8');

  fs.writeFileSync(path.join(__dirname, 'analysis.json'), analysisJson, 'utf-8');

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
    analysis: {
      status: analysis.outcome.status,
      healthScore: analysis.outcome.healthScore,
      findings: analysis.findings.length,
      planAdherence: analysis.plan ? analysis.plan.adherenceScore : null
    },
    parsedAt: new Date().toISOString()
  };

  // Filter out existing and insert current at the beginning
  tasksList = [taskMeta, ...tasksList.filter(t => t.taskId !== taskId)];
  fs.writeFileSync(tasksJsonPath, JSON.stringify(tasksList, null, 2), 'utf-8');
  console.log('Updated tasks catalog:', tasksJsonPath);

  console.log('Parsing completed successfully.');
}

// First run always surfaces failures and exits non-zero — serving a stale or
// empty dataset is worse than a loud parse error.
runParse();

if (watchMode) {
  console.log(`\nWatching for changes: ${taskDir}`);
  console.log('(ui_messages.json, api_conversation_history.json, task_metadata.json — Ctrl+C to stop)');

  // Cline writes the log in small bursts (each turn appends a few messages),
  // so a single logical update fires several fs events in quick succession.
  // Debounce and coalesce them into one re-parse.
  let debounceTimer = null;
  let retryTimer = null;
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 2000;

  function reparse(label) {
    console.log(`\n[watch] ${label}, re-parsing...`);
    try {
      runParse();
      retryCount = 0;
    } catch (err) {
      // The log may be mid-write (partial JSON). A later file-change event
      // retries naturally, but if this was the task's *final* write no more
      // events are coming — so also schedule a timed retry, bounded so a
      // genuinely corrupt file doesn't retry forever.
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        console.error(`[watch] Re-parse failed (attempt ${retryCount}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS / 1000}s:`, err.message);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          reparse('Retrying after failed parse');
        }, RETRY_DELAY_MS);
      } else {
        console.error('[watch] Re-parse failed, giving up until the next file change:', err.message);
      }
    }
  }

  let watcher = null;

  function startWatch() {
    if (watcher) {
      try { watcher.close(); } catch (e) {}
    }
    try {
      watcher = fs.watch(taskDir, { persistent: true }, (eventType, filename) => {
        if (filename && !/^(ui_messages|api_conversation_history|task_metadata)\.json$/.test(filename)) return;
        // A real file change supersedes any pending retry and resets its budget.
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        retryCount = 0;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          reparse(`Change detected (${filename || 'log file'})`);
        }, 500);
      });

      watcher.on('error', (err) => {
        console.error(`[watch] Watcher error occurred:`, err.message);
        // On Windows, locks or temp folder moves can break the watcher. Attempt restart.
        console.log('[watch] Attempting to restart watcher in 3s...');
        setTimeout(startWatch, 3000);
      });
    } catch (err) {
      console.error(`[watch] Failed to initialize watcher:`, err.message);
      console.log('[watch] Retrying watcher initialization in 5s...');
      setTimeout(startWatch, 5000);
    }
  }

  startWatch();
}
