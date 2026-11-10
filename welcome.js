
const {
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');

const { createCanvas, loadImage } = require('@napi-rs/canvas');

const GUILD_ID = '1514274839823646730'; // À remplacer par l'ID du serveur
const WELCOME_CHANNEL_ID = '1514274839823646730';
const LEAVE_CHANNEL_ID = '1514274908979331133';
const CIVIL_ROLE_ID = '1517283159744577596';

const RULES_CHANNEL_ID = '1513973934326939700';
const INFO_CHANNEL_ID = '1563691087271432192';
const SERVERS_CHANNEL_ID = '1567231276040065116';
const TICKET_CHANNEL_ID = '1569495381706801243';

// Image de fond fournie
const BACKGROUND_URL =
  'https://media.discordapp.net/attachments/1514274839823646730/1569491357226111128/joinimg.png?ex=6af44efb&is=6af2fd7b&hm=7597d826386bbeb669b47e4c599be22fc29c1e60778318f046885dfbb5087eb4&=&format=webp&quality=lossless';

const welcomeSent = new Set();
let backgroundPromise;

const welcomeMessages = [
  'Toute l’équipe est heureuse de t’accueillir ! Installe-toi et profite de ton expérience parmi nous.',
  'Un nouveau visage parmi nous ! Nous te souhaitons une excellente aventure sur Bruxelles Technique.',
  'Bienvenue dans la communauté ! Nous espérons que tu passeras de très bons moments avec nous.',
  'Nous sommes ravis de te compter parmi nous. N’hésite pas à participer et à faire connaissance !',
  'Une nouvelle personne rejoint l’aventure ! Toute l’équipe te souhaite la bienvenue.',
  'Bienvenue à toi ! Prends tes marques, découvre le serveur et surtout amuse-toi bien.',
  'La communauté s’agrandit ! Nous te souhaitons une superbe expérience parmi nous.',
  'Ravi de t’accueillir ! Si tu as besoin d’aide, notre équipe est là pour toi.',
];

let inviteCache = new Map();
let inviteQueue = Promise.resolve();

function randomWelcome() {
  return welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
}

async function getBackground() {
  if (!backgroundPromise) {
    backgroundPromise = (async () => {
      const response = await fetch(BACKGROUND_URL);
      if (!response.ok) throw new Error(`Image de fond inaccessible : ${response.status}`);
      return loadImage(Buffer.from(await response.arrayBuffer()));
    })();
  }
  return backgroundPromise;
}

function drawCover(ctx, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

function fitText(ctx, text, maxWidth, initialSize, font = 'bold') {
  let size = initialSize;
  while (size > 20) {
    ctx.font = `${font} ${size}px Arial`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

async function createMemberImage(member, isLeaving = false) {
  const width = 1200;
  const height = 420;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fond personnalisé, avec un fond de secours si le lien expire
  try {
    const background = await getBackground();
    drawCover(ctx, background, width, height);
  } catch (error) {
    console.error('[welcome] Image de fond indisponible :', error.message);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#171b35');
    gradient.addColorStop(1, '#354b79');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // Voile sombre pour rendre le texte lisible
  ctx.fillStyle = 'rgba(8, 12, 25, 0.60)';
  ctx.fillRect(0, 0, width, height);

  // Avatar
  const avatarUrl = member.user.displayAvatarURL({
    extension: 'png',
    size: 256,
  });

  const avatarResponse = await fetch(avatarUrl);
  if (!avatarResponse.ok) throw new Error('Impossible de récupérer l’avatar.');
  const avatar = await loadImage(Buffer.from(await avatarResponse.arrayBuffer()));

  ctx.save();
  ctx.beginPath();
  ctx.arc(215, 210, 115, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, 100, 95, 230, 230);
  ctx.restore();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(215, 210, 119, 0, Math.PI * 2);
  ctx.stroke();

  // Texte
  const title = isLeaving ? 'À BIENTÔT !' : 'BIENVENUE !';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px Arial';
  ctx.fillText(title, 390, 145);

  const displayName = member.user.globalName || member.user.username;
  const fontSize = fitText(ctx, displayName, 730, 62);
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillText(displayName, 390, 225);

  ctx.font = '28px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(
    isLeaving ? 'Merci pour ton passage sur le serveur !' : 'Bienvenue dans la communauté Bruxelles Technique',
    390,
    285,
  );

  ctx.font = '22px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`Membre ${member.guild.memberCount}`, 390, 340);

  return canvas.toBuffer('image/png');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'Durée inconnue';

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

  return parts.join(', ');
}

async function refreshInvites(guild) {
  const invites = await guild.invites.fetch();
  const nextCache = new Map(invites.map((invite) => [invite.code, invite.uses || 0]));

  let usedInvite = null;
  for (const invite of invites.values()) {
    if ((invite.uses || 0) > (inviteCache.get(invite.code) || 0)) {
      usedInvite = invite;
      break;
    }
  }

  inviteCache = nextCache;
  return usedInvite;
}

async function detectInviter(guild) {
  const task = inviteQueue.then(() => refreshInvites(guild));
  inviteQueue = task.catch(() => {});
  return task;
}

async function saveInviter(db, member, inviterId, inviteCode) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO welcome_invites
          (guild_id, member_id, inviter_id, invite_code)
          VALUES (?, ?, ?, ?)`,
    args: [member.guild.id, member.id, inviterId || null, inviteCode || null],
  });
}

async function sendWelcome(member, db) {
  if (welcomeSent.has(member.id)) return;
  welcomeSent.add(member.id);

  try {
    const result = await db.execute({
      sql: 'SELECT inviter_id FROM welcome_invites WHERE guild_id=? AND member_id=?',
      args: [member.guild.id, member.id],
    });

    const inviterId = result.rows[0]?.inviter_id;
    const inviterText = inviterId ? `<@${inviterId}>` : 'Inviteur inconnu';

    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const image = await createMemberImage(member);
    const attachment = new AttachmentBuilder(image, { name: 'bienvenue.png' });

    const createdAt = Math.floor(member.user.createdTimestamp / 1000);
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Bienvenue sur Bruxelles Technique !')
      .setDescription(
        `${randomWelcome()}\n\n` +
        `**Invité par :** ${inviterText}\n\n` +
        `Pense à consulter <#${RULES_CHANNEL_ID}> et <#${INFO_CHANNEL_ID}>.\n` +
        `N’hésite pas à rejoindre les autres serveurs dans <#${SERVERS_CHANNEL_ID}>.\n` +
        `Besoin d’un renseignement ou d’aide ? Tu peux ouvrir un ticket dans <#${TICKET_CHANNEL_ID}>.`
      )
      .addFields(
        { name: 'Membre', value: `${member.user}`, inline: true },
        { name: 'Identifiant', value: `\`${member.id}\``, inline: true },
        { name: 'Compte créé', value: `<t:${createdAt}:F>`, inline: false },
      )
      .setImage('attachment://bienvenue.png')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: 'Bruxelles Technique • Bienvenue parmi nous' })
      .setTimestamp();

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      files: [attachment],
      allowedMentions: {
        users: [member.id, ...(inviterId ? [inviterId] : [])],
      },
    });

    await db.execute({
      sql: 'DELETE FROM welcome_invites WHERE guild_id=? AND member_id=?',
      args: [member.guild.id, member.id],
    });

    console.log(`[welcome] Bienvenue envoyée à ${member.user.tag}`);
  } catch (error) {
    welcomeSent.delete(member.id);
    console.error('[welcome] Erreur bienvenue :', error);
  }
}

async function sendLeave(member) {
  try {
    const channel = await member.guild.channels.fetch(LEAVE_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const now = Date.now();
    const joinedAt = member.joinedTimestamp;
    const joinedUnix = joinedAt ? Math.floor(joinedAt / 1000) : null;
    const leftUnix = Math.floor(now / 1000);
    const duration = joinedAt ? formatDuration(now - joinedAt) : 'Durée inconnue';

    const image = await createMemberImage(member, true);
    const attachment = new AttachmentBuilder(image, { name: 'depart.png' });

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('Un membre nous a quittés')
      .setDescription(
        `**${member.user.globalName || member.user.username}** vient de quitter Bruxelles Technique.\n\n` +
        `Merci pour le temps passé parmi nous. Nous te souhaitons une bonne continuation !`
      )
      .addFields(
        { name: 'Membre', value: `${member.user.username}`, inline: true },
        { name: 'Identifiant', value: `\`${member.id}\``, inline: true },
        { name: 'Présence sur le serveur', value: duration, inline: false },
        { name: 'Arrivée', value: joinedUnix ? `<t:${joinedUnix}:F> (<t:${joinedUnix}:R>)` : 'Inconnue', inline: false },
        { name: 'Départ', value: `<t:${leftUnix}:F> (<t:${leftUnix}:R>)`, inline: false },
      )
      .setImage('attachment://depart.png')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: 'Bruxelles Technique • Départ' })
      .setTimestamp();

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      files: [attachment],
      allowedMentions: { users: [member.id] },
    });

    console.log(`[welcome] Départ annoncé : ${member.user.tag}`);
  } catch (error) {
    console.error('[welcome] Erreur départ :', error);
  }
}

async function init(client, db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS welcome_invites (
      guild_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      inviter_id TEXT,
      invite_code TEXT,
      PRIMARY KEY (guild_id, member_id)
    )
  `);

  const guild = await client.guilds.fetch(GUILD_ID);

  try {
    const invites = await guild.invites.fetch();
    inviteCache = new Map(invites.map((invite) => [invite.code, invite.uses || 0]));
  } catch (error) {
    console.error('[welcome] Impossible de charger les invitations :', error.message);
  }

  client.on('inviteCreate', (invite) => {
    inviteCache.set(invite.code, invite.uses || 0);
  });

  client.on('inviteDelete', (invite) => {
    inviteCache.delete(invite.code);
  });

  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== GUILD_ID || member.user.bot) return;

    let usedInvite = null;
    try {
      usedInvite = await detectInviter(member.guild);
    } catch (error) {
      console.error('[welcome] Détection invitation impossible :', error.message);
    }

    const inviterId = usedInvite?.inviter?.id || null;
    await saveInviter(db, member, inviterId, usedInvite?.code || null);
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const hadCivil = oldMember.roles.cache.has(CIVIL_ROLE_ID);
    const hasCivil = newMember.roles.cache.has(CIVIL_ROLE_ID);

    // Le message de bienvenue part uniquement à l'attribution du rôle CIVIL.
    if (!hadCivil && hasCivil) {
      await sendWelcome(newMember, db);
    }
  });

  client.on('guildMemberRemove', async (member) => {
    if (member.guild.id !== GUILD_ID || member.user.bot) return;

    // Le message de départ est réservé aux membres qui avaient le rôle CIVIL.
    if (member.roles.cache.has(CIVIL_ROLE_ID)) {
      await sendLeave(member);
    }

    await db.execute({
      sql: 'DELETE FROM welcome_invites WHERE guild_id=? AND member_id=?',
      args: [member.guild.id, member.id],
    }).catch((error) => console.error('[welcome] Nettoyage invitation :', error.message));

    welcomeSent.delete(member.id);
  });

  console.log('[welcome] Module bienvenue et départ chargé.');
}

module.exports = { init };
