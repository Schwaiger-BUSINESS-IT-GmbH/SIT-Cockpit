// Übernimmt die SIT-Time-Oberfläche (public/) in das Cockpit (public/zeiten/).
// Aufruf:  npm run sync:zeiten  [-- <Pfad zum SIT-Time-Repo>]   (Standard: ../SIT-Time)
//
// Cockpit-Anpassungen werden automatisch gesetzt:
//  - alle Pfade unter /zeiten/ (Schriften, Icons, Logos, CSS, JS, Manifest)
//  - eingebettet im Cockpit-iframe: eigene Kopfzeile ausblenden
//  - eigener Service Worker (sw.js des Cockpits bleibt), Cache-Version = SIT-Time-Version
// Die Serverseite (server/time-routes.js, server/weclapp.js) wird NICHT automatisch
// übernommen – Änderungen dort von Hand nachziehen. Dafür merkt sich das Skript den
// übernommenen SIT-Time-Commit (public/zeiten/SOURCE) und listet beim nächsten Lauf
// alle Server-Änderungen seither auf (Exit-Code 2 = Server nachziehen).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRepo = path.resolve(root, process.argv[2] || '../SIT-Time');
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

function main() {
  if (!fs.existsSync(src)) throw new Error(`SIT-Time nicht gefunden: ${src}`);
  const version = JSON.parse(fs.readFileSync(path.join(srcRepo, 'package.json'), 'utf8')).version;
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

  // Server-Änderungen seit der letzten Übernahme anzeigen (müssen von Hand nachgezogen werden)
  const git = (...a) => execFileSync('git', ['-C', srcRepo, ...a], { encoding: 'utf8' }).trim();
  let head;
  try { head = git('rev-parse', 'HEAD'); } catch { console.warn('Kein git im SIT-Time-Ordner – Server-Änderungen bitte selbst prüfen.'); return; }
  const srcFile = path.join(dst, 'SOURCE');
  const prev = fs.existsSync(srcFile) ? fs.readFileSync(srcFile, 'utf8').trim() : '';
  fs.writeFileSync(srcFile, `${head}\n`);
  if (!prev) { console.warn('Erste Übernahme mit Commit-Merker: Server-Änderungen bitte einmalig selbst prüfen.'); return; }
  if (prev === head) return;
  const stat = git('diff', '--stat', prev, head, '--', 'server');
  if (stat) {
    console.warn(`\n!!! SIT-Time-Server hat sich geändert (${prev.slice(0, 7)}..${head.slice(0, 7)}).`
      + ` In server/weclapp.js, server/time-routes.js und den Mocks nachziehen:\n${stat}\n`
      + `    Details: git -C ${srcRepo} diff ${prev.slice(0, 7)} ${head.slice(0, 7)} -- server\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
