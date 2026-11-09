const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const cfg = require('./config');
const { db } = require('./db');

const ts = (ms) => Math.floor(ms / 1000);
const MEDALS = ['🥇', '🥈', '🥉'];
const PRIZES = [
  '💶 30 000 € • 🏡 Maison quartier de luxe • 🚙 Audi Q8',
  '💶 20 000 € • 🚙 Dodge Charger • 🏡 Maison banlieue de River City',
  '💶 20 000 € • 🚙 Falcon Rampage • 🏡 Bungalow à High Rock Park',
];

async function getActive(guildId) {
  const r = await db.execute({ sql: 'SELECT * FROM giveaway WHERE guild_id=?', args: [guildId] });
  return r.rows[0] || null;
}

async function getBoard(guildId) {
  const r = await db.execute({
    sql: `SELECT inviter_id,
            SUM(CASE WHEN status='validated' THEN 1 ELSE 0 END) v,
            SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) p
          FROM invited
          WHERE guild_id=? AND has_left=0
            AND inviter_id NOT IN (SELECT user_id FROM disq WHERE guild_id=?)
          GROUP BY inviter_id`,
    args: [guildId, guildId],
  });
  return r.rows
    .map((x) => ({ id: x.inviter_id, v: Number(x.v), p: Number(x.p) }))
    .sort((a, b) => b.v - a.v || b.p - a.p);
}

function announceEmbed(guild) {
  const e = new EmbedBuilder()
    .setColor(cfg.COLOR)
    .setTitle('🎉🇧🇪  GRAND GIVEAWAY • SPÉCIAL OUVERTURE  🇧🇪🎉')
    .setDescription(
      '🏆 À l’occasion de l’ouverture de **Bruxelles Roleplay**, tentez de remporter un **pack de démarrage incroyable** pour lancer votre aventure RP dans les meilleures conditions !\n\n' +
      '🎁 **Le principe est simple :** la personne qui invite le plus de membres sur le serveur remporte le concours.\n\n' +
      '**1️⃣** Clique sur **Mon lien d’invitation** ci-dessous\n' +
      '**2️⃣** Partage ton lien personnel (le même pour tous tes invités)\n' +
      '**3️⃣** Chaque invité compte dès qu’il a sa **carte d’identité** et sa **vérification Roblox**\n\n' +
      '⏳ **En attente** : l’invité a rejoint mais n’a pas encore le rôle civil\n' +
      '✅ **Validée** : l’invité a reçu le rôle civil\n' +
      '*Le classement se fait sur les invitations validées.*'
    )
    .addFields(
      {
        name: '📋 Conditions de participation',
        value:
          '🔹 Inviter **au minimum 5 personnes** pour être éligible\n' +
          '🔹 Les invités doivent avoir créé leur **carte d’identité** et effectué la **vérification Roblox** (compte Roblox obligatoire)\n' +
          '🔹 🚫 **Doubles comptes interdits** : toute triche = disqualification immédiate',
      },
      { name: '🏆 1ʳᵉ place', value: PRIZES[0].replaceAll(' • ', '\n'), inline: true },
      { name: '🥈 2ᵉ place', value: PRIZES[1].replaceAll(' • ', '\n'), inline: true },
      { name: '🥉 3ᵉ place', value: PRIZES[2].replaceAll(' • ', '\n'), inline: true },
      {
        name: '🗓️ Calendrier',
        value:
          `🟢 Début : <t:${ts(cfg.START)}:F>\n` +
          `🔴 Fin : <t:${ts(cfg.END)}:F> (<t:${ts(cfg.END)}:R>)\n` +
          '⚠️ Les invitations avant le début ne comptent pas.',
      }
    )
    .setFooter({ text: cfg.FOOTER });
  if (guild?.iconURL()) e.setThumbnail(guild.iconURL());
  return e;
}

function lines(board, max) {
  return board.slice(0, max).map((x, i) => {
    const rank = MEDALS[i] || `**${i + 1}.**`;
    const ok = x.v >= cfg.MIN_INVITES ? '' : ' 🔒';
    return `${rank} <@${x.id}> — ✅ **${x.v}** validée${x.v > 1 ? 's' : ''} • ⏳ ${x.p} en attente${ok}`;
  }).join('\n');
}

function boardEmbed(board, ended) {
  const e = new EmbedBuilder().setColor(ended ? 0x2ecc71 : 0x3498db).setFooter({ text: cfg.FOOTER });
  if (!ended) {
    e.setTitle('📊 CLASSEMENT EN DIRECT')
      .setDescription(
        (board.length ? lines(board, 10) : '*Aucune invitation pour le moment, sois le premier !*') +
        `\n\n🔒 = moins de ${cfg.MIN_INVITES} invitations validées (non éligible)`
      )
      .setTimestamp();
    return e;
  }
  const qualified = board.filter((x) => x.v >= cfg.MIN_INVITES);
  e.setTitle('🏁 CLASSEMENT FINAL • GIVEAWAY TERMINÉ');
  if (!qualified.length) {
    e.setDescription('Aucun participant n’a atteint le minimum requis. Merci à tous ! 🇧🇪');
    return e;
  }
  const podium = qualified.slice(0, 3).map((x, i) =>
    `${MEDALS[i]} <@${x.id}> — ✅ **${x.v}** invitations\n└ ${PRIZES[i]}`).join('\n\n');
  const rest = qualified.slice(3, 10).map((x, i) =>
    `**${i + 4}.** <@${x.id}> — ✅ ${x.v}`).join('\n');
  e.setDescription(`🎉 **Félicitations aux gagnants !**\n\n${podium}${rest ? `\n\n**Suite du classement**\n${rest}` : ''}`);
  return e;
}

const linkRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('gw_link').setLabel('Mon lien d’invitation')
    .setEmoji('🔗').setStyle(ButtonStyle.Success)
);

const refreshRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('gw_refresh').setLabel('Actualiser')
    .setEmoji('🔄').setStyle(ButtonStyle.Secondary)
);

async function personalPayload(guildId, userId, link) {
  const board = await getBoard(guildId);
  const idx = board.findIndex((x) => x.id === userId);
  const me = board[idx] || { v: 0, p: 0 };
  const left = Math.max(0, cfg.MIN_INVITES - me.v);
  const mine = new EmbedBuilder()
    .setColor(cfg.COLOR)
    .setTitle('🔗 Ton lien d’invitation')
    .setDescription(`**${link}**\n\nPartage ce lien : toutes les personnes qui rejoignent avec comptent pour toi.`)
    .addFields(
      { name: '✅ Validées', value: `${me.v}`, inline: true },
      { name: '⏳ En attente', value: `${me.p}`, inline: true },
      { name: '📍 Ta place', value: idx >= 0 ? `#${idx + 1}` : '—', inline: true },
      {
        name: '🎯 Éligibilité',
        value: left === 0 ? '✅ Tu es éligible au concours !' : `Encore **${left}** invitation${left > 1 ? 's' : ''} validée${left > 1 ? 's' : ''} pour être éligible.`,
      }
    )
    .setFooter({ text: cfg.FOOTER });
  return { embeds: [mine, boardEmbed(board, false)], components: [refreshRow()] };
}

async function refreshPublic(client) {
  const gw = await getActive(cfg.GUILD_ID);
  if (!gw || gw.status !== 'active') return;
  const guild = client.guilds.cache.get(cfg.GUILD_ID);
  const ch = await guild.channels.fetch(gw.channel_id).catch(() => null);
  const msg = await ch?.messages.fetch(gw.message_id).catch(() => null);
  if (!msg) return;
  const board = await getBoard(cfg.GUILD_ID);
  await msg.edit({ embeds: [announceEmbed(guild), boardEmbed(board, false)], components: [linkRow()] });
}

let timer = null;
function scheduleRefresh(client) {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    await refreshPublic(client).catch((e) => console.error('refresh', e.message));
  }, 10000);
}

async function finish(client) {
  const gw = await getActive(cfg.GUILD_ID);
  if (!gw || gw.status !== 'active') return false;
  const guild = client.guilds.cache.get(cfg.GUILD_ID);
  const board = await getBoard(cfg.GUILD_ID);
  const ch = await guild.channels.fetch(gw.channel_id).catch(() => null);
  const msg = await ch?.messages.fetch(gw.message_id).catch(() => null);
  await db.execute({ sql: "UPDATE giveaway SET status='ended' WHERE guild_id=?", args: [cfg.GUILD_ID] });
  if (msg) await msg.edit({ embeds: [announceEmbed(guild), boardEmbed(board, true)], components: [] });
  const winners = board.filter((x) => x.v >= cfg.MIN_INVITES).slice(0, 3);
  if (ch && winners.length) {
    await ch.send({
      content: `🎉 Le giveaway est terminé ! Bravo à ${winners.map((w) => `<@${w.id}>`).join(', ')} !`,
      allowedMentions: { users: winners.map((w) => w.id) },
    });
  }
  return true;
}

module.exports = {
  cfg, getActive, getBoard, announceEmbed, boardEmbed, linkRow,
  personalPayload, refreshPublic, scheduleRefresh, finish,
};
