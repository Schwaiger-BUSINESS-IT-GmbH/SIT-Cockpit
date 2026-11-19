// Startet das Cockpit im Demo-Modus: Atera und weclapp werden mit Beispieldaten
// simuliert (im selben Prozess). Login-Token: demo-rene
import { spawn } from 'node:child_process';

const env = { ...process.env, DEMO: '1' };
const p = spawn(process.execPath, ['server/index.js'], { env, stdio: 'inherit' });
const stop = () => { p.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
