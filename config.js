module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,
  GUILD_ID: process.env.GUILD_ID || '1513940188060057720',
  CIVIL_ROLE: '1517283159744577596',

  // Administrateur, Exécutif, Fondateur
  STAFF_ROLES: ['1563694441212944434', '1514237734472908810', '1513966828555210752'],
  // Guide, Modérateur, Administrateur, Exécutif, Fondateur
  TICKET_STAFF_ROLES: [
    '1514240838916509696', '1514240629889175693', '1563694441212944434',
    '1514237734472908810', '1513966828555210752',
  ],
  // Rôles pingés quand un ticket est ouvert : Modérateur, Guide
  TICKET_PING_ROLES: ['1514240629889175693', '1514240838916509696'],

  // Giveaway
  START: Date.parse('2026-11-11T14:00:00+01:00'),
  END: Date.parse('2026-12-20T23:59:00+01:00'),
  MIN_INVITES: 5,

  // Tickets
  TICKET_PANEL_CHANNEL: '1569495381706801243',
  TICKET_LOG_CHANNEL: '1569495626553757879',
  TICKET_ALERT_CHANNEL: '1514326681446514798',
  ROLE_VIP: '1569496637414449213',
  ROLE_BOOSTER: '1569496721724280854',
  TICKET_MAX_OPEN: 2,
  TICKET_TYPES: [
    { id: 'general', emoji: '🛠️', label: 'Assistance Générale', desc: 'Obtiens de l’aide pour tout ce qui ne rentre pas dans les autres catégories.' },
    { id: 'identite', emoji: '🪪', label: 'Carte d’identité & Vérification', desc: 'Un souci avec ta carte d’identité, ton état civil ou ta vérification Roblox ?' },
    { id: 'entreprise', emoji: '🏢', label: 'Gestion des Entreprises', desc: 'Reprise d’une entreprise vacante ou toute demande liée à ton commerce RP.' },
    { id: 'mort', emoji: '💀', label: 'Déclaration de Mort RP', desc: 'Officialise la mort de ton personnage RP ou demande une autorisation.' },
    { id: 'signalement', emoji: '🚨', label: 'Signalement', desc: 'Signale un joueur ou une situation (pense à joindre tes preuves).' },
    { id: 'technique', emoji: '⚙️', label: 'Support Technique', desc: 'Un bug du serveur, d’un bot ou une erreur de connexion ? Décris le problème.' },
    { id: 'prioritaire', emoji: '🚀', label: 'Support Prioritaire', desc: 'Ouvre n’importe quel type de demande ici, elle passe avant les autres tickets.', restricted: true },
  ],

  // Effectif
  EFFECTIF_CHANNEL: '1567234864694952037',
  EFFECTIF_GROUPS: [
    {
      title: '👑 Direction', max: 250,
      roles: ['1513966828555210752', '1514237734472908810'], // Fondateur, Exécutif
    },
    {
      title: '🛡️ Staff', max: 300,
      roles: ['1563694441212944434', '1514240629889175693', '1514240838916509696'], // Admin, Modo, Guide
    },
    {
      title: '🎨 Pôle création', max: 300,
      roles: ['1558426593138049034', '1558426732699324446', '1569505793923874827'], // Graphiste, Développeur, Content creator
    },
    {
      title: '💎 Soutiens', max: 450,
      roles: ['1569496721724280854', '1569496637414449213'], // Booster, VIP
    },
  ],

  // Vocaux temporaires
  VOC_HRP_TRIGGER: '1514386360545579068',
  VOC_RP_TRIGGER: '1563688321538850817',

  COLOR: 0xf5c518,
  FOOTER: 'Dev by U-lis ⚜',
};
