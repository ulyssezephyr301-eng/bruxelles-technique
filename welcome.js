
const { EmbedBuilder } = require('discord.js');

const cfg = require('./config');

const GUILD_ID = cfg.GUILD_ID;

const WELCOME_CHANNEL_ID = '1514274839823646730';
const LEAVE_CHANNEL_ID = '1514274908979331133';
const CIVIL_ROLE_ID = '1517283159744577596';

const RULES_CHANNEL_ID = '1513973934326939700';
const INFO_CHANNEL_ID = '1563691087271432192';
const SERVERS_CHANNEL_ID = '1567231276040065116';
const TICKET_CHANNEL_ID = '1569495381706801243';

const welcomeSent = new Set();
const pendingInviteSaves = new Map();

let inviteCache = new Map();
let inviteQueue = Promise.resolve();

const welcomeMessages = [
  'Toute l’équipe est heureuse de t’accueillir ! Installe-toi et profite de ton expérience parmi nous.',
  'Un nouveau visage parmi nous ! Nous te souhaitons une excellente aventure sur Bruxelles Role-Play.',
  'Bienvenue dans la communauté ! Nous espérons que tu passeras de très bons moments avec nous.',
  'Nous sommes ravis de te compter parmi nous. N’hésite pas à participer et à faire connaissance !',
  'Une nouvelle personne rejoint l’aventure ! Toute l’équipe te souhaite la bienvenue.',
  'Bienvenue à toi ! Prends tes marques, découvre le serveur et surtout amuse-toi bien.',
  'La communauté s’agrandit ! Nous te souhaitons une superbe expérience parmi nous.',
  'Ravi de t’accueillir ! Si tu as besoin d’aide, notre équipe est là pour toi.',
];

function randomWelcome() {
  return welcomeMessages[
    Math.floor(Math.random() * welcomeMessages.length)
  ];
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return 'Durée inconnue';
  }

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];

  if (days) parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);

  if (minutes || parts.length === 0) {
    parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}

async function refreshInvites(guild) {
  const invites = await guild.invites.fetch();

  const nextCache = new Map(
    invites.map((invite) => [
      invite.code,
      invite.uses || 0,
    ])
  );

  let usedInvite = null;

  for (const invite of invites.values()) {
    if (
      (invite.uses || 0) >
      (inviteCache.get(invite.code) || 0)
    ) {
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
    args: [
      member.guild.id,
      member.id,
      inviterId || null,
      inviteCode || null,
    ],
  });
}

async function sendWelcome(member, db) {
  if (welcomeSent.has(member.id)) return;

  welcomeSent.add(member.id);

  try {
    const result = await db.execute({
      sql: `SELECT inviter_id
            FROM welcome_invites
            WHERE guild_id=? AND member_id=?`,
      args: [member.guild.id, member.id],
    });

    const inviterId = result.rows[0]?.inviter_id;
    const inviterText = inviterId
      ? `<@${inviterId}>`
      : 'Inviteur inconnu';

    const channel = await member.guild.channels.fetch(
      WELCOME_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased()) return;

    const createdAt = Math.floor(
      member.user.createdTimestamp / 1000
    );

    const displayName =
      member.user.globalName || member.user.username;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Bienvenue sur Bruxelles Role-Play !')
      .setDescription(
        `${randomWelcome()}\n\n` +
        `**Invité par :** ${inviterText}\n\n` +
        `Pense à consulter <#${RULES_CHANNEL_ID}> et <#${INFO_CHANNEL_ID}>.\n` +
        `N’hésite pas à rejoindre les autres serveurs dans <#${SERVERS_CHANNEL_ID}>.\n` +
        `Besoin d’un renseignement ou d’aide ? Tu peux ouvrir un ticket dans <#${TICKET_CHANNEL_ID}>.`
      )
      .addFields(
        {
          name: 'Membre',
          value: `${displayName}\n${member.user}`,
          inline: true,
        },
        {
          name: 'Identifiant',
          value: `\`${member.id}\``,
          inline: true,
        },
        {
          name: 'Membres du serveur',
          value: `${member.guild.memberCount}`,
          inline: true,
        },
        {
          name: 'Compte créé',
          value: `<t:${createdAt}:F>`,
          inline: false,
        }
      )
      .setThumbnail(
        member.user.displayAvatarURL({ size: 256 })
      )
      .setFooter({
        text: 'Bruxelles Role-Play • Bienvenue parmi nous',
      })
      .setTimestamp();

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      allowedMentions: {
        users: [
          member.id,
          ...(inviterId ? [inviterId] : []),
        ],
      },
    });

    await db.execute({
      sql: `DELETE FROM welcome_invites
            WHERE guild_id=? AND member_id=?`,
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
    const channel = await member.guild.channels.fetch(
      LEAVE_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased()) return;

    const now = Date.now();
    const joinedAt = member.joinedTimestamp;

    const joinedUnix = joinedAt
      ? Math.floor(joinedAt / 1000)
      : null;

    const leftUnix = Math.floor(now / 1000);

    const duration = joinedAt
      ? formatDuration(now - joinedAt)
      : 'Durée inconnue';

    const displayName =
      member.user.globalName || member.user.username;

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('Un membre nous a quittés')
      .setDescription(
        `**${displayName}** vient de quitter Bruxelles Role-Play.\n\n` +
        `Merci pour le temps passé parmi nous. Nous te souhaitons une bonne continuation !`
      )
      .addFields(
        {
          name: 'Membre',
          value: member.user.username,
          inline: true,
        },
        {
          name: 'Identifiant',
          value: `\`${member.id}\``,
          inline: true,
        },
        {
          name: 'Présence sur le serveur',
          value: duration,
          inline: false,
        },
        {
          name: 'Arrivée',
          value: joinedUnix
            ? `<t:${joinedUnix}:F> (<t:${joinedUnix}:R>)`
            : 'Inconnue',
          inline: false,
        },
        {
          name: 'Départ',
          value: `<t:${leftUnix}:F> (<t:${leftUnix}:R>)`,
          inline: false,
        }
      )
      .setThumbnail(
        member.user.displayAvatarURL({ size: 256 })
      )
      .setFooter({
        text: 'Bruxelles Role-Play • Départ',
      })
      .setTimestamp();

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      allowedMentions: {
        users: [member.id],
      },
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

  // Initialisation du cache d'invitations
  try {
    const invites = await guild.invites.fetch();

    inviteCache = new Map(
      invites.map((invite) => [
        invite.code,
        invite.uses || 0,
      ])
    );
  } catch (error) {
    console.error(
      '[welcome] Chargement invitations impossible :',
      error.message
    );
  }

  client.on('inviteCreate', (invite) => {
    inviteCache.set(invite.code, invite.uses || 0);
  });

  client.on('inviteDelete', (invite) => {
    inviteCache.delete(invite.code);
  });

  // Enregistrement de l'inviteur à l'arrivée
  client.on('guildMemberAdd', async (member) => {
    if (
      member.guild.id !== GUILD_ID ||
      member.user.bot
    ) return;

    const task = (async () => {
      let usedInvite = null;

      try {
        usedInvite = await detectInviter(member.guild);
      } catch (error) {
        console.error(
          '[welcome] Détection invitation impossible :',
          error.message
        );
      }

      const inviterId = usedInvite?.inviter?.id || null;

      await saveInviter(
        db,
        member,
        inviterId,
        usedInvite?.code || null
      );
    })();

    pendingInviteSaves.set(member.id, task);

    try {
      await task;
    } finally {
      pendingInviteSaves.delete(member.id);
    }
  });

  // Déclenchement uniquement à l'attribution du rôle CIVIL
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const hadCivil = oldMember.roles.cache.has(CIVIL_ROLE_ID);
    const hasCivil = newMember.roles.cache.has(CIVIL_ROLE_ID);

    if (!hadCivil && hasCivil) {
      // Attend l'enregistrement de l'inviteur si nécessaire
      const pending = pendingInviteSaves.get(newMember.id);

      if (pending) {
        await pending.catch((error) => {
          console.error('[welcome] Enregistrement invitation :', error);
        });
      }

      await sendWelcome(newMember, db);
    }
  });

  // Départ d'un membre ayant le rôle CIVIL
  client.on('guildMemberRemove', async (member) => {
    if (
      member.guild.id !== GUILD_ID ||
      member.user.bot
    ) return;

    if (member.roles.cache.has(CIVIL_ROLE_ID)) {
      await sendLeave(member);
    }

    await db.execute({
      sql: `DELETE FROM welcome_invites
            WHERE guild_id=? AND member_id=?`,
      args: [member.guild.id, member.id],
    }).catch((error) => {
      console.error('[welcome] Nettoyage invitation :', error.message);
    });

    welcomeSent.delete(member.id);
    pendingInviteSaves.delete(member.id);
  });

  console.log('[welcome] Module bienvenue et départ chargé.');
}

module.exports = { init };
