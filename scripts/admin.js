import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db.js';
import { setPassword } from '../auth.js';

const directory = path.resolve(process.env.DATA_DIR || './data');
const db = openDatabase(directory);
try {
  if (process.argv[2] === 'password') {
    if (!process.stdin.isTTY) throw new Error('Use an interactive terminal (docker compose exec -it app npm run password).');
    let muted = false;
    const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
    const input = createInterface({ input: process.stdin, output, terminal: true });
    const ask = async prompt => { process.stdout.write(prompt); muted = true; const value = await input.question(''); muted = false; process.stdout.write('\n'); return value; };
    try {
      const current = db.prepare('SELECT username FROM account WHERE id=1').get()?.username || 'admin';
      const username = (await input.question(`Username [${current}]: `)).trim() || current;
      const first = await ask('New password (at least 12 characters): ');
      const second = await ask('Confirm password: ');
      if (first !== second) throw new Error('Passwords did not match. Nothing changed.');
      await setPassword(db, first, username);
      console.log('Username and password saved. Existing sessions have been signed out.');
    } finally { input.close(); }
  } else if (process.argv[2] === 'backup') {
    const filename = `poker-${new Date().toISOString().replaceAll(':', '-')}.sqlite3`;
    const destination = path.resolve(process.argv[3] || path.join(directory, 'backups', filename));
    if (destination === path.join(directory, 'poker.sqlite3')) throw new Error('Choose a different backup path.');
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    // SQLite produces a consistent snapshot, including committed WAL data, while the app runs.
    db.prepare('VACUUM INTO ?').run(destination);
    console.log(destination);
  } else throw new Error('Usage: node scripts/admin.js password | backup [destination]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { db.close(); }
