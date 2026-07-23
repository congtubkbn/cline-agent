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
let currentFlowchartOrientation = 'TD';

// Global jumpToTurn handler used by Mermaid node click
function jumpToTurn(turnIndex) {
  const idx = typeof turnIndex === 'string' ? parseInt(turnIndex, 10) : turnIndex;
  if (!isNaN(idx) && typeof setCurrentStep === 'function') {
    setCurrentStep(idx);
    const tabBtn = document.querySelector('.tab-btn[data-tab="simulator"]');
    if (tabBtn) tabBtn.click();
  }
}
window.jumpToTurn = jumpToTurn;

// Threshold Settings (default values)
let thresholdSettings = {
  timeWarning: 30,
  timeError: 90,
  tokenWarning: 4000,
  tokenError: 10000,
  contextCapWarning: 80,
  contextCapError: 90,
  // Error source toggles — which sources contribute to Warning/Error counts
  enableTimeThreshold: true,
  enableTokenThreshold: true,
  enableContextCapThreshold: true,
  enableParserErrors: true,
  githubHost: 'https://github.com', // Default host
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

// Client-side Error Analyzer fallback (evaluates errorDetails on-the-fly for legacy flow_data.json logs)
function analyzeOutputError(outputText) {
  if (!outputText || typeof outputText !== 'string') return null;

  // Negative patterns to filter out false positives
  const isFalsePositive = /no (merge )?conflicts?|0 errors?,?\s*0 warnings?|0 (failed|failures)|syntax ok|build (succeeded|successful)|tests? passed/i.test(outputText);
  if (isFalsePositive) return null;

  if (/Access is denied|Permission denied|EACCES|operation not permitted/i.test(outputText)) {
    return { severity: 'critical', category: 'system-permission', code: 'permission-denied', summary: 'Permission denied' };
  }
  if (/SyntaxError:|TypeError:|ReferenceError:|ParserError:|Uncaught Exception|IndentationError:/i.test(outputText)) {
    return { severity: 'critical', category: 'syntax-error', code: 'syntax-error', summary: 'Syntax / Runtime exception' };
  }
  if (/ERR_OUT_OF_MEMORY|Reached heap limit|OutOfMemoryError|Killed process/i.test(outputText)) {
    return { severity: 'critical', category: 'execution-failed', code: 'out-of-memory', summary: 'Out of memory / process killed' };
  }
  if (/command not found|is not recognized|Cannot find module|ModuleNotFoundError:|No module named/i.test(outputText)) {
    return { severity: 'major', category: 'dependency-missing', code: 'command-not-found', summary: 'Command or module not found' };
  }
  if (/no such file or directory|cannot find the path|ENOENT/i.test(outputText)) {
    return { severity: 'major', category: 'execution-failed', code: 'path-not-found', summary: 'File or path not found' };
  }
  if (/CONFLICT \(content\):|fatal:/i.test(outputText)) {
    return { severity: 'major', category: 'git-conflict', code: 'git-fatal-conflict', summary: 'Git conflict or fatal error' };
  }
  if (/npm ERR!|ERR_[A-Z0-9_]+|Traceback \(most recent call last\):|exit code [1-9]\d*/i.test(outputText)) {
    return { severity: 'major', category: 'execution-failed', code: 'execution-failed', summary: 'Execution / Command error' };
  }
  if (/DeprecationWarning:|npm WARN/i.test(outputText)) {
    return { severity: 'minor', category: 'warning-notice', code: 'warning-notice', summary: 'Warning notice' };
  }

  return { severity: 'major', category: 'execution-failed', code: 'execution-failed', summary: 'Output error detected' };
}

// Unified error details lookup (supports pre-parsed errorDetails or client-side fallback)
function getErrorDetails(output) {
  if (!output) return null;
  if (output.errorDetails) return output.errorDetails;
  if (output.isError && output.text) {
    return analyzeOutputError(output.text);
  }
  return null;
}

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
  if (mmdContainer) enablePanAndZoom(mmdContainer);

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
      } else if (btn.dataset.tab === 'vireport') {
        loadViReport();
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

  // Sidecar search event listeners
  const sidecarSearchInput = document.getElementById('sidecar-search-input');
  const btnSidecarSearchPrev = document.getElementById('btn-sidecar-search-prev');
  const btnSidecarSearchNext = document.getElementById('btn-sidecar-search-next');

  if (sidecarSearchInput) {
    sidecarSearchInput.addEventListener('input', () => {
      currentSidecarSearchIndex = 0;
      updateSidecarSearch();
    });
    sidecarSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          prevSidecarMatch();
        } else {
          nextSidecarMatch();
        }
      }
    });
  }

  if (btnSidecarSearchPrev) {
    btnSidecarSearchPrev.addEventListener('click', prevSidecarMatch);
  }
  if (btnSidecarSearchNext) {
    btnSidecarSearchNext.addEventListener('click', nextSidecarMatch);
  }

  // Ctrl+F shortcut inside Sidecar Modal
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      if (sidecarModal && sidecarModal.classList.contains('active')) {
        e.preventDefault();
        if (sidecarSearchInput) {
          sidecarSearchInput.focus();
          sidecarSearchInput.select();
        }
      }
    }
  });

  // Render Mermaid button
  document.getElementById('btn-render-mmd').addEventListener('click', initMermaid);

  // Render FTA diagram button
  document.getElementById('btn-render-fta').addEventListener('click', initFtaMermaid);

  // Orientation Switcher & Zoom Controls for Flowchart
  const btnOrientTD = document.getElementById('btn-orient-td');
  const btnOrientLR = document.getElementById('btn-orient-lr');
  const mmdRenderBox = document.querySelector('#tab-mermaid .mermaid-render-box');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  if (btnOrientTD && btnOrientLR) {
    btnOrientTD.addEventListener('click', () => {
      btnOrientTD.classList.add('active');
      btnOrientLR.classList.remove('active');
      currentFlowchartOrientation = 'TD';
      initMermaid();
    });
    btnOrientLR.addEventListener('click', () => {
      btnOrientLR.classList.add('active');
      btnOrientTD.classList.remove('active');
      currentFlowchartOrientation = 'LR';
      initMermaid();
    });
  }

  if (btnZoomIn && mmdRenderBox) {
    btnZoomIn.addEventListener('click', () => {
      if (mmdRenderBox.zoomIn) mmdRenderBox.zoomIn();
    });
  }
  if (btnZoomOut && mmdRenderBox) {
    btnZoomOut.addEventListener('click', () => {
      if (mmdRenderBox.zoomOut) mmdRenderBox.zoomOut();
    });
  }
  if (btnZoomReset && mmdRenderBox) {
    btnZoomReset.addEventListener('click', () => {
      if (mmdRenderBox.resetZoom) mmdRenderBox.resetZoom();
    });
  }

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
  const setContextCapWarning = document.getElementById('set-context-cap-warning');
  const setContextCapError = document.getElementById('set-context-cap-error');

  const setEnableTime = document.getElementById('set-enable-time');
  const setEnableToken = document.getElementById('set-enable-token');
  const setEnableContextCap = document.getElementById('set-enable-context-cap');
  const setEnableErrors = document.getElementById('set-enable-errors');
  const setGithubHost = document.getElementById('set-github-host');
  const setGithubRepo = document.getElementById('set-github-repo');

  // Helper: grey-out threshold inputs when the source toggle is OFF
  function syncThresholdDisabledState() {
    const timeOff = setEnableTime && !setEnableTime.checked;
    const tokenOff = setEnableToken && !setEnableToken.checked;
    const contextCapOff = setEnableContextCap && !setEnableContextCap.checked;

    [setTimeWarning, setTimeError].forEach(el => { if (el) el.disabled = timeOff; });
    [setTokenWarning, setTokenError].forEach(el => { if (el) el.disabled = tokenOff; });
    [setContextCapWarning, setContextCapError].forEach(el => { if (el) el.disabled = contextCapOff; });

    document.querySelectorAll('.threshold-group-time').forEach(el => el.classList.toggle('source-disabled', timeOff));
    document.querySelectorAll('.threshold-group-token').forEach(el => el.classList.toggle('source-disabled', tokenOff));
    document.querySelectorAll('.threshold-group-context-cap').forEach(el => el.classList.toggle('source-disabled', contextCapOff));
  }

  if (setEnableTime)       setEnableTime.addEventListener('change',       syncThresholdDisabledState);
  if (setEnableToken)      setEnableToken.addEventListener('change',      syncThresholdDisabledState);
  if (setEnableContextCap) setEnableContextCap.addEventListener('change', syncThresholdDisabledState);

  if (btnSettingsOpen && settingsModal) {
    btnSettingsOpen.addEventListener('click', () => {
      // Load current threshold values into inputs
      if (setTimeWarning)       setTimeWarning.value       = thresholdSettings.timeWarning;
      if (setTimeError)         setTimeError.value         = thresholdSettings.timeError;
      if (setTokenWarning)       setTokenWarning.value       = thresholdSettings.tokenWarning;
      if (setTokenError)         setTokenError.value         = thresholdSettings.tokenError;
      if (setContextCapWarning) setContextCapWarning.value = thresholdSettings.contextCapWarning;
      if (setContextCapError)   setContextCapError.value   = thresholdSettings.contextCapError;

      // Load toggle states and github repo/host
      if (setEnableTime)       setEnableTime.checked       = thresholdSettings.enableTimeThreshold;
      if (setEnableToken)      setEnableToken.checked      = thresholdSettings.enableTokenThreshold;
      if (setEnableContextCap) setEnableContextCap.checked = thresholdSettings.enableContextCapThreshold !== false;
      if (setEnableErrors)     setEnableErrors.checked     = thresholdSettings.enableParserErrors;
      if (setGithubHost)       setGithubHost.value         = thresholdSettings.githubHost || 'https://github.com';
      if (setGithubRepo)       setGithubRepo.value         = thresholdSettings.githubRepo || '';
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
      thresholdSettings.timeWarning       = parseInt(setTimeWarning.value, 10)       || 30;
      thresholdSettings.timeError         = parseInt(setTimeError.value, 10)         || 90;
      thresholdSettings.tokenWarning       = parseInt(setTokenWarning.value, 10)       || 4000;
      thresholdSettings.tokenError         = parseInt(setTokenError.value, 10)       || 10000;
      thresholdSettings.contextCapWarning = parseInt(setContextCapWarning.value, 10) || 80;
      thresholdSettings.contextCapError   = parseInt(setContextCapError.value, 10)   || 90;

      // Save toggle states and github repo/host
      thresholdSettings.enableTimeThreshold       = setEnableTime       ? setEnableTime.checked       : true;
      thresholdSettings.enableTokenThreshold      = setEnableToken      ? setEnableToken.checked      : true;
      thresholdSettings.enableContextCapThreshold = setEnableContextCap ? setEnableContextCap.checked : true;
      thresholdSettings.enableParserErrors        = setEnableErrors     ? setEnableErrors.checked     : true;
      thresholdSettings.githubHost                = setGithubHost       ? setGithubHost.value.trim() : 'https://github.com';
      thresholdSettings.githubRepo                = setGithubRepo       ? setGithubRepo.value.trim() : '';

      try {
        localStorage.setItem('analyzerThresholds', JSON.stringify(thresholdSettings));
      } catch (e) {
        console.error('Error saving thresholds:', e);
      }

      settingsModal.classList.remove('active');
      
      // Re-apply timeline filters & re-render timeline
      renderTimeline();
    });
  }

  if (btnSettingsReset) {
    btnSettingsReset.addEventListener('click', () => {
      if (setTimeWarning)       setTimeWarning.value       = 30;
      if (setTimeError)         setTimeError.value         = 90;
      if (setTokenWarning)       setTokenWarning.value       = 4000;
      if (setTokenError)         setTokenError.value         = 10000;
      if (setContextCapWarning) setContextCapWarning.value = 80;
      if (setContextCapError)   setContextCapError.value   = 90;

      if (setEnableTime)       setEnableTime.checked       = true;
      if (setEnableToken)      setEnableToken.checked      = true;
      if (setEnableContextCap) setEnableContextCap.checked = true;
      if (setEnableErrors)     setEnableErrors.checked     = true;
      if (setGithubHost)       setGithubHost.value         = 'https://github.com';
      if (setGithubRepo)       setGithubRepo.value         = '';
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

    // Calculate anomaly levels for time, delta tokens, turn 1 initial context & context window %
    const durationSec = (step.durationMs || 0) / 1000;
    const tokensIn = (step.request && step.request.tokensIn) || 0;
    const prevTokensIn = (idx > 0 && flowData.turns[idx - 1]?.request?.tokensIn) ? flowData.turns[idx - 1].request.tokensIn : 0;
    const deltaTokens = (idx === 0 || prevTokensIn === 0) ? 0 : Math.max(0, tokensIn - prevTokensIn);
    const contextPercent = step.request?.contextWindow?.percent || 0;

    // Time duration level
    let timeLevel = 'safe';
    if (durationSec >= thresholdSettings.timeWarning && durationSec <= thresholdSettings.timeError) {
      timeLevel = 'warning';
    } else if (durationSec > thresholdSettings.timeError) {
      timeLevel = 'error';
    }

    // Delta token level (for turns after Turn 0)
    let deltaLevel = 'safe';
    if (idx > 0 && deltaTokens > 0) {
      if (deltaTokens >= thresholdSettings.tokenWarning && deltaTokens <= thresholdSettings.tokenError) {
        deltaLevel = 'warning';
      } else if (deltaTokens > thresholdSettings.tokenError) {
        deltaLevel = 'error';
      }
    }

    // Context capacity saturation level
    let contextCapLevel = 'safe';
    if (contextPercent > 0) {
      const capWarnLimit = thresholdSettings.contextCapWarning || 80;
      const capErrLimit  = thresholdSettings.contextCapError || 90;
      if (contextPercent >= capWarnLimit && contextPercent <= capErrLimit) {
        contextCapLevel = 'warning';
      } else if (contextPercent > capErrLimit) {
        contextCapLevel = 'error';
      }
    }

    // Evaluate overall token anomaly level for dataset filtering
    let isTokenErr = false;
    let isTokenWarn = false;

    if (idx > 0 && thresholdSettings.enableTokenThreshold !== false) {
      if (deltaLevel === 'error') isTokenErr = true;
      else if (deltaLevel === 'warning') isTokenWarn = true;
    }
    if (thresholdSettings.enableContextCapThreshold !== false) {
      if (contextCapLevel === 'error') isTokenErr = true;
      else if (contextCapLevel === 'warning' && !isTokenErr) isTokenWarn = true;
    }

    const tokenLevel = isTokenErr ? 'error' : (isTokenWarn ? 'warning' : 'safe');

    item.dataset.timeLevel = timeLevel;
    item.dataset.tokenLevel = tokenLevel;
    item.dataset.deltaLevel = deltaLevel;
    item.dataset.contextCapLevel = contextCapLevel;

    // Count warnings and errors — respect per-source toggles
    const isErr = (
      (thresholdSettings.enableTimeThreshold  && timeLevel === 'error')  ||
      (thresholdSettings.enableTokenThreshold !== false && idx > 0 && deltaLevel === 'error') ||
      (thresholdSettings.enableContextCapThreshold !== false && contextCapLevel === 'error') ||
      (thresholdSettings.enableParserErrors   && (step.hasError || (step.errors && step.errors.length > 0)))
    );
    const isWarn = (
      (thresholdSettings.enableTimeThreshold  && timeLevel === 'warning') ||
      (thresholdSettings.enableTokenThreshold !== false && idx > 0 && deltaLevel === 'warning') ||
      (thresholdSettings.enableContextCapThreshold !== false && contextCapLevel === 'warning')
    );
    if (isErr) errorCount++;
    else if (isWarn) warningCount++;

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

    const errBadges = [];

    // 1. Collect tool/command execution output error badges
    if (step.actions) {
      step.actions.forEach(a => {
        if (a.output && (a.output.isError || getErrorDetails(a.output))) {
          const ed = getErrorDetails(a.output) || {};
          const sev = (ed.severity || 'major').toUpperCase();
          const badgeColor = sev === 'CRITICAL' ? 'var(--rose, #f43f5e)' : 'var(--amber, #f59e0b)';
          const badgeBg = sev === 'CRITICAL' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)';
          errBadges.push(`<span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}; font-size: 9px; padding: 1px 4px; font-weight: 700;">${sev}</span>`);
        }
      });
    }

    // 2. Collect Token In threshold breach badges
    if (thresholdSettings.enableTokenThreshold !== false && idx > 0 && deltaLevel === 'error') {
      errBadges.push(`<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid #c084fc; font-size: 9px; padding: 1px 4px; font-weight: 700;">TOKEN SPIKE</span>`);
    }
    if (thresholdSettings.enableContextCapThreshold !== false && contextCapLevel === 'error') {
      errBadges.push(`<span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid #f43f5e; font-size: 9px; padding: 1px 4px; font-weight: 700;">CTX CAP ${contextPercent}%</span>`);
    }

    // 3. Collect Time duration threshold breach badge
    if (thresholdSettings.enableTimeThreshold && timeLevel === 'error') {
      errBadges.push(`<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid #eab308; font-size: 9px; padding: 1px 4px; font-weight: 700;">SLOW TURN</span>`);
    }

    const errBadgeHTML = errBadges.length > 0 ? `<div style="display:inline-flex; gap:3px; margin-left:4px;">${errBadges.join('')}</div>` : '';

    const ctxPillLabel = idx === 0 
      ? `🪟 Init ${tokensIn >= 1000 ? Math.round(tokensIn/1000) + 'k' : tokensIn} tok` 
      : `🪟 +${deltaTokens.toLocaleString()} tok (${contextPercent}%)`;
    const ctxPillTitle = idx === 0 
      ? `Turn 0 Init Context: ${tokensIn.toLocaleString()} tokens` 
      : `Turn ${step.index} Delta: +${deltaTokens.toLocaleString()} tokens | Context: ${tokensIn.toLocaleString()} (${contextPercent}%) [Status: ${tokenLevel.toUpperCase()}]`;

    item.innerHTML = `
      <div class="timeline-info">
        <div class="timeline-meta">
          <div class="timeline-left">
            <span class="timeline-step">TURN ${step.index}</span>${errBadgeHTML}
            ${turnDuration ? `<span class="timeline-duration ${timeStatusClass}" title="Thời gian chạy: ${durationSec}s (${timeLevel.toUpperCase()})">(${turnDuration})</span>` : ''}
          </div>
          <div class="timeline-right">
            <span class="timeline-time" title="Tổng thời gian đã trôi qua: Lúc ${absoluteTime}">${elapsed}</span>
            ${step.request?.contextWindow ? `<span class="timeline-ctx ${tokenStatusClass}" title="${ctxPillTitle}">${ctxPillLabel}</span>` : ''}
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
        let errRibbon = '';
        const ed = getErrorDetails(a.output);
        if (a.output.isError || ed) {
          const details = ed || {};
          const sev = (details.severity || 'major').toUpperCase();
          const cat = (details.category || 'execution-failed').toUpperCase();
          const summary = details.summary || 'Error detected in tool output';
          const isCritical = sev === 'CRITICAL';
          const ribbonBorderColor = isCritical ? 'var(--rose, #f43f5e)' : 'var(--amber, #f59e0b)';
          const ribbonBgColor = isCritical ? 'rgba(244, 63, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)';

          errRibbon = `
            <div class="error-details-ribbon" style="margin-bottom: 10px; padding: 8px 12px; border-radius: 6px; background: ${ribbonBgColor}; border: 1px solid ${ribbonBorderColor};">
              <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 12px; color: ${ribbonBorderColor};">
                <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i>
                <span>${sev} ERROR · ${cat}</span>
              </div>
              <div style="font-size: 11px; margin-top: 4px; color: var(--text-main); font-family: var(--font-mono); word-break: break-all;">${escapeHtml(summary)}</div>
            </div>
          `;
        }

        outputHTML += `
          <div class="output-item-box ${a.output.isError ? 'has-error' : ''}">
            ${errRibbon}
            ${renderTextBlockHTML(a.output, 'output', `${step.index}_${ai}_out`)}
          </div>
        `;
      }
    });
    simOutput.innerHTML = outputHTML || '<span class="text-muted">No output results returned during this Turn.</span>';
    if (window.lucide) lucide.createIcons();
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

// Sidecar Modal Search Logic
let currentSidecarRawText = '';
let sidecarSearchMatches = [];
let currentSidecarSearchIndex = -1;

function updateSidecarSearch() {
  const input = document.getElementById('sidecar-search-input');
  const countSpan = document.getElementById('sidecar-search-count');
  const container = document.getElementById('sidecar-file-content');
  if (!container || !input) return;

  const query = input.value;
  if (!query || !currentSidecarRawText) {
    container.textContent = currentSidecarRawText;
    if (countSpan) countSpan.textContent = '0 / 0';
    sidecarSearchMatches = [];
    currentSidecarSearchIndex = -1;
    return;
  }

  let regex;
  try {
    regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  } catch (e) {
    container.textContent = currentSidecarRawText;
    if (countSpan) countSpan.textContent = '0 / 0';
    return;
  }

  let match;
  const matches = [];
  while ((match = regex.exec(currentSidecarRawText)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
  }

  if (matches.length === 0) {
    container.textContent = currentSidecarRawText;
    if (countSpan) countSpan.textContent = '0 / 0';
    sidecarSearchMatches = [];
    currentSidecarSearchIndex = -1;
    return;
  }

  if (currentSidecarSearchIndex < 0 || currentSidecarSearchIndex >= matches.length) {
    currentSidecarSearchIndex = 0;
  }

  sidecarSearchMatches = matches;
  if (countSpan) {
    countSpan.textContent = `${currentSidecarSearchIndex + 1} / ${matches.length}`;
  }

  let html = '';
  let lastIdx = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    html += escapeHtml(currentSidecarRawText.slice(lastIdx, m.start));
    const matchText = escapeHtml(currentSidecarRawText.slice(m.start, m.end));
    const activeClass = i === currentSidecarSearchIndex ? 'active-search-match' : '';
    html += `<mark class="search-highlight ${activeClass}" id="sidecar-match-${i}">${matchText}</mark>`;
    lastIdx = m.end;
  }
  html += escapeHtml(currentSidecarRawText.slice(lastIdx));
  container.innerHTML = html;

  const activeEl = document.getElementById(`sidecar-match-${currentSidecarSearchIndex}`);
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function nextSidecarMatch() {
  if (sidecarSearchMatches.length === 0) return;
  currentSidecarSearchIndex = (currentSidecarSearchIndex + 1) % sidecarSearchMatches.length;
  updateSidecarSearch();
}

function prevSidecarMatch() {
  if (sidecarSearchMatches.length === 0) return;
  currentSidecarSearchIndex = (currentSidecarSearchIndex - 1 + sidecarSearchMatches.length) % sidecarSearchMatches.length;
  updateSidecarSearch();
}

// Fetch sidecar content and open modal
async function openSidecarModal(sidecarPath) {
  sidecarFileContent.textContent = 'Loading sidecar file content...';
  currentSidecarRawText = '';
  sidecarSearchMatches = [];
  currentSidecarSearchIndex = -1;

  const searchInput = document.getElementById('sidecar-search-input');
  const countSpan = document.getElementById('sidecar-search-count');
  if (searchInput) searchInput.value = '';
  if (countSpan) countSpan.textContent = '0 / 0';

  sidecarModal.classList.add('active');
  const targetUrl = currentTaskId 
    ? `./tasks/${encodeURIComponent(currentTaskId)}/${sidecarPath}`
    : `./${sidecarPath}`;
  try {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();
    currentSidecarRawText = text;
    sidecarFileContent.textContent = text;
    if (window.lucide) lucide.createIcons();
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

// Helper to download ui_messages.json file for a given task
function downloadUiMessages(taskId) {
  if (!taskId) return;
  const link = document.createElement('a');
  link.href = `/api/tasks/${encodeURIComponent(taskId)}/ui_messages`;
  link.download = `${taskId}_ui_messages.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Helper to construct GitHub Issue URL, open Preview Modal, and optionally trigger ui_messages.json download
function openGitHubIssueSafely(title, bodyInput, labels = 'bug', taskId = null) {
  let host = (thresholdSettings.githubHost || 'https://github.com').trim();
  if (!/^https?:\/\//i.test(host)) {
    host = 'https://' + host;
  }
  host = host.replace(/\/+$/, '');

  let rawRepo = (thresholdSettings.githubRepo || '').trim();
  rawRepo = rawRepo.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const parts = rawRepo.split('/').filter(Boolean);
  if (parts.length >= 2) {
    rawRepo = `${parts[0]}/${parts[1]}`;
  } else {
    rawRepo = parts[0] || '';
  }

  if (!rawRepo) {
    alert('⚠️ GitHub Repository chưa được cấu hình!\n\nVui lòng mở cài đặt (nút ⚙️ Settings) và nhập Host & Repository (VD: "https://github.samsung.com" và "samsung/mobile-agent") để tạo issue.');
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) settingsModal.classList.add('active');
    return;
  }

  const currentTask = taskId || (flowData && flowData.taskId) || currentTaskId;

  // Show Issue Preview Modal
  const previewModal = document.getElementById('issue-preview-modal');
  const targetUrlInput = document.getElementById('issue-target-url');
  const targetTitleInput = document.getElementById('issue-target-title');
  const targetBodyPre = document.getElementById('issue-target-body');
  const chkAttachJson = document.getElementById('chk-issue-attach-json');
  const btnOpenUrl = document.getElementById('btn-issue-open-url');
  const btnCopyOnly = document.getElementById('btn-issue-copy-only');
  const btnDownloadJson = document.getElementById('btn-issue-download-json');
  const btnCancel = document.getElementById('btn-issue-cancel');
  const btnClose = document.getElementById('btn-issue-modal-close');

  // Checkbox is unchecked by default
  if (chkAttachJson) chkAttachJson.checked = false;

  const getBodyText = () => {
    if (typeof bodyInput === 'string') return bodyInput;
    const isAttached = chkAttachJson ? chkAttachJson.checked : false;
    return isAttached ? bodyInput.withLog : bodyInput.withoutLog;
  };

  const updateModalDisplay = () => {
    const currentBody = getBodyText();
    const fullMarkdown = `# ${title}\n\n${currentBody}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullMarkdown).catch(() => {});
    }

    const safeBody = currentBody.length > 1200 ? currentBody.slice(0, 1200) + '\n\n*(Full report copied to clipboard)*' : currentBody;
    const issueUrl = `${host}/${rawRepo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(safeBody)}`;

    if (targetUrlInput) targetUrlInput.value = issueUrl;
    if (targetTitleInput) targetTitleInput.value = title;
    if (targetBodyPre) targetBodyPre.textContent = currentBody;

    return { issueUrl, fullMarkdown };
  };

  updateModalDisplay();

  if (previewModal) {
    previewModal.classList.add('active');

    const handleCheckboxChange = () => {
      updateModalDisplay();
    };

    const handleOpen = () => {
      const { issueUrl } = updateModalDisplay();
      window.open(issueUrl, '_blank');
      previewModal.classList.remove('active');
      cleanupListeners();
    };

    const handleDownloadLog = () => {
      if (currentTask) {
        downloadUiMessages(currentTask);
      } else {
        alert('Không tìm thấy Task ID để tải ui_messages.json');
      }
    };

    const handleCopy = () => {
      const { fullMarkdown } = updateModalDisplay();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(fullMarkdown).then(() => {
          if (btnCopyOnly) btnCopyOnly.innerHTML = '<i data-lucide="check"></i> Copied!';
          if (window.lucide) lucide.createIcons();
          setTimeout(() => {
            if (btnCopyOnly) btnCopyOnly.innerHTML = '<i data-lucide="copy"></i> Copy Markdown';
            if (window.lucide) lucide.createIcons();
          }, 1500);
        });
      }
    };

    const handleCloseModal = () => {
      previewModal.classList.remove('active');
      cleanupListeners();
    };

    function cleanupListeners() {
      if (btnOpenUrl) btnOpenUrl.removeEventListener('click', handleOpen);
      if (chkAttachJson) chkAttachJson.removeEventListener('change', handleCheckboxChange);
      if (btnDownloadJson) btnDownloadJson.removeEventListener('click', handleDownloadLog);
      if (btnCopyOnly) btnCopyOnly.removeEventListener('click', handleCopy);
      if (btnCancel) btnCancel.removeEventListener('click', handleCloseModal);
      if (btnClose) btnClose.removeEventListener('click', handleCloseModal);
    }

    cleanupListeners();
    if (btnOpenUrl) btnOpenUrl.addEventListener('click', handleOpen);
    if (chkAttachJson) chkAttachJson.addEventListener('change', handleCheckboxChange);
    if (btnDownloadJson) btnDownloadJson.addEventListener('click', handleDownloadLog);
    if (btnCopyOnly) btnCopyOnly.addEventListener('click', handleCopy);
    if (btnCancel) btnCancel.addEventListener('click', handleCloseModal);
    if (btnClose) btnClose.addEventListener('click', handleCloseModal);

    if (window.lucide) lucide.createIcons();
  } else {
    const currentBody = getBodyText();
    const safeBody = currentBody.length > 1200 ? currentBody.slice(0, 1200) + '\n\n*(Full report copied to clipboard)*' : currentBody;
    const issueUrl = `${host}/${rawRepo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(safeBody)}`;
    window.open(issueUrl, '_blank');
  }
}

// Build and open simplified GitHub Issue for a specific Turn
function createGitHubIssueForTurn(stepIndex) {
  if (!flowData || stepIndex == null || stepIndex < 0 || stepIndex >= flowData.turns.length) return;
  const turn = flowData.turns[stepIndex];
  const taskId = flowData.taskId || currentTaskId || 'unknown-task';
  const modelId = flowData.model?.modelId || flowData.model?.name || (typeof flowData.model === 'string' ? flowData.model : 'Unknown');
  const modelMode = flowData.model?.mode ? ` (${flowData.model.mode})` : '';
  const baseUrl = window.location.origin + window.location.pathname;
  const deepLink = `${baseUrl}#turn-${stepIndex}`;

  const act = turn.actions && turn.actions[0];
  const toolName = act?.what?.tool || act?.what?.command || act?.kind || 'General Turn Execution';
  const durationSec = Math.round((turn.durationMs || 0) / 1000);
  const tokensIn = turn.request?.tokensIn || 0;
  const tokensOut = turn.request?.tokensOut || 0;
  const tokensTotal = tokensIn + tokensOut;
  const cacheReads = turn.request?.cacheReads || 0;
  const ctxWin = turn.request?.contextWindow ? `${turn.request.contextWindow.percent}% (${turn.request.contextWindow.used}/${turn.request.contextWindow.total})` : 'N/A';

  // Error details / Actual Result
  let errorSummary = '';
  let actualResult = 'Issue / Threshold Anomaly observed at this turn.';
  let errorType = 'General Error';

  // Extract Tool Details
  let toolInput = 'N/A';
  let toolOutput = 'N/A';
  if (act) {
    if (act.kind === 'command') {
      toolInput = act.what?.command || 'N/A';
    } else {
      toolInput = act.what ? JSON.stringify(act.what, null, 2) : 'N/A';
    }
    if (act.output) {
      toolOutput = act.output.preview || act.output.text || 'N/A';
    }
  }
  let reasoning = turn.reasoning?.preview || turn.reasoning?.text || turn.request?.text || 'N/A';

  // Evaluate Delta Tokens for anomalies
  let deltaTokens = tokensTotal;
  if (stepIndex > 0 && flowData.turns[stepIndex - 1]) {
    const prevTurn = flowData.turns[stepIndex - 1];
    const prevTokens = (prevTurn.request?.tokensIn || 0) + (prevTurn.request?.tokensOut || 0);
    deltaTokens = tokensTotal - prevTokens;
  }
  let isTokenSpike = (stepIndex > 0 && deltaTokens > (thresholdSettings?.tokenError || 10000));

  if (turn.hasError && turn.errors && turn.errors.length > 0) {
    actualResult = turn.errors.map(e => e.text?.preview || e.text || 'Error occurred').join('\n');
    const firstErr = turn.errors[0]?.text?.preview || turn.errors[0]?.text || '';
    errorSummary = firstErr.split(/\r?\n/)[0].trim();
    if (errorSummary.includes(':')) {
      errorType = errorSummary.split(':')[0].trim();
    }
  } else if (turn.actions) {
    const errAction = turn.actions.find(a => a.output && a.output.isError);
    if (errAction) {
      actualResult = errAction.output.preview || errAction.output.text || 'Tool output returned error status.';
      errorSummary = actualResult.split(/\r?\n/)[0].trim();
      if (errorSummary.includes(':')) {
        errorType = errorSummary.split(':')[0].trim();
      }
    }
  }

  if (errorType === 'General Error') {
    if (isTokenSpike) {
      errorType = 'Token Spike';
      errorSummary = `Token spike detected: +${deltaTokens.toLocaleString()} tokens`;
      if (actualResult === 'Issue / Threshold Anomaly observed at this turn.') actualResult = toolOutput;
    } else if (durationSec > (thresholdSettings?.timeError || 60)) {
      errorType = 'Long Duration';
      errorSummary = `Turn took unusually long: ${durationSec}s`;
      if (actualResult === 'Issue / Threshold Anomaly observed at this turn.') actualResult = toolOutput;
    } else {
      if (actualResult === 'Issue / Threshold Anomaly observed at this turn.' && toolOutput !== 'N/A') {
         actualResult = toolOutput;
      }
    }
  }

  if (!errorSummary) {
    errorSummary = `Turn ${stepIndex} (${toolName})`;
  }

  errorSummary = errorSummary.replace(/\s+/g, ' ').trim();
  if (errorSummary.length > 55) {
    errorSummary = errorSummary.slice(0, 55).trim() + '...';
  }

  let errorTypeUpper = errorType.toUpperCase();
  const title = `[Task ${taskId}][Model ${modelId}] [Turn ${stepIndex}] Error ${errorTypeUpper}`;

  const bodyWithLog = `1 Problem CRITICAL ERROR · ${errorTypeUpper}           
${errorSummary}

2. Steps / Route to Reproduce

3 Detail 

**Model Reasoning:**
\`\`\`text
${reasoning}
\`\`\`

**Tool Input (${toolName}):**
\`\`\`text
${toolInput}
\`\`\`

**Actual Result / Tool Output:**
\`\`\`text
${actualResult}
\`\`\`

4 System & Context Information
- **Task ID:** \`${taskId}\`
- **Model:** \`${modelId}\`${modelMode}
- **Turn Index:** Turn ${stepIndex} of ${flowData.turns.length}
- **Time / Duration:** \`${durationSec}s\`
- **Token Metrics:** Input \`${tokensIn.toLocaleString()}\` → Output \`${tokensOut.toLocaleString()}\` (Total: \`${tokensTotal.toLocaleString()}\`) | Cache Read \`${cacheReads.toLocaleString()}\`
- **Context Window:** \`${ctxWin}\`
- **Log File:** \`ui_messages.json\` (Task \`${taskId}\`)`;

  const bodyWithoutLog = `1 Problem CRITICAL ERROR · ${errorTypeUpper}           
${errorSummary}

2. Steps / Route to Reproduce

3 Detail 

**Model Reasoning:**
\`\`\`text
${reasoning}
\`\`\`

**Tool Input (${toolName}):**
\`\`\`text
${toolInput}
\`\`\`

**Actual Result / Tool Output:**
\`\`\`text
${actualResult}
\`\`\`

4 System & Context Information
- **Task ID:** \`${taskId}\`
- **Model:** \`${modelId}\`${modelMode}
- **Turn Index:** Turn ${stepIndex} of ${flowData.turns.length}
- **Time / Duration:** \`${durationSec}s\`
- **Token Metrics:** Input \`${tokensIn.toLocaleString()}\` → Output \`${tokensOut.toLocaleString()}\` (Total: \`${tokensTotal.toLocaleString()}\`) | Cache Read \`${cacheReads.toLocaleString()}\`
- **Context Window:** \`${ctxWin}\``;

  openGitHubIssueSafely(title, { withLog: bodyWithLog, withoutLog: bodyWithoutLog }, 'bug,qa-report', taskId);
}

// Build and open simplified GitHub Issue for a specific Finding
function createGitHubIssueForFinding(findingId) {
  if (!flowData || !flowData.analysis || !flowData.analysis.findings) return;
  const f = flowData.analysis.findings.find(x => x.id === findingId);
  if (!f) return;

  const taskId = flowData.taskId || currentTaskId || 'unknown-task';
  const modelId = flowData.model?.modelId || flowData.model?.name || (typeof flowData.model === 'string' ? flowData.model : 'Unknown');
  const baseUrl = window.location.origin + window.location.pathname;
  
  const firstTurnEv = f.evidence ? f.evidence.find(e => e.turn != null) : null;
  const deepLink = firstTurnEv ? `${baseUrl}#turn-${firstTurnEv.turn}` : `${baseUrl}#tab-analysis`;

  const title = `[Task ${taskId}][Model ${modelId}] [Finding] ${f.category ? f.category.toUpperCase() : 'ISSUE'} ${f.title}`;

  const bodyWithLog = `1 Problem ${f.severity.toUpperCase()} · ${f.category ? f.category.toUpperCase() : 'FINDING'}           
${f.title}
${f.detail ? `\n${f.detail}\n` : ''}
2. Steps / Route to Reproduce
1. Open **Cline Agent Loop Analyzer** at \`http://localhost:8099/\`
2. Select Task ID: \`${taskId}\`
3. Navigate to **Analysis Tab** or Evidence Link ([Direct Link](${deepLink}))
4. Review trace evidence: ${f.evidence ? f.evidence.map(e => `\`${e.ref}\``).join(', ') : 'N/A'}.

3 Detail 

Finding triggered due to fault category \`${f.category}\` with severity \`${f.severity}\`.

4 System & Context Information
- **Task ID:** \`${taskId}\`
- **Model:** \`${modelId}\`
- **Category:** \`${f.category}\`
- **Severity:** \`${f.severity}\`
- **Log File:** \`ui_messages.json\` (Task \`${taskId}\`)`;

  const bodyWithoutLog = `1 Problem ${f.severity.toUpperCase()} · ${f.category ? f.category.toUpperCase() : 'FINDING'}           
${f.title}
${f.detail ? `\n${f.detail}\n` : ''}
2. Steps / Route to Reproduce
1. Open **Cline Agent Loop Analyzer** at \`http://localhost:8099/\`
2. Select Task ID: \`${taskId}\`
3. Navigate to **Analysis Tab** or Evidence Link ([Direct Link](${deepLink}))
4. Review trace evidence: ${f.evidence ? f.evidence.map(e => `\`${e.ref}\``).join(', ') : 'N/A'}.

3 Detail 

Finding triggered due to fault category \`${f.category}\` with severity \`${f.severity}\`.

4 System & Context Information
- **Task ID:** \`${taskId}\`
- **Model:** \`${modelId}\`
- **Category:** \`${f.category}\`
- **Severity:** \`${f.severity}\``;

  openGitHubIssueSafely(title, { withLog: bodyWithLog, withoutLog: bodyWithoutLog }, 'bug,qa-finding,' + f.category, taskId);
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
  mermaid.run({ nodes: [box] }).then(() => {
    const ftaContainer = document.querySelector('#tab-analysis .mermaid-render-box');
    if (ftaContainer && ftaContainer.resetZoom) ftaContainer.resetZoom();
  }).catch(err => console.error('FTA mermaid render error:', err));
}



function attachMermaidNodeClickHandlers(container) {
  if (!container) return;
  const nodes = container.querySelectorAll('.node');
  nodes.forEach(node => {
    const text = node.textContent || '';
    const match = text.match(/Turn\s+(\d+)/i) || (node.id && node.id.match(/T(\d+)/));
    if (match) {
      const stepIdx = parseInt(match[1], 10);
      node.style.cursor = 'pointer';
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof setCurrentStep === 'function') {
          setCurrentStep(stepIdx);
        }
        const tabBtn = document.querySelector('.tab-btn[data-tab="simulator"]');
        if (tabBtn) tabBtn.click();
      });
    }
  });
}

// Render Mermaid Diagram — uses mermaid.run() (Mermaid v11+ API)
function initMermaid() {
  if (!flowData || !flowData.mermaid) return;
  const mermaidBox = document.getElementById('mermaid-code');
  if (!mermaidBox) return;

  let mmd = flowData.mermaid || '';
  if (currentFlowchartOrientation === 'LR') {
    mmd = mmd.replace(/^flowchart TD/m, 'flowchart LR');
  } else {
    mmd = mmd.replace(/^flowchart LR/m, 'flowchart TD');
  }

  // Reset element so mermaid re-processes it
  mermaidBox.removeAttribute('data-processed');
  mermaidBox.innerHTML = '';
  mermaidBox.textContent = mmd;

  mermaid.run({ nodes: [mermaidBox] }).then(() => {
    attachMermaidNodeClickHandlers(mermaidBox);
    const mmdContainer = document.querySelector('#tab-mermaid .mermaid-render-box');
    if (mmdContainer && mmdContainer.resetZoom) mmdContainer.resetZoom();
    if (window.lucide) lucide.createIcons();
  }).catch(err => console.error('Mermaid render error:', err));
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

  // Expose reset zoom function (Fit to Screen)
  container.resetZoom = function() {
    const svg = container.querySelector('svg');
    if (!svg) {
      scale = 1; translateX = 0; translateY = 0;
      updateTransform();
      return;
    }
    const rect = container.getBoundingClientRect();
    
    let svgWidth = 0;
    let svgHeight = 0;
    
    // 1. Try viewBox first (most accurate for aspect ratio and designer's bounds)
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[ ,]+/);
      if (parts.length === 4) {
        svgWidth = parseFloat(parts[2]);
        svgHeight = parseFloat(parts[3]);
      }
    }
    
    // 2. Try getBBox if viewBox was invalid or not found
    if (!svgWidth || !svgHeight) {
      try {
        const bbox = svg.getBBox();
        svgWidth = bbox.width;
        svgHeight = bbox.height;
      } catch (e) {}
    }
    
    // 3. Fall back to absolute attributes (ignore % values)
    if (!svgWidth || !svgHeight) {
      const wAttr = svg.getAttribute('width');
      const hAttr = svg.getAttribute('height');
      if (wAttr && !wAttr.includes('%')) {
        svgWidth = parseFloat(wAttr);
      }
      if (hAttr && !hAttr.includes('%')) {
        svgHeight = parseFloat(hAttr);
      }
    }
    
    // 4. Ultimate fallback to client dimensions
    if (!svgWidth || !svgHeight) {
      svgWidth = svg.clientWidth;
      svgHeight = svg.clientHeight;
    }
    
    if (svgWidth && svgHeight) {
      // Force SVG to its intrinsic size to prevent browser from auto-scaling it via width="100%"
      svg.style.width = svgWidth + 'px';
      svg.style.height = svgHeight + 'px';

      const pad = 48; // padding
      const scaleX = (rect.width - pad) / svgWidth;
      const scaleY = (rect.height - pad) / svgHeight;
      
      // Calculate ideal fit scale
      const idealScale = Math.min(scaleX, scaleY, 1);
      
      // Limit how much it can zoom out so it doesn't become a microscopic line
      // For massive diagrams, 0.4 is a good lower bound so text is still identifiable
      scale = Math.max(0.4, idealScale);
      
      // If we had to bound the scale (meaning the diagram is huge), 
      // align to Top (TD) or Left (LR) instead of center, so user sees the START node.
      if (scale > idealScale) {
        if (typeof currentFlowchartOrientation !== 'undefined' && currentFlowchartOrientation === 'LR') {
           translateX = pad / 2; // Align left
           translateY = (rect.height - (svgHeight * scale)) / 2; // Center vertically
        } else {
           translateX = (rect.width - (svgWidth * scale)) / 2; // Center horizontally
           translateY = pad / 2; // Align top
        }
      } else {
        // Standard center alignment for smaller diagrams
        translateX = (rect.width - (svgWidth * scale)) / 2;
        translateY = (rect.height - (svgHeight * scale)) / 2;
      }
    } else {
      scale = 1;
      translateX = 0;
      translateY = 0;
    }
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

// ===== Báo cáo Tiếng Việt Loader =====
function renderTableHtml(headers, rows) {
  let thHtml = headers.map(h => `<th>${h}</th>`).join('');
  let trHtml = rows.map(r => {
    let tdHtml = r.map(c => `<td>${c}</td>`).join('');
    return `<tr>${tdHtml}</tr>`;
  }).join('');

  return `
    <div class="vi-phase-table-card">
      <div class="vi-table-wrapper">
        <table class="vi-table">
          <thead><tr>${thHtml}</tr></thead>
          <tbody>${trHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMarkdownToHtml(md) {
  if (!md) return '<p class="text-muted">Không có dữ liệu báo cáo.</p>';

  const lines = md.split(/\r?\n/);
  const processedLines = [];
  let inTable = false;
  let tableHeaders = [];
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHeaders = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        tableRows = [];
      } else if (/^\|[\s:\-\|]+\|$/.test(line)) {
        // Skip separator line
        continue;
      } else {
        const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        tableRows.push(cells);
      }
    } else {
      if (inTable) {
        processedLines.push(renderTableHtml(tableHeaders, tableRows));
        inTable = false;
        tableHeaders = [];
        tableRows = [];
      }
      processedLines.push(line);
    }
  }
  if (inTable) {
    processedLines.push(renderTableHtml(tableHeaders, tableRows));
  }

  let text = processedLines.join('\n');

  let html = text
    .replace(/^# (.*$)/gim, '<h1 style="color:var(--cyan);margin-top:10px;margin-bottom:16px;">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 style="color:var(--text-main);margin-top:24px;margin-bottom:12px;border-bottom:1px solid var(--border-color);padding-bottom:6px;">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 style="color:var(--indigo);margin-top:16px;margin-bottom:8px;">$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4 style="margin-top:12px;margin-bottom:6px;">$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--fill-05);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:12px;">$1</code>')
    .replace(/```([\s\S]*?)```/g, '<pre style="background:var(--code-bg);padding:14px;border-radius:8px;overflow-x:auto;border:1px solid var(--border-color);"><code style="font-family:var(--font-mono);">$1</code></pre>')
    .replace(/^\- (.*$)/gim, '<li style="margin-left:20px;margin-bottom:4px;">$1</li>')
    .replace(/^\* (.*$)/gim, '<li style="margin-left:20px;margin-bottom:4px;">$1</li>')
    .replace(/✅ Thành công/g, '<span class="vi-badge vi-badge-success">✅ Thành công</span>')
    .replace(/❌ Có lỗi/g, '<span class="vi-badge vi-badge-error">❌ Có lỗi</span>')
    .replace(/\n\n/g, '<br/>');

  return `<div class="vireport-container">${html}</div>`;
}

async function loadViReport() {
  const container = document.getElementById('vireport-content');
  if (!container) return;
  try {
    const taskPath = currentTaskId ? `tasks/${encodeURIComponent(currentTaskId)}/bao_cao_chi_tiet.md` : 'bao_cao_chi_tiet.md';
    const res = await fetch(taskPath);
    if (!res.ok) {
      container.innerHTML = '<p class="text-muted">Chưa tìm thấy file báo cáo Tiếng Việt cho task này. Hãy chạy lại parser để khởi tạo.</p>';
      return;
    }
    const text = await res.text();
    container.innerHTML = renderMarkdownToHtml(text);
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Lỗi khi tải báo cáo: ${err.message}</p>`;
  }
}
