import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const digest = token => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password, salt) {
  return (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
}
export const normalizeUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export async function setPassword(db, password, username) {
  username = normalizeUsername(username ?? db.prepare('SELECT username FROM account WHERE id=1').get()?.username ?? 'admin');
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw new Error('Use a username of 3–64 letters, numbers, dots, underscores or hyphens, starting with a letter or number.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Use a password between 12 and 1,024 characters.');
  const salt = randomBytes(24).toString('hex'), hash = await hashPassword(password, salt);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT OR REPLACE INTO account (id,salt,hash,username) VALUES (1,?,?,?)').run(salt, hash, username);
    db.exec('DELETE FROM sessions; DELETE FROM throttle; COMMIT;');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function checkPassword(account, password) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const candidate = Buffer.from(await hashPassword(password, account.salt), 'hex');
  return timingSafeEqual(candidate, Buffer.from(account.hash, 'hex'));
}
