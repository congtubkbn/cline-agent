/**
 * Algorithmic Phase Grouping & Macro Turn Aggregator
 * Group 200+ micro turns into 5-8 semantic phases & macro user interaction turns.
 */

// Tool Family Categorization
const PHASE_KIND_MAP = {
  // Initialization & Setup
  'useSkill': 'Initialization & Skill Activation',
  'task_progress': 'Initialization & Skill Activation',

  // Exploration & Information Gathering
  'list_dir': 'Exploration & Context Gathering',
  'grep_search': 'Exploration & Context Gathering',
  'file_search': 'Exploration & Context Gathering',
  'view_file': 'Exploration & Context Gathering',
  'readFile': 'Exploration & Context Gathering',
  'snapshot': 'Exploration & Context Gathering',

  // Code & Data Modification
  'write_to_file': 'Implementation & Modification',
  'replace_file_content': 'Implementation & Modification',
  'edit_file': 'Implementation & Modification',

  // Terminal & Browser Actions
  'command': 'Browser & Terminal Execution',
  'execute_command': 'Browser & Terminal Execution',
  'run_command': 'Browser & Terminal Execution',
  'click': 'Browser & Terminal Execution',
  'open': 'Browser & Terminal Execution',
  'eval': 'Browser & Terminal Execution',
  'wait': 'Browser & Terminal Execution',

  // Rendering & PDF Generation
  'render': 'Artifact Generation & Render',
  'pdf': 'Artifact Generation & Render',

  // Completion
  'completion_result': 'Task Completion & Wrap-up'
};

function getActionPhaseCategory(action) {
  if (!action) return 'General Execution';
  const toolName = action.what?.tool || action.kind || '';
  for (const [key, category] of Object.entries(PHASE_KIND_MAP)) {
    if (toolName.toLowerCase().includes(key.toLowerCase()) || 
       (action.what?.command && action.what.command.toLowerCase().includes(key.toLowerCase()))) {
      return category;
    }
  }
  return 'General Execution';
}

export function buildMacroTurnsAndPhases(turns) {
  if (!turns || !turns.length) {
    return { macroTurns: [], phases: [] };
  }

  const macroTurns = [];
  let currentMacro = null;

  // 1. Group into Macro Turns (User Session boundaries)
  for (const t of turns) {
    if (t.isUserInitiated || !currentMacro) {
      if (currentMacro) {
        currentMacro.tsEnd = turns[t.index - 1]?.tsEnd || currentMacro.tsStart;
        currentMacro.durationMs = currentMacro.tsEnd - currentMacro.tsStart;
        macroTurns.push(currentMacro);
      }
      currentMacro = {
        index: macroTurns.length,
        tsStart: t.tsStart,
        tsEnd: t.tsEnd,
        durationMs: 0,
        userPrompt: t.request?.text?.summary || t.request?.text?.preview || `Turn ${t.index}`,
        microTurnIndices: [t.index],
        microTurnsCount: 1,
        hasError: t.hasError,
        tokensIn: t.request?.tokensIn || 0,
        tokensOut: t.request?.tokensOut || 0,
        phases: []
      };
    } else {
      currentMacro.microTurnIndices.push(t.index);
      currentMacro.microTurnsCount++;
      currentMacro.tsEnd = t.tsEnd;
      currentMacro.tokensIn += (t.request?.tokensIn || 0);
      currentMacro.tokensOut += (t.request?.tokensOut || 0);
      if (t.hasError) currentMacro.hasError = true;
    }
  }
  if (currentMacro) {
    currentMacro.durationMs = currentMacro.tsEnd - currentMacro.tsStart;
    macroTurns.push(currentMacro);
  }

  // 2. Group Micro Turns into Semantic Phases
  const phases = [];
  let currentPhase = null;

  for (const t of turns) {
    const primaryAction = t.actions?.[0];
    const category = getActionPhaseCategory(primaryAction);

    if (!currentPhase || currentPhase.name !== category || t.isUserInitiated) {
      if (currentPhase) {
        currentPhase.durationMs = currentPhase.tsEnd - currentPhase.tsStart;
        phases.push(currentPhase);
      }
      currentPhase = {
        index: phases.length,
        name: category,
        tsStart: t.tsStart,
        tsEnd: t.tsEnd,
        durationMs: 0,
        turnRange: [t.index, t.index],
        turnCount: 1,
        hasError: t.hasError,
        anomalies: t.hasError ? [{ turn: t.index, details: t.errors }] : [],
        toolsUsed: new Set(t.actions.map(a => a.what?.tool || a.kind))
      };
    } else {
      currentPhase.turnRange[1] = t.index;
      currentPhase.turnCount++;
      currentPhase.tsEnd = t.tsEnd;
      if (t.hasError) {
        currentPhase.hasError = true;
        currentPhase.anomalies.push({ turn: t.index, details: t.errors });
      }
      t.actions.forEach(a => currentPhase.toolsUsed.add(a.what?.tool || a.kind));
    }
  }

  if (currentPhase) {
    currentPhase.durationMs = currentPhase.tsEnd - currentPhase.tsStart;
    phases.push(currentPhase);
  }

  // Convert toolsUsed Sets to Arrays
  const formattedPhases = phases.map(p => ({
    ...p,
    toolsUsed: Array.from(p.toolsUsed)
  }));

  // Attach phases to macro turns
  macroTurns.forEach(m => {
    m.phases = formattedPhases.filter(p => 
      p.turnRange[0] >= m.microTurnIndices[0] && 
      p.turnRange[1] <= m.microTurnIndices[m.microTurnIndices.length - 1]
    );
  });

  return { macroTurns, phases: formattedPhases };
}
