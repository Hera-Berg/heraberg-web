#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────
   build.mjs — the "drop a folder and it updates" engine.

   Scans  projects/<name>/project.json  and writes
   public/projects.json  in the exact shape your index.html expects:
     { id, name, tagline, why, what, tech[], url, status }

   Run once:        node build.mjs
   Watch mode:      node build.mjs --watch
     → rebuilds automatically whenever you drop/edit a project folder.

   project.json fields it reads (extra fields like port/gated/subdomain
   are used by server.mjs, ignored here):
     id, name, tagline, why, what, tech, subdomain, status, gated
   url is derived from subdomain →  https://<subdomain>.heraberg.com
─────────────────────────────────────────────────────────────── */

import { readdirSync, readFileSync, writeFileSync, existsSync, watch, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, 'projects');
const AI_PROJECTS_DIR = join(__dirname, 'ai-projects');   // The Lab — AI experiments
const PUBLIC_DIR = join(__dirname, 'public');
const OUT = join(PUBLIC_DIR, 'projects.json');
const AI_OUT = join(PUBLIC_DIR, 'ai.json');               // The Lab data file
const CONTENT_DIR = join(__dirname, 'content');           // hand-edited site content
const PROFICIENCY_SRC = join(CONTENT_DIR, 'proficiency.json');
const PROFICIENCY_OUT = join(PUBLIC_DIR, 'proficiency.json');
const DOMAIN = process.env.DOMAIN || 'heraberg.com';
// LOCAL=1 makes the poster link to http://<sub>.localhost:<PORT> instead of
// https://<sub>.heraberg.com — for testing the whole thing on your machine.
const LOCAL = process.env.LOCAL === '1' || process.env.LOCAL === 'true';
const LOCAL_PORT = process.env.PORT || 8080;

function projectUrl(meta) {
  if (meta.url) return meta.url;            // explicit override always wins
  if (!meta.subdomain) return '';
  return LOCAL
    ? `http://${meta.subdomain}.localhost:${LOCAL_PORT}`
    : `https://${meta.subdomain}.${DOMAIN}`;
}

function build() {
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  const projects = [];

  if (existsSync(PROJECTS_DIR)) {
    const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)); // stable order; prefix folders 01-,02- to control it

    for (const d of dirs) {
      const metaPath = join(PROJECTS_DIR, d.name, 'project.json');
      if (!existsSync(metaPath)) continue;
      let meta;
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); }
      catch (e) { console.warn(`✗ ${d.name}: bad project.json (${e.message})`); continue; }

      const status = meta.status || 'wip';
      const url = projectUrl(meta);

      projects.push({
        id: meta.id || d.name,
        name: meta.name || d.name,
        tagline: meta.tagline || '',
        why: meta.why || '',
        what: meta.what || '',
        tech: Array.isArray(meta.tech) ? meta.tech : [],
        url: status === 'live' ? url : '',
        github: meta.github || '',
        status,
      });
    }
  }

  writeFileSync(OUT, JSON.stringify(projects, null, 2));
  const stamp = new Date().toLocaleTimeString();
  console.log(`[${stamp}] wrote ${projects.length} project(s) → public/projects.json`);
  projects.forEach(p => console.log(`   · ${p.name}  [${p.status}]  ${p.url || '—'}`));
}

/* ── Proficiency: copy content/proficiency.json → public/ ───────
   It's a hand-edited file with two sections (bars + strengths).
   build.mjs just validates it's parseable and copies it so the
   page can fetch it, keeping the same "edit source, build regen
   public/" workflow as everything else.
─────────────────────────────────────────────────────────────── */
function buildProficiency() {
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  const stamp = new Date().toLocaleTimeString();
  if (!existsSync(PROFICIENCY_SRC)) {
    console.warn(`[${stamp}] content/proficiency.json not found — page will use inline defaults`);
    return;
  }
  try {
    const raw = readFileSync(PROFICIENCY_SRC, 'utf8');
    const data = JSON.parse(raw);                       // validate it parses
    const bars = Array.isArray(data.bars) ? data.bars.length : 0;
    const str  = Array.isArray(data.strengths) ? data.strengths.length : 0;
    writeFileSync(PROFICIENCY_OUT, raw);                // copy verbatim
    console.log(`[${stamp}] wrote proficiency.json → ${bars} bar(s), ${str} strength(s)`);
  } catch (e) {
    console.warn(`[${stamp}] ✗ content/proficiency.json is invalid JSON (${e.message}) — keeping previous`);
  }
}

/* ── The Lab: AI experiments in ai-projects/<name>/project.json ──
   Same idea as the main projects, but these render as the smaller
   "link cards" in the #deep section, and use ports 9000+.
   Fields read: tag, name, blurb, subdomain, port, github, status, url
─────────────────────────────────────────────────────────────── */
function buildAILab() {
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  const items = [];

  if (existsSync(AI_PROJECTS_DIR)) {
    const dirs = readdirSync(AI_PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const d of dirs) {
      const metaPath = join(AI_PROJECTS_DIR, d.name, 'project.json');
      if (!existsSync(metaPath)) continue;
      let meta;
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); }
      catch (e) { console.warn(`✗ ${d.name}: bad project.json (${e.message})`); continue; }

      const status = meta.status || 'wip';
      // demo URL: the live subdomain link if the project is live, else empty
      const demo = (status === 'live' && (meta.url || meta.subdomain)) ? projectUrl(meta) : '';

      items.push({
        id: meta.id || d.name,
        tag: meta.tag || 'ai',
        name: meta.name || d.name,
        blurb: meta.blurb || meta.tagline || '',
        demo,                          // live demo link (subdomain/localhost)
        github: meta.github || '',     // repository link
        status,
      });
    }
  }

  writeFileSync(AI_OUT, JSON.stringify(items, null, 2));
  const stamp = new Date().toLocaleTimeString();
  console.log(`[${stamp}] wrote ${items.length} lab item(s) → public/ai.json`);
  items.forEach(p => console.log(`   · ${p.name}  [${p.status}]  ${p.demo || p.github || '—'}`));
}

build();
buildAILab();
buildProficiency();

if (process.argv.includes('--watch')) {
  console.log('👀 watching projects/, ai-projects/, content/ — drop a folder or edit to update the site…');
  let timer;
  const trigger = () => { clearTimeout(timer); timer = setTimeout(() => { build(); buildAILab(); buildProficiency(); }, 300); };
  if (existsSync(PROJECTS_DIR)) watch(PROJECTS_DIR, { recursive: true }, trigger);
  else console.warn('projects/ does not exist yet — create it, then restart watch.');
  if (existsSync(AI_PROJECTS_DIR)) watch(AI_PROJECTS_DIR, { recursive: true }, trigger);
  else console.warn('ai-projects/ does not exist yet — create it, then restart watch.');
  if (existsSync(CONTENT_DIR)) watch(CONTENT_DIR, { recursive: true }, trigger);
  else console.warn('content/ does not exist yet — create it, then restart watch.');
}
