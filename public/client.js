const videos = [
  {
    id: 'aurora',
    creator: 'elin.studio',
    initials: 'E',
    creatorColor: '#c7f2df',
    verified: true,
    title: 'När himlen målar om hela kvällen',
    caption: 'Tre minuter vid vattnet och lite tålamod. Vilken färg ser du först? ',
    tags: ['#norrsken', '#ute'],
    sound: 'originalt ljud · elin.studio',
    likes: 24800,
    commentsCount: 486,
    shares: 921,
    tone: 'aurora',
    safeLabel: 'Lugn inspiration',
    comments: [
      { initials: 'M', name: 'Mira', text: 'Det här var precis vad jag behövde se idag.' },
      { initials: 'J', name: 'Joel', text: 'Wow, färgerna är helt otroliga.' },
    ],
    liked: false,
    saved: false,
    following: false,
  },
  {
    id: 'garden',
    creator: 'noor.skapa',
    initials: 'N',
    creatorColor: '#f0c6a8',
    verified: true,
    title: 'Gör en liten balkong till en stor paus',
    caption: 'Ett enkelt helgprojekt med sådant som redan fanns hemma. Spara om du vill testa! ',
    tags: ['#skapa', '#vardag'],
    sound: 'soft sunday · VY sounds',
    likes: 17300,
    commentsCount: 208,
    shares: 614,
    tone: 'mint',
    safeLabel: 'Kreativt innehåll',
    comments: [
      { initials: 'S', name: 'Sam', text: 'Fint och faktiskt enkelt att prova.' },
      { initials: 'A', name: 'Ava', text: 'Älskar färgkombinationen!' },
    ],
    liked: false,
    saved: false,
    following: false,
  },
  {
    id: 'night',
    creator: 'leo.foto',
    initials: 'L',
    creatorColor: '#d2c9fa',
    verified: false,
    title: 'En nattpromenad utan filter',
    caption: 'Stanna upp och lägg märke till ljusen runt dig. Små saker räknas också. ',
    tags: ['#foto', '#natt'],
    sound: 'midnight walk · leo.foto',
    likes: 9100,
    commentsCount: 97,
    shares: 301,
    tone: 'night',
    safeLabel: 'Kreativt innehåll',
    comments: [
      { initials: 'R', name: 'Rami', text: 'Den här stämningen! 🌙' },
    ],
    liked: false,
    saved: false,
    following: false,
  },
];

const fallbackReports = [
  { id: 'RPT-1042', category: 'Olämplig kontakt', detail: 'Rapport från 13–17-profil · video #aurora', priority: 'critical', time: '12:42', status: 'new' },
  { id: 'RPT-1041', category: 'Kommentarfilter', detail: 'Externa kontaktuppgifter · video #garden', priority: 'high', time: '12:18', status: 'new' },
  { id: 'RPT-1038', category: 'Farlig utmaning', detail: 'Automatisk flaggning · väntar på granskning', priority: 'low', time: '11:55', status: 'reviewed' },
];

const state = {
  activeView: 'feed',
  activeVideoId: videos[0].id,
  feedTab: 'for-you',
  reports: [],
  safety: { reports: true, comments: true },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getVideo(id) {
  return videos.find((video) => video.id === id) || videos[0];
}

function formatCount(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace('.', ',')}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 1).replace('.', ',')}k`;
  return String(value);
}

function setView(view) {
  const allowedViews = ['feed', 'following', 'create', 'safety', 'moderator'];
  if (!allowedViews.includes(view)) return;

  state.activeView = view;
  $$('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('is-visible', panel.dataset.viewPanel === view);
  });
  $$('.nav-item[data-view], .mobile-nav-item[data-view]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === view);
  });

  const titles = {
    feed: 'För dig',
    following: 'Följer',
    create: 'Ny video',
    safety: 'Trygghet först',
    moderator: 'Moderatorcenter',
  };
  $('#page-title').textContent = titles[view];
  if (view === 'moderator') renderReports();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderFeed() {
  const feed = $('#video-feed');
  if (!feed) return;

  let orderedVideos = [...videos];
  if (state.feedTab === 'new') orderedVideos.reverse();

  feed.innerHTML = orderedVideos.map((video, index) => `
    <article class="video-card ${index === 0 ? 'is-featured' : 'video-card--compact'}" data-video-id="${video.id}">
      <div class="video-stage theme-${video.tone}" role="img" aria-label="Demo-video från ${escapeHtml(video.creator)}">
        <div class="video-art"></div>
        <div class="video-topline"><span class="content-pill"><i></i> ${escapeHtml(video.safeLabel)}</span><button class="video-menu" type="button" data-action="video-menu" aria-label="Fler alternativ">${icon('more')}</button></div>
        <button class="video-play" type="button" data-action="play" aria-label="Spela video">${icon('play')}</button>
        <div class="video-info">
          <div class="creator-line"><span class="creator-avatar" style="--creator-color: ${video.creatorColor}">${escapeHtml(video.initials)}</span><span class="creator-name">@${escapeHtml(video.creator)} ${video.verified ? `<span class="creator-verified">${icon('check', 'icon-xs')}</span>` : ''}</span><button class="follow-button ${video.following ? 'is-following' : ''}" type="button" data-action="follow">${video.following ? 'Följer' : 'Följ'}</button></div>
          <h2>${escapeHtml(video.title)}</h2>
          <p class="video-caption">${escapeHtml(video.caption)} ${video.tags.map((tag) => `<span class="hashtag">${escapeHtml(tag)}</span>`).join(' ')}</p>
          <div class="sound-line">${icon('music', 'icon-xs')}<span>${escapeHtml(video.sound)}</span></div>
        </div>
        <div class="video-progress"><span style="width: ${index === 0 ? '42%' : index === 1 ? '67%' : '26%'}"></span></div>
      </div>
      <aside class="video-actions" aria-label="Videoåtgärder">
        <button class="action-button avatar-action" type="button" data-action="follow" aria-label="Följ ${escapeHtml(video.creator)}"><span class="action-avatar" style="background: ${video.creatorColor}">${escapeHtml(video.initials)}</span></button>
        <button class="action-button ${video.liked ? 'is-liked' : ''}" type="button" data-action="like" aria-label="Gilla video"><span>${icon('heart')}</span><span class="action-count">${formatCount(video.likes)}</span></button>
        <button class="action-button" type="button" data-action="comments" aria-label="Visa kommentarer"><span>${icon('message')}</span><span class="action-count">${formatCount(video.commentsCount)}</span></button>
        <button class="action-button ${video.saved ? 'is-saved' : ''}" type="button" data-action="save" aria-label="Spara video"><span>${icon('bookmark')}</span><span class="action-count">Spara</span></button>
        <button class="action-button" type="button" data-action="share" aria-label="Dela video"><span>${icon('share')}</span><span class="action-count">${formatCount(video.shares)}</span></button>
        <button class="action-button" type="button" data-action="report" aria-label="Rapportera video"><span>${icon('flag')}</span><span class="action-count">Rapport</span></button>
      </aside>
    </article>
  `).join('');
}

function updateVideoControls(video) {
  const card = $(`[data-video-id="${video.id}"]`);
  if (!card) return;
  const likeButton = card.querySelector('[data-action="like"]');
  const saveButton = card.querySelector('[data-action="save"]');
  const followButtons = card.querySelectorAll('[data-action="follow"]');
  if (likeButton) {
    likeButton.classList.toggle('is-liked', video.liked);
    const count = likeButton.querySelector('.action-count');
    if (count) count.textContent = formatCount(video.likes);
  }
  if (saveButton) saveButton.classList.toggle('is-saved', video.saved);
  followButtons.forEach((button) => {
    button.classList.toggle('is-following', video.following);
    if (button.classList.contains('follow-button')) button.textContent = video.following ? 'Följer' : 'Följ';
  });
}

function toggleLike(video) {
  video.liked = !video.liked;
  video.likes += video.liked ? 1 : -1;
  updateVideoControls(video);
  showToast(video.liked ? 'Gillad. Fint att visa stöd.' : 'Gilla borttagen.');
}

function toggleSave(video) {
  video.saved = !video.saved;
  updateVideoControls(video);
  showToast(video.saved ? 'Videon sparades privat.' : 'Videon togs bort från sparade.');
}

function toggleFollow(video) {
  video.following = !video.following;
  updateVideoControls(video);
  showToast(video.following ? `Du följer @${video.creator}.` : `Du följer inte längre @${video.creator}.`);
}

function togglePlayback(button) {
  const isPlaying = button.classList.toggle('is-playing');
  button.innerHTML = icon(isPlaying ? 'pause' : 'play');
  button.setAttribute('aria-label', isPlaying ? 'Pausa video' : 'Spela video');
  showToast(isPlaying ? 'Video spelas i demo-läge.' : 'Video pausad.');
}

function renderComments(video) {
  const list = $('#comments-list');
  if (!list) return;
  list.innerHTML = video.comments.length
    ? video.comments.map((comment) => `<div class="comment"><span class="comment-avatar">${escapeHtml(comment.initials)}</span><div class="comment-copy"><strong>${escapeHtml(comment.name)}</strong><p>${escapeHtml(comment.text)}</p></div></div>`).join('')
    : '<div class="comments-empty">Inga kommentarer ännu. Säg något snällt först.</div>';
}

function openComments(video) {
  state.activeVideoId = video.id;
  $('#comments-title').textContent = `Kommentarer · @${video.creator}`;
  renderComments(video);
  $('#comments-modal').hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => $('#comment-input')?.focus(), 80);
}

function openReport(video = getVideo(state.activeVideoId)) {
  state.activeVideoId = video.id;
  $('#report-form').reset();
  $('#report-video-id').value = video.id;
  $('#report-subtitle').textContent = `Rapport om @${video.creator}. Din rapport går till VY:s moderatorer. Du kan vara anonym i prototypen.`;
  $('#report-modal').hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => $('#report-reason')?.focus(), 80);
}

function closeModals() {
  $('#report-modal').hidden = true;
  $('#comments-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

function isUnsafeComment(text) {
  const normalized = text.toLocaleLowerCase('sv-SE');
  const contactWords = ['snapchat', 'telegram', 'whatsapp', 'signal', 'discord', 'dm:a', 'dm', 'träffas', 'meetup'];
  const hasContactWord = contactWords.some((word) => normalized.includes(word));
  const hasContactData = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s-]{7,})/i.test(text);
  return hasContactWord || hasContactData;
}

async function submitReport(event) {
  event.preventDefault();
  const reason = $('#report-reason').value;
  const videoId = $('#report-video-id').value || state.activeVideoId;
  if (!reason) {
    showToast('Välj en anledning så skickas rapporten rätt.', 'warning');
    return;
  }

  const payload = { videoId, reason, details: $('#report-details').value.trim() };
  try {
    await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (error) {
    // The prototype still confirms the safety action when the optional API is offline.
  }
  closeModals();
  showToast('Rapport skickad till moderatorerna. Tack för att du säger till.');
  if (state.activeView === 'moderator') loadReports();
}

function addComment(event) {
  event.preventDefault();
  const input = $('#comment-input');
  const text = input.value.trim();
  if (!text) return;

  if (isUnsafeComment(text)) {
    input.value = '';
    showToast('Kommentaren stoppades: kontaktuppgifter och kontaktförsök tillåts inte.', 'warning');
    return;
  }

  const video = getVideo(state.activeVideoId);
  video.comments.unshift({ initials: 'A', name: 'Du', text });
  video.commentsCount += 1;
  input.value = '';
  renderComments(video);
  updateVideoControls(video);
  showToast('Kommentaren publicerades efter trygghetskontroll.');
}

async function shareVideo(video) {
  const shareUrl = `${window.location.origin}${window.location.pathname}#video-${video.id}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Länk kopierad. Den innehåller inga privata kontaktuppgifter.');
  } catch (error) {
    showToast('Delning är redo i demo-läge.');
  }
}

function renderReports() {
  const list = $('#report-list');
  if (!list) return;
  const reports = state.reports.length ? state.reports : fallbackReports;
  const newCount = reports.filter((report) => report.status === 'new').length;
  $('#new-report-count').textContent = String(newCount);

  list.innerHTML = reports.map((report) => `
    <div class="report-item" data-report-id="${escapeHtml(report.id)}">
      <span class="report-priority report-priority--${escapeHtml(report.priority || 'high')}"></span>
      <div class="report-copy"><strong>${escapeHtml(report.category)}</strong><span>${escapeHtml(report.detail)} · ${escapeHtml(report.id)}</span></div>
      <div class="report-meta"><time>${escapeHtml(report.time || 'Nu')}</time><span class="report-status ${report.status === 'reviewed' ? 'report-status--reviewed' : ''}">${report.status === 'reviewed' ? 'Granskad' : 'Ny'}</span></div>
      ${report.status !== 'reviewed' ? `<button class="report-action" type="button" data-action="resolve-report" data-report-id="${escapeHtml(report.id)}" aria-label="Markera ${escapeHtml(report.id)} som granskad">${icon('check', 'icon-sm')}</button>` : ''}
    </div>
  `).join('');
}

async function loadReports() {
  try {
    const response = await fetch('/api/moderation/reports', { headers: { Accept: 'application/json' } });
    if (response.ok) state.reports = await response.json();
  } catch (error) {
    state.reports = [...fallbackReports];
  }
  renderReports();
}

async function resolveReport(id) {
  const report = state.reports.find((entry) => entry.id === id);
  if (report) report.status = 'reviewed';
  try {
    await fetch(`/api/moderation/reports/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'reviewed' }) });
  } catch (error) {
    // Keep the local demo state if the API is unavailable.
  }
  renderReports();
  showToast(`${id} markerad som granskad.`);
}

function handleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  $('#upload-title').textContent = file.name;
  $('#upload-subtitle').textContent = `${Math.round(file.size / 1024 / 1024 * 10) / 10 || '< 0,1'} MB · redo för förhandsgranskning`;
  $('#upload-zone').classList.add('is-uploaded');
}

function submitVideo(event) {
  event.preventDefault();
  if (!$('#video-file').files?.length) {
    showToast('Välj en video först.', 'warning');
    return;
  }
  if (!$('#confirm-rights').checked) {
    showToast('Bekräfta att du har rätt att publicera materialet.', 'warning');
    return;
  }
  if (!$('#no-location').checked) {
    showToast('Aktivera borttagning av platsdata för att fortsätta säkert.', 'warning');
    return;
  }
  showToast('Videon klarade förhandskontrollen i demo-läge.');
  $('#create-form').reset();
  $('#upload-title').textContent = 'Släpp en video här';
  $('#upload-subtitle').textContent = 'MP4 eller MOV · max 60 sekunder';
  $('#upload-zone').classList.remove('is-uploaded');
  setView('feed');
}

function toggleSafetySetting(button) {
  const key = button.dataset.safetySetting;
  state.safety[key] = !state.safety[key];
  button.classList.toggle('is-on', state.safety[key]);
  button.setAttribute('aria-label', `${key} ${state.safety[key] ? 'aktiv' : 'avstängd'}`);
  showToast(`${key === 'comments' ? 'Kommentarfilter' : 'Snabb rapportering'} ${state.safety[key] ? 'på' : 'av'}.`);
}

function showToast(message, tone = 'success') {
  const container = $('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${tone === 'warning' ? 'toast--warning' : tone === 'danger' ? 'toast--danger' : ''}`;
  toast.innerHTML = `${icon(tone === 'success' ? 'check' : 'alert', 'icon-sm')}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 190);
  }, 3100);
}

function handleAction(action, element) {
  const card = element?.closest('[data-video-id]');
  const video = card ? getVideo(card.dataset.videoId) : getVideo(state.activeVideoId);

  switch (action) {
    case 'go-feed':
      setView('feed');
      break;
    case 'profile-menu':
      showToast('Profilinställningar kommer efter trygg inloggning.');
      break;
    case 'notifications':
      showToast('Inga nya säkerhetsaviseringar.');
      break;
    case 'help':
      showToast('Tips: använd Rapportera om något känns fel — du behöver inte vara säker.');
      break;
    case 'video-menu':
      showToast('Menyn innehåller rapportera, blockera och dölj.');
      break;
    case 'play':
      togglePlayback(element);
      break;
    case 'like':
      state.activeVideoId = video.id;
      toggleLike(video);
      break;
    case 'save':
      state.activeVideoId = video.id;
      toggleSave(video);
      break;
    case 'follow':
      state.activeVideoId = video.id;
      toggleFollow(video);
      break;
    case 'comments':
      openComments(video);
      break;
    case 'share':
      shareVideo(video);
      break;
    case 'report':
    case 'open-report':
      openReport(video);
      break;
    case 'close-modal':
    case 'close-comments':
      closeModals();
      break;
    case 'resolve-report':
      resolveReport(element.dataset.reportId);
      break;
    case 'moderator-filter':
      showToast('Kön är redan sorterad efter risk och ålder.');
      break;
    case 'search':
      showToast('Sökning av kreatörer kommer med säkra konto- och åldersfilter.');
      break;
    default:
      break;
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }

    const viewTarget = event.target.closest('[data-view-target]');
    if (viewTarget) {
      setView(viewTarget.dataset.viewTarget);
      return;
    }

    const feedTab = event.target.closest('[data-feed-tab]');
    if (feedTab) {
      state.feedTab = feedTab.dataset.feedTab;
      $$('.feed-tab').forEach((tab) => tab.classList.toggle('is-active', tab === feedTab));
      renderFeed();
      showToast(state.feedTab === 'new' ? 'Nyaste videorna visas först.' : state.feedTab === 'following' ? 'Videor från dina valda kreatörer.' : 'Personligt, modererat flöde.');
      return;
    }

    const actionElement = event.target.closest('[data-action]');
    if (actionElement) {
      handleAction(actionElement.dataset.action, actionElement);
      return;
    }

    const safetySetting = event.target.closest('[data-safety-setting]');
    if (safetySetting) toggleSafetySetting(safetySetting);
  });

  $('#report-form').addEventListener('submit', submitReport);
  $('#comment-form').addEventListener('submit', addComment);
  $('#video-file').addEventListener('change', handleUpload);
  $('#create-form').addEventListener('submit', submitVideo);

  const uploadZone = $('#upload-zone');
  ['dragenter', 'dragover'].forEach((eventName) => uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove('is-dragging');
  }));
  uploadZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('video/')) {
      showToast('Välj en videofil, till exempel MP4 eller MOV.', 'warning');
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    $('#video-file').files = transfer.files;
    handleUpload({ target: { files: [file] } });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModals();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      showToast('Sökning av kreatörer kommer med säkra konto- och åldersfilter.');
    }
  });

  $$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModals();
  }));
}

async function init() {
  renderFeed();
  renderReports();
  bindEvents();
  loadReports();

  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const config = await response.json();
      if (config.directMessages === false) document.body.dataset.directMessages = 'off';
    }
  } catch (error) {
    // The UI is intentionally functional without the optional API.
  }
}

document.addEventListener('DOMContentLoaded', init);
