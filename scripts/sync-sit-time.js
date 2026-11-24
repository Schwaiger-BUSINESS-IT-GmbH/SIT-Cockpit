// Übernimmt die SIT-Time-Oberfläche (public/) in das Cockpit (public/zeiten/).
// Aufruf:  npm run sync:zeiten  [-- <Pfad zum SIT-Time-Repo>]   (Standard: ../SIT-Time)
//
// Cockpit-Anpassungen werden automatisch gesetzt:
//  - alle Pfade unter /zeiten/ (Schriften, Icons, Logos, CSS, JS, Manifest)
//  - eingebettet im Cockpit-iframe: eigene Kopfzeile ausblenden
//  - eigener Service Worker (sw.js des Cockpits bleibt), Cache-Version = SIT-Time-Version
// Serverseite: Das Skript merkt sich den übernommenen SIT-Time-Commit (public/zeiten/SOURCE).
// Änderungen an server/weclapp.js seither werden automatisch als Patch übernommen,
// alles andere (Routen in server/index.js -> server/time-routes.js, neue Dateien,
// neue Abhängigkeiten) wird gemeldet. Exit-Code 2 = von Hand nachziehen.
// --report <datei> schreibt das Ergebnis als JSON (für den GitHub-Workflow sync-zeiten.yml).
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoArg = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--report');
const srcRepo = path.resolve(root, repoArg || '../SIT-Time');
const src = path.join(srcRepo, 'public');
const dst = path.join(root, 'public', 'zeiten');
const B = '/zeiten/';

const read = (f) => fs.readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n');
const must = (s, re, what) => { if (!re.test(s)) throw new Error(`SIT-Time hat sich geändert: ${what} nicht gefunden`); return s; };

export function transform(file, s) {
  switch (file) {
    case 'index.html':
      s = s.replace(/(href|src)="\/(?=(fonts|icons|img)\/|manifest\.webmanifest|styles\.css|app\.js)/g, `$1="${B}`);
      return must(s, /<link rel="stylesheet" href="\/zeiten\/styles\.css">\n/, 'Stylesheet-Link')
        .replace(/(<link rel="stylesheet" href="\/zeiten\/styles\.css">\n)/, '$1  <script>if (window.top !== window) document.documentElement.classList.add("embedded");</script>\n');
    case 'styles.css':
      return s.replace(/url\("\/fonts\//g, `url("${B}fonts/`).replace(/\n*$/, '\n')
        + '\n/* Eingebettet im SIT-Cockpit: eigene Kopfzeile ausblenden (Cockpit hat Login/Logout) */\n.embedded .topbar { display: none; }\n';
    case 'app.js':
      // Versionsanzeige: SIT-Time-Version statt Cockpit-Version
      s = s.replace(/state\.version = me\.version;/g, 'state.version = me.timeVersion || me.version;');
      return must(s, /navigator\.serviceWorker\.register\('\/sw\.js'\)/, 'Service-Worker-Registrierung')
        .replace("navigator.serviceWorker.register('/sw.js')", `navigator.serviceWorker.register('${B}sw.js', { scope: '${B}' })`);
    case 'manifest.webmanifest':
      return s.replace(/"(start_url|scope)": "\/"/g, `"$1": "${B}"`).replace(/"src": "\/icons\//g, `"src": "${B}icons/`);
    default:
      return s;
  }
}

// Server-Dateien von SIT-Time und wie sie im Cockpit übernommen werden
//   patch  -> Diff wird direkt auf die Cockpit-Datei angewendet (weicht nur an wenigen Stellen ab)
//   info   -> nur Demo-/Testdaten, blockiert nicht
//   sonst  -> von Hand nachziehen (z. B. server/index.js -> server/time-routes.js)
const SERVER_MAP = {
  'server/weclapp.js': { mode: 'patch', target: 'server/weclapp.js' },
  'server/mock-weclapp.js': { mode: 'info', note: 'Demo-Daten: bei Bedarf in server/mock/weclapp.js bzw. weclapp-sales.js nachziehen' },
  // Routen stehen im Cockpit 1:1 (eingerückt) in server/time-routes.js; Login/Session/Start
  // gibt es dort nicht – betrifft ein Diff diese Teile, passt der Patch nicht und wird gemeldet
  'server/index.js': { mode: 'patch', target: 'server/time-routes.js', indent: '  ', note: 'Routen in server/time-routes.js nachziehen' },
};

/** wendet einen git-Diff auf eine Cockpit-Datei an (Zeilenenden egal); true = sauber angewendet */
function applyDiff(diff, target, { indent = '' } = {}) {
  const file = path.join(root, target);
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-sync-'));
  try {
    // Pfad im Diff (a/server/x.js) auf die Zieldatei umbiegen
    const name = 'target.js';
    fs.writeFileSync(path.join(tmp, name), raw.replace(/\r\n/g, '\n'));
    let patch = diff.replace(/\r\n/g, '\n').replace(/^(---|\+\+\+) [ab]\/\S+/gm, (m, p) => `${p} ${p === '---' ? 'a' : 'b'}/${name}`).replace(/^diff --git .*$/m, `diff --git a/${name} b/${name}`);
    // eingerückt übernehmen (SIT-Time-Routen stehen im Cockpit in einer Funktion): alle nicht leeren
    // Zeilen der Hunks einrücken; Leerzeilen mit/ohne Leerzeichen gleicht --ignore-whitespace aus
    if (indent) {
      let inHunk = false;
      patch = patch.split('\n').map((l) => {
        if (l.startsWith('@@')) { inHunk = true; return l; }
        if (!inHunk || !/^[ +-]./.test(l) || !l.slice(1).trim()) return l;
        return l[0] + indent + l.slice(1);
      }).join('\n');
    }
    fs.writeFileSync(path.join(tmp, 'p.diff'), patch);
    execFileSync('git', ['apply', '--recount', ...(indent ? ['--ignore-whitespace'] : []), 'p.diff'], { cwd: tmp, stdio: 'pipe' });
    const out = fs.readFileSync(path.join(tmp, name), 'utf8').replace(/\r\n/g, '\n'); // git apply kann je nach autocrlf CRLF schreiben
    fs.writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' ') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Routen rufen nur Funktionen auf, die es im Cockpit gibt (wc./store./work.) – sonst Liste der fehlenden */
export function missingFunctions() {
  const routes = fs.readFileSync(path.join(root, 'server/time-routes.js'), 'utf8').split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
  const mods = { wc: 'server/weclapp.js', store: 'server/store.js', work: 'server/worktime.js' };
  const missing = [];
  for (const [ns, file] of Object.entries(mods)) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    for (const fn of new Set([...routes.matchAll(new RegExp(`\\b${ns}\\.(\\w+)`, 'g'))].map((m) => m[1]))) {
      if (!new RegExp(`export\\s+(async\\s+)?(function\\*?|const|let|class)\\s+${fn}\\b|export\\s*\\{[^}]*\\b${fn}\\b`).test(code)) missing.push(`${ns}.${fn}`);
    }
  }
  return missing;
}

/** neue Abhängigkeiten in SIT-Time, die dem Cockpit fehlen */
function missingDeps() {
  const pkg = (p) => JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
  const mine = pkg(root).dependencies || {};
  return Object.keys(pkg(srcRepo).dependencies || {}).filter((d) => !(d in mine));
}

function main() {
  if (!fs.existsSync(src)) throw new Error(`SIT-Time nicht gefunden: ${src}`);
  const version = JSON.parse(fs.readFileSync(path.join(srcRepo, 'package.json'), 'utf8')).version;
  const report = { version, prev: null, head: null, server: [], deps: [], manual: false };
  const done = () => {
    report.manual = report.server.some((s) => s.mode === 'manual' || (s.mode === 'patch' && !s.ok)) || report.deps.length > 0;
    if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    if (report.manual) process.exitCode = 2;
  };
  for (const f of ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest']) {
    fs.writeFileSync(path.join(dst, f), transform(f, read(f)));
  }
  for (const dir of ['fonts', 'icons', 'img']) {
    fs.mkdirSync(path.join(dst, dir), { recursive: true });
    for (const f of fs.readdirSync(path.join(src, dir))) fs.copyFileSync(path.join(src, dir, f), path.join(dst, dir, f));
  }
  // Service Worker: Cockpit-Version behalten, Cache erneuern, damit Browser die neue Oberfläche laden
  const swPath = path.join(dst, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  fs.writeFileSync(swPath, sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'sit-cockpit-zeiten-${version}';`));
  fs.writeFileSync(path.join(dst, 'VERSION'), `${version}\n`);
  console.log(`SIT-Time ${version} nach public/zeiten übernommen.`);

  // Server-Änderungen seit der letzten Übernahme: weclapp.js automatisch patchen, Rest melden
  const git = (...a) => execFileSync('git', ['-C', srcRepo, ...a], { encoding: 'utf8', maxBuffer: 64e6 });
  let head;
  try { head = git('rev-parse', 'HEAD').trim(); } catch { console.warn('Kein git im SIT-Time-Ordner – Server-Änderungen bitte selbst prüfen.'); return done(); }
  const srcFile = path.join(dst, 'SOURCE');
  const prev = fs.existsSync(srcFile) ? fs.readFileSync(srcFile, 'utf8').trim() : '';
  Object.assign(report, { prev: prev || null, head });
  report.deps = missingDeps();
  if (report.deps.length) console.warn(`!!! Neue Abhängigkeiten in SIT-Time, im Cockpit fehlen: ${report.deps.join(', ')}`);
  if (!prev) {
    fs.writeFileSync(srcFile, `${head}\n`);
    console.warn('Erste Übernahme mit Commit-Merker: Server-Änderungen bitte einmalig selbst prüfen.');
    return done();
  }
  if (prev !== head) {
    const files = git('diff', '--name-only', prev, head, '--', 'server').split('\n').map((s) => s.trim()).filter(Boolean);
    for (const f of files) {
      const m = SERVER_MAP[f] || { mode: 'manual', note: 'neue/unbekannte Server-Datei – prüfen, ob das Cockpit sie braucht' };
      const entry = { file: f, mode: m.mode, note: m.note || null };
      if (m.mode === 'patch') {
        Object.assign(entry, applyDiff(git('diff', prev, head, '--', f), m.target, m), { target: m.target });
        console.log(`${entry.ok ? '✓' : '✗'} ${f} -> ${m.target}${entry.ok ? ' automatisch übernommen' : `: Patch passt nicht (${entry.error})`}`);
      } else {
        console.warn(`${m.mode === 'info' ? 'ℹ' : '!!!'} ${f}: ${entry.note}`);
      }
      report.server.push(entry);
    }
    report.missingFunctions = missingFunctions();
    if (report.missingFunctions.length) {
      console.warn(`!!! Routen rufen Funktionen auf, die im Cockpit fehlen: ${report.missingFunctions.join(', ')}`);
      report.server.push({ file: 'server/time-routes.js', mode: 'manual', note: `fehlende Funktionen: ${report.missingFunctions.join(', ')}` });
    }
    if (report.server.some((s) => s.mode === 'manual' || (s.mode === 'patch' && !s.ok))) {
      console.warn(`\nVon Hand nachziehen – Details: git -C ${srcRepo} diff ${prev.slice(0, 7)} ${head.slice(0, 7)} -- server\n`);
    }
  }
  fs.writeFileSync(srcFile, `${head}\n`);
  return done();
}

const args = process.argv.slice(2);
const reportFile = args.includes('--report') ? path.resolve(args[args.indexOf('--report') + 1]) : null;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
