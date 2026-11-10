const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const cfg = require('./config');

const commandesCommand = new SlashCommandBuilder()
  .setName('commandes')
  .setDescription('Voir toutes les commandes du bot et leur fonctionnement')
  .toJSON();

let ids = new Map();
const setIds = (cmds) => { ids = new Map(cmds.map((c) => [c.name, c.id])); };
const cmd = (name, sub) => {
  const id = ids.get(name);
  const full = sub ? `${name} ${sub}` : name;
  return id ? `</${full}:${id}>` : `\`/${full}\``;
};

function commandesEmbed() {
  return new EmbedBuilder()
    .setColor(cfg.COLOR)
    .setTitle('📖 Commandes du bot technique')
    .setDescription('Le grade indiqué après chaque commande est le **minimum requis**.')
    .addFields(
      {
        name: '🎫 Tickets : pour tous',
        value:
          '🔹 Les **boutons du panneau** — Tout le monde\n' +
          '└ Clique sur une catégorie, explique ta demande, et un salon privé est créé pour toi.\n' +
          `🔹 **Support Prioritaire** — <@&${cfg.ROLE_VIP}> et <@&${cfg.ROLE_BOOSTER}>\n` +
          '└ Ta demande passe devant les autres tickets.',
      },
      {
        name: '🛡️ Tickets : staff',
        value:
          `${cmd('ticket', 'prendre')} — Prendre en charge le ticket — **Guide et +**\n` +
          `${cmd('ticket', 'ajouter')} — Ajouter un membre au ticket — **Guide et +**\n` +
          `${cmd('ticket', 'retirer')} — Retirer un membre du ticket — **Guide et +**\n` +
          `${cmd('ticket', 'renommer')} — Renommer le salon du ticket — **Guide et +**\n` +
          `${cmd('ticket', 'fermer')} — Fermer le ticket (transcript envoyé dans les logs) — **Guide et +**\n` +
          `${cmd('ticket', 'panneau')} — Renvoyer le panneau de tickets — **Administrateur et +**`,
      },
      {
        name: '🎙️ Vocaux temporaires',
        value:
          `🔹 Rejoins <#${cfg.VOC_HRP_TRIGGER}> — Tout le monde\n` +
          '└ Crée ton **vocal HRP** avec un panneau pour le gérer (renommer, limite, verrouiller, masquer, inviter, expulser, bloquer, transférer).\n' +
          `🔹 Rejoins <#${cfg.VOC_RP_TRIGGER}> — Tout le monde\n` +
          '└ Crée une **fréquence RP** numérotée. Les vocaux vides sont supprimés automatiquement.',
      },
      {
        name: '🎉 Giveaway',
        value:
          `${cmd('giveaway', 'creer')} — Poster le giveaway d’invitations — **Administrateur et +**\n` +
          `${cmd('giveaway', 'terminer')} — Terminer le giveaway maintenant — **Administrateur et +**\n` +
          `${cmd('giveaway', 'disqualifier')} — Disqualifier un membre (triche) — **Administrateur et +**\n` +
          '🔹 Bouton **Mon lien d’invitation** — Tout le monde',
      },
      {
        name: '📋 Effectif & autres',
        value:
          `${cmd('effectif')} — Envoyer ou renvoyer l’effectif du serveur — **Administrateur et +**\n` +
          '🔹 Bouton **Mettre à jour l’effectif** — **Guide et +**\n' +
          `${cmd('commandes')} — Afficher cette liste — Tout le monde`,
      },
      {
        name: '⚙️ Comment fonctionnent les tickets ?',
        value:
          '1️⃣ Le membre ouvre un ticket et décrit sa demande\n' +
          '2️⃣ Un salon privé est créé, le staff est prévenu dans le salon d’alerte\n' +
          '3️⃣ Un membre du staff clique sur **Prendre en charge** : l’alerte disparaît\n' +
          '4️⃣ À la fermeture, un **transcript** est envoyé dans les logs et en MP au membre\n' +
          '🔹 Maximum **' + cfg.TICKET_MAX_OPEN + ' tickets** ouverts par personne\n' +
          '🔹 Si le panneau est supprimé, il est renvoyé automatiquement',
      }
    )
    .setFooter({ text: cfg.FOOTER });
}

module.exports = { commandesCommand, commandesEmbed, setIds };
