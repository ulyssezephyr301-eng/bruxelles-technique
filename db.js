const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

async function init() {
  await db.batch([
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
  ], 'write');
}

module.exports = { db, init };
