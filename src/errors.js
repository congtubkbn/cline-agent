// Advanced Error Detection Library for Agent Traces
// Provides structured error categorization, severity classification, and false-positive filtering.

export const ERROR_SEVERITY = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor'
};

export const ERROR_CATEGORY = {
  SYSTEM_PERMISSION: 'system-permission',
  SYNTAX_ERROR: 'syntax-error',
  DEPENDENCY_MISSING: 'dependency-missing',
  EXECUTION_FAILED: 'execution-failed',
  GIT_CONFLICT: 'git-conflict',
  TIMEOUT_LIMIT: 'timeout-limit',
  RATE_LIMIT: 'rate-limit',
  WARNING_NOTICE: 'warning-notice'
};

// Patterns that indicate FALSE POSITIVES (text containing error keywords in benign contexts)
const NEGATIVE_PATTERNS = [
  /no (merge )?conflicts?/i,
  /0 errors?,?\s*0 warnings?/i,
  /0 (failed|failures)/i,
  /syntax ok/i,
  /build (succeeded|successful)/i,
  /tests? passed/i,
  /error: 0\b/i
];

// Structured Rules Matrix
const ERROR_RULES = [
  // --- CRITICAL ---
  {
    name: 'permission-denied',
    category: ERROR_CATEGORY.SYSTEM_PERMISSION,
    severity: ERROR_SEVERITY.CRITICAL,
    patterns: [
      /Access is denied/i,
      /Permission denied/i,
      /EACCES/i,
      /operation not permitted/i,
      /sudo: a password is required/i
    ]
  },
  {
    name: 'syntax-error',
    category: ERROR_CATEGORY.SYNTAX_ERROR,
    severity: ERROR_SEVERITY.CRITICAL,
    patterns: [
      /SyntaxError:/,
      /TypeError:/,
      /ReferenceError:/,
      /ParserError:/i,
      /Uncaught Exception/i,
      /IndentationError:/
    ]
  },
  {
    name: 'out-of-memory',
    category: ERROR_CATEGORY.EXECUTION_FAILED,
    severity: ERROR_SEVERITY.CRITICAL,
    patterns: [
      /ERR_OUT_OF_MEMORY/i,
      /FATAL ERROR: .*Reached heap limit/i,
      /java\.lang\.OutOfMemoryError/i,
      /Killed\s+process/i
    ]
  },

  // --- MAJOR ---
  {
    name: 'command-not-found',
    category: ERROR_CATEGORY.DEPENDENCY_MISSING,
    severity: ERROR_SEVERITY.MAJOR,
    patterns: [
      /command not found/i,
      /is not recognized as an internal or external command/i,
      /Cannot find module/i,
      /ModuleNotFoundError:/,
      /No module named/i,
      /pkg_resources\.DistributionNotFound/i
    ]
  },
  {
    name: 'path-not-found',
    category: ERROR_CATEGORY.EXECUTION_FAILED,
    severity: ERROR_SEVERITY.MAJOR,
    patterns: [
      /no such file or directory/i,
      /cannot find the path/i,
      /ENOENT/i,
      /The system cannot find the file specified/i
    ]
  },
  {
    name: 'git-fatal-conflict',
    category: ERROR_CATEGORY.GIT_CONFLICT,
    severity: ERROR_SEVERITY.MAJOR,
    patterns: [
      /CONFLICT \(content\):/i,
      /CONFLICT \(add\/add\):/i,
      /fatal: (.*)/i,
      /Automatic merge failed;/i
    ]
  },
  {
    name: 'npm-build-error',
    category: ERROR_CATEGORY.EXECUTION_FAILED,
    severity: ERROR_SEVERITY.MAJOR,
    patterns: [
      /npm ERR!/,
      /ERR_[A-Z0-9_]+/,
      /Traceback \(most recent call last\):/,
      /Exception:/,
      /RedirectionNotSupported/i,
      /exit code [1-9]\d*/i,
      /process failed with code/i
    ]
  },
  {
    name: 'rate-limit-timeout',
    category: ERROR_CATEGORY.RATE_LIMIT,
    severity: ERROR_SEVERITY.MAJOR,
    patterns: [
      /429 Too Many Requests/i,
      /rate limit exceeded/i,
      /ETIMEDOUT/i,
      /Connection timed out/i
    ]
  },

  // --- MINOR ---
  {
    name: 'warning-notice',
    category: ERROR_CATEGORY.WARNING_NOTICE,
    severity: ERROR_SEVERITY.MINOR,
    patterns: [
      /DeprecationWarning:/i,
      /npm WARN/i,
      /warning:/i
    ]
  }
];

/**
 * Perform deep structured error analysis on output text.
 * @param {string} outputText 
 * @returns {object} Structured error details
 */
export function analyzeError(outputText) {
  if (!outputText || typeof outputText !== 'string') {
    return {
      hasError: false,
      severity: null,
      category: null,
      code: null,
      summary: null,
      evidenceSnippet: null,
      isFalsePositive: false
    };
  }

  // Check if output contains a known false positive pattern
  const isFalsePositive = NEGATIVE_PATTERNS.some(pat => pat.test(outputText));
  if (isFalsePositive) {
    return {
      hasError: false,
      severity: null,
      category: null,
      code: null,
      summary: null,
      evidenceSnippet: null,
      isFalsePositive: true
    };
  }

  // Scan rules matrix
  for (const rule of ERROR_RULES) {
    for (const pattern of rule.patterns) {
      const match = outputText.match(pattern);
      if (match) {
        // Extract surrounding line as evidence snippet
        const lines = outputText.split(/\r?\n/);
        const matchIndex = lines.findIndex(l => pattern.test(l));
        const snippet = matchIndex >= 0 ? lines[matchIndex].trim() : match[0];

        return {
          hasError: true,
          severity: rule.severity,
          category: rule.category,
          code: rule.name,
          summary: snippet.slice(0, 150),
          evidenceSnippet: snippet,
          isFalsePositive: false
        };
      }
    }
  }

  return {
    hasError: false,
    severity: null,
    category: null,
    code: null,
    summary: null,
    evidenceSnippet: null,
    isFalsePositive: false
  };
}

/**
 * Backward-compatible boolean error detector.
 * @param {string} outputText 
 * @returns {boolean}
 */
export function detectError(outputText) {
  return analyzeError(outputText).hasError;
}
