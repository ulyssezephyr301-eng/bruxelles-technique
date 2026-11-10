
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const cfg = require('./config');
const { db } = require('./db');

const PANEL_CHANNEL = '1569773459775422514';

const NOTIFICATION_ROLES = [
  {
    id: '1533997530881196158',
    label: 'Session RP',
    description: 'Recevoir les notifications des sessions RP',
  },
  {
    id: '1533997605682675712',
    label: 'Règlement',
    description: 'Recevoir les notifications concernant le règlement',
  },
  {
    id: '1533997683587682344',
    label: 'Spoil',
    description: 'Recevoir les notifications avec spoilers',
  },
  {
    id: '1533997774075334656',
    label: 'Recrutement',
    description: 'Recevoir les annonces de recrutement',
  },
  {
    id: '1533997852752216285',
    label: 'Effectif',
    description: 'Recevoir les annonces concernant les effectifs',
  },
  {
    id: '1569773158590980200',
    label: 'Changelog',
    description: 'Recevoir les nouveautés et mises à jour',
  },
  {
    id: '1569813474421383228',
    label: 'Concours',
    description: 'Recevoir les annonces de concours',
  },
  {
    id: '1569813749026783374',
    label: 'Toutes les notifications',
    description: 'Recevoir toutes les notifications générales',
  },
];

const ROLE_IDS = new Set(NOTIFICATION_ROLES.map((r) => r.id));

function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(cfg.COLOR || 0xf5c518)
    .setTitle('🔔 Gestion des notifications')
    .setDescription(
      'Choisis les notifications que tu souhaites recevoir sur le serveur **Bruxelles Roleplay**.\n\n' +
      'Utilise le premier menu pour **ajouter** des rôles et le second pour **retirer** ceux que tu ne souhaites plus avoir.\n\n' +
      'Tu peux sélectionner plusieurs catégories en même temps. Tes choix sont modifiables à tout moment.'
    )
    .addFields({
      name: 'Rôles disponibles',
      value: NOTIFICATION_ROLES
        .map((r) => `• **${r.label}** — ${r.description}`)
        .join('\n'),
    })
    .setFooter({
      text: cfg.FOOTER || 'Bruxelles Roleplay',
    });

  const addMenu = new StringSelectMenuBuilder()
    .setCustomId('notif_add_roles')
    .setPlaceholder('Sélectionner les rôles à ajouter')
    .setMinValues(1)
    .setMaxValues(NOTIFICATION_ROLES.length)
    .addOptions(
      NOTIFICATION_ROLES.map((r) => ({
        label: r.label,
        description: r.description,
        value: r.id,
      }))
    );

  const removeMenu = new StringSelectMenuBuilder()
    .setCustomId('notif_remove_roles')
    .setPlaceholder('Sélectionner les rôles à retirer')
    .setMinValues(1)
    .setMaxValues(NOTIFICATION_ROLES.length)
    .addOptions(
      NOTIFICATION_ROLES.map((r) => ({
        label: r.label,
        description: r.description,
        value: r.id,
      }))
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(addMenu),
      new ActionRowBuilder().addComponents(removeMenu),
    ],
    allowedMentions: { parse: [] },
  };
}

let panelBusy = false;

async function ensurePanel(client) {
  if (panelBusy) return;
  panelBusy = true;

  try {
    const guild = await client.guilds.fetch(cfg.GUILD_ID);
    const channel = await guild.channels.fetch(PANEL_CHANNEL);

    if (!channel || !channel.isTextBased() || !channel.messages) {
      throw new Error('Salon du panneau introuvable ou incompatible.');
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS notification_panel (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL
      )
    `);

    const result = await db.execute({
      sql: 'SELECT message_id FROM notification_panel WHERE guild_id=?',
      args: [guild.id],
    });

    const old = result.rows[0]
      ? await channel.messages.fetch(result.rows[0].message_id).catch(() => null)
      : null;

    let message;

    if (old) {
      message = await old.edit(panelPayload());
    } else {
      message = await channel.send(panelPayload());
    }

    await db.execute({
      sql: 'INSERT OR REPLACE INTO notification_panel (guild_id, channel_id, message_id) VALUES (?,?,?)',
      args: [guild.id, channel.id, message.id],
    });

    console.log('[notifications] Panneau vérifié.');
  } finally {
    panelBusy = false;
  }
}

async function handle(interaction) {
  if (!interaction.isStringSelectMenu()) return false;

  const adding = interaction.customId === 'notif_add_roles';
  const removing = interaction.customId === 'notif_remove_roles';

  if (!adding && !removing) return false;

  const selectedIds = interaction.values.filter((id) =>
    ROLE_IDS.has(id)
  );

  if (
    !selectedIds.length ||
    selectedIds.length !== interaction.values.length
  ) {
    await interaction.reply({
      content: '❌ Sélection invalide.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    const guild = interaction.guild;
    const botMember = await guild.members.fetchMe();

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: '❌ Le bot doit disposer de la permission **Gérer les rôles**.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const roles = await Promise.all(
      selectedIds.map((id) => guild.roles.fetch(id))
    );

    if (roles.some((role) => !role)) {
      await interaction.reply({
        content: '❌ Au moins un des rôles configurés est introuvable.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (
      roles.some(
        (role) =>
          role.managed ||
          role.position >= botMember.roles.highest.position
      )
    ) {
      await interaction.reply({
        content: '❌ Le rôle le plus élevé du bot doit être placé au-dessus de tous les rôles de notification.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const member = await guild.members.fetch(interaction.user.id);

    if (adding) {
      await member.roles.add(
        roles,
        'Choix des rôles de notification via le panneau.'
      );
    } else {
      await member.roles.remove(
        roles,
        'Retrait des rôles de notification via le panneau.'
      );
    }

    const labels = selectedIds.map(
      (id) => NOTIFICATION_ROLES.find((r) => r.id === id).label
    );

    // Actualisation des menus pour vider la sélection
    await interaction.update({
      components: panelPayload().components,
    });

    await interaction.followUp({
      content: adding
        ? `✅ Rôle(s) ajouté(s) : **${labels.join(', ')}**.`
        : `✅ Rôle(s) retiré(s) : **${labels.join(', ')}**.`,
      flags: MessageFlags.Ephemeral,
    });

  } catch (error) {
    console.error('[notifications] Erreur :', error);

    const message =
      '❌ Impossible de modifier tes rôles. Vérifie les permissions et la hiérarchie des rôles du bot.';

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }

  return true;
}

module.exports = { ensurePanel, handle };
