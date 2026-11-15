
const {
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const cfg = require('./config');
const { db } = require('./db');

const EPH = MessageFlags.Ephemeral;
const REQUEST_CHANNEL_ID = '1571590475872337940';

// Rôles interdits aux demandes
const FORBIDDEN_ROLE_IDS = new Set([
  '1564202384782262272',
  '1564012833912520704',
  '1515639246692679740',
  '1513966828555210752',
  '1563923939623829505',
  '1565052230682284036',
  '1569484433126457529',
  '1520513878176301089',
  '1533281935290269770',
  '1513986961805803533',
  '1514237734472908810',
  '1515639590503846038',
  '1514240629889175693',
  '1563694441212944434',
  '1515639703573889114',
  '1514240838916509696'
]);

// Affichage du nom du rôle entre accents graves
function formatRoleName(name) {
  return '`' + String(name).replace(/`/g, '\\`') + '`';
}

// Commande slash
const roleCommand = new SlashCommandBuilder()
  .setName('demande-role')
  .setDescription('Faire une demande pour obtenir un rôle')
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('Le rôle que tu souhaites obtenir')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('preuve')
      .setDescription('Explique pourquoi tu souhaites ce rôle')
      .setMaxLength(1000)
      .setRequired(false)
  )
  .addUserOption(option =>
    option
      .setName('personne')
      .setDescription('Personne qui devra valider ta demande')
      .setRequired(false)
  )
  .addAttachmentOption(option =>
    option
      .setName('image')
      .setDescription('Image servant de preuve')
      .setRequired(false)
  )
  .toJSON();

function isAdmin(member) {
  if (!member || !Array.isArray(cfg.STAFF_ROLES)) return false;

  return cfg.STAFF_ROLES.some(roleId =>
    member.roles.cache.has(roleId)
  );
}

function statusText(status) {
  if (status === 'accepted') return 'Acceptée';
  if (status === 'refused') return 'Refusée';
  return 'En attente';
}

function requestEmbed(request) {
  const embed = new EmbedBuilder()
    .setColor(
      request.status === 'accepted'
        ? 0x2ecc71
        : request.status === 'refused'
          ? 0xe74c3c
          : (cfg.COLOR || 0x5865f2)
    )
    .setTitle('Demande de rôle')
    .setDescription(
      `**Demandeur :** <@${request.requester_id}>\n` +
      `**Rôle demandé :** <@&${request.role_id}>\n` +
      `**Statut :** ${statusText(request.status)}`
    )
    .addFields(
      {
        name: 'Preuve / justification',
        value: request.proof_text || 'Aucune justification écrite.',
        inline: false
      },
      {
        name: 'Personne chargée de valider',
        value: request.proof_user_id
          ? `<@${request.proof_user_id}>`
          : 'Validation par le staff',
        inline: false
      }
    )
    .setTimestamp(new Date(Number(request.created_ts) * 1000));

  if (request.decided_by) {
    embed.addFields({
      name: 'Décision prise par',
      value: `<@${request.decided_by}>`,
      inline: false
    });
  }

  if (request.proof_image_url) {
    embed.setImage(request.proof_image_url);
  }

  if (cfg.FOOTER) {
    embed.setFooter({ text: cfg.FOOTER });
  }

  return embed;
}

function staffButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`drs:accept:${id}`)
      .setLabel('Accepter')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`drs:refuse:${id}`)
      .setLabel('Refuser')
      .setStyle(ButtonStyle.Danger)
  );
}

function validatorButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`drv:accept:${id}`)
      .setLabel('Valider la demande')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`drv:refuse:${id}`)
      .setLabel('Refuser la demande')
      .setStyle(ButtonStyle.Danger)
  );
}

async function getRequest(id) {
  const result = await db.execute({
    sql: 'SELECT * FROM role_requests WHERE id = ?',
    args: [id]
  });

  return result.rows[0] || null;
}

async function updatePublicMessage(client, request) {
  if (!request.channel_id || !request.message_id) return;

  try {
    const channel = await client.channels.fetch(request.channel_id);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(request.message_id);

    const components =
      request.status === 'pending' &&
      (!request.proof_user_id || Number(request.staff_fallback) === 1)
        ? [staffButtons(request.id)]
        : [];

    await message.edit({
      embeds: [requestEmbed(request)],
      components
    });
  } catch (error) {
    console.error('[DEMANDE-ROLE] Erreur mise à jour message :', error);
  }
}

async function createRequest(i, client) {
  await i.deferReply({ flags: EPH });

  const role = i.options.getRole('role');
  const proofText = i.options.getString('preuve');
  const proofUser = i.options.getUser('personne');
  const attachment = i.options.getAttachment('image');

  if (!role || role.id === i.guild.id || role.managed) {
    return i.editReply('❌ Ce rôle ne peut pas faire l’objet d’une demande.');
  }

  if (FORBIDDEN_ROLE_IDS.has(role.id)) {
    return i.editReply('❌ Ce rôle ne peut pas faire l’objet d’une demande.');
  }

  if (!proofText && !proofUser && !attachment) {
    return i.editReply(
      '❌ Tu dois fournir au moins une preuve : un texte, une personne à contacter ou une image.'
    );
  }

  if (proofUser && proofUser.id === i.user.id) {
    return i.editReply('❌ Tu ne peux pas te désigner toi-même comme personne chargée de valider.');
  }

  if (proofUser && proofUser.bot) {
    return i.editReply('❌ Tu ne peux pas désigner un bot comme validateur.');
  }

  if (attachment && (!attachment.contentType || !attachment.contentType.startsWith('image/'))) {
    return i.editReply('❌ Le fichier fourni doit être une image.');
  }

  const duplicate = await db.execute({
    sql: `
      SELECT id
      FROM role_requests
      WHERE guild_id = ?
      AND requester_id = ?
      AND role_id = ?
      AND status = 'pending'
      LIMIT 1
    `,
    args: [i.guild.id, i.user.id, role.id]
  });

  if (duplicate.rows.length > 0) {
    return i.editReply('❌ Tu as déjà une demande en attente pour ce rôle.');
  }

  const channel = await client.channels.fetch(REQUEST_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return i.editReply('❌ Le salon des demandes de rôles est introuvable.');
  }

  const now = Math.floor(Date.now() / 1000);

  const inserted = await db.execute({
    sql: `
      INSERT INTO role_requests (
        guild_id,
        requester_id,
        role_id,
        proof_text,
        proof_user_id,
        proof_image_url,
        status,
        staff_fallback,
        channel_id,
        message_id,
        created_ts
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?)
    `,
    args: [
      i.guild.id,
      i.user.id,
      role.id,
      proofText || null,
      proofUser ? proofUser.id : null,
      attachment ? attachment.url : null,
      channel.id,
      now
    ]
  });

  const id = Number(inserted.lastInsertRowid);

  let request = await getRequest(id);

  const publicMessage = await channel.send({
    embeds: [requestEmbed(request)],
    components: !proofUser ? [staffButtons(id)] : []
  });

  await db.execute({
    sql: 'UPDATE role_requests SET message_id = ? WHERE id = ?',
    args: [publicMessage.id, id]
  });

  request = await getRequest(id);

  // Si une personne est désignée, elle reçoit un MP
  if (proofUser) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(cfg.COLOR || 0x5865f2)
        .setTitle('Demande de validation de rôle')
        .setDescription(
          `Bonjour <@${proofUser.id}> !\n\n` +
          `<@${i.user.id}> souhaite obtenir le rôle ${formatRoleName(role.name)}.\n\n` +
          `**Justification :**\n${proofText || 'Aucune justification écrite.'}\n\n` +
          `Peux-tu confirmer ou refuser cette demande ?`
        )
        .setTimestamp();

      if (attachment) {
        dmEmbed.setImage(attachment.url);
      }

      await proofUser.send({
        embeds: [dmEmbed],
        components: [validatorButtons(id)]
      });
    } catch (error) {
      console.error('[DEMANDE-ROLE] Erreur envoi MP :', error);

      // Si le MP échoue, le staff peut prendre le relais
      await db.execute({
        sql: 'UPDATE role_requests SET staff_fallback = 1 WHERE id = ?',
        args: [id]
      });

      request = await getRequest(id);
      await updatePublicMessage(client, request);

      await i.editReply(
        '⚠️ Ta demande a été publiée, mais la personne désignée ne peut pas recevoir de MP. Le staff pourra donc traiter ta demande.'
      );

      return;
    }
  }

  await i.editReply(
    `✅ Ta demande pour le rôle ${formatRoleName(role.name)} a bien été envoyée dans <#${REQUEST_CHANNEL_ID}>.`
  );
}

async function decide(i, client, type, action, id) {
  const request = await getRequest(id);

  if (!request) {
    return i.reply({
      content: '❌ Cette demande est introuvable.',
      flags: EPH
    });
  }

  if (request.status !== 'pending') {
    return i.reply({
      content: '❌ Cette demande a déjà été traitée.',
      flags: EPH
    });
  }

  if (type === 'validator') {
    if (!request.proof_user_id || request.proof_user_id !== i.user.id) {
      return i.reply({
        content: '❌ Tu n’es pas la personne désignée pour valider cette demande.',
        flags: EPH
      });
    }
  }

  if (type === 'staff') {
    if (!i.guild || i.guild.id !== request.guild_id || !isAdmin(i.member)) {
      return i.reply({
        content: '❌ Seuls les administrateurs et les membres du staff autorisés peuvent traiter cette demande.',
        flags: EPH
      });
    }

    if (request.proof_user_id && Number(request.staff_fallback) !== 1) {
      return i.reply({
        content: '❌ Cette demande doit être traitée par la personne désignée.',
        flags: EPH
      });
    }
  }

  // On réserve la demande pour éviter deux décisions simultanées
  const claim = await db.execute({
    sql: `
      UPDATE role_requests
      SET status = 'processing'
      WHERE id = ? AND status = 'pending'
    `,
    args: [id]
  });

  if (Number(claim.rowsAffected) === 0) {
    return i.reply({
      content: '❌ Cette demande a déjà été traitée par quelqu’un d’autre.',
      flags: EPH
    });
  }

  const newStatus = action === 'accept' ? 'accepted' : 'refused';

  // Attribution réelle du rôle en cas d'acceptation
  if (newStatus === 'accepted') {
    try {
      const guild = await client.guilds.fetch(request.guild_id);

      const role = await guild.roles.fetch(request.role_id);

      if (!role || role.id === guild.id || role.managed) {
        throw new Error('Le rôle demandé est introuvable ou ne peut pas être attribué.');
      }

      const botMember = await guild.members.fetch(client.user.id);

      if (!botMember.permissions.has('ManageRoles')) {
        throw new Error('Le bot ne possède pas la permission Gérer les rôles.');
      }

      if (botMember.roles.highest.comparePositionTo(role) <= 0) {
        throw new Error('Le rôle du bot doit être placé au-dessus du rôle demandé dans la hiérarchie Discord.');
      }

      const requester = await guild.members.fetch(request.requester_id);

      await requester.roles.add(
        role,
        `Demande de rôle #${id} acceptée par ${i.user.tag}`
      );

    } catch (error) {
      console.error('[DEMANDE-ROLE] Attribution du rôle impossible :', error);

      // On remet la demande en attente si le rôle n'a pas pu être attribué
      await db.execute({
        sql: `
          UPDATE role_requests
          SET status = 'pending'
          WHERE id = ? AND status = 'processing'
        `,
        args: [id]
      });

      const pendingRequest = await getRequest(id);
      await updatePublicMessage(client, pendingRequest);

      return i.reply({
        content:
          '❌ Impossible d’attribuer le rôle. La demande reste en attente.\n\n' +
          `**Détail :** ${error.message}\n\n` +
          'Vérifie les permissions du bot et la hiérarchie des rôles Discord.',
        flags: EPH
      });
    }
  }

  // Enregistrement définitif de la décision
  const result = await db.execute({
    sql: `
      UPDATE role_requests
      SET status = ?, decided_by = ?, decided_ts = ?
      WHERE id = ? AND status = 'processing'
    `,
    args: [
      newStatus,
      i.user.id,
      Math.floor(Date.now() / 1000),
      id
    ]
  });

  if (Number(result.rowsAffected) === 0) {
    return i.reply({
      content: '❌ Impossible d’enregistrer la décision.',
      flags: EPH
    });
  }

  const updatedRequest = await getRequest(id);

  await updatePublicMessage(client, updatedRequest);

  // Prévenir le demandeur en MP
  try {
    const requester = await client.users.fetch(request.requester_id);
    const guild = await client.guilds.fetch(request.guild_id);
    const role = await guild.roles.fetch(request.role_id).catch(() => null);

    const roleName = formatRoleName(role ? role.name : request.role_id);

    await requester.send(
      newStatus === 'accepted'
        ? `✅ Ta demande pour le rôle ${roleName} a été acceptée. Le rôle t'a été attribué automatiquement.`
        : `❌ Ta demande pour le rôle ${roleName} a été refusée.`
    );
  } catch (error) {
    console.error('[DEMANDE-ROLE] Impossible de prévenir le demandeur :', error);
  }

  return i.reply({
    content: newStatus === 'accepted'
      ? '✅ Demande acceptée. Le rôle a bien été attribué au membre.'
      : '❌ Demande refusée.',
    flags: EPH
  });
}

async function handle(i, client) {
  if (i.isChatInputCommand() && i.commandName === 'demande-role') {
    await createRequest(i, client);
    return true;
  }

  if (!i.isButton()) return false;

  const parts = i.customId.split(':');

  if (parts[0] === 'drs' && parts.length === 3) {
    await decide(i, client, 'staff', parts[1], parts[2]);
    return true;
  }

  if (parts[0] === 'drv' && parts.length === 3) {
    await decide(i, client, 'validator', parts[1], parts[2]);
    return true;
  }

  return false;
}

module.exports = {
  roleCommand,
  handle
};
