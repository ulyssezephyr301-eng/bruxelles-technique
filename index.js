const http = require('http');
const {
  Client, GatewayIntentBits, Partials, SlashCommandBuilder, MessageFlags,
} = require('discord.js');
const cfg = require('./config');
const { db, init } = require('./db');
const gw = require('./giveaway');
const tickets = require('./tickets');
const effectif = require('./effectif');
const voc = require('./vocal');
const help = require('./commandes');

http.createServer((req, res) => { res.writeHead(200); res.end('ok'); })
  .listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

let cache = new Map();
async function snapshot(guild) {
  const inv = await guild.invites.fetch();
  cache = new Map(inv.map((i) => [i.code, i.uses || 0]));
  return inv;
}

const isStaff = (m) => m.roles.cache.hasAny(...cfg.STAFF_ROLES);

const giveawayCommand = new SlashCommandBuilder()
  .setName('giveaway').setDescription('Gérer le giveaway d’invitations')
  .addSubcommand((s) => s.setName('creer').setDescription('Poster le giveaway')
    .addChannelOption((o) => o.setName('salon').setDescription('Salon du giveaway')))
  .addSubcommand((s) => s.setName('terminer').setDescription('Terminer le giveaway maintenant'))
  .addSubcommand((s) => s.setName('disqualifier').setDescription('Disqualifier un membre')
    .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)))
  .toJSON();

client.once('clientReady', async () => {
  await init();
  const guild = await client.guilds.fetch(cfg.GUILD_ID);
  const cmds = await guild.commands.set([
    giveawayCommand, tickets.ticketCommand, help.commandesCommand, effectif.effectifCommand,
  ]);
  help.setIds(cmds);
  await snapshot(guild).catch((e) => console.error('snapshot', e.message));

  tickets.ensurePanel(client).catch((e) => console.error('panneau', e.message));
  setInterval(() => tickets.ensurePanel(client).catch(() => {}), 5 * 60 * 1000);

  effectif.ensureEffectif(client, 'refresh').catch((e) => console.error('effectif', e.message));
  setInterval(() => effectif.ensureEffectif(client, 'check').catch(() => {}), 5 * 60 * 1000);

  console.log('[boot] module vocal chargé, vérification des salons déclencheurs…');
  voc.sweep(client).catch((e) => console.error('[vocal] sweep', e));

  setInterval(async () => {
    const g = await gw.getActive(cfg.GUILD_ID);
    if (g && g.status === 'active' && Date.now() >= Number(g.end_ts)) await gw.finish(client);
  }, 30000);
  console.log(`✅ Connecté : ${client.user.tag}`);
});

client.on('inviteCreate', (i) => cache.set(i.code, i.uses || 0));
client.on('inviteDelete', (i) => cache.delete(i.code));

client.on('voiceStateUpdate', (oldS, newS) => {
  if (oldS.channelId !== newS.channelId) {
    console.log(`[voice] ${newS.member?.user.tag} : ${oldS.channelId || '—'} → ${newS.channelId || '—'}`);
  }
  voc.onVoiceUpdate(oldS, newS).catch((e) => console.error('[vocal]', e));
});

client.on('messageDelete', (m) => {
  tickets.onMessageDelete(m, client).catch(() => {});
  effectif.onMessageDelete(m, client).catch(() => {});
});
client.on('channelDelete', (c) => {
  tickets.onChannelDelete(c, client).catch(() => {});
  voc.onChannelDelete(c).catch(() => {});
});

client.on('guildMemberAdd', async (m) => {
  if (m.user.bot || m.guild.id !== cfg.GUILD_ID) return;
  const inv = await m.guild.invites.fetch().catch(() => null);
  if (!inv) return;
  let used = null;
  for (const i of inv.values()) {
    if ((i.uses || 0) > (cache.get(i.code) || 0)) { used = i; break; }
  }
  cache = new Map(inv.map((i) => [i.code, i.uses || 0]));
  if (!used) return;

  const r = await db.execute({
    sql: 'SELECT user_id FROM invites WHERE guild_id=? AND code=?', args: [m.guild.id, used.code],
  });
  const inviter = r.rows[0]?.user_id;
  if (!inviter || inviter === m.id) return;

  const ex = await db.execute({
    sql: 'SELECT 1 FROM invited WHERE guild_id=? AND invited_id=?', args: [m.guild.id, m.id],
  });
  if (ex.rows.length) {
    await db.execute({ sql: 'UPDATE invited SET has_left=0 WHERE guild_id=? AND invited_id=?', args: [m.guild.id, m.id] });
  } else {
    const now = Date.now();
    if (now < cfg.START || now > cfg.END) return;
    await db.execute({
      sql: "INSERT INTO invited (guild_id, invited_id, inviter_id, status, has_left, joined_ts) VALUES (?,?,?,'pending',0,?)",
      args: [m.guild.id, m.id, inviter, now],
    });
  }
  gw.scheduleRefresh(client);
});

client.on('guildMemberUpdate', async (oldM, newM) => {
  effectif.onMemberUpdate(oldM, newM, client);
  if (newM.guild.id !== cfg.GUILD_ID) return;
  if (!newM.roles.cache.has(cfg.CIVIL_ROLE)) return;
  const r = await db.execute({
    sql: "UPDATE invited SET status='validated' WHERE guild_id=? AND invited_id=? AND status='pending'",
    args: [newM.guild.id, newM.id],
  });
  if (r.rowsAffected) gw.scheduleRefresh(client);
});

client.on('guildMemberRemove', async (m) => {
  effectif.onMemberRemove(m, client);
  if (m.guild.id !== cfg.GUILD_ID) return;
  const r = await db.execute({
    sql: 'UPDATE invited SET has_left=1 WHERE guild_id=? AND invited_id=? AND has_left=0',
    args: [m.guild.id, m.id],
  });
  if (r.rowsAffected) gw.scheduleRefresh(client);
});

client.on('interactionCreate', async (i) => {
  try {
    if (await tickets.handle(i, client)) return;
    if (await effectif.handle(i, client)) return;
    if (await voc.handle(i)) return;

    if (i.isChatInputCommand() && i.commandName === 'commandes') {
      return i.reply({ embeds: [help.commandesEmbed()], flags: MessageFlags.Ephemeral });
    }

    if (i.isChatInputCommand() && i.commandName === 'giveaway') {
      if (!isStaff(i.member)) {
        return i.reply({ content: '❌ Réservé au staff (Administrateur et plus).', flags: MessageFlags.Ephemeral });
      }
      const sub = i.options.getSubcommand();

      if (sub === 'creer') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const ex = await gw.getActive(i.guildId);
        if (ex && ex.status === 'active') return i.editReply('❌ Un giveaway est déjà en cours.');
        const ch = i.options.getChannel('salon') || i.channel;
        const board = await gw.getBoard(i.guildId);
        const msg = await ch.send({
          content: `||<@&${cfg.CIVIL_ROLE}>||`,
          embeds: [gw.announceEmbed(i.guild), gw.boardEmbed(board, false)],
          components: [gw.linkRow()],
          allowedMentions: { roles: [cfg.CIVIL_ROLE] },
        });
        await db.execute({
          sql: "INSERT OR REPLACE INTO giveaway (guild_id, channel_id, message_id, start_ts, end_ts, status) VALUES (?,?,?,?,?,'active')",
          args: [i.guildId, ch.id, msg.id, cfg.START, cfg.END],
        });
        return i.editReply(`✅ Giveaway posté dans ${ch}.`);
      }

      if (sub === 'terminer') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const ok = await gw.finish(client);
        return i.editReply(ok ? '🏁 Giveaway terminé.' : '❌ Aucun giveaway en cours.');
      }

      if (sub === 'disqualifier') {
        const u = i.options.getUser('membre');
        await db.execute({ sql: 'INSERT OR IGNORE INTO disq (guild_id, user_id) VALUES (?,?)', args: [i.guildId, u.id] });
        gw.scheduleRefresh(client);
        return i.reply({ content: `🚫 ${u} est disqualifié du giveaway.`, flags: MessageFlags.Ephemeral });
      }
    }

    if (i.isButton() && i.customId === 'gw_link') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const g = await gw.getActive(i.guildId);
      if (!g || g.status !== 'active') return i.editReply('❌ Le giveaway est terminé.');

      const r = await db.execute({
        sql: 'SELECT code FROM invites WHERE guild_id=? AND user_id=?', args: [i.guildId, i.user.id],
      });
      let code = r.rows[0]?.code;
      if (code) {
        const still = await i.guild.invites.fetch().then((x) => x.has(code)).catch(() => true);
        if (!still) code = null;
      }
      if (!code) {
        const inv = await i.channel.createInvite({
          maxAge: 0, maxUses: 0, unique: true, reason: `Giveaway - ${i.user.tag}`,
        });
        code = inv.code;
        cache.set(code, 0);
        await db.execute({
          sql: 'INSERT OR REPLACE INTO invites (guild_id, user_id, code) VALUES (?,?,?)',
          args: [i.guildId, i.user.id, code],
        });
      }
      return i.editReply(await gw.personalPayload(i.guildId, i.user.id, `https://discord.gg/${code}`));
    }

    if (i.isButton() && i.customId === 'gw_refresh') {
      const r = await db.execute({
        sql: 'SELECT code FROM invites WHERE guild_id=? AND user_id=?', args: [i.guildId, i.user.id],
      });
      const code = r.rows[0]?.code;
      if (!code) return i.deferUpdate();
      return i.update(await gw.personalPayload(i.guildId, i.user.id, `https://discord.gg/${code}`));
    }
  } catch (e) {
    console.error('interaction', e);
    const msg = '❌ Une erreur est survenue, réessaie dans un instant.';
    if (i.deferred || i.replied) i.editReply(msg).catch(() => {});
    else i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(cfg.TOKEN);
