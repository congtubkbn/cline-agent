// App State
let flowData = null;
let currentStepIndex = 0;
let playbackInterval = null;
let isPlaying = false;
let tokenChartInstance = null;
let costChartInstance = null;
let cacheChartInstance = null;
let currentTaskId = null;
let refreshTimer = null;
let lastParsedAt = null;
let pendingParsedAt = null;
let dismissedParsedAt = null;
let isRefreshing = false;
let currentTimelineFilter = 'all';
let currentSearchQuery = '';

// Threshold Settings (default values)
let thresholdSettings = {
  timeWarning: 30,
  timeError: 90,
  tokenWarning: 5000,
  tokenError: 10000,
  // Error source toggles — which sources contribute to Warning/Error counts
  enableTimeThreshold: true,
  enableTokenThreshold: true,
  enableParserErrors: true,
  githubRepo: '' // Default empty
};

// Load thresholds from localStorage
function loadThresholdSettings() {
  try {
    const saved = localStorage.getItem('analyzerThresholds');
    if (saved) {
      thresholdSettings = { ...thresholdSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Error loading thresholds:', e);
  }
}
loadThresholdSettings();

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
const simStepStats = document.getElementById('sim-step-stats');
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

const taskSelectorContainer = document.getElementById('task-selector-container');
const taskSelect = document.getElementById('task-select');

const refreshControlsContainer = document.getElementById('refresh-controls-container');
const refreshIntervalSelect = document.getElementById('refresh-interval-select');
const refreshModeSelect = document.getElementById('refresh-mode-select');
const updateBanner = document.getElementById('update-banner');
const btnBannerReload = document.getElementById('btn-banner-reload');
const btnBannerDismiss = document.getElementById('btn-banner-dismiss');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  setupThemeSwitcher();
  fetchData();
  setupEventListeners();
  if (window.lucide) lucide.createIcons();

  // Initialize Pan & Zoom on both diagram containers
  const ftaContainer = document.querySelector('#tab-analysis .mermaid-render-box');
  if (ftaContainer) enablePanAndZoom(ftaContainer);
  
  const mmdContainer = document.querySelector('#tab-mermaid .mermaid-render-box');
  // Listen to hash changes (browser back/forward or manual hash edits)
  window.addEventListener('hashchange', () => {
    const t = getTurnFromHash();
    if (t !== null && flowData && t !== currentStepIndex) {
      setCurrentStep(Math.max(0, Math.min(t, flowData.turns.length - 1)));
    }
  });
});

// ===== Theme switching =====
const THEMES = ['midnight', 'dev', 'light', 'claude'];
// Which Mermaid built-in theme pairs with each app theme.
const MERMAID_THEME = { midnight: 'dark', dev: 'dark', light: 'default', claude: 'neutral' };

function getActiveTheme() {
  return document.documentElement.getAttribute('data-theme') || 'midnight';
}

// Resolve a CSS custom property to a concrete color string (for canvas/mermaid,
// which can't read CSS variables themselves).
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'midnight';
  document.documentElement.setAttribute('data-theme', name);
  try { localStorage.setItem('analyzerTheme', name); } catch (e) {}

  // Reflect active state on the switcher buttons.
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === name);
  });

  // Canvas charts and Mermaid diagrams bake colors in at render time, so
  // re-render them against the new token values.
  mermaid.initialize({ startOnLoad: false, theme: MERMAID_THEME[name], securityLevel: 'loose' });
  if (flowData) {
    drawCharts();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'mermaid') initMermaid();
    else if (activeTab === 'analysis') initFtaMermaid();
  }
}

function setupThemeSwitcher() {
  let saved = 'midnight';
  try { saved = localStorage.getItem('analyzerTheme') || 'midnight'; } catch (e) {}
  applyTheme(saved);

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeVal));
  });
}

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

  // Task selector change
  if (taskSelect) {
    taskSelect.addEventListener('change', async (e) => {
      const selectedId = e.target.value;
      localStorage.setItem('selectedTaskId', selectedId);
      currentTaskId = selectedId;
      if (isPlaying) pause();

      // Switching tasks invalidates any pending/dismissed update from the previous task
      pendingParsedAt = null;
      dismissedParsedAt = null;
      hideUpdateBanner();

      try {
        await loadTaskData(currentTaskId);
        lastParsedAt = await fetchParsedAt(currentTaskId);
      } catch (err) {
        console.error('Error switching task:', err);
        alert('Failed to load selected task data.');
      }
    });
  }

  // Auto-refresh interval/mode selectors
  if (refreshIntervalSelect) {
    refreshIntervalSelect.addEventListener('change', (e) => {
      const intervalMs = parseInt(e.target.value, 10) || 0;
      const { mode } = getRefreshSettings();
      saveRefreshSettings({ intervalMs, mode });
      if (refreshModeSelect) refreshModeSelect.disabled = intervalMs === 0;
      hideUpdateBanner();
      armRefreshTimer();
    });
  }
  if (refreshModeSelect) {
    refreshModeSelect.addEventListener('change', (e) => {
      const { intervalMs } = getRefreshSettings();
      saveRefreshSettings({ intervalMs, mode: e.target.value });
    });
  }

  // Update banner actions (Ask mode)
  if (btnBannerReload) {
    btnBannerReload.addEventListener('click', applyPendingRefresh);
  }
  if (btnBannerDismiss) {
    btnBannerDismiss.addEventListener('click', () => {
      dismissedParsedAt = pendingParsedAt;
      hideUpdateBanner();
    });
  }
  // Timeline filters
  const filterButtons = document.querySelectorAll('.btn-filter');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTimelineFilter = btn.dataset.filter || 'all';
      applyTimelineFilter();
    });
  });
  // Timeline search
  const timelineSearch = document.getElementById('timeline-search');
  if (timelineSearch) {
    timelineSearch.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.toLowerCase().trim();
      applyTimelineFilter();
    });
  }

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
      } else if (btn.dataset.tab === 'analysis') {
        setTimeout(initFtaMermaid, 50);
      }
    });
  });

  // Raise GitHub Issue for current Turn button
  const btnRaiseIssue = document.getElementById('btn-raise-issue');
  if (btnRaiseIssue) {
    btnRaiseIssue.addEventListener('click', () => {
      createGitHubIssueForTurn(currentStepIndex);
    });
  }

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

  // Render FTA diagram button
  document.getElementById('btn-render-fta').addEventListener('click', initFtaMermaid);

  // Settings Modal Events
  const settingsModal = document.getElementById('settings-modal');
  const btnSettingsOpen = document.getElementById('btn-settings-open');
  const btnSettingsClose = document.getElementById('btn-settings-close');
  const btnSettingsSave = document.getElementById('btn-settings-save');
  const btnSettingsReset = document.getElementById('btn-settings-reset');

  const setTimeWarning = document.getElementById('set-time-warning');
  const setTimeError = document.getElementById('set-time-error');
  const setTokenWarning = document.getElementById('set-token-warning');
  const setTokenError = document.getElementById('set-token-error');
  const setEnableTime = document.getElementById('set-enable-time');
  const setEnableToken = document.getElementById('set-enable-token');
  const setEnableErrors = document.getElementById('set-enable-errors');
  const setGithubRepo = document.getElementById('set-github-repo');

  // Helper: grey-out threshold inputs when the source toggle is OFF
  function syncThresholdDisabledState() {
    const timeOff = setEnableTime && !setEnableTime.checked;
    const tokenOff = setEnableToken && !setEnableToken.checked;
    [setTimeWarning, setTimeError].forEach(el => { if (el) el.disabled = timeOff; });
    [setTokenWarning, setTokenError].forEach(el => { if (el) el.disabled = tokenOff; });
    document.querySelectorAll('.threshold-group-time').forEach(el => el.classList.toggle('source-disabled', timeOff));
    document.querySelectorAll('.threshold-group-token').forEach(el => el.classList.toggle('source-disabled', tokenOff));
  }

  if (setEnableTime)  setEnableTime.addEventListener('change',  syncThresholdDisabledState);
  if (setEnableToken) setEnableToken.addEventListener('change', syncThresholdDisabledState);

  if (btnSettingsOpen && settingsModal) {
    btnSettingsOpen.addEventListener('click', () => {
      // Load current threshold values into inputs
      setTimeWarning.value = thresholdSettings.timeWarning;
      setTimeError.value = thresholdSettings.timeError;
      setTokenWarning.value = thresholdSettings.tokenWarning;
      setTokenError.value = thresholdSettings.tokenError;
      // Load toggle states and github repo
      if (setEnableTime)   setEnableTime.checked   = thresholdSettings.enableTimeThreshold;
      if (setEnableToken)  setEnableToken.checked  = thresholdSettings.enableTokenThreshold;
      if (setEnableErrors) setEnableErrors.checked = thresholdSettings.enableParserErrors;
      if (setGithubRepo)   setGithubRepo.value     = thresholdSettings.githubRepo || '';
      syncThresholdDisabledState();
      settingsModal.classList.add('active');
    });
  }

  if (btnSettingsClose && settingsModal) {
    btnSettingsClose.addEventListener('click', () => {
      settingsModal.classList.remove('active');
    });
  }

  window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('active');
    }
  });

  if (btnSettingsSave && settingsModal) {
    btnSettingsSave.addEventListener('click', () => {
      thresholdSettings.timeWarning = parseInt(setTimeWarning.value, 10) || 30;
      thresholdSettings.timeError = parseInt(setTimeError.value, 10) || 90;
      thresholdSettings.tokenWarning = parseInt(setTokenWarning.value, 10) || 5000;
      thresholdSettings.tokenError = parseInt(setTokenError.value, 10) || 10000;
      // Save toggle states and github repo
      thresholdSettings.enableTimeThreshold  = setEnableTime   ? setEnableTime.checked   : true;
      thresholdSettings.enableTokenThreshold = setEnableToken  ? setEnableToken.checked  : true;
      thresholdSettings.enableParserErrors   = setEnableErrors ? setEnableErrors.checked : true;
      thresholdSettings.githubRepo           = setGithubRepo   ? setGithubRepo.value.trim() : '';

      try {
        localStorage.setItem('analyzerThresholds', JSON.stringify(thresholdSettings));
      } catch (e) {
        console.error('Error saving thresholds:', e);
      }

      settingsModal.classList.remove('active');
      
      // Re-apply timeline filters since threshold values changed
      applyTimelineFilter();
    });
  }

  if (btnSettingsReset) {
    btnSettingsReset.addEventListener('click', () => {
      setTimeWarning.value = 30;
      setTimeError.value = 90;
      setTokenWarning.value = 5000;
      setTokenError.value = 10000;
      if (setEnableTime)   setEnableTime.checked   = true;
      if (setEnableToken)  setEnableToken.checked  = true;
      if (setEnableErrors) setEnableErrors.checked = true;
      if (setGithubRepo)   setGithubRepo.value     = '';
      syncThresholdDisabledState();
    });
  }
}

// Parse turn index from URL hash (e.g. #turn-5 or #5)
function getTurnFromHash() {
  const hash = window.location.hash;
  if (!hash) return null;
  const m = hash.match(/^#?(?:turn-)?(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Sync current step to URL hash without adding excessive browser history entries
function updateUrlHash(index) {
  const targetHash = `#turn-${index}`;
  if (window.location.hash !== targetHash) {
    history.replaceState(null, '', targetHash);
  }
}

// Fetch flow_data.json for one task and (re)render every panel that depends on it.
// preserveStep keeps the current playback position (clamped to the new turn
// count) instead of jumping back to turn 0 — used by auto-refresh so a
// mid-review session isn't yanked back to the start on every poll.
async function loadTaskData(taskId, { preserveStep = false } = {}) {
  const prevIndex = currentStepIndex;
  const response = await fetch(`./tasks/${encodeURIComponent(taskId)}/flow_data.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  flowData = await response.json();
  populateOverview();
  renderAnalysisPanel();
  renderTimeline();
  setupPlaybackSlider();

  const hashTurn = getTurnFromHash();
  let initialTurn = 0;
  if (preserveStep) {
    initialTurn = Math.max(0, Math.min(prevIndex, flowData.turns.length - 1));
  } else if (hashTurn !== null) {
    initialTurn = Math.max(0, Math.min(hashTurn, flowData.turns.length - 1));
  }

  setCurrentStep(initialTurn);
  setTimeout(initMermaid, 200);
}

// Look up the catalog's parsedAt for a task, used to detect new analysis data.
// Uses /api/tasks/:id/meta (single entry, ~200 B) instead of the full tasks.json
// so polling stays cheap even as the catalog grows.
async function fetchParsedAt(taskId) {
  try {
    const response = await fetch(`./api/tasks/${encodeURIComponent(taskId)}/meta`, { cache: 'no-store' });
    if (!response.ok) return null;
    const entry = await response.json();
    return entry.parsedAt ?? null;
  } catch (e) {
    return null;
  }
}

// Fetch Log Flow Data
async function fetchData() {
  try {
    // 1. Try to load tasks list
    let tasksList = [];
    try {
      const response = await fetch('./tasks.json');
      if (response.ok) {
        tasksList = await response.json();
      }
    } catch (e) {
      console.log('No tasks.json catalog found, falling back to legacy flow_data.json');
    }

    if (tasksList && tasksList.length > 0) {
      taskSelectorContainer.style.display = 'flex';
      refreshControlsContainer.style.display = 'flex';
      taskSelect.innerHTML = '';

      tasksList.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.taskId;
        const durationSec = Math.round((t.totals?.durationMs || 0) / 1000);
        opt.textContent = `${t.taskId} - ${t.model} - ${t.totals?.turns} turns (${durationSec}s)`;
        taskSelect.appendChild(opt);
      });

      // Restore last selected task or default to first
      let lastTaskId = localStorage.getItem('selectedTaskId');
      if (!lastTaskId || !tasksList.some(t => t.taskId === lastTaskId)) {
        lastTaskId = tasksList[0].taskId;
      }
      taskSelect.value = lastTaskId;
      currentTaskId = lastTaskId;

      await loadTaskData(currentTaskId);
      const entry = tasksList.find(t => t.taskId === currentTaskId);
      lastParsedAt = entry ? entry.parsedAt : null;
      initAutoRefreshControls();
    } else {
      taskSelectorContainer.style.display = 'none';
      refreshControlsContainer.style.display = 'none';
      currentTaskId = null;

      const response = await fetch('./flow_data.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      flowData = await response.json();
      populateOverview();
      renderAnalysisPanel();
      renderTimeline();
      setupPlaybackSlider();
      setCurrentStep(0);
      // Only render diagram tabs if they are currently visible — rendering
      // into a hidden element (display:none) gives Mermaid no dimensions to
      // work with, producing a blank or clipped SVG on first switch.
      const _activeTabOnLoad = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (_activeTabOnLoad === 'mermaid') setTimeout(initMermaid, 200);
      else if (_activeTabOnLoad === 'analysis') setTimeout(initFtaMermaid, 200);
    }
  } catch (error) {
    console.error('Error fetching flow data:', error);
    initialPrompt.textContent = 'Error loading data: Please make sure parser.js has run successfully.';
    initialPrompt.style.color = '#f43f5e';
  }
}

// ===== Auto-refresh =====
function getRefreshSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('analyzerAutoRefresh'));
    if (saved && typeof saved.intervalMs === 'number' && (saved.mode === 'auto' || saved.mode === 'ask')) {
      return saved;
    }
  } catch (e) {}
  return { intervalMs: 0, mode: 'ask' };
}

function saveRefreshSettings(settings) {
  try { localStorage.setItem('analyzerAutoRefresh', JSON.stringify(settings)); } catch (e) {}
}

function initAutoRefreshControls() {
  const { intervalMs, mode } = getRefreshSettings();
  if (refreshIntervalSelect) refreshIntervalSelect.value = String(intervalMs);
  if (refreshModeSelect) {
    refreshModeSelect.value = mode;
    refreshModeSelect.disabled = intervalMs === 0;
  }
  armRefreshTimer();
}

function armRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  const { intervalMs } = getRefreshSettings();
  if (intervalMs > 0) {
    refreshTimer = setInterval(checkForUpdates, intervalMs);
  }
}

function showUpdateBanner() {
  if (updateBanner) updateBanner.classList.add('visible');
}

function hideUpdateBanner() {
  if (updateBanner) updateBanner.classList.remove('visible');
}

async function checkForUpdates() {
  // isRefreshing keeps slow reloads from overlapping: with a large
  // flow_data.json and a short interval, a second tick could otherwise start
  // a concurrent loadTaskData and interleave renders/lastParsedAt updates.
  if (!currentTaskId || isRefreshing) return;
  isRefreshing = true;
  try {
    const newParsedAt = await fetchParsedAt(currentTaskId);
    if (!newParsedAt || newParsedAt === lastParsedAt) return;

    const { mode } = getRefreshSettings();
    if (mode === 'auto') {
      // Don't re-render under an active playback — the playback timer would
      // fight the refreshed panels. The next tick applies the update instead.
      if (isPlaying) return;
      await loadTaskData(currentTaskId, { preserveStep: true });
      lastParsedAt = newParsedAt;
      hideUpdateBanner();
    } else if (dismissedParsedAt !== newParsedAt) {
      pendingParsedAt = newParsedAt;
      showUpdateBanner();
    }
  } catch (e) {
    console.error('Auto-refresh failed:', e);
  } finally {
    isRefreshing = false;
  }
}

async function applyPendingRefresh() {
  if (!currentTaskId || isRefreshing) return;
  isRefreshing = true;
  try {
    if (isPlaying) pause();
    await loadTaskData(currentTaskId, { preserveStep: true });
    lastParsedAt = pendingParsedAt;
    hideUpdateBanner();
  } catch (e) {
    console.error('Failed to apply refreshed data:', e);
  } finally {
    isRefreshing = false;
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

// Format local time HH:MM:SS from epoch MS
function formatLocalTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0')
  ].join(':');
}

// Format JSON text to wrap sidecar file paths in clickable elements
function formatJsonWithLinks(jsonStr) {
  let html = jsonStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Find "sidecar/..." strings and wrap them in a clickable span
  // e.g. "sidecar": "sidecar/0_req_request.txt"
  html = html.replace(/"(sidecar\/[^"]+)"/g, (match, p1) => {
    return `<span class="sidecar-link-inspect" onclick="openSidecarModal('${p1}')">"${p1}"</span>`;
  });
  
  return html;
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

  const elapsedStr = formatDuration(stats.durationMs);
  const activeDurationMs = flowData.turns.reduce((acc, t) => acc + (t.durationMs || 0), 0);
  const activeStr = formatDuration(activeDurationMs);
  const idleDurationMs = Math.max(0, stats.durationMs - activeDurationMs);
  const idleStr = formatDuration(idleDurationMs);

  statDuration.textContent = elapsedStr;
  
  const statActiveDuration = document.getElementById('stat-active-duration');
  if (statActiveDuration) {
    statActiveDuration.textContent = `Active: ${activeStr}`;
  }

  const durationCard = document.getElementById('card-duration');
  if (durationCard) {
    durationCard.setAttribute('title', `Tổng thời gian trôi qua: ${elapsedStr}\nThời gian AI hoạt động: ${activeStr}\nThời gian chờ/Idle: ${idleStr}`);
  }
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
  if (step.hasError || (step.errors && step.errors.length > 0)) return 'alert-triangle';
  if (step.index === 0) return 'play-circle';
  if (step.actions && step.actions.length > 0) {
    const action = step.actions[0];
    if (action.kind === 'command') {
      const cmd = action.what?.command || '';
      if (cmd.trim().startsWith('agent-browser')) {
        return 'globe';
      }
      return 'terminal';
    }
    if (action.kind === 'tool') return 'wrench';
  }
  if (step.checkpoint && (!step.reasoning || !step.reasoning.preview)) {
    return 'shield-check';
  }
  return 'message-square';
}

// Render Left Panel Timeline
function renderTimeline() {
  if (!flowData) return;

  const getBasename = (p) => {
    if (!p) return '';
    return p.split(/[/\\]/).pop();
  };

  const getToolLabel = (action) => {
    const tool = action.what?.tool;
    const filePath = action.what?.path;
    const baseName = getBasename(filePath);
    
    switch (tool) {
      case 'readFile':
      case 'read_file':
        return `[read_file for "${baseName || filePath || ''}"]`;
      case 'writeFile':
      case 'write_to_file':
        return `[write_to_file for "${baseName || filePath || ''}"]`;
      case 'replace_file_content':
        return `[replace_file_content for "${baseName || filePath || ''}"]`;
      case 'grep_search':
        return `[grep_search for "${action.what?.query || ''}"]`;
      case 'list_dir':
        return `[list_dir for "${baseName || filePath || '.'}"]`;
      case 'useSkill':
        return `[use_skill for "${action.what?.path || ''}"]`;
      case 'ask_question':
        return '[ask_question]';
      default:
        return `[${tool || 'action'}]`;
    }
  };

  const getCommandLabel = (action) => {
    const cmd = action.what?.command || '';
    if (!cmd) return '[execute_command]';
    const trimmed = cmd.trim();
    const firstLine = trimmed.split('\n')[0].trim();
    const maxLen = 35;
    const truncated = firstLine.length > maxLen ? firstLine.slice(0, maxLen - 3) + '...' : firstLine;
    return `[execute_command for '${truncated}']`;
  };

  const getRequestPreview = (request) => {
    let text = request?.text?.summary || request?.text?.preview || '';
    if (!text) return '';
    
    // Clean up JSON strings if it starts with {"request":...}
    if (text.startsWith('{"request":')) {
      try {
        const parsed = JSON.parse(text);
        text = parsed.request || text;
      } catch (e) {}
    }
    
    // Replace newlines with spaces for single-line display
    let cleaned = text.replace(/\r?\n/g, ' ').trim();
    
    // Truncate to exactly 50 chars
    const maxLen = 50;
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
  };

  let warningCount = 0;
  let errorCount = 0;
  const totalCount = flowData.turns.length;

  timelineList.innerHTML = '';
  flowData.turns.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.dataset.index = idx;
    
    // Determine classes and type
    let itemKindClass = 'item-reasoning';
    let label = getRequestPreview(step.request) || 'Reasoning / Chat';
    
    if (step.hasError || (step.errors && step.errors.length > 0)) {
      itemKindClass = 'item-error';
    } else if (idx === 0) {
      itemKindClass = 'item-task';
      label = 'Start Task';
    } else if (step.actions && step.actions.length > 0) {
      const action = step.actions[0];
      if (action.kind === 'command') {
        itemKindClass = 'item-command';
      } else {
        itemKindClass = 'item-tool';
      }
    } else if (step.checkpoint && (!step.reasoning || !step.reasoning.preview)) {
      itemKindClass = 'item-checkpoint';
    }

    item.classList.add(itemKindClass);

    // Calculate anomaly levels for time & token in
    const durationSec = (step.durationMs || 0) / 1000;
    const tokensIn = (step.request && step.request.tokensIn) || 0;

    let timeLevel = 'safe';
    if (durationSec >= thresholdSettings.timeWarning && durationSec <= thresholdSettings.timeError) {
      timeLevel = 'warning';
    } else if (durationSec > thresholdSettings.timeError) {
      timeLevel = 'error';
    }

    let tokenLevel = 'safe';
    if (tokensIn >= thresholdSettings.tokenWarning && tokensIn <= thresholdSettings.tokenError) {
      tokenLevel = 'warning';
    } else if (tokensIn > thresholdSettings.tokenError) {
      tokenLevel = 'error';
    }

    item.dataset.timeLevel = timeLevel;
    item.dataset.tokenLevel = tokenLevel;

    // Count warnings and errors — respect per-source toggles
    const isErr = (
      (thresholdSettings.enableTimeThreshold  && timeLevel === 'error')  ||
      (thresholdSettings.enableTokenThreshold && tokenLevel === 'error') ||
      (thresholdSettings.enableParserErrors   && (step.hasError || (step.errors && step.errors.length > 0)))
    );
    const isWarn = (
      (thresholdSettings.enableTimeThreshold  && timeLevel === 'warning') ||
      (thresholdSettings.enableTokenThreshold && tokenLevel === 'warning')
    );
    if (isErr) errorCount++;
    if (isWarn) warningCount++;

    const timeStatusClass = `status-${timeLevel}`;
    const tokenStatusClass = `status-${tokenLevel}`;

    // Get time elapsed and turn duration
    const elapsed = idx === 0 ? '0s' : `+${Math.round((step.tsStart - flowData.turns[0].tsStart) / 1000)}s`;
    const turnDuration = idx === 0 ? '' : formatDuration(step.durationMs);
    const absoluteTime = step.tsStart ? new Date(step.tsStart).toLocaleString() : 'N/A';

    // Short description: focus on reasoning, fallback to action details
    let desc = 'Processing...';
    if (step.reasoning && step.reasoning.preview) {
      desc = step.reasoning.preview;
    } else if (step.actions && step.actions.length > 0) {
      const firstAct = step.actions[0];
      desc = firstAct.kind === 'command' ? firstAct.what.command : `Call ${firstAct.what.tool}`;
    } else if (step.checkpoint) {
      desc = 'Saved checkpoint.';
    } else {
      desc = 'Chatting...';
    }

    item.innerHTML = `
      <div class="timeline-info">
        <div class="timeline-meta">
          <div class="timeline-left">
            <span class="timeline-step">TURN ${step.index}</span>
            ${turnDuration ? `<span class="timeline-duration ${timeStatusClass}" title="Thời gian chạy: ${durationSec}s (${timeLevel.toUpperCase()})">(${turnDuration})</span>` : ''}
          </div>
          <div class="timeline-right">
            <span class="timeline-time" title="Tổng thời gian đã trôi qua: Lúc ${absoluteTime}">${elapsed}</span>
            ${step.request?.contextWindow ? `<span class="timeline-ctx ${tokenStatusClass}" title="Token In: ${tokensIn.toLocaleString()} tokens (${tokenLevel.toUpperCase()})">🪟 ${step.request.contextWindow.percent}%</span>` : ''}
          </div>
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

  // Update timeline filter button counts
  const btnAll = document.querySelector('.btn-filter[data-filter="all"]');
  const btnWarning = document.querySelector('.btn-filter[data-filter="warning"]');
  const btnError = document.querySelector('.btn-filter[data-filter="error"]');

  if (btnAll) btnAll.textContent = `All (${totalCount})`;
  if (btnWarning) btnWarning.innerHTML = `Warning (${warningCount}) ⚠️`;
  if (btnError) btnError.innerHTML = `Error (${errorCount}) ❌`;

  applyTimelineFilter();
  lucide.createIcons();
}

// Apply current timeline filter & search query
function applyTimelineFilter() {
  if (!timelineList || !flowData) return;
  const items = timelineList.querySelectorAll('.timeline-item');
  items.forEach(item => {
    const idx = parseInt(item.dataset.index, 10);
    const step = flowData.turns[idx];
    if (!step) return;

    // Check search query
    let matchesSearch = true;
    if (currentSearchQuery) {
      matchesSearch = false;
      const q = currentSearchQuery.toLowerCase();
      
      // Search in visible card text
      if (item.textContent.toLowerCase().includes(q)) {
        matchesSearch = true;
      }
      // Search in Turn Index
      else if (String(step.index).includes(q)) {
        matchesSearch = true;
      }
      // Search in Request Text (contains tool output and prompt)
      else if (step.request && step.request.text && (
        (step.request.text.preview && step.request.text.preview.toLowerCase().includes(q)) ||
        (step.request.text.summary && step.request.text.summary.toLowerCase().includes(q))
      )) {
        matchesSearch = true;
      }
      // Search in Reasoning Preview/Text
      else if (step.reasoning && (
        (step.reasoning.preview && step.reasoning.preview.toLowerCase().includes(q)) ||
        (step.reasoning.text && step.reasoning.text.toLowerCase().includes(q))
      )) {
        matchesSearch = true;
      }
      // Search in Actions
      else if (step.actions && step.actions.length > 0) {
        for (const act of step.actions) {
          const whatStr = act.kind === 'tool' 
            ? `${act.what.tool || ''} ${act.what.path || ''}` 
            : (act.what.command || '');
          if (whatStr.toLowerCase().includes(q) || 
              (act.why && act.why.toLowerCase().includes(q)) ||
              (act.text && act.text.preview && act.text.preview.toLowerCase().includes(q))) {
            matchesSearch = true;
            break;
          }
        }
      }
      // Search in general say texts
      else if (step.texts && step.texts.length > 0) {
        for (const x of step.texts) {
          if (x.text && x.text.toLowerCase().includes(q)) {
            matchesSearch = true;
            break;
          }
        }
      }
    }
    
    // Check anomaly filter — respect per-source toggles
    let matchesAnomaly = true;
    if (currentTimelineFilter === 'warning') {
      matchesAnomaly = (
        (thresholdSettings.enableTimeThreshold  && item.dataset.timeLevel === 'warning') ||
        (thresholdSettings.enableTokenThreshold && item.dataset.tokenLevel === 'warning')
      );
    } else if (currentTimelineFilter === 'error') {
      matchesAnomaly = (
        (thresholdSettings.enableTimeThreshold  && item.dataset.timeLevel === 'error')  ||
        (thresholdSettings.enableTokenThreshold && item.dataset.tokenLevel === 'error') ||
        (thresholdSettings.enableParserErrors   && (step.hasError || (step.errors && step.errors.length > 0)))
      );
    }

    const visible = matchesAnomaly && matchesSearch;
    if (visible) {
      item.classList.remove('filtered-out');
    } else {
      item.classList.add('filtered-out');
    }
  });
}

// Set current step and update UI
function setCurrentStep(idx) {
  if (!flowData || idx < 0 || idx >= flowData.turns.length) return;

  currentStepIndex = idx;
  playbackSlider.value = idx;
  playbackCurrentStepLabel.textContent = `Turn ${idx}`;

  updateUrlHash(idx);

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
  
  simStepTitle.textContent = `(${elapsed})`;

  // Turn vitals: duration, tokens in→out, context window
  if (simStepStats) {
    const req = step.request || {};
    const dur = `+${Math.round((step.durationMs || 0) / 1000)}s`;
    const cw = req.contextWindow;
    const timeStr = formatLocalTime(step.tsStart);
    const fullDateStr = step.tsStart ? new Date(step.tsStart).toLocaleString() : 'N/A';
    simStepStats.innerHTML = `
      <span class="vital"><i data-lucide="clock" style="width:12px;height:12px;"></i> ${dur}</span>
      <span class="vital"><i data-lucide="arrow-right-left" style="width:12px;height:12px;"></i> ${req.tokensIn || 0}→${req.tokensOut || 0} tok</span>
      <span class="vital" title="Bắt đầu lúc: ${fullDateStr}"><i data-lucide="calendar" style="width:12px;height:12px;"></i> ${timeStr} (${step.tsStart || '-'})</span>
      ${cw ? `<span class="vital" title="Context Window Usage">🪟 ${cw.used.toLocaleString()}/${cw.total} (${cw.percent}%)</span>` : ''}
    `;
    lucide.createIcons();
  }

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

  // Raw Inspector Tab update (rendered with clickable sidecar links)
  jsonInspector.innerHTML = formatJsonWithLinks(JSON.stringify(step, null, 2));

  lucide.createIcons();
}

// Fetch sidecar content and open modal
async function openSidecarModal(sidecarPath) {
  sidecarFileContent.textContent = 'Loading sidecar file content...';
  sidecarModal.classList.add('active');
  const targetUrl = currentTaskId 
    ? `./tasks/${encodeURIComponent(currentTaskId)}/${sidecarPath}`
    : `./${sidecarPath}`;
  try {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();
    sidecarFileContent.textContent = text;
  } catch (e) {
    console.error('Error reading sidecar file:', e);
    sidecarFileContent.textContent = `Error: Failed to load sidecar file at ${targetUrl}\nThe file might not have been created or the path is incorrect.`;
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

  // Pull palette from the active theme's CSS tokens so charts match the UI.
  const cText = cssVar('--text-muted', '#94a3b8');
  const cGrid = cssVar('--fill-04', 'rgba(255, 255, 255, 0.04)');
  const cIndigo = cssVar('--indigo', '#6366f1');
  const cCyan = cssVar('--cyan', '#06b6d4');
  const cAmber = cssVar('--amber', '#f59e0b');
  const cEmerald = cssVar('--emerald', '#10b981');
  const cRose = cssVar('--rose', '#f43f5e');

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
          borderColor: cIndigo,
          backgroundColor: 'rgba(99, 102, 241, 0.05)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Tokens Out (Cumulative)',
          data: dataTokensOut,
          borderColor: cCyan,
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: cText } }
      },
      scales: {
        x: { grid: { color: cGrid }, ticks: { color: cText } },
        y: { grid: { color: cGrid }, ticks: { color: cText } }
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
        borderColor: cAmber,
        backgroundColor: 'rgba(245, 158, 11, 0.05)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: cText } }
      },
      scales: {
        x: { grid: { color: cGrid }, ticks: { color: cText } },
        y: { grid: { color: cGrid }, ticks: { color: cText } }
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
        backgroundColor: [cEmerald, cRose],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: cText } }
      }
    }
  });
}

// --- Analysis tab (FTA & findings) ---

const SEVERITY_META = {
  critical: { icon: 'octagon-alert', cls: 'sev-critical' },
  major: { icon: 'alert-triangle', cls: 'sev-major' },
  minor: { icon: 'info', cls: 'sev-minor' }
};

const STATUS_META = {
  completed: { label: 'Completed cleanly', cls: 'badge-emerald' },
  completed_with_faults: { label: 'Completed with faults', cls: 'badge-amber' },
  incomplete: { label: 'Incomplete', cls: 'badge-rose' }
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Populate the Analysis tab from flowData.analysis (written by parser.js).
function renderAnalysisPanel() {
  const verdictBox = document.getElementById('analysis-verdict');
  const findingsBox = document.getElementById('analysis-findings');
  const recsBox = document.getElementById('analysis-recommendations');
  if (!verdictBox) return;

  const a = flowData && flowData.analysis;
  if (!a) {
    verdictBox.innerHTML = '<span class="text-muted">No analysis data in this flow_data.json — re-run parser.js to generate it.</span>';
    findingsBox.innerHTML = '<span class="text-muted">No analysis data.</span>';
    recsBox.innerHTML = '<li class="text-muted">No analysis data.</li>';
    return;
  }

  // Verdict header
  const st = STATUS_META[a.outcome.status] || STATUS_META.incomplete;
  const sev = a.fta.severityCount;
  const planHtml = a.plan
    ? `<div class="verdict-item"><span class="verdict-label">Plan adherence</span><span class="verdict-value">${(a.plan.adherenceScore * 100).toFixed(0)}%<small> (${a.plan.source})</small></span></div>`
    : '';
  verdictBox.innerHTML = `
    <div class="verdict-item">
      <span class="verdict-label">Outcome</span>
      <span class="badge ${st.cls}">${st.label}</span>
    </div>
    <div class="verdict-item">
      <span class="verdict-label">Health score</span>
      <span class="verdict-value health-${a.outcome.healthScore >= 80 ? 'good' : a.outcome.healthScore >= 50 ? 'warn' : 'bad'}">${a.outcome.healthScore}<small>/100</small></span>
    </div>
    ${planHtml}
    <div class="verdict-item">
      <span class="verdict-label">Findings</span>
      <span class="verdict-value">🟥 ${sev.critical} · 🟧 ${sev.major} · 🟦 ${sev.minor}</span>
    </div>
  `;

  // Findings cards — evidence refs jump the simulator to the referenced turn.
  if (!a.findings.length) {
    findingsBox.innerHTML = '<span class="text-muted">✅ No findings — clean run.</span>';
  } else {
    findingsBox.innerHTML = a.findings.map(f => {
      const meta = SEVERITY_META[f.severity] || SEVERITY_META.minor;
      const evHtml = [...new Set(f.evidence.map(e =>
        e.turn != null
          ? `<span class="evidence-link" onclick="jumpToTurn(${e.turn})" title="${escapeHtml(e.ref)}">Turn ${e.turn}</span>`
          : `<code class="evidence-ref">${escapeHtml(e.ref)}</code>`
      ))];
      const evLinks = evHtml.slice(0, 6).join(' ');
      const more = evHtml.length > 6 ? `<span class="text-muted"> +${evHtml.length - 6} more</span>` : '';
      return `
        <div class="finding-card ${meta.cls}">
          <div class="finding-head">
            <i data-lucide="${meta.icon}"></i>
            <span class="finding-id">${f.id}</span>
            <span class="badge badge-cat">${escapeHtml(f.category)}</span>
            <span class="finding-sev">${f.severity}</span>
          </div>
          <div class="finding-title">${escapeHtml(f.title)}</div>
          ${f.detail ? `<div class="finding-detail">${escapeHtml(f.detail)}</div>` : ''}
          <div class="finding-evidence">Evidence: ${evLinks}${more}</div>
          ${f.suggestion ? `<div class="finding-suggestion"><i data-lucide="lightbulb"></i> ${escapeHtml(f.suggestion)}</div>` : ''}
          <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
            <button class="btn btn-secondary btn-sm" onclick="createGitHubIssueForFinding('${f.id}')" style="display: flex; align-items: center; gap: 6px;">
              <i data-lucide="github"></i> Raise GitHub Issue
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Recommendations
  if (!a.recommendations.length) {
    recsBox.innerHTML = '<li class="text-muted">Nothing to improve — clean run.</li>';
  } else {
    recsBox.innerHTML = a.recommendations.map(r => {
      const target = r.targetName ? `${r.target}: ${r.targetName}` : r.target;
      return `<li class="rec-${r.priority}"><span class="badge badge-cat">${escapeHtml(target)}</span> <strong>[${r.priority}]</strong> ${escapeHtml(r.text)} <em class="text-muted">(${r.findingIds.join(', ')})</em></li>`;
    }).join('');
  }

  if (window.lucide) lucide.createIcons();
}

// Helper to copy text to clipboard and trigger pre-filled GitHub Issue link safely via Preview Modal
function openGitHubIssueSafely(title, body, labels) {
  // Always copy full Markdown body to clipboard
  const fullText = `# ${title}\n\n${body}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(fullText).catch(() => {});
  }

  let rawRepo = (thresholdSettings.githubRepo || '').trim();
  // Clean up full URL input to strictly extract owner/repo pair only
  rawRepo = rawRepo.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const parts = rawRepo.split('/').filter(Boolean);
  if (parts.length >= 2) {
    rawRepo = `${parts[0]}/${parts[1]}`;
  } else {
    rawRepo = parts[0] || '';
  }

  if (!rawRepo) {
    alert('Full Markdown report copied to Clipboard!\n\nTarget GitHub Repository is currently unconfigured in Settings. Please open Settings to set your Target Repository (owner/repo).');
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) settingsModal.classList.add('active');
    return;
  }

  // Bounded body snippet for URL parameter (browsers choke on > 2000 chars)
  const safeBody = body.length > 1200 ? body.slice(0, 1200) + '\n\n*(Full report copied to clipboard)*' : body;
  const issueUrl = `https://github.com/${rawRepo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(safeBody)}&labels=${encodeURIComponent(labels)}`;

  // Populate preview modal elements
  const modal = document.getElementById('issue-preview-modal');
  const inputUrl = document.getElementById('issue-target-url');
  const inputTitle = document.getElementById('issue-target-title');
  const preBody = document.getElementById('issue-target-body');
  const btnClose = document.getElementById('btn-issue-modal-close');
  const btnCancel = document.getElementById('btn-issue-cancel');
  const btnOpen = document.getElementById('btn-issue-open-url');
  const btnCopy = document.getElementById('btn-issue-copy-only');

  if (inputUrl) inputUrl.value = issueUrl;
  if (inputTitle) inputTitle.value = title;
  if (preBody) preBody.textContent = fullText;

  if (modal) modal.classList.add('active');

  const closeModal = () => modal && modal.classList.remove('active');

  if (btnClose) btnClose.onclick = closeModal;
  if (btnCancel) btnCancel.onclick = closeModal;
  if (btnOpen) {
    btnOpen.onclick = () => {
      closeModal();
      window.open(issueUrl, '_blank');
    };
  }
  if (btnCopy) {
    btnCopy.onclick = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(fullText).then(() => {
          btnCopy.innerHTML = '<i data-lucide="check"></i> Copied!';
          if (window.lucide) lucide.createIcons();
          setTimeout(() => {
            btnCopy.innerHTML = '<i data-lucide="copy"></i> Copy Markdown';
            if (window.lucide) lucide.createIcons();
          }, 1500);
        });
      }
    };
  }
}

// Build and open GitHub Issue pre-fill URL for a specific Turn
function createGitHubIssueForTurn(stepIndex) {
  if (!flowData || stepIndex == null || stepIndex < 0 || stepIndex >= flowData.turns.length) return;
  const turn = flowData.turns[stepIndex];
  const taskId = flowData.taskId || currentTaskId || 'unknown-task';
  const modelName = flowData.model ? `${flowData.model.modelId} (${flowData.model.mode})` : 'Unknown';
  const baseUrl = window.location.origin + window.location.pathname;
  const deepLink = `${baseUrl}#turn-${stepIndex}`;

  const tokensIn = turn.request?.tokensIn || 0;
  const tokensOut = turn.request?.tokensOut || 0;
  const actionSummary = turn.actions && turn.actions.length > 0 
    ? turn.actions.map(a => `${a.kind}: ${JSON.stringify(a.what)}`).join('\n')
    : 'No action recorded';
  const reasoning = (turn.reasoning?.preview || 'No reasoning text recorded').slice(0, 300);

  const title = `[Agent Fault]: Issue observed at Turn ${stepIndex} (Task: ${taskId})`;
  const body = `## ⚠️ [BUG/FAULT]: Agent Execution Issue at Turn ${stepIndex}

### 📌 Summary
Issue observed at **Turn ${stepIndex}** of Task **\`${taskId}\`**.

---

### 🔗 Context & Environment
- **Task ID:** \`${taskId}\`
- **Model:** \`${modelName}\`
- **Turn Deep Link:** [View Turn ${stepIndex} in Dashboard](${deepLink})
- **Tokens In:** \`${tokensIn.toLocaleString()}\`
- **Tokens Out:** \`${tokensOut.toLocaleString()}\`

---

### 📊 Observed Evidence (Trace Data)
- **Evidence Reference:** \`turns[${stepIndex}]\`
- **Action(s):**
\`\`\`
${actionSummary}
\`\`\`

#### Agent Reasoning Excerpt:
> ${reasoning.replace(/\n/g, '\n> ')}

---

### 🔀 Expected vs. Actual Behavior

| Expected Behavior | Actual Behavior |
| :--- | :--- |
| Agent executes turn step correctly without errors or abnormal metric spikes. | Abnormal behavior, failure, or threshold breach observed at Turn ${stepIndex}. |

---

### 🛠️ Actionable Guidance for Dev
- [ ] Inspect \`SKILL.md\` or prompt instructions relevant to this step.
- [ ] Check command output / tool execution errors at Turn ${stepIndex}.
- [ ] Verify if pre-conditions or context window limits caused thrashing.

---
*Reported via Cline Agent Loop Analyzer*`;

  openGitHubIssueSafely(title, body, 'bug,trace-fault');
}

// Build and open GitHub Issue pre-fill URL for a specific Finding
function createGitHubIssueForFinding(findingId) {
  if (!flowData || !flowData.analysis || !flowData.analysis.findings) return;
  const f = flowData.analysis.findings.find(x => x.id === findingId);
  if (!f) return;

  const taskId = flowData.taskId || currentTaskId || 'unknown-task';
  const modelName = flowData.model ? `${flowData.model.modelId} (${flowData.model.mode})` : 'Unknown';
  const baseUrl = window.location.origin + window.location.pathname;
  
  const firstTurnEv = f.evidence ? f.evidence.find(e => e.turn != null) : null;
  const deepLink = firstTurnEv ? `${baseUrl}#turn-${firstTurnEv.turn}` : `${baseUrl}#tab-analysis`;

  const title = `[Analysis Finding ${f.id}]: ${f.title} (Task: ${taskId})`;
  const body = `## ⚠️ [BUG/FAULT]: ${f.id} - ${f.title}

### 📌 Summary
Finding **${f.id}** (${f.category}) detected with **${f.severity.toUpperCase()}** severity on Task **\`${taskId}\`**.

---

### 🔗 Context & Environment
- **Task ID:** \`${taskId}\`
- **Model:** \`${modelName}\`
- **Category:** \`${f.category}\`
- **Severity:** \`${f.severity}\`
- **Deep Link:** [View Evidence in Dashboard](${deepLink})

---

### 📊 Finding Details & Evidence
${f.detail ? `**Detail:** ${f.detail}\n` : ''}
- **Evidence References:** ${f.evidence.map(e => `\`${e.ref}\``).join(', ')}

---

### 💡 Suggested Recommendation
> ${f.suggestion || 'Inspect referenced trace turns and update skill instructions.'}

---

### 🛠️ Actionable Guidance for Dev
- [ ] Review the referenced turns in the trace analyzer.
- [ ] Update \`SKILL.md\` or workflow definitions to prevent recurrence.

---
*Reported via Cline Agent Loop Analyzer*`;

  openGitHubIssueSafely(title, body, 'bug,' + f.category);
}

window.jumpToTurn = jumpToTurn;
window.createGitHubIssueForTurn = createGitHubIssueForTurn;
window.createGitHubIssueForFinding = createGitHubIssueForFinding;

// Render FTA Mermaid Diagram
function initFtaMermaid() {
  if (!flowData || !flowData.ftaMermaid || typeof mermaid === 'undefined') return;
  const box = document.getElementById('fta-mermaid-code');
  box.removeAttribute('data-processed');
  box.textContent = flowData.ftaMermaid;
  try {
    mermaid.init(undefined, box);
    
    // Reset zoom after rendering new diagram
    const ftaContainer = document.querySelector('#tab-analysis .mermaid-render-box');
    if (ftaContainer && ftaContainer.resetZoom) ftaContainer.resetZoom();
  } catch (err) {
    console.error('FTA mermaid render error:', err);
  }
}

// Render Mermaid Diagram
function initMermaid() {
  if (!flowData || !flowData.mermaid) return;
  const mermaidBox = document.getElementById('mermaid-code');
  mermaidBox.removeAttribute('data-processed');
  mermaidBox.textContent = flowData.mermaid;
  try {
    mermaid.init(undefined, mermaidBox);
    
    // Reset zoom after rendering new diagram
    const mmdContainer = document.querySelector('#tab-mermaid .mermaid-render-box');
    if (mmdContainer && mmdContainer.resetZoom) mmdContainer.resetZoom();
  } catch (err) {
    console.error('Mermaid render error:', err);
  }
}

// Initialize Mermaid.js — use the active app theme so it always matches.
// (applyTheme() calls mermaid.initialize() again whenever the user switches
//  themes, but this initial call must also respect the saved preference.)
mermaid.initialize({
  startOnLoad: false,
  theme: MERMAID_THEME[getActiveTheme()] || 'dark',
  securityLevel: 'loose'
});

// ===== Pan & Zoom functionality =====
function enablePanAndZoom(container) {
  if (!container) return;
  
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  
  // Set up overlay controls
  setupControlOverlay(container);

  // Apply transform to the SVG child
  function updateTransform() {
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      svg.style.transformOrigin = '0 0';
    }
  }

  // Handle Zoom (Wheel event)
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const svg = container.querySelector('svg');
    if (!svg) return;

    const zoomIntensity = 0.1;
    const minScale = 0.15;
    const maxScale = 10;
    
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const svgX = (mouseX - translateX) / scale;
    const svgY = (mouseY - translateY) / scale;

    const delta = -e.deltaY;
    let newScale = scale;
    if (delta > 0) {
      newScale = scale * (1 + zoomIntensity);
    } else {
      newScale = scale / (1 + zoomIntensity);
    }
    
    newScale = Math.min(Math.max(minScale, newScale), maxScale);

    translateX = mouseX - svgX * newScale;
    translateY = mouseY - svgY * newScale;
    scale = newScale;

    updateTransform();
  }, { passive: false });

  // Handle Pan (Mouse Drag)
  container.addEventListener('mousedown', (e) => {
    // Only drag with left mouse click, and ignore clicks on UI buttons
    if (e.button !== 0 || e.target.closest('.zoom-controls-overlay')) return;
    
    const svg = container.querySelector('svg');
    if (!svg) return;

    isDragging = true;
    container.classList.add('is-dragging');
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      container.classList.remove('is-dragging');
    }
  });

  // Expose reset zoom function
  container.resetZoom = function() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateTransform();
  };
  
  // Custom Zoom Functions for the overlay buttons
  container.zoomIn = function() {
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const svgX = (cx - translateX) / scale;
    const svgY = (cy - translateY) / scale;
    const newScale = Math.min(10, scale * 1.3);
    translateX = cx - svgX * newScale;
    translateY = cy - svgY * newScale;
    scale = newScale;
    updateTransform();
  };

  container.zoomOut = function() {
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const svgX = (cx - translateX) / scale;
    const svgY = (cy - translateY) / scale;
    const newScale = Math.max(0.15, scale / 1.3);
    translateX = cx - svgX * newScale;
    translateY = cy - svgY * newScale;
    scale = newScale;
    updateTransform();
  };
}

function setupControlOverlay(container) {
  // Check if overlay already exists
  let overlay = container.querySelector('.zoom-controls-overlay');
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'zoom-controls-overlay';
  overlay.innerHTML = `
    <button class="zoom-btn zoom-in-btn" title="Zoom In"><i data-lucide="plus"></i></button>
    <button class="zoom-btn zoom-out-btn" title="Zoom Out"><i data-lucide="minus"></i></button>
    <button class="zoom-btn zoom-reset-btn" title="Reset Zoom"><i data-lucide="maximize"></i></button>
  `;
  container.appendChild(overlay);

  // Attach button events
  overlay.querySelector('.zoom-in-btn').addEventListener('click', () => container.zoomIn());
  overlay.querySelector('.zoom-out-btn').addEventListener('click', () => container.zoomOut());
  overlay.querySelector('.zoom-reset-btn').addEventListener('click', () => container.resetZoom());

  // Render icons
  if (window.lucide) {
    lucide.createIcons({
      attrs: {
        class: 'lucide-icon'
      },
      nameAttr: 'data-lucide',
      node: overlay
    });
  }
}
