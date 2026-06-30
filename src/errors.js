const ERROR_PATTERNS = [
  // OS & Paths
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /Access is denied/i,
  /Permission denied/i,
  /no such file or directory/i,
  /cannot find the path/i,
  // Node.js & NPM
  /SyntaxError:/,
  /TypeError:/,
  /ReferenceError:/,
  /Cannot find module/i,
  /npm ERR!/,
  /ERR_[A-Z0-9_]+/,
  // Python
  /Traceback \(most recent call last\):/,
  /Exception:/,
  /ModuleNotFoundError:/,
  // PowerShell
  /ParserError:/i,
  /RedirectionNotSupported/i,
  // Git
  /fatal:/i,
  /conflict/i
];

export function detectError(outputText) {
  if (!outputText) return false;
  return ERROR_PATTERNS.some(pattern => pattern.test(outputText));
}
