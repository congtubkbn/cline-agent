#!/usr/bin/env node
/*
 * Build the shareable distribution of the Cline Agent Loop Analyzer.
 *
 *   npm run package
 *
 * Produces:
 *   dist/app/                      minified app bundle (parser/clean/serve + web + docs)
 *   dist/skill/cline-agent/        the distributable skill
 *   dist/cline-agent-installer.mjs single self-extracting installer — the ONLY
 *                                  file you need to share with other machines
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const skillDist = path.join(dist, 'skill', 'cline-agent');
const scriptsDist = path.join(skillDist, 'scripts');
const webDist = path.join(scriptsDist, 'web');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const buildInfo = {
  name: 'cline-agent-analyzer',
  version: pkg.version,
  builtAt: new Date().toISOString()
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(skillDist, { recursive: true });
fs.mkdirSync(scriptsDist, { recursive: true });
fs.mkdirSync(webDist, { recursive: true });

// 1. Bundle each entry point (src/ gets inlined) into a single minified file.
const banner = `/* ${buildInfo.name} v${buildInfo.version} (${buildInfo.builtAt}) — generated bundle, do not edit */`;
for (const entry of ['parser.js', 'clean.js', 'serve.mjs']) {
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    banner: { js: banner },
    outfile: path.join(scriptsDist, entry)
  });
  console.log(`bundled scripts/${entry}`);
}

// 2. Static dashboard assets (only the checked-in sources, never generated data).
fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(webDist, 'index.html'));
for (const [file, loader] of [['app.js', 'js'], ['style.css', 'css']]) {
  const source = fs.readFileSync(path.join(root, 'web', file), 'utf-8');
  const { code } = await transform(source, { loader, minify: true });
  fs.writeFileSync(path.join(webDist, file), code, 'utf-8');
  console.log(`minified scripts/web/${file}`);
}


// 4. Minimal runtime package.json (type:module so the bundles load as ESM).
fs.writeFileSync(
  path.join(skillDist, 'package.json'),
  JSON.stringify({
    name: buildInfo.name,
    version: buildInfo.version,
    private: true,
    type: 'module'
  }, null, 2) + '\n',
  'utf-8'
);

// 5. The distributable skill (generated from the repo's SKILL.md to ensure they stay in sync).
let skillContent = fs.readFileSync(path.join(root, '.claude', 'skills', 'cline-agent', 'SKILL.md'), 'utf-8');

// Preprocess: remove local-only blocks (none in the simplified file, but good for future extension)
skillContent = skillContent.replace(/<!-- #exclude-dist-start -->[\s\S]*?<!-- #exclude-dist-end -->/g, '');

// Preprocess: uncomment dist-only blocks (none in the simplified file, but good for future extension)
skillContent = skillContent.replace(/<!-- #include-dist-start\s*([\s\S]*?)\s*#include-dist-end -->/g, '$1');

// Preprocess: replace repo commands/paths with distributed skill-dir paths
skillContent = skillContent
  .replace(/npm run clean/g, 'node "<SKILL_DIR>/scripts/clean.js"')
  .replace(/node serve\.mjs/g, 'node "<SKILL_DIR>/scripts/serve.mjs"')
  .replace(/node parser\.js/g, 'node "<SKILL_DIR>/scripts/parser.js"');

// Preprocess: replace local intro description and file setup instructions
const searchHeader = '# Cline Agent Analyzer\n\nThis skill runs the Cline Agent Loop Analyzer (this repository) for the user. It\nexposes two operations behind a menu: **Clean** (reset generated output) and\n**Live-debug** (parse a Cline log and open the interactive dashboard).';

const replacementHeader = `# Cline Agent Analyzer (installed distribution)

This skill drives the Cline Agent Loop Analyzer **installed as a self-contained skill** on this
machine. All commands run against the skill install directory:

- Windows: \`%\u0055SERPROFILE%\\.agents\\skills\\cline-agent\`
- macOS / Linux: \`~/.agents/skills/cline-agent\`

Call that path \`<SKILL_DIR>\` below. Resolve it first (e.g. in bash:
\`SKILL_DIR="$HOME/.agents/skills/cline-agent"\`; in PowerShell:
\`$SKILL_DIR = "$env:USERPROFILE\\.agents\\skills\\cline-agent"\`).

**Before anything else**, verify the skill is installed: \`<SKILL_DIR>/version.json\`
must exist. If it doesn't, stop and tell the user to run the installer they
were given (\`node cline-agent-installer.mjs\`) — do not try to reconstruct the
app. To report the installed version, read \`version.json\` (fields: \`name\`,
\`version\`, \`builtAt\`).

This skill exposes two operations behind a menu: **Clean** (reset generated
output) and **Live-debug** (parse a Cline log and open the interactive
dashboard).`;

skillContent = skillContent.replace(searchHeader, replacementHeader);

// Preprocess: update description in frontmatter to refer to node commands instead of npm/node
skillContent = skillContent.replace(
  /description: >-[\s\S]*?flow stay consistent\./,
  `description: >-
  Drive the Cline Agent Loop Analyzer (installed skill) — clean generated
  artifacts or run a live-debug session on a Cline execution log. Use this
  skill whenever the user wants to analyze, debug, replay, or visualize a Cline
  agent run, parse a \`ui_messages.json\` log folder, clean the analyzer output,
  or open the analyzer dashboard at http://localhost:8099/. Triggers on phrases
  like "cline-agent", "analyze this cline log", "live debug the agent loop",
  "clean the analyzer", "parse my cline run", "open the cline dashboard", or
  any request to inspect a Cline agent's reasoning/turns. Prefer this skill
  over running node commands by hand so the serve\u2192watch\u2192open flow stays
  consistent.`
);

fs.writeFileSync(path.join(skillDist, 'SKILL.md'), skillContent, 'utf-8');

// 6. Self-extracting installer: embed everything under dist/skill.
function collect(baseDir) {
  const files = {};
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files[path.relative(baseDir, full).split(path.sep).join('/')] =
        fs.readFileSync(full).toString('base64');
    }
  })(baseDir);
  return files;
}

const manifest = {
  skill: collect(skillDist)
};

const template = fs.readFileSync(path.join(root, 'packaging', 'installer-template.mjs'), 'utf-8');
const installer = template
  .replace('__BUILD_INFO__', JSON.stringify(buildInfo))
  .replace('__MANIFEST_JSON__', JSON.stringify(manifest));
const installerPath = path.join(dist, 'cline-agent-installer.mjs');
fs.writeFileSync(installerPath, installer, 'utf-8');

const assetsDir = path.join(root, 'assets');
if (fs.existsSync(assetsDir)) {
  const assetsInstallerPath = path.join(assetsDir, 'cline-agent-installer.mjs');
  fs.writeFileSync(assetsInstallerPath, installer, 'utf-8');
  console.log(`Copied updated installer to assets/cline-agent-installer.mjs`);
}

const sizeKb = Math.round(fs.statSync(installerPath).size / 1024);
console.log(`\nBuilt ${path.relative(root, installerPath)} (${sizeKb} KB) — share this one file.`);
