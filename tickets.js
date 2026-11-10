const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionFlagsBits,
  AttachmentBuilder, SlashCommandBuilder, MessageFlags, ChannelType,
} = require('discord.js');
const cfg = require('./config');
const { db } = require('./db');

const EPH = MessageFlags.Ephemeral;
const P = PermissionFlagsBits;
const USER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

const pad = (n) => String(n).padStart(4, '0');
const typeOf = (id) => cfg.TICKET_TYPES.find((t) => t.id === id);
const isStaff = (m) => m.roles.cache.hasAny(...cfg.TICKET_STAFF_ROLES);
const isAdmin = (m) => m.roles.cache.hasAny(...cfg.STAFF_ROLES);
const isPremium = (m) => m.roles.cache.hasAny(cfg.ROLE_VIP, cfg.ROLE_BOOSTER);
const staffPings = () => cfg.TICKET_PING_ROLES.map((r) => `<@&${r}>`).join(' ');
const fmtDur = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
};

/* ───────── Commande /ticket ───────── */
const ticketCommand = new SlashCommandBuilder()
  .setName('ticket').setDescription('Gérer les tickets')
  .addSubcommand((s) => s.setName('panneau').setDescription('Renvoyer le panneau de tickets'))
  .addSubcommand((s) => s.setName('prendre').setDescription('Prendre en charge ce ticket'))
  .addSubcommand((s) => s.setName('ajouter').setDescription('Ajouter un membre au ticket')
    .addUserOption((o) => o.setName('membre').setDescription('Membre à ajouter').setRequired(true)))
  .addSubcommand((s) => s.setName('retirer').setDescription('Retirer un membre du ticket')
    .addUserOption((o) => o.setName('membre').setDescription('Membre à retirer').setRequired(true)))
  .addSubcommand((s) => s.setName('renommer').setDescription('Renommer le salon du ticket')
    .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setRequired(true).setMaxLength(50)))
  .addSubcommand((s) => s.setName('fermer').setDescription('Fermer ce ticket')
    .addStringOption((o) => o.setName('raison').setDescription('Raison de la fermeture').setMaxLength(300)))
  .toJSON();

/* ───────── Panneau (style Components V2) ───────── */
function panelPayload() {
  const c = new ContainerBuilder().setAccentColor(cfg.COLOR);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '# 🎫 Assistance • Bruxelles Roleplay\n' +
    'ℹ️ Ici, tu peux créer un ticket via les **boutons ci-dessous** si tu as un problème ou une demande. ' +
    'L’équipe du staff te répondra dans les plus brefs délais.\n\n' +
    '⚠️ **Attention :** pense à choisir la bonne catégorie correspondant à ta demande.\n\n' +
    '### ⬇️ Catégories de tickets disponibles'
  ));
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  cfg.TICKET_TYPES.forEach((t, idx) => {
    let desc = t.desc;
    if (t.restricted) desc += `\n⚠️ Réservé aux <@&${cfg.ROLE_VIP}> et <@&${cfg.ROLE_BOOSTER}>.`;
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t.emoji} ${t.label}\n${desc}`))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId(`tk_open:${t.id}`).setLabel('Ouvrir un ticket')
          .setEmoji(t.emoji).setStyle(t.restricted ? ButtonStyle.Primary : ButtonStyle.Secondary)
      );
    c.addSectionComponents(section);
    if (idx < cfg.TICKET_TYPES.length - 1) {
      c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    }
  });

  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${cfg.FOOTER}`));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

let panelBusy = false;
async function ensurePanel(client, force = false) {
  if (panelBusy) return;
  panelBusy = true;
  try {
    const guild = client.guilds.cache.get(cfg.GUILD_ID);
    const ch = await guild.channels.fetch(cfg.TICKET_PANEL_CHANNEL).catch(() => null);
    if (!ch) return console.error('Salon du panneau introuvable');
    const r = await db.execute({ sql: 'SELECT * FROM ticket_panel WHERE guild_id=?', args: [guild.id] });
    const row = r.rows[0];
    let old = null;
    if (row) old = await ch.messages.fetch(row.message_id).catch(() => null);
    if (old && !force) return;

    const msg = await ch.send(panelPayload());
    await db.execute({
      sql: 'INSERT OR REPLACE INTO ticket_panel (guild_id, channel_id, message_id) VALUES (?,?,?)',
      args: [guild.id, ch.id, msg.id],
    });
    if (old) await old.delete().catch(() => {});
  } finally {
    panelBusy = false;
  }
}

async function onMessageDelete(m, client) {
  if (m.channelId !== cfg.TICKET_PANEL_CHANNEL) return;
  const r = await db.execute({ sql: 'SELECT 1 FROM ticket_panel WHERE message_id=?', args: [m.id] });
  if (r.rows.length) setTimeout(() => ensurePanel(client).catch(() => {}), 1500);
}

/* ───────── Aides ───────── */
async function getByChannel(channelId) {
  const r = await db.execute({ sql: 'SELECT * FROM tickets WHERE channel_id=?', args: [channelId] });
  return r.rows[0] || null;
}

async function logTicket(guild, title, color, fields, files = []) {
  const ch = await guild.channels.fetch(cfg.TICKET_LOG_CHANNEL).catch(() => null);
  if (!ch) return;
  const e = new EmbedBuilder().setColor(color).setTitle(title).addFields(fields)
    .setFooter({ text: cfg.FOOTER }).setTimestamp();
  await ch.send({ embeds: [e], files, allowedMentions: { parse: [] } }).catch((err) => console.error('log', err.message));
}

async function deleteAlert(guild, t) {
  if (!t.alert_msg_id) return;
  const ch = await guild.channels.fetch(cfg.TICKET_ALERT_CHANNEL).catch(() => null);
  const m = await ch?.messages.fetch(t.alert_msg_id).catch(() => null);
  if (m) await m.delete().catch(() => {});
}

function welcomeEmbed(t, opener, claimedBy) {
  const type = typeOf(t.type);
  return new EmbedBuilder()
    .setColor(t.priority ? 0xe74c3c : cfg.COLOR)
    .setAuthor({ name: opener.username, iconURL: opener.displayAvatarURL() })
    .setTitle(`${type.emoji} Ticket #${pad(t.id)} • ${type.label}${t.priority ? ' 🚀' : ''}`)
    .setDescription(
      `Bienvenue <@${t.user_id}> ! Un membre du staff va te répondre dans les plus brefs délais.\n\n` +
      `📝 **Ta demande**\n>>> ${t.reason}`
    )
    .addFields(
      { name: '👤 Demandeur', value: `<@${t.user_id}>`, inline: true },
      { name: '📂 Catégorie', value: type.label, inline: true },
      {
        name: '📌 Statut',
        value: claimedBy ? `🔵 Pris en charge par <@${claimedBy}>` : '🟢 En attente de prise en charge',
        inline: true,
      }
    )
    .setFooter({ text: cfg.FOOTER })
    .setTimestamp(Number(t.created_ts));
}

const ticketButtons = (claimed) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('tk_claim').setLabel(claimed ? 'Pris en charge' : 'Prendre en charge')
    .setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(claimed),
  new ButtonBuilder().setCustomId('tk_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger)
);

async function fetchAll(channel, max = 1000) {
  const all = [];
  let before;
  while (all.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  return all.reverse();
}

function transcriptText(t, msgs) {
  const fmt = (d) => d.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' });
  const head = [
    `Ticket #${pad(t.id)} — ${typeOf(t.type)?.label}`,
    `Ouvert par : ${t.user_id}`,
    `Créé le : ${fmt(new Date(Number(t.created_ts)))}`,
    '----------------------------------------', '',
  ];
  const body = msgs.map((m) => {
    let c = m.content || '';
    if (m.embeds.length) c += ` [embed : ${m.embeds.map((e) => e.title || e.description?.slice(0, 60) || '').join(' | ')}]`;
    if (m.attachments.size) c += ' ' + m.attachments.map((a) => a.url).join(' ');
    return `[${fmt(m.createdAt)}] ${m.author.tag} : ${c}`;
  });
  return [...head, ...body].join('\n');
}

/* ───────── Prise en charge ───────── */
async function doClaim(client, t, staffUser) {
  const r = await db.execute({
    sql: "UPDATE tickets SET claimed_by=? WHERE id=? AND claimed_by IS NULL AND status='open'",
    args: [staffUser.id, t.id],
  });
  if (!r.rowsAffected) return false;
  const guild = client.guilds.cache.get(cfg.GUILD_ID);
  const ch = await guild.channels.fetch(t.channel_id).catch(() => null);
  const opener = await client.users.fetch(t.user_id).catch(() => null);
  const wm = await ch?.messages.fetch(t.welcome_msg_id).catch(() => null);
  if (wm && opener) await wm.edit({ embeds: [welcomeEmbed(t, opener, staffUser.id)], components: [ticketButtons(true)] });
  await deleteAlert(guild, t);
  await ch?.send({
    embeds: [new EmbedBuilder().setColor(0x3498db).setDescription(`🙋 ${staffUser} a pris en charge ce ticket.`).setFooter({ text: cfg.FOOTER })],
    allowedMentions: { parse: [] },
  });
  await logTicket(guild, `🙋 Ticket #${pad(t.id)} pris en charge`, 0x3498db, [
    { name: 'Staff', value: `${staffUser}`, inline: true },
    { name: 'Demandeur', value: `<@${t.user_id}>`, inline: true },
    { name: 'Salon', value: `<#${t.channel_id}>`, inline: true },
  ]);
  return true;
}

/* ───────── Fermeture ───────── */
async function closeTicket(client, t, closer, reason) {
  const fresh = await getByChannel(t.channel_id);
  if (!fresh || fresh.status !== 'open') return;
  await db.execute({ sql: "UPDATE tickets SET status='closed' WHERE id=?", args: [t.id] });

  const guild = client.guilds.cache.get(cfg.GUILD_ID);
  const ch = await guild.channels.fetch(t.channel_id).catch(() => null);
  await deleteAlert(guild, t);

  let text = null;
  if (ch) {
    const msgs = await fetchAll(ch).catch(() => []);
    text = transcriptText(t, msgs);
  }
  const mkFile = () => new AttachmentBuilder(Buffer.from(text || '', 'utf8'), { name: `ticket-${pad(t.id)}.txt` });
  const type = typeOf(t.type);
  const duration = fmtDur(Date.now() - Number(t.created_ts));

  await logTicket(guild, `🔒 Ticket #${pad(t.id)} fermé`, 0xe74c3c, [
    { name: 'Demandeur', value: `<@${t.user_id}>`, inline: true },
    { name: 'Catégorie', value: type?.label || t.type, inline: true },
    { name: 'Fermé par', value: `${closer}`, inline: true },
    { name: 'Pris en charge par', value: t.claimed_by ? `<@${t.claimed_by}>` : 'Personne', inline: true },
    { name: 'Durée', value: duration, inline: true },
    { name: 'Raison', value: reason || 'Aucune raison précisée' },
  ], text ? [mkFile()] : []);

  const opener = await client.users.fetch(t.user_id).catch(() => null);
  if (opener) {
    await opener.send({
      embeds: [new EmbedBuilder().setColor(cfg.COLOR).setTitle(`🔒 Ton ticket #${pad(t.id)} a été fermé`)
        .setDescription('Merci d’avoir contacté le staff de **Bruxelles Roleplay** ! Tu trouveras la conversation en pièce jointe.')
        .addFields(
          { name: 'Catégorie', value: type?.label || t.type, inline: true },
          { name: 'Durée', value: duration, inline: true },
          { name: 'Raison', value: reason || 'Aucune raison précisée' }
        ).setFooter({ text: cfg.FOOTER })],
      files: text ? [mkFile()] : [],
    }).catch(() => {});
  }

  if (ch) {
    await ch.send({
      embeds: [new EmbedBuilder().setColor(0xe74c3c)
        .setDescription(`🔒 Ticket fermé par ${closer}.\nSuppression du salon dans **5 secondes**…`)
        .setFooter({ text: cfg.FOOTER })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    setTimeout(() => ch.delete().catch(() => {}), 5000);
  }
}

async function onChannelDelete(ch, client) {
  const t = await getByChannel(ch.id);
  if (!t || t.status !== 'open') return;
  await db.execute({ sql: "UPDATE tickets SET status='closed' WHERE id=?", args: [t.id] });
  await deleteAlert(client.guilds.cache.get(cfg.GUILD_ID), t);
}

/* ───────── Ouverture ───────── */
async function onOpenButton(i) {
  const type = typeOf(i.customId.split(':')[1]);
  if (!type) return;
  if (type.restricted && !isPremium(i.member)) {
    return i.reply({
      content: `❌ Cette catégorie est réservée aux <@&${cfg.ROLE_VIP}> et <@&${cfg.ROLE_BOOSTER}>.`,
      flags: EPH, allowedMentions: { parse: [] },
    });
  }
  const open = await db.execute({
    sql: "SELECT channel_id FROM tickets WHERE guild_id=? AND user_id=? AND status='open'",
    args: [i.guildId, i.user.id],
  });
  if (open.rows.length >= cfg.TICKET_MAX_OPEN) {
    return i.reply({
      content: `❌ Tu as déjà **${open.rows.length}** ticket(s) ouvert(s) : ${open.rows.map((r) => `<#${r.channel_id}>`).join(', ')}`,
      flags: EPH,
    });
  }
  const modal = new ModalBuilder()
    .setCustomId(`tk_modal:${type.id}`)
    .setTitle(`${type.emoji} ${type.label}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Décris ta demande')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setMaxLength(1000)
        .setPlaceholder('Explique ta demande le plus clairement possible…')
    ));
  return i.showModal(modal);
}

async function onModal(i, client) {
  await i.deferReply({ flags: EPH });
  const type = typeOf(i.customId.split(':')[1]);
  if (!type) return i.editReply('❌ Catégorie inconnue.');
  const reason = i.fields.getTextInputValue('reason').trim();
  const priority = type.restricted ? 1 : 0;
  const guild = i.guild;

  const open = await db.execute({
    sql: "SELECT 1 FROM tickets WHERE guild_id=? AND user_id=? AND status='open'",
    args: [guild.id, i.user.id],
  });
  if (open.rows.length >= cfg.TICKET_MAX_OPEN) return i.editReply('❌ Tu as déjà trop de tickets ouverts.');

  const ins = await db.execute({
    sql: "INSERT INTO tickets (guild_id, channel_id, user_id, type, reason, priority, status, created_ts) VALUES (?,?,?,?,?,?,'open',?)",
    args: [guild.id, '', i.user.id, type.id, reason, priority, Date.now()],
  });
  const id = Number(ins.lastInsertRowid);

  try {
    const panelCh = await guild.channels.fetch(cfg.TICKET_PANEL_CHANNEL).catch(() => null);
    const safe = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'membre';
    const channel = await guild.channels.create({
      name: `${priority ? '🚀' : '🎫'}・ticket-${pad(id)}-${safe}`,
      type: ChannelType.GuildText,
      parent: panelCh?.parentId || undefined,
      topic: `Ticket #${pad(id)} • ${type.label} • ${i.user.tag} (${i.user.id})`,
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: i.user.id, allow: USER_PERMS },
        ...cfg.TICKET_STAFF_ROLES.map((r) => ({ id: r, allow: USER_PERMS })),
        { id: client.user.id, allow: [...USER_PERMS, P.ManageChannels] },
      ],
      reason: `Ticket #${pad(id)} - ${i.user.tag}`,
    });

    const t = {
      id, channel_id: channel.id, user_id: i.user.id, type: type.id,
      reason, priority, created_ts: Date.now(),
    };
    const welcome = await channel.send({
      content: `<@${i.user.id}>`,
      embeds: [welcomeEmbed(t, i.user, null)],
      components: [ticketButtons(false)],
      allowedMentions: { users: [i.user.id] },
    });

    // Alerte staff (ping Modérateur + Guide)
    let alertId = null;
    const alertCh = await guild.channels.fetch(cfg.TICKET_ALERT_CHANNEL).catch(() => null);
    if (alertCh) {
      const alert = await alertCh.send({
        content: staffPings(),
        embeds: [new EmbedBuilder()
          .setColor(priority ? 0xe74c3c : cfg.COLOR)
          .setTitle(priority ? '🚀 Nouveau ticket PRIORITAIRE' : '🎫 Nouveau ticket')
          .setDescription(`**${i.user}** a ouvert un ticket pour **${type.label}**.`)
          .addFields(
            { name: '📝 Raison', value: reason.slice(0, 1000) },
            { name: '📍 Salon', value: `${channel}`, inline: true },
            { name: '📌 Statut', value: '🟢 En attente de prise en charge', inline: true }
          )
          .setFooter({ text: cfg.FOOTER }).setTimestamp()],
        allowedMentions: { roles: cfg.TICKET_PING_ROLES },
      });
      alertId = alert.id;
    }

    await db.execute({
      sql: 'UPDATE tickets SET channel_id=?, welcome_msg_id=?, alert_msg_id=? WHERE id=?',
      args: [channel.id, welcome.id, alertId, id],
    });

    await logTicket(guild, `🎫 Ticket #${pad(id)} ouvert${priority ? ' 🚀' : ''}`, priority ? 0xe74c3c : 0x2ecc71, [
      { name: 'Demandeur', value: `${i.user}`, inline: true },
      { name: 'Catégorie', value: type.label, inline: true },
      { name: 'Salon', value: `${channel}`, inline: true },
      { name: 'Raison', value: reason.slice(0, 1000) },
    ]);

    return i.editReply(`✅ Ton ticket a été créé : ${channel}`);
  } catch (e) {
    console.error('création ticket', e);
    await db.execute({ sql: 'DELETE FROM tickets WHERE id=?', args: [id] });
    return i.editReply('❌ Impossible de créer le ticket (vérifie la permission « Gérer les salons » du bot).');
  }
}

/* ───────── Routeur ───────── */
const deny = (i, grade) => i.reply({ content: `❌ Réservé aux **${grade}**.`, flags: EPH });

async function onCommand(i, client) {
  const sub = i.options.getSubcommand();

  if (sub === 'panneau') {
    if (!isAdmin(i.member)) return deny(i, 'Administrateur et +');
    await i.deferReply({ flags: EPH });
    await ensurePanel(client, true);
    return i.editReply('✅ Panneau de tickets renvoyé.');
  }

  if (!isStaff(i.member)) return deny(i, 'Guide et +');
  const t = await getByChannel(i.channelId);
  if (!t || t.status !== 'open') {
    return i.reply({ content: '❌ Utilise cette commande dans un ticket ouvert.', flags: EPH });
  }

  if (sub === 'prendre') {
    const ok = await doClaim(client, t, i.user);
    return i.reply({ content: ok ? '✅ Ticket pris en charge.' : '❌ Ce ticket est déjà pris en charge.', flags: EPH });
  }

  if (sub === 'ajouter') {
    const u = i.options.getUser('membre');
    await i.channel.permissionOverwrites.edit(u.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true,
    });
    await logTicket(i.guild, `➕ Membre ajouté au ticket #${pad(t.id)}`, 0x3498db, [
      { name: 'Membre', value: `${u}`, inline: true }, { name: 'Par', value: `${i.user}`, inline: true },
    ]);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0x3498db).setDescription(`➕ ${u} a été ajouté au ticket par ${i.user}.`).setFooter({ text: cfg.FOOTER })],
    });
  }

  if (sub === 'retirer') {
    const u = i.options.getUser('membre');
    if (u.id === t.user_id) return i.reply({ content: '❌ Tu ne peux pas retirer le demandeur.', flags: EPH });
    await i.channel.permissionOverwrites.delete(u.id);
    await logTicket(i.guild, `➖ Membre retiré du ticket #${pad(t.id)}`, 0x3498db, [
      { name: 'Membre', value: `${u}`, inline: true }, { name: 'Par', value: `${i.user}`, inline: true },
    ]);
    return i.reply({
      embeds: [new EmbedBuilder().setColor(0x3498db).setDescription(`➖ ${u} a été retiré du ticket par ${i.user}.`).setFooter({ text: cfg.FOOTER })],
    });
  }

  if (sub === 'renommer') {
    const nom = i.options.getString('nom').toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿ-]+/g, '-').slice(0, 60);
    await i.deferReply({ flags: EPH });
    await i.channel.setName(`${t.priority ? '🚀' : '🎫'}・${nom}`);
    return i.editReply('✅ Ticket renommé.');
  }

  if (sub === 'fermer') {
    const raison = i.options.getString('raison');
    await i.deferReply({ flags: EPH });
    await i.editReply('🔒 Fermeture en cours…');
    return closeTicket(client, t, i.user, raison);
  }
}

async function handle(i, client) {
  if (i.isChatInputCommand() && i.commandName === 'ticket') { await onCommand(i, client); return true; }

  if (i.isButton()) {
    const id = i.customId;
    if (id.startsWith('tk_open:')) { await onOpenButton(i); return true; }

    if (id === 'tk_claim') {
      const t = await getByChannel(i.channelId);
      if (!t || t.status !== 'open') return true;
      if (!isStaff(i.member)) { await deny(i, 'Guide et +'); return true; }
      await i.deferUpdate();
      const ok = await doClaim(client, t, i.user);
      if (!ok) await i.followUp({ content: '❌ Ce ticket est déjà pris en charge.', flags: EPH });
      return true;
    }

    if (id === 'tk_close') {
      const t = await getByChannel(i.channelId);
      if (!t || t.status !== 'open') return true;
      if (!isStaff(i.member) && i.user.id !== t.user_id) {
        await i.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', flags: EPH });
        return true;
      }
      await i.reply({
        content: '⚠️ Veux-tu vraiment fermer ce ticket ?',
        flags: EPH,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tk_close_yes').setLabel('Confirmer').setEmoji('🔒').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('tk_close_no').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
        )],
      });
      return true;
    }

    if (id === 'tk_close_no') { await i.update({ content: '✅ Fermeture annulée.', components: [] }); return true; }

    if (id === 'tk_close_yes') {
      const t = await getByChannel(i.channelId);
      if (!t || t.status !== 'open') return true;
      await i.update({ content: '🔒 Fermeture en cours…', components: [] });
      await closeTicket(client, t, i.user, null);
      return true;
    }
  }

  if (i.isModalSubmit() && i.customId.startsWith('tk_modal:')) { await onModal(i, client); return true; }
  return false;
}

module.exports = { ticketCommand, handle, ensurePanel, onMessageDelete, onChannelDelete };
