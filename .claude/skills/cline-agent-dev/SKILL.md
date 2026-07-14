---
name: cline-agent-dev
description: >-
  Developer skill for the Cline Agent Loop Analyzer — package the analyzer into a shareable
  single-file installer. Triggers on phrases like "package the analyzer", "build the installer",
  "npm run package". Only available locally in this developer repository.
---

# Cline Agent Analyzer — Developer Packaging Skill

This skill builds the shareable, minified installer (`dist/cline-agent-installer.mjs`) from this repository.

## Step 1 — Verify dependencies

Make sure `esbuild` is installed (it is needed for bundling and minification). If it isn't, run:

```bash
npm install
```

## Step 2 — Build package

Run the packaging script from the repository root:

```bash
npm run package
```

Upon success, this builds:
- `dist/cline-agent-installer.mjs` (the self-extracting installer)
- `dist/app/` (minified app bundle for checking)
- `dist/skill/cline-agent/SKILL.md` (the distributed skill, generated automatically by processing the local `cline-agent` skill)

Explain to the user that `dist/cline-agent-installer.mjs` is the ONLY file they need to share. Running `node cline-agent-installer.mjs` on the recipient's machine installs both the app and the user skill.
