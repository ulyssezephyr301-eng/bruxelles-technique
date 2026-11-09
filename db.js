const { createClient } = require('@libsql/client');

const url = (process.env.TURSO_URL || '').trim().replace(/^["']|["']$/g, '');
const authToken = (process.env.TURSO_TOKEN || '').trim().replace(/^["']|["']$/g, '');

const db = createClient({ url, authToken });

async function init() {
  if (!url || !authToken) throw new Error('TURSO_URL ou TURSO_TOKEN manquant sur Render');
  console.log('Turso :', url.slice(0, 22) + '…', '| token', authToken.length, 'caractères');

  const tables = [
    `CREATE TABLE IF NOT EXISTS giveaway (
      guild_id TEXT PRIMARY KEY, channel_id TEXT, message_id TEXT,
      start_ts INTEGER, end_ts INTEGER, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS invites (
      guild_id TEXT, user_id TEXT, code TEXT,
      PRIMARY KEY (guild_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS invited (
      guild_id TEXT, invited_id TEXT, inviter_id TEXT,
      status TEXT, has_left INTEGER DEFAULT 0, joined_ts INTEGER,
      PRIMARY KEY (guild_id, invited_id))`,
    `CREATE TABLE IF NOT EXISTS disq (
      guild_id TEXT, user_id TEXT, PRIMARY KEY (guild_id, user_id))`,
  ];
  for (const sql of tables) await db.execute(sql);
}

module.exports = { db, init };
