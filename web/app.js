// App State
let flowData = null;
let currentStepIndex = 0;
let playbackInterval = null;
let isPlaying = false;
let tokenChartInstance = null;
let costChartInstance = null;
let cacheChartInstance = null;

// DOM Elements
const taskIdBadge = document.getElementById('task-id-badge');
const modelBadge = document.getElementById('model-badge');
const initialPrompt = document.getElementById('initial-prompt');
const statDuration = document.getElementById('stat-duration');
const statTokens = document.getElementById('stat-tokens');
const statCache = document.getElementById('stat-cache');
const statSteps = document.getElementById('stat-steps');

const timelineList = document.getElementById('timeline-list');

const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnReset = document.getElementById('btn-reset');
const playbackSlider = document.getElementById('playback-slider');
const playbackCurrentStepLabel = document.getElementById('playback-current-step');
const playbackTotalStepsLabel = document.getElementById('playback-total-steps');
const playbackSpeedSelect = document.getElementById('playback-speed');

const simStepBadge = document.getElementById('sim-step-badge');
const simStepTitle = document.getElementById('sim-step-title');
const simReasoning = document.getElementById('sim-reasoning');
const simAction = document.getElementById('sim-action');
const simOutput = document.getElementById('sim-output');
const simChecklist = document.getElementById('sim-checklist');
const simCheckpoint = document.getElementById('sim-checkpoint');

const jsonInspector = document.getElementById('json-inspector');
const btnCopyJson = document.getElementById('btn-copy-json');

const sidecarModal = document.getElementById('sidecar-modal');
const sidecarFileContent = document.getElementById('sidecar-file-content');
const btnCloseModal = document.getElementById('btn-close-modal');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  fetchData();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  // Playback controls
  btnPlay.addEventListener('click', togglePlay);
  btnPrev.addEventListener('click', stepPrev);
  btnNext.addEventListener('click', stepNext);
  btnReset.addEventListener('click', resetPlayback);
  playbackSlider.addEventListener('input', (e) => {
    setCurrentStep(parseInt(e.target.value));
    if (isPlaying) pause();
  });

  // Tabs navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Toggle button active state
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Toggle tab content active state
      const targetTabId = `tab-${btn.dataset.tab}`;
      const tabPanes = document.querySelectorAll('.tab-pane');
      tabPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === targetTabId) {
          pane.classList.add('active');
        }
      });

      // Special re-draw checks for charts or mermaid
      if (btn.dataset.tab === 'analytics') {
        setTimeout(drawCharts, 50);
      } else if (btn.dataset.tab === 'mermaid') {
        setTimeout(initMermaid, 50);
      }
    });
  });

  // Copy JSON button
  btnCopyJson.addEventListener('click', () => {
    const jsonStr = jsonInspector.textContent;
    navigator.clipboard.writeText(jsonStr).then(() => {
      const originalText = btnCopyJson.innerHTML;
      btnCopyJson.innerHTML = '<i data-lucide="check"></i> Copied!';
      lucide.createIcons();
      setTimeout(() => {
        btnCopyJson.innerHTML = originalText;
        lucide.createIcons();
      }, 1500);
    });
  });

  // Modal close
  btnCloseModal.addEventListener('click', () => {
    sidecarModal.classList.remove('active');
  });
  window.addEventListener('click', (e) => {
    if (e.target === sidecarModal) {
      sidecarModal.classList.remove('active');
    }
  });

  // Render Mermaid button
  document.getElementById('btn-render-mmd').addEventListener('click', initMermaid);
}

// Fetch Log Flow Data
async function fetchData() {
  try {
    const response = await fetch('./flow_data.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    flowData = await response.json();
    populateOverview();
    renderTimeline();
    setupPlaybackSlider();
    setCurrentStep(0);
    setTimeout(initMermaid, 200);
  } catch (error) {
    console.error('Error fetching flow_data.json:', error);
    initialPrompt.textContent = 'Error loading data: Please make sure parser.js has run successfully.';
    initialPrompt.style.color = '#f43f5e';
  }
}

// Format duration from MS
function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

// Populate Header and Overview Stats
function populateOverview() {
  if (!flowData) return;

  const { stats, model, prompt, taskId } = flowData;

  taskIdBadge.textContent = `Task ID: ${taskId}`;
  if (model) {
    modelBadge.textContent = `${model.modelId} (${model.mode})`;
  } else {
    modelBadge.textContent = 'Unknown Model';
  }

  initialPrompt.textContent = prompt;

  statDuration.textContent = formatDuration(stats.durationMs);
  statTokens.textContent = `${stats.totalTokensIn.toLocaleString()} / ${stats.totalTokensOut.toLocaleString()}`;
  
  const cacheHitRate = stats.totalCacheReads > 0 
    ? ((stats.totalCacheReads / (stats.totalCacheReads + stats.totalCacheWrites)) * 100).toFixed(1) + '%' 
    : '0%';
  statCache.textContent = `${cacheHitRate} (${stats.totalCacheReads.toLocaleString()} reads)`;
  statSteps.textContent = `${stats.totalSteps} Turns`;
}

// Set up Playback Slider max range
function setupPlaybackSlider() {
  if (!flowData || !flowData.turns.length) return;
  playbackSlider.max = flowData.turns.length - 1;
  playbackTotalStepsLabel.textContent = `/ Turn ${flowData.turns.length - 1}`;
}

// Get icon by event type/action kind
function getIconForStep(step) {
  if (step.index === 0) return 'play-circle';
  if (step.actions && step.actions.length > 0) {
    const action = step.actions[0];
    if (action.kind === 'command') return 'terminal';
    if (action.kind === 'tool') return 'wrench';
  }
  if (step.checkpoint) return 'shield-check';
  return 'cpu';
}

// Render Left Panel Timeline
function renderTimeline() {
  if (!flowData) return;

  timelineList.innerHTML = '';
  flowData.turns.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.dataset.index = idx;
    
    // Determine classes and type
    let itemKindClass = 'item-reasoning';
    let label = 'Reasoning';
    if (idx === 0) {
      itemKindClass = 'item-task';
      label = 'Start Task';
    } else if (step.actions && step.actions.length > 0) {
      const action = step.actions[0];
      if (action.kind === 'command') {
        itemKindClass = 'item-command';
        label = 'Run Command';
      } else {
        itemKindClass = 'item-tool';
        label = `Tool: ${action.what.tool || 'Action'}`;
      }
    } else if (step.checkpoint) {
      itemKindClass = 'item-checkpoint';
      label = 'Checkpoint';
    }

    item.classList.add(itemKindClass);

    // Get time elapsed
    const elapsed = idx === 0 ? '0s' : `+${Math.round((step.tsStart - flowData.turns[0].tsStart) / 1000)}s`;

    // Short description
    let desc = step.reasoning ? step.reasoning.preview : 'Processing...';
    if (step.actions && step.actions.length > 0) {
      const firstAct = step.actions[0];
      desc = firstAct.kind === 'command' ? firstAct.what.command : `Call ${firstAct.what.tool}`;
    }

    item.innerHTML = `
      <div class="timeline-icon-box">
        <i data-lucide="${getIconForStep(step)}"></i>
      </div>
      <div class="timeline-info">
        <div class="timeline-meta">
          <span class="timeline-step">TURN ${step.index}</span>
          <span class="timeline-time">${elapsed}</span>
        </div>
        <div class="timeline-title">${label}</div>
        <div class="timeline-desc">${desc}</div>
      </div>
    `;

    item.addEventListener('click', () => {
      setCurrentStep(idx);
      if (isPlaying) pause();
    });

    timelineList.appendChild(item);
  });

  lucide.createIcons();
}

// Set current step and update UI
function setCurrentStep(idx) {
  if (!flowData || idx < 0 || idx >= flowData.turns.length) return;

  currentStepIndex = idx;
  playbackSlider.value = idx;
  playbackCurrentStepLabel.textContent = `Turn ${idx}`;

  // Update active timeline item styling
  const items = timelineList.querySelectorAll('.timeline-item');
  items.forEach((item, index) => {
    if (index === idx) {
      item.classList.add('active');
      // Scroll into view if needed
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });

  updateActiveStepDetails();
}

// Render Sidecar view helper
function renderTextBlockHTML(block, kind, idSuffix) {
  if (!block) return '<span class="text-muted">No data available</span>';
  let html = `<div class="block-preview-text">${block.preview}</div>`;
  if (block.sidecar) {
    html += `
      <div style="margin-top: 8px;">
        <span class="sidecar-link" onclick="openSidecarModal('${block.sidecar}')">
          <i data-lucide="external-link" style="width:14px;height:14px;"></i> View full (${block.fullLen} chars)
        </span>
      </div>
    `;
  }
  return html;
}

// Update Right Panel Simulator view
function updateActiveStepDetails() {
  if (!flowData || !flowData.turns.length) return;

  const step = flowData.turns[currentStepIndex];

  // Headings
  simStepBadge.textContent = `Turn ${step.index}`;
  const elapsed = currentStepIndex === 0 ? 'Start' : `+${Math.round((step.tsStart - flowData.turns[0].tsStart) / 1000)}s`;
  
  let typeLabel = 'Analysis & Reasoning Step';
  if (step.actions && step.actions.length > 0) {
    typeLabel = step.actions[0].kind === 'command' ? 'Execute Terminal Command' : 'Call Extension Tool';
  }
  simStepTitle.textContent = `${typeLabel} (${elapsed})`;

  // Reasoning
  if (step.reasoning) {
    simReasoning.innerHTML = renderTextBlockHTML(step.reasoning, 'reasoning', step.index);
  } else {
    simReasoning.innerHTML = '<span class="text-muted">This step does not contain reasoning logic.</span>';
  }

  // Action
  if (step.actions && step.actions.length > 0) {
    let actionHTML = '';
    step.actions.forEach((a, ai) => {
      const what = a.kind === 'tool' ? `${a.what.tool} (${JSON.stringify(a.what.path || '')})` : a.what.command;
      actionHTML += `
        <div class="action-item-box" style="margin-bottom: ${ai < step.actions.length - 1 ? '12px' : '0'}">
          <div><strong style="color:var(--amber);">Kind:</strong> <span class="badge badge-amber">${a.kind}</span></div>
          <div style="margin-top: 6px;"><strong style="color:var(--amber);">Command/Tool:</strong> <code>${what}</code></div>
          ${a.why ? `<div style="margin-top: 6px; font-style:italic;"><strong style="color:var(--cyan);">Intent:</strong> ${a.why}</div>` : ''}
          <div style="margin-top: 8px;">${renderTextBlockHTML(a.text, `action_${a.kind}`, `${step.index}_${ai}`)}</div>
        </div>
      `;
    });
    simAction.innerHTML = actionHTML;
  } else {
    simAction.innerHTML = '<span class="text-muted">No actions were called during this Turn.</span>';
  }

  // Output
  if (step.actions && step.actions.length > 0) {
    let outputHTML = '';
    step.actions.forEach((a, ai) => {
      if (a.output) {
        outputHTML += `
          <div class="output-item-box">
            ${renderTextBlockHTML(a.output, 'output', `${step.index}_${ai}_out`)}
          </div>
        `;
      }
    });
    simOutput.innerHTML = outputHTML || '<span class="text-muted">No output results returned during this Turn.</span>';
  } else {
    // If it's the last turn or task completion
    if (flowData.completion && flowData.completion.preview && currentStepIndex === flowData.turns.length - 1) {
      simOutput.innerHTML = `
        <div style="border-left: 3px solid var(--emerald); padding-left: 12px;">
          <h4 style="color:var(--emerald); margin-bottom: 6px;">Task Completed (Completion Result):</h4>
          ${renderTextBlockHTML(flowData.completion, 'completion', 'final')}
        </div>
      `;
    } else {
      simOutput.innerHTML = '<span class="text-muted">No output results returned during this Turn.</span>';
    }
  }

  // Checklist
  if (step.taskProgress && step.taskProgress.items && step.taskProgress.items.length > 0) {
    simChecklist.innerHTML = '';
    step.taskProgress.items.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = it.done 
        ? `<i data-lucide="check-circle" class="icon-done" style="width:14px;height:14px;flex-shrink:0;"></i> <s>${it.text}</s>`
        : `<i data-lucide="circle" class="icon-todo" style="width:14px;height:14px;flex-shrink:0;"></i> <span>${it.text}</span>`;
      simChecklist.appendChild(li);
    });
  } else {
    simChecklist.innerHTML = '<li class="text-muted">No checklist available or unchanged</li>';
  }

  // Checkpoint
  if (step.checkpoint && step.checkpoint.hash) {
    simCheckpoint.innerHTML = `
      <span class="hash" title="SHA-1 Git commit hash">${step.checkpoint.hash.substring(0, 7)}</span>
      ${step.checkpoint.checkedOut ? '<span class="badge badge-indigo">Checked Out</span>' : ''}
    `;
  } else {
    simCheckpoint.innerHTML = '<span class="text-muted">No Git checkpoint</span>';
  }

  // Raw Inspector Tab update
  jsonInspector.textContent = JSON.stringify(step, null, 2);

  lucide.createIcons();
}

// Fetch sidecar content and open modal
async function openSidecarModal(sidecarPath) {
  sidecarFileContent.textContent = 'Loading sidecar file content...';
  sidecarModal.classList.add('active');
  try {
    const res = await fetch(`./${sidecarPath}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();
    sidecarFileContent.textContent = text;
  } catch (e) {
    console.error('Error reading sidecar file:', e);
    sidecarFileContent.textContent = `Error: Failed to load sidecar file at ./${sidecarPath}\nThe file might not have been created or the path is incorrect.`;
  }
}

// Make openSidecarModal available globally on window so HTML onClick works
window.openSidecarModal = openSidecarModal;

// Playback Player Loop
function togglePlay() {
  if (isPlaying) {
    pause();
  } else {
    play();
  }
}

function play() {
  if (isPlaying) return;

  // If we are at the end, reset to 0
  if (currentStepIndex >= flowData.turns.length - 1) {
    setCurrentStep(0);
  }

  isPlaying = true;
  btnPlay.innerHTML = '<i data-lucide="pause"></i> Pause';
  lucide.createIcons();

  const speed = parseInt(playbackSpeedSelect.value);
  playbackInterval = setInterval(() => {
    if (currentStepIndex < flowData.turns.length - 1) {
      setCurrentStep(currentStepIndex + 1);
    } else {
      pause();
    }
  }, speed);
}

function pause() {
  if (!isPlaying) return;
  isPlaying = false;
  btnPlay.innerHTML = '<i data-lucide="play"></i> Play';
  lucide.createIcons();
  clearInterval(playbackInterval);
}

function stepNext() {
  if (currentStepIndex < flowData.turns.length - 1) {
    setCurrentStep(currentStepIndex + 1);
  }
  if (isPlaying) pause();
}

function stepPrev() {
  if (currentStepIndex > 0) {
    setCurrentStep(currentStepIndex - 1);
  }
  if (isPlaying) pause();
}

function resetPlayback() {
  setCurrentStep(0);
  if (isPlaying) pause();
}

// Draw performance charts
function drawCharts() {
  if (!flowData) return;

  const turns = flowData.turns;
  const labels = turns.map(t => `T${t.index}`);

  // Chart 1: Cumulative Tokens
  let cumTokensIn = 0;
  let cumTokensOut = 0;
  const dataTokensIn = [];
  const dataTokensOut = [];

  turns.forEach(t => {
    cumTokensIn += t.request.tokensIn;
    cumTokensOut += t.request.tokensOut;
    dataTokensIn.push(cumTokensIn);
    dataTokensOut.push(cumTokensOut);
  });

  if (tokenChartInstance) tokenChartInstance.destroy();
  const ctxToken = document.getElementById('tokenChart').getContext('2d');
  tokenChartInstance = new Chart(ctxToken, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Tokens In (Cumulative)',
          data: dataTokensIn,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.05)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Tokens Out (Cumulative)',
          data: dataTokensOut,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#94a3b8' } }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  // Chart 2: Cumulative Cost
  let cumCost = 0;
  const dataCost = [];
  turns.forEach(t => {
    cumCost += t.request.cost;
    dataCost.push(cumCost);
  });

  if (costChartInstance) costChartInstance.destroy();
  const ctxCost = document.getElementById('costChart').getContext('2d');
  costChartInstance = new Chart(ctxCost, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Cost (USD)',
        data: dataCost,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.05)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#94a3b8' } }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  // Chart 3: Cache Reads vs Writes Pie
  if (cacheChartInstance) cacheChartInstance.destroy();
  const ctxCache = document.getElementById('cacheChart').getContext('2d');
  cacheChartInstance = new Chart(ctxCache, {
    type: 'doughnut',
    data: {
      labels: ['Cache Reads', 'Cache Writes'],
      datasets: [{
        data: [flowData.totals.cacheReads, flowData.totals.cacheWrites],
        backgroundColor: ['#10b981', '#f43f5e'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#94a3b8' } }
      }
    }
  });
}

// Render Mermaid Diagram
function initMermaid() {
  if (!flowData || !flowData.mermaid) return;
  const mermaidBox = document.getElementById('mermaid-code');
  mermaidBox.removeAttribute('data-processed');
  mermaidBox.textContent = flowData.mermaid;
  try {
    mermaid.init(undefined, mermaidBox);
  } catch (err) {
    console.error('Mermaid render error:', err);
  }
}

// Initialize Mermaid.js
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose'
});
