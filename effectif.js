const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const cfg = require('./config');
const { db } = require('./db');

const EPH = MessageFlags.Ephemeral;
const tracked = new Set(cfg.EFFECTIF_GROUPS.flatMap((g) => g.roles));
let busy = 0;
let lastRefresh = 0;
let timer = null;

const effectifCommand = new SlashCommandBuilder()
  .setName('effectif')
  .setDescription('Envoyer (ou renvoyer) l’effectif du serveur dans son salon')
  .toJSON();

function listMentions(members, max) {
  if (!members.length) return '*Aucun membre*';
  let out = '';
  let shown = 0;
  for (const m of members) {
    const s = `<@${m.id}>`;
    if ((out + ' ' + s).length > max - 30) break;
    out += (out ? ' ' : '') + s;
    shown++;
  }
  const rest = members.length - shown;
  return rest > 0 ? `${out} … **+${rest}**` : out;
}

async function fetchMembers(guild) {
  try {
    await Promise.race([
      guild.members.fetch(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
  } catch (e) {
    console.error('fetch membres', e.message);
  }
}

async function buildPayload(guild) {
  await fetchMembers(guild);

  const header = new EmbedBuilder()
    .setColor(cfg.COLOR)
    .setTitle('📋 Effectif • Bruxelles Roleplay')
    .setDescription(
      'Retrouvez ici les membres qui font vivre **Bruxelles Roleplay** au quotidien.\n' +
      `🕒 Dernière mise à jour : <t:${Math.floor(Date.now() / 1000)}:R>`
    );
  if (guild.iconURL()) header.setThumbnail(guild.iconURL());

  const embeds = [header];
  cfg.EFFECTIF_GROUPS.forEach((g, idx) => {
    const seen = new Set();
    const lines = g.roles.map((id) => {
      const role = guild.roles.cache.get(id);
      const members = role
        ? [...role.members.values()]
            .filter((m) => !m.user.bot)
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }))
        : [];
      members.forEach((m) => seen.add(m.id));
      return `<@&${id}> (${members.length}) : ${listMentions(members, g.max)}`;
    });
    const e = new EmbedBuilder()
      .setColor(g.color)
      .setTitle(`${g.title} • ${seen.size} membre${seen.size > 1 ? 's' : ''}`)
      .setDescription(lines.join('\n\n'));
    if (idx === cfg.EFFECTIF_GROUPS.length - 1) e.setFooter({ text: cfg.FOOTER }).setTimestamp();
    embeds.push(e);
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ef_refresh').setLabel('Mettre à jour l’effectif')
      .setEmoji('🔄').setStyle(ButtonStyle.Primary)
  );
  return { embeds, components: [row], allowedMentions: { parse: [] } };
}

// mode : 'check' (renvoie seulement s'il manque), 'refresh' (met à jour), 'force' (renvoie un nouveau)
async function ensureEffectif(client, mode = 'check', bypass = false) {
  if (!bypass && busy && Date.now() - busy < 120000) return;
  busy = Date.now();
  try {
    const guild = client.guilds.cache.get(cfg.GUILD_ID);
    if (!guild) throw new Error('Serveur introuvable');
    const ch = await guild.channels.fetch(cfg.EFFECTIF_CHANNEL).catch(() => null);
    if (!ch) throw new Error('Salon introuvable ou invisible pour le bot');

    const r = await db.execute({ sql: 'SELECT * FROM effectif_panel WHERE guild_id=?', args: [guild.id] });
    const row = r.rows[0];
    const old = row ? await ch.messages.fetch(row.message_id).catch(() => null) : null;
    if (old && mode === 'check') return;

    const payload = await buildPayload(guild);
    if (old && mode === 'refresh') {
      await old.edit(payload);
      lastRefresh = Date.now();
      return;
    }

    const msg = await ch.send(payload);
    await db.execute({
      sql: 'INSERT OR REPLACE INTO effectif_panel (guild_id, channel_id, message_id) VALUES (?,?,?)',
      args: [guild.id, ch.id, msg.id],
    });
    if (old) await old.delete().catch(() => {});
    lastRefresh = Date.now();
  } finally {
    busy = 0;
  }
}

function scheduleRefresh(client) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    ensureEffectif(client, 'refresh').catch((e) => console.error('effectif', e.message));
  }, 30000);
}

async function onMessageDelete(m, client) {
  if (m.channelId !== cfg.EFFECTIF_CHANNEL) return;
  const r = await db.execute({ sql: 'SELECT 1 FROM effectif_panel WHERE message_id=?', args: [m.id] });
  if (r.rows.length) setTimeout(() => ensureEffectif(client, 'check').catch(() => {}), 1500);
}

function onMemberUpdate(oldM, newM, client) {
  if (newM.guild.id !== cfg.GUILD_ID) return;
  const changed = oldM.partial || [...tracked].some((id) => oldM.roles.cache.has(id) !== newM.roles.cache.has(id));
  if (changed) scheduleRefresh(client);
}

function onMemberRemove(m, client) {
  if (m.guild.id !== cfg.GUILD_ID) return;
  if (m.roles?.cache && [...tracked].some((id) => m.roles.cache.has(id))) scheduleRefresh(client);
}

async function handle(i, client) {
  if (i.isChatInputCommand() && i.commandName === 'effectif') {
    if (!i.member.roles.cache.hasAny(...cfg.STAFF_ROLES)) {
      await i.reply({ content: '❌ Réservé aux **Administrateur et +**.', flags: EPH });
      return true;
    }
    await i.deferReply({ flags: EPH });
    try {
      await ensureEffectif(client, 'force', true);
      await i.editReply(`✅ Effectif envoyé dans <#${cfg.EFFECTIF_CHANNEL}>.`);
    } catch (e) {
      console.error('effectif', e);
      await i.editReply(`❌ Impossible d’envoyer l’effectif : \`${e.message}\``);
    }
    return true;
  }

  if (!(i.isButton() && i.customId === 'ef_refresh')) return false;
  if (!i.member.roles.cache.hasAny(...cfg.TICKET_STAFF_ROLES)) {
    await i.reply({ content: '❌ Réservé au staff (Guide et +).', flags: EPH });
    return true;
  }
  const wait = 20000 - (Date.now() - lastRefresh);
  if (wait > 0) {
    await i.reply({ content: `⏳ Déjà mis à jour à l’instant, réessaie dans ${Math.ceil(wait / 1000)} s.`, flags: EPH });
    return true;
  }
  await i.deferReply({ flags: EPH });
  await ensureEffectif(client, 'refresh');
  await i.editReply('✅ Effectif mis à jour.');
  return true;
}

module.exports = {
  effectifCommand, handle, ensureEffectif, onMessageDelete, onMemberUpdate, onMemberRemove,
};
