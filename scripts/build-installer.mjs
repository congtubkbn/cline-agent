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
const appDist = path.join(dist, 'app');
const skillDist = path.join(dist, 'skill', 'cline-agent');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const buildInfo = {
  name: 'cline-agent-analyzer',
  version: pkg.version,
  builtAt: new Date().toISOString()
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(appDist, { recursive: true });
fs.mkdirSync(skillDist, { recursive: true });

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
    outfile: path.join(appDist, entry)
  });
  console.log(`bundled ${entry}`);
}

// 2. Static dashboard assets (only the checked-in sources, never generated data).
const webDist = path.join(appDist, 'web');
fs.mkdirSync(webDist, { recursive: true });
fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(webDist, 'index.html'));
for (const [file, loader] of [['app.js', 'js'], ['style.css', 'css']]) {
  const source = fs.readFileSync(path.join(root, 'web', file), 'utf-8');
  const { code } = await transform(source, { loader, minify: true });
  fs.writeFileSync(path.join(webDist, file), code, 'utf-8');
  console.log(`minified web/${file}`);
}

// 3. Docs referenced by the skill.
const docsDist = path.join(appDist, 'docs');
fs.mkdirSync(docsDist, { recursive: true });
for (const doc of fs.readdirSync(path.join(root, 'docs'))) {
  if (doc.endsWith('.md')) {
    fs.copyFileSync(path.join(root, 'docs', doc), path.join(docsDist, doc));
  }
}

// 4. Minimal runtime package.json (type:module so the bundles load as ESM).
fs.writeFileSync(
  path.join(appDist, 'package.json'),
  JSON.stringify({
    name: buildInfo.name,
    version: buildInfo.version,
    private: true,
    type: 'module'
  }, null, 2) + '\n',
  'utf-8'
);

// 5. The distributable skill.
fs.copyFileSync(path.join(root, 'packaging', 'SKILL.dist.md'), path.join(skillDist, 'SKILL.md'));

// 6. Self-extracting installer: embed everything under dist/app and dist/skill.
function collect(baseDir) {
  const files = {};
  (function walk(dir) {
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
  app: collect(appDist),
  skill: collect(path.join(dist, 'skill', 'cline-agent'))
};

const template = fs.readFileSync(path.join(root, 'packaging', 'installer-template.mjs'), 'utf-8');
const installer = template
  .replace('__BUILD_INFO__', JSON.stringify(buildInfo))
  .replace('__MANIFEST_JSON__', JSON.stringify(manifest));
const installerPath = path.join(dist, 'cline-agent-installer.mjs');
fs.writeFileSync(installerPath, installer, 'utf-8');

const sizeKb = Math.round(fs.statSync(installerPath).size / 1024);
console.log(`\nBuilt ${path.relative(root, installerPath)} (${sizeKb} KB) — share this one file.`);
