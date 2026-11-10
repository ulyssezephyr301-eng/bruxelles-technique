const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, UserSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionFlagsBits,
  MessageFlags, ChannelType,
} = require('discord.js');
const cfg = require('./config');
const { db } = require('./db');

const EPH = MessageFlags.Ephemeral;
const P = PermissionFlagsBits;
const isAdmin = (m) => m.roles.cache.hasAny(...cfg.STAFF_ROLES);
const STATES = { public: '🌐 Public', locked: '🔒 Verrouillé', hidden: '🙈 Masqué' };
const BOT_PERMS = { ViewChannel: true, Connect: true, Speak: true, ManageChannels: true, ManageRoles: true, MoveMembers: true };

const td = (t) => new TextDisplayBuilder().setContent(t);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
]);

async function getHrp(channelId) {
  const r = await db.execute({ sql: 'SELECT * FROM voc_hrp WHERE channel_id=?', args: [channelId] });
  return r.rows[0] || null;
}

async function dropRows(channelId) {
  await db.execute({ sql: 'DELETE FROM voc_hrp WHERE channel_id=?', args: [channelId] });
  await db.execute({ sql: 'DELETE FROM voc_rp WHERE channel_id=?', args: [channelId] });
}

const humansIn = (ch) => ch.members.filter((m) => !m.user.bot);

/* ───────── Panneau HRP ───────── */
function panelPayload(row, channel) {
  const limit = channel?.userLimit ? `${channel.userLimit} places` : 'Illimitée';
  const locked = row.state === 'locked';
  const hidden = row.state === 'hidden';
  const sec = (title, desc, id, label, emoji, style) => new SectionBuilder()
    .addTextDisplayComponents(td(`**${title}**\n${desc}`))
    .setButtonAccessory(new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style));

  const c = new ContainerBuilder().setAccentColor(0x5865f2);
  c.addTextDisplayComponents(td(
    '# 🎙️ Panneau du salon\n' +
    `**Propriétaire** <@${row.owner_id}> · **État** ${STATES[row.state] || STATES.public} · **Limite** ${limit}`
  ));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(td('## ⚙️ Salon'));
  c.addSectionComponents(
    sec('Renommer', 'Changer le nom du salon', 'vh_rename', 'Renommer', '✏️', ButtonStyle.Secondary),
    sec('Limite de places', 'Nombre max de membres (0 = illimité)', 'vh_limit', 'Limite', '👥', ButtonStyle.Secondary),
    sec('Verrouiller', 'Visible mais connexion coupée', 'vh_lock', locked ? 'Déverrouiller' : 'Verrouiller', '🔒', ButtonStyle.Secondary),
    sec('Masquer', 'Invisible pour tout le monde', 'vh_hide', hidden ? 'Afficher' : 'Masquer', '🙈', ButtonStyle.Secondary)
  );
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(td('## 👥 Membres'));
  c.addSectionComponents(
    sec('Inviter', 'Donner l’accès à un membre, même salon verrouillé', 'vh_invite', 'Inviter', '➕', ButtonStyle.Success),
    sec('Expulser', 'Déconnecter un membre du vocal', 'vh_kick', 'Expulser', '🥾', ButtonStyle.Secondary),
    sec('Bloquer', 'Connexion coupée pour ce membre, même salon public (re-cliquer pour débloquer)', 'vh_block', 'Bloquer', '⛔', ButtonStyle.Danger),
    sec('Transférer', 'Donner la propriété du salon à un autre membre', 'vh_transfer', 'Transférer', '👑', ButtonStyle.Secondary)
  );
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(td(`-# ${cfg.FOOTER}`));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function refreshPanel(channel) {
  const row = await getHrp(channel.id);
  if (!row?.panel_msg_id) return;
  const msg = await channel.messages.fetch(row.panel_msg_id).catch(() => null);
  if (msg) await msg.edit(panelPayload(row, channel)).catch((e) => console.error('[vocal] panneau', e.message));
}

async function setState(channel, state) {
  const ev = channel.guild.id;
  if (state === 'public') await channel.permissionOverwrites.edit(ev, { ViewChannel: null, Connect: null });
  else if (state === 'locked') await channel.permissionOverwrites.edit(ev, { ViewChannel: null, Connect: false });
  else await channel.permissionOverwrites.edit(ev, { ViewChannel: false, Connect: false });
  await db.execute({ sql: 'UPDATE voc_hrp SET state=? WHERE channel_id=?', args: [state, channel.id] });
}

async function transferOwnership(channel, row, newId) {
  await db.execute({ sql: 'UPDATE voc_hrp SET owner_id=? WHERE channel_id=?', args: [newId, channel.id] });
  await channel.permissionOverwrites.edit(newId, { ViewChannel: true, Connect: true, Speak: true })
    .catch((e) => console.error('[vocal] permissions nouveau propriétaire', e.message));
  if (row.owner_id !== newId) await channel.permissionOverwrites.delete(row.owner_id).catch(() => {});
  await refreshPanel(channel);
}

/* ───────── Création HRP ───────── */
const cooldown = new Map();
async function createHrp(member) {
  if (member.user.bot) return;
  const now = Date.now();
  if (now - (cooldown.get(member.id) || 0) < 5000) return;
  cooldown.set(member.id, now);

  const guild = member.guild;
  const trigger = member.voice.channel;
  if (!trigger) return;

  let ch;
  try {
    ch = await guild.channels.create({
      name: `Vocal de ${member.displayName}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: trigger.parentId || undefined,
      reason: `Vocal HRP de ${member.user.tag}`,
    });
  } catch (e) {
    console.error('[vocal] création du salon HRP impossible :', e.message);
    return;
  }

  await db.execute({
    sql: "INSERT OR REPLACE INTO voc_hrp (channel_id, guild_id, owner_id, state) VALUES (?,?,?,'public')",
    args: [ch.id, guild.id, member.id],
  });

  try {
    await member.voice.setChannel(ch);
  } catch (e) {
    console.error('[vocal] déplacement impossible (permission « Déplacer des membres » ?) :', e.message);
    await ch.delete().catch(() => {});
    await dropRows(ch.id);
    return;
  }

  try {
    await ch.permissionOverwrites.edit(guild.members.me.id, BOT_PERMS);
  } catch (e) {
    console.error('[vocal] permissions du bot sur le salon (permission « Gérer les rôles » ?) :', e.message);
  }
  try {
    await ch.permissionOverwrites.edit(member.id, { ViewChannel: true, Connect: true, Speak: true });
  } catch (e) {
    console.error('[vocal] permissions du propriétaire :', e.message);
  }

  const row = await getHrp(ch.id);
  const msg = await ch.send(panelPayload(row, ch)).catch((e) => {
    console.error('[vocal] envoi du panneau impossible :', e.message);
    return null;
  });
  if (msg) await db.execute({ sql: 'UPDATE voc_hrp SET panel_msg_id=? WHERE channel_id=?', args: [msg.id, ch.id] });
}

/* ───────── Création RP (Fréquence N) ───────── */
let rpQueue = Promise.resolve();
function createRp(member) {
  rpQueue = rpQueue.then(() => doCreateRp(member)).catch((e) => console.error('[vocal] RP', e));
  return rpQueue;
}

async function doCreateRp(member) {
  if (member.user.bot || member.voice.channelId !== cfg.VOC_RP_TRIGGER) return;
  const guild = member.guild;
  const trigger = member.voice.channel;

  const rows = (await db.execute({ sql: 'SELECT channel_id, num FROM voc_rp WHERE guild_id=?', args: [guild.id] })).rows;
  const used = new Set();
  const live = [];
  for (const r of rows) {
    const c = guild.channels.cache.get(r.channel_id);
    if (c) { used.add(Number(r.num)); live.push({ num: Number(r.num), ch: c }); }
    else await dropRows(r.channel_id);
  }
  let n = 1;
  while (used.has(n)) n++;

  let ch;
  try {
    ch = await guild.channels.create({
      name: `📻・Fréquence ${n}`,
      type: ChannelType.GuildVoice,
      parent: trigger.parentId || undefined,
      reason: `Vocal RP de ${member.user.tag}`,
    });
  } catch (e) {
    console.error('[vocal] création du salon RP impossible :', e.message);
    return;
  }
  await db.execute({
    sql: 'INSERT OR REPLACE INTO voc_rp (channel_id, guild_id, num) VALUES (?,?,?)',
    args: [ch.id, guild.id, n],
  });

  // Se placer juste avant la fréquence au numéro supérieur
  const higher = live.filter((x) => x.num > n).sort((a, b) => a.num - b.num)[0];
  if (higher) await ch.setPosition(higher.ch.position).catch(() => {});

  try {
    await member.voice.setChannel(ch);
  } catch (e) {
    console.error('[vocal] déplacement RP impossible (permission « Déplacer des membres » ?) :', e.message);
    await ch.delete().catch(() => {});
    await dropRows(ch.id);
  }
}

/* ───────── Événements vocaux ───────── */
async function onLeave(oldS) {
  const ch = oldS.channel;
  if (!ch) return;
  const hrp = await getHrp(ch.id);
  const rp = hrp ? null : (await db.execute({ sql: 'SELECT 1 FROM voc_rp WHERE channel_id=?', args: [ch.id] })).rows[0];
  if (!hrp && !rp) return;

  const humans = humansIn(ch);
  if (!humans.size) {
    await ch.delete('Vocal vide').catch(() => {});
    await dropRows(ch.id);
    return;
  }
  if (hrp && oldS.id === hrp.owner_id) await transferOwnership(ch, hrp, humans.first().id);
}

async function onVoiceUpdate(oldS, newS) {
  if (newS.guild.id !== cfg.GUILD_ID) return;
  if (newS.channelId && newS.channelId !== oldS.channelId && newS.member) {
    if (newS.channelId === cfg.VOC_HRP_TRIGGER) {
      console.log('[vocal] HRP déclenché par', newS.member.user.tag);
      await createHrp(newS.member);
    } else if (newS.channelId === cfg.VOC_RP_TRIGGER) {
      console.log('[vocal] RP déclenché par', newS.member.user.tag);
      await createRp(newS.member);
    }
  }
  if (oldS.channelId && oldS.channelId !== newS.channelId) await onLeave(oldS);
}

async function onChannelDelete(ch) {
  await dropRows(ch.id);
}

async function checkSetup(guild) {
  const me = guild.members.me;
  for (const [label, id] of [['HRP', cfg.VOC_HRP_TRIGGER], ['RP', cfg.VOC_RP_TRIGGER]]) {
    const ch = guild.channels.cache.get(id);
    if (!ch) { console.error(`[vocal] Salon déclencheur ${label} introuvable (${id})`); continue; }
    if (ch.type !== ChannelType.GuildVoice) console.error(`[vocal] Le salon ${label} n’est pas un salon vocal (type ${ch.type})`);
    const missing = ch.permissionsFor(me).missing([P.ViewChannel, P.Connect, P.MoveMembers, P.ManageChannels]);
    if (missing.length) console.error(`[vocal] Permissions manquantes pour le bot sur le salon ${label} : ${missing.join(', ')}`);
    else console.log(`[vocal] Salon ${label} OK (${ch.name})`);
  }
  if (!me.permissions.has(P.ManageRoles)) {
    console.error('[vocal] Le bot n’a pas « Gérer les rôles » : les permissions de salon (propriétaire, verrouillage…) échoueront');
  }
}

async function sweep(client) {
  const guild = client.guilds.cache.get(cfg.GUILD_ID);
  if (!guild) return;
  await checkSetup(guild);
  for (const table of ['voc_hrp', 'voc_rp']) {
    const rows = (await db.execute(`SELECT channel_id FROM ${table}`)).rows;
    for (const r of rows) {
      const ch = guild.channels.cache.get(r.channel_id);
      if (!ch) { await dropRows(r.channel_id); continue; }
      if (!humansIn(ch).size) {
        await ch.delete('Vocal vide').catch(() => {});
        await dropRows(r.channel_id);
      }
    }
  }
}

/* ───────── Interactions du panneau ───────── */
const pick = (id, text) => ({
  content: text,
  flags: EPH,
  components: [new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId(id).setPlaceholder('Choisis un membre').setMinValues(1).setMaxValues(1)
  )],
});

async function handle(i) {
  const id = i.customId;
  if (!id || !id.startsWith('vh_')) return false;
  if (!(i.isButton() || i.isModalSubmit() || i.isUserSelectMenu())) return false;

  const row = await getHrp(i.channelId);
  if (!row) { await i.reply({ content: '❌ Ce salon n’existe plus.', flags: EPH }); return true; }
  if (i.user.id !== row.owner_id && !isAdmin(i.member)) {
    await i.reply({ content: '❌ Seul le propriétaire du salon peut utiliser ce panneau.', flags: EPH });
    return true;
  }
  const channel = i.guild.channels.cache.get(i.channelId);
  if (!channel) { await i.reply({ content: '❌ Salon introuvable.', flags: EPH }); return true; }

  /* Boutons */
  if (i.isButton()) {
    if (id === 'vh_rename') {
      await i.showModal(new ModalBuilder().setCustomId('vh_rename_modal').setTitle('Renommer le salon')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('Nouveau nom').setStyle(TextInputStyle.Short)
            .setMinLength(1).setMaxLength(100).setRequired(true).setValue(channel.name.slice(0, 100))
        )));
    } else if (id === 'vh_limit') {
      await i.showModal(new ModalBuilder().setCustomId('vh_limit_modal').setTitle('Limite de places')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('limit').setLabel('Nombre max de membres (0 = illimité)')
            .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setRequired(true)
            .setValue(String(channel.userLimit || 0))
        )));
    } else if (id === 'vh_lock' || id === 'vh_hide') {
      await i.deferUpdate();
      const target = id === 'vh_lock' ? 'locked' : 'hidden';
      await setState(channel, row.state === target ? 'public' : target);
      await refreshPanel(channel);
    } else if (id === 'vh_invite') {
      await i.reply(pick('vh_invite_sel', '➕ Qui veux-tu inviter ?'));
    } else if (id === 'vh_kick') {
      await i.reply(pick('vh_kick_sel', '🥾 Qui veux-tu expulser du vocal ?'));
    } else if (id === 'vh_block') {
      await i.reply(pick('vh_block_sel', '⛔ Qui veux-tu bloquer (ou débloquer) ?'));
    } else if (id === 'vh_transfer') {
      await i.reply(pick('vh_transfer_sel', '👑 À qui donner la propriété du salon ?'));
    }
    return true;
  }

  /* Formulaires */
  if (i.isModalSubmit()) {
    await i.deferReply({ flags: EPH });
    if (id === 'vh_rename_modal') {
      const name = i.fields.getTextInputValue('name').trim().slice(0, 100);
      try {
        await withTimeout(channel.setName(name), 8000);
        await i.editReply('✅ Salon renommé.');
      } catch (e) {
        await i.editReply(e.message === 'timeout'
          ? '⏳ Discord limite le renommage (2 fois toutes les 10 minutes). Réessaie plus tard.'
          : '❌ Impossible de renommer le salon.');
      }
    } else if (id === 'vh_limit_modal') {
      const n = Number(i.fields.getTextInputValue('limit').trim());
      if (!Number.isInteger(n) || n < 0 || n > 99) {
        await i.editReply('❌ Entre un nombre entier entre 0 et 99.');
        return true;
      }
      await channel.setUserLimit(n);
      await refreshPanel(channel);
      await i.editReply(n === 0 ? '✅ Limite retirée (illimité).' : `✅ Limite fixée à **${n}** places.`);
    }
    return true;
  }

  /* Sélection d'un membre */
  const uid = i.values[0];
  const target = await i.guild.members.fetch(uid).catch(() => null);
  if (!target || target.user.bot || uid === row.owner_id) {
    await i.update({ content: '❌ Choix impossible (membre introuvable, bot ou propriétaire).', components: [] });
    return true;
  }

  if (id === 'vh_invite_sel') {
    await channel.permissionOverwrites.edit(uid, { ViewChannel: true, Connect: true });
    await i.update({ content: `✅ ${target} peut maintenant rejoindre ce salon.`, components: [] });
  } else if (id === 'vh_kick_sel') {
    if (target.voice.channelId !== channel.id) {
      await i.update({ content: `❌ ${target} n’est pas dans ce vocal.`, components: [] });
    } else {
      await target.voice.disconnect().catch(() => {});
      await i.update({ content: `✅ ${target} a été expulsé du vocal.`, components: [] });
    }
  } else if (id === 'vh_block_sel') {
    const blocked = channel.permissionOverwrites.cache.get(uid)?.deny.has(P.Connect);
    if (blocked) {
      await channel.permissionOverwrites.edit(uid, { Connect: null });
      await i.update({ content: `✅ ${target} est débloqué.`, components: [] });
    } else {
      await channel.permissionOverwrites.edit(uid, { Connect: false });
      if (target.voice.channelId === channel.id) await target.voice.disconnect().catch(() => {});
      await i.update({ content: `⛔ ${target} est bloqué : il ne peut plus se connecter à ce salon.`, components: [] });
    }
  } else if (id === 'vh_transfer_sel') {
    await transferOwnership(channel, row, uid);
    await i.update({ content: `👑 ${target} est maintenant propriétaire du salon.`, components: [] });
  }
  return true;
}

module.exports = { onVoiceUpdate, onChannelDelete, sweep, handle };
