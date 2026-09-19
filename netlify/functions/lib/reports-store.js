'use strict';
// Inminnes rapportkö — återställs vid function cold start.
// Samma inriktning som server.js: prototyp, ingen database.
const reports = [
  { id: 'RPT-1042', category: 'Olämplig kontakt', detail: 'Rapport från 13–17-profil · video #aurora', priority: 'critical', time: '12:42', status: 'new' },
  { id: 'RPT-1041', category: 'Kommentarfilter', detail: 'Externa kontaktuppgifter · video #garden', priority: 'high', time: '12:18', status: 'new' },
  { id: 'RPT-1038', category: 'Farlig utmaning', detail: 'Automatisk flaggning · väntar på granskning', priority: 'low', time: '11:55', status: 'reviewed' },
];

const reportReasons = new Set([
  'Olämplig kontakt',
  'Sexuellt eller exploaterande innehåll',
  'Hot, hat eller mobbning',
  'Farlig utmaning eller självskada',
  'Annat som känns fel',
]);

module.exports = { reports, reportReasons };
