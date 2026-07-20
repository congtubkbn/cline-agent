import { execSync } from 'child_process';
import fs from 'fs';

try {
  ['scratch_git_status.js', 'scratch_package_qa.js', 'scratch_sync_all.js'].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  execSync('git add -A', { cwd: 'e:\\the.thoi\\Project\\cline-agent\\cline-agent' });
  const status = execSync('git status --short', { cwd: 'e:\\the.thoi\\Project\\cline-agent\\cline-agent', encoding: 'utf-8' }).trim();
  if (status) {
    execSync('git commit -m "chore: clean scratch scripts"', { cwd: 'e:\\the.thoi\\Project\\cline-agent\\cline-agent' });
    execSync('git push origin main', { cwd: 'e:\\the.thoi\\Project\\cline-agent\\cline-agent' });
  }
  if (fs.existsSync('scratch_clean.js')) fs.unlinkSync('scratch_clean.js');
  console.log('Clean completed!');
} catch (e) {
  console.error(e.message);
}
