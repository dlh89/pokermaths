import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDatabase, recordReview, progressMeasurements } from './db.js';
import { checkPassword, digest, normalizeUsername } from './auth.js';
import { SKILLS, LEVELS, DIFFICULTIES, DAY, categoryOf } from './engine.js';

import { parsePractice, nextQuestion } from './questions.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createApp({ dataDir = process.env.DATA_DIR || path.join(root, 'data'), origin = process.env.APP_ORIGIN || 'http://127.0.0.1:8766', production = process.env.NODE_ENV === 'production', now = Date.now } = {}) {
  if (new URL(origin).origin !== origin || (production && !origin.startsWith('https://'))) throw new Error('APP_ORIGIN must be an exact origin; HTTPS is required in production.');
  const db = openDatabase(dataDir);
  const cookieName = production ? '__Host-poker' : 'poker_session';
  const setCookie = (token, age = 30 * DAY / 1000) => `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`;
  const assets = Object.fromEntries([['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/table.js', 'table.js', 'text/javascript'], ['/tips.js', 'tips.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'], ['/favicon.svg', 'favicon.svg', 'image/svg+xml']].map(([route, file, type]) => [route, { body: readFileSync(path.join(root, 'static', file)), type }]));
  async function handler(req, res) {
    const reply = (status, data, extra = {}) => {
      const body = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}), ...extra });
      res.end(body);
    };
    try {
      const route = new URL(req.url, origin).pathname, time = now();
      if (req.method === 'GET' && assets[route]) return reply(200, assets[route].body, { 'Content-Type': `${assets[route].type}; charset=utf-8` });
      if (!route.startsWith('/api/')) return reply(404, { error: 'Not found.' });
      if (!['GET', 'POST'].includes(req.method)) return reply(405, { error: 'Method not allowed.' });
      let body = {};
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['x-maths-request'] !== '1') return reply(403, { error: 'Open your practice page to make this request.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Expected JSON.' });
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(413, { error: 'Request too large.' }); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return reply(400, { error: 'Invalid JSON.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request.' });
      }
      if (route === '/api/login' && req.method === 'POST') {
        // Reserve the attempt before awaiting the hash: concurrent requests cannot bypass the limit.
        const throttle = db.prepare('SELECT * FROM throttle WHERE id=1').get();
        if (throttle && time - throttle.since < 900_000 && throttle.failures >= 10) return reply(429, { error: 'Too many attempts. Try again in 15 minutes.' });
        if (throttle && time - throttle.since >= 900_000) db.exec('DELETE FROM throttle');
        const account = db.prepare('SELECT * FROM account WHERE id=1').get();
        if (!account) return reply(503, { error: 'Run npm run password on the server to set your username and password first.' });
        db.prepare('INSERT INTO throttle VALUES (1,1,?) ON CONFLICT(id) DO UPDATE SET failures=failures+1').run(time);
        const passwordMatches = await checkPassword(account, body.password);
        if (!passwordMatches || normalizeUsername(body.username) !== account.username) return reply(401, { error: 'Username or password didn’t match.' });
        // A password reset during verification must not create a session for the old password.
        if (db.prepare('SELECT hash FROM account WHERE id=1').get().hash !== account.hash) return reply(401, { error: 'Password changed. Please sign in again.' });
        const token = randomBytes(32).toString('base64url');
        db.exec('DELETE FROM throttle');
        db.prepare('DELETE FROM sessions WHERE expires < ?').run(time);
        db.prepare('INSERT INTO sessions VALUES (?,?)').run(digest(token), time + 30 * DAY);
        return reply(200, { ok: true }, { 'Set-Cookie': setCookie(token) });
      }
      const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
      if (!db.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires>?').get(digest(token), time)) return reply(401, { error: 'Please sign in.' });
      if (route === '/api/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
        return reply(200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
      }
      if (route === '/api/state' && req.method === 'GET') {
        const bands = db.prepare('SELECT * FROM bands ORDER BY skill,level').all();
        return reply(200, { bands, now: time, due: bands.filter(b => b.due <= time).length,
          total: db.prepare('SELECT count(*) AS n FROM reviews').get().n,
          skills: Object.entries(SKILLS).map(([id, s]) => ({ id, name: s.name, category: categoryOf(id) })), levels: LEVELS,
          difficulties: DIFFICULTIES, measurements: progressMeasurements(db) });
      }
      if (route === '/api/question' && req.method === 'POST') {
        return reply(200, nextQuestion(db, parsePractice(body), time));
      }
      if (route === '/api/review-next' && req.method === 'POST') {
        if (typeof body.id !== 'string' || !['missed', 'slow', 'comfortable'].includes(body.rating)) return reply(400, { error: 'Unknown answer rating.' });
        // Validate selection before saving. A lost response can safely retry the same review ID.
        const practice = parsePractice(body.practice);
        const result = recordReview(db, body.id, body.rating, time, body);
        return reply(200, { ...result, next: nextQuestion(db, practice, time) });
      }
      if (route === '/api/review' && req.method === 'POST') {
        if (typeof body.id !== 'string' || !['missed', 'slow', 'comfortable'].includes(body.rating)) return reply(400, { error: 'Unknown answer rating.' });
        return reply(200, recordReview(db, body.id, body.rating, time, body));
      }
      if (route === '/api/export' && req.method === 'GET') return reply(200, {
        version: 2, exportedAt: time, bands: db.prepare('SELECT * FROM bands').all(),
        reviews: db.prepare('SELECT r.*,q.skill,q.level,q.payload FROM reviews r JOIN questions q ON q.id=r.question_id ORDER BY r.at').all(),
      }, { 'Content-Disposition': 'attachment; filename="poker-maths-progress.json"' });
      return reply(404, { error: 'Not found.' });
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.message);
      if (!res.headersSent) reply(error.status || 500, { error: error.status ? error.message : 'Could not save or load data. Please retry; your local answer is kept.' });
    }
  }
  const server = http.createServer(handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, db };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { server, db } = createApp();
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 8766);
  server.listen(port, host, () => console.log(`Poker maths: ${process.env.APP_ORIGIN || `http://${host}:${port}`}`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
