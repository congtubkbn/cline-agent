import { execSync } from 'child_process';

try {
  console.log('--- Checking Git Status ---');
  const out = execSync('git status', { cwd: 'e:\\the.thoi\\Project\\cline-agent\\cline-agent', encoding: 'utf-8' });
  console.log(out);
} catch (err) {
  console.error('Git error:', err.message);
}
