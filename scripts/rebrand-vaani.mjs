#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = /\\dograh-local\\|\\node_modules\\|\\.agents\\|\\.git\\|\\.cursor\\/;

const exts = new Set(['.md', '.js', '.jsx', '.mjs', '.sh', '.ps1', '.json', '.example', '.css', '.html', '.txt']);

const reps = [
  ['Vaani AI Voice Platform', 'Vaani AI Voice Platform'],
  ['Vaani AI Console', 'Vaani AI Console'],
  ['Vaani AI', 'Vaani AI'],
  ['Vaani AI Agency OS', 'Vaani AI Agency OS'],
  ['Vaani AI', 'Vaani AI'],
  ['Vaani Demo', 'Vaani Demo'],
  ['Vaani Test', 'Vaani Test'],
  ['Vaani Agency QA', 'Vaani Agency QA'],
  ['vaani-ai-voice-platform', 'vaani-ai-voice-platform'],
  ['vaani-ai-console', 'vaani-ai-console'],
  ['/opt/vaani-ai', '/opt/vaani-ai'],
  ['vaani-ai', 'vaani-ai'],
  ['demo@vaani.ai', 'demo@vaani.ai'],
  ['vaaniai', 'vaaniai'],
  ['vaani_sess', 'vaani_sess'],
  ['vaani_demo_', 'vaani_demo_'],
  ['----VaaniAI', '----VaaniAI'],
  ['vaani.ai', 'vaani.ai'],
  ['@vaani.ai', '@vaani.ai'],
  ['vaani-local-dev-key', 'vaani-local-dev-key'],
  ['vaani-credentials', 'vaani-credentials'],
  ['vaani-iso-', 'vaani-iso-'],
  ['vaani-agency-os-', 'vaani-agency-os-'],
  ['VaaniCharts', 'VaaniCharts'],
  ['You are Vaani AI,', 'You are Vaani AI,'],
  ['Vaani AI Admin', 'Vaani AI Admin'],
  ['Vaani AI Dashboard', 'Vaani AI Dashboard'],
  ['Vaani AI', 'Vaani AI'],
  ['name vaani-ai', 'name vaani-ai'],
  ['`vaani_', '`vaani_'],
];

let updated = 0;

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!skip.test(p)) walk(p);
      continue;
    }
    if (!exts.has(path.extname(ent.name))) continue;
    if (skip.test(p)) continue;
    let text = fs.readFileSync(p, 'utf8');
    const orig = text;
    for (const [from, to] of reps) text = text.split(from).join(to);
    if (text !== orig) {
      fs.writeFileSync(p, text);
      updated += 1;
    }
  }
}

walk(root);
console.log(`Rebrand complete. Updated ${updated} files.`);
