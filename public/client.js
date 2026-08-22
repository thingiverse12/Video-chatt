const locations = [
  { id: 'stockholm', city: 'Stockholm', country: 'Sverige', code: 'SE', flag: '🇸🇪', latency: 12, servers: 8, popular: true },
  { id: 'copenhagen', city: 'Köpenhamn', country: 'Danmark', code: 'DK', flag: '🇩🇰', latency: 18, servers: 5, popular: true },
  { id: 'amsterdam', city: 'Amsterdam', country: 'Nederländerna', code: 'NL', flag: '🇳🇱', latency: 24, servers: 7, popular: false },
  { id: 'london', city: 'London', country: 'Storbritannien', code: 'GB', flag: '🇬🇧', latency: 31, servers: 11, popular: true },
  { id: 'new-york', city: 'New York', country: 'USA', code: 'US', flag: '🇺🇸', latency: 86, servers: 16, popular: false },
  { id: 'singapore', city: 'Singapore', country: 'Singapore', code: 'SG', flag: '🇸🇬', latency: 143, servers: 6, popular: false },
];

const viewMeta = {
  browser: { kicker: 'Webbläsare', title: 'Privat webbläsare' },
  locations: { kicker: 'Platser', title: 'Serverplatser' },
  protection: { kicker: 'Skydd', title: 'Integritetscenter' },
  activity: { kicker: 'Aktivitet', title: 'Din aktivitet' },
  settings: { kicker: 'Inställningar', title: 'NOVA-inställningar' },
};

const defaultHistory = [
  { icon: 'browser', title: 'NOVA startsida', detail: 'Privat session', time: 'Nu', tone: 'green' },
  { icon: 'map', title: 'Stockholm, Sverige', detail: 'Vald serverplats', time: 'Idag', tone: 'purple' },
  { icon: 'shield-check', title: 'Skyddsinställningar', detail: 'Kontrollerad lokalt', time: 'Idag', tone: 'orange' },
];

const defaultSettings = {
  'private-connection': true,
  trackers: true,
  ads: false,
  'kill-switch': true,
};

const storage = {
  get(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Local storage can be disabled in private browser contexts. The UI still works.
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Ignore storage errors and keep the current in-memory state.
    }
  },
};

const state = {
  activeView: 'browser',
  connection: 'idle',
  selectedLocationId: storage.get('nova-location', 'stockholm'),
  history: storage.get('nova-history', defaultHistory),
  settings: { ...defaultSettings, ...storage.get('nova-settings', {}) },
  bookmarked: false,
  currentUrl: '',
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

function selectedLocation() {
  return locations.find((location) => location.id === state.selectedLocationId) || locations[0];
}

function setView(view) {
  if (!viewMeta[view]) return;

  state.activeView = view;
  $$('.nav-item[data-view]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === view);
  });
  $$('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('is-visible', panel.dataset.viewPanel === view);
  });

  const meta = viewMeta[view];
  $('#view-kicker').textContent = meta.kicker;
  $('#view-title').textContent = meta.title;

  if (view === 'locations') renderLocationGrid($('#location-search')?.value || '');
  if (view === 'activity') renderActivity();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderConnection() {
  const location = selectedLocation();
  const card = $('#connection-card');
  const topStatusText = $('#top-status-text');
  const topStatusPulse = $('#top-status-pulse');
  const cardStatusPulse = $('#card-status-pulse');
  const title = $('#connection-title');
  const description = $('#connection-description');
  const toggle = $('#connection-toggle');
  const ipAddress = $('#ip-address');
  const protocol = $('#protocol-value');

  const isConnected = state.connection === 'connected';
  const isConnecting = state.connection === 'connecting';

  card.classList.toggle('is-connected', isConnected);
  card.classList.toggle('is-connecting', isConnecting);
  [topStatusPulse, cardStatusPulse].forEach((pulse) => {
    pulse.classList.toggle('is-connected', isConnected);
    pulse.classList.toggle('is-connecting', isConnecting);
  });

  if (isConnecting) {
    topStatusText.textContent = 'Ansluter…';
    title.textContent = 'Ansluter…';
    description.textContent = `Upprättar session mot ${location.city}.`;
    ipAddress.textContent = 'Tilldelas…';
    protocol.textContent = 'Förbereder';
  } else if (isConnected) {
    topStatusText.textContent = 'Skyddad anslutning';
    title.textContent = 'Skyddad';
    description.textContent = 'Din privata demosession är aktiv.';
    ipAddress.textContent = '185.12.•••.42';
    protocol.textContent = 'Demo-tunnel';
  } else {
    topStatusText.textContent = 'Ej ansluten';
    title.textContent = 'Ej skyddad';
    description.textContent = 'Anslut för att starta en privat session.';
    ipAddress.textContent = 'Inte tillgänglig';
    protocol.textContent = '—';
  }

  toggle.disabled = isConnecting;
  toggle.setAttribute('aria-pressed', String(isConnected));
  toggle.setAttribute('aria-label', isConnected ? 'Koppla från VPN' : 'Anslut VPN');
  $('#top-connection-status').setAttribute('aria-label', isConnected ? 'Koppla från VPN' : 'Anslut VPN');
  $('#selected-location-name').textContent = `${location.city}, ${location.country}`;
  $('#selected-location-meta').textContent = `${location.code} · ${location.latency} ms`;
}

function toggleConnection() {
  if (state.connection === 'connecting') return;

  if (state.connection === 'connected') {
    state.connection = 'idle';
    renderConnection();
    addHistory({ icon: 'power', title: 'Privat session avslutad', detail: 'NOVA demosession', time: 'Nu', tone: 'orange' });
    showToast('Sessionen är pausad.');
    return;
  }

  state.connection = 'connecting';
  renderConnection();
  showToast(`Ansluter till ${selectedLocation().city}…`);

  window.setTimeout(() => {
    if (state.connection !== 'connecting') return;
    state.connection = 'connected';
    renderConnection();
    addHistory({ icon: 'shield-check', title: 'Privat session startad', detail: selectedLocation().city, time: 'Nu', tone: 'green' });
    showToast(`Ansluten till ${selectedLocation().city}. Demo-tunneln är aktiv.`);
  }, 950);
}

function renderPicker() {
  const pickerOptions = $('#picker-options');
  if (!pickerOptions) return;

  pickerOptions.innerHTML = locations.slice(0, 5).map((location) => `
    <button class="picker-option ${location.id === state.selectedLocationId ? 'is-selected' : ''}" type="button" data-location-id="${location.id}">
      <span class="picker-flag">${location.flag}</span>
      <span class="picker-option-copy"><strong>${escapeHtml(location.city)}</strong><small>${escapeHtml(location.country)} · ${location.latency} ms</small></span>
      ${icon('check', 'icon-xs')}
    </button>
  `).join('');
}

function togglePicker(force) {
  const picker = $('#location-picker');
  if (!picker) return;
  const shouldOpen = typeof force === 'boolean' ? force : !picker.classList.contains('is-open');
  picker.classList.toggle('is-open', shouldOpen);
  picker.setAttribute('aria-hidden', String(!shouldOpen));
  if (shouldOpen) renderPicker();
}

function selectLocation(id) {
  const location = locations.find((entry) => entry.id === id);
  if (!location) return;

  state.selectedLocationId = id;
  storage.set('nova-location', id);
  renderConnection();
  renderPicker();
  renderLocationGrid($('#location-search')?.value || '');
  togglePicker(false);

  if (state.connection === 'connected') {
    showToast(`${location.city} vald. Anslut igen för att byta demo-plats.`);
  } else {
    showToast(`${location.city}, ${location.country} vald.`);
  }
}

function renderLocationGrid(filter = '') {
  const grid = $('#location-grid');
  if (!grid) return;

  const query = filter.trim().toLocaleLowerCase('sv-SE');
  const filtered = locations.filter((location) =>
    `${location.city} ${location.country} ${location.code}`.toLocaleLowerCase('sv-SE').includes(query),
  );

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">Ingen plats matchar din sökning.</div>';
    return;
  }

  grid.innerHTML = filtered.map((location) => `
    <button class="location-card ${location.id === state.selectedLocationId ? 'is-selected' : ''}" type="button" data-location-id="${location.id}">
      <span class="location-flag">${location.flag}</span>
      <span class="location-card-copy"><strong>${escapeHtml(location.city)}, ${escapeHtml(location.country)}</strong><span>${location.servers} servrar · ${location.popular ? 'Populär plats' : 'Tillgänglig'}</span></span>
      <span class="location-latency">${location.latency} ms</span>
      ${icon('check', 'icon-xs checkmark')}
    </button>
  `).join('');
}

function renderActivity() {
  const list = $('#activity-list');
  if (!list) return;

  if (!state.history.length) {
    list.innerHTML = '<div class="activity-empty">Ingen lokal aktivitet att visa ännu.</div>';
    return;
  }

  list.innerHTML = state.history.slice(0, 12).map((entry) => `
    <div class="activity-row">
      <div class="activity-icon activity-icon--${escapeHtml(entry.tone || 'green')}" aria-hidden="true">${icon(entry.icon || 'clock', 'icon-sm')}</div>
      <div class="activity-copy"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.detail)}</span></div>
      <span class="activity-time">${escapeHtml(entry.time)}</span>
    </div>
  `).join('');
}

function addHistory(entry) {
  state.history = [entry, ...state.history.filter((item) => !(item.title === entry.title && item.detail === entry.detail))].slice(0, 12);
  storage.set('nova-history', state.history);
  if (state.activeView === 'activity') renderActivity();
}

function clearHistory() {
  state.history = [];
  storage.set('nova-history', state.history);
  renderActivity();
  showToast('Den lokala historiken är rensad.');
}

function renderWelcome() {
  $('#active-tab-title').textContent = 'Ny flik';
  $('#address-input').value = '';
  state.currentUrl = '';
  state.bookmarked = false;
  $('#bookmark-button').classList.remove('is-bookmarked');
  $('#bookmark-button').setAttribute('aria-label', 'Bokmärk sidan');
  $('#browser-page').innerHTML = `
    <div class="browser-page-inner">
      <div class="welcome-layout">
        <div class="welcome-copy">
          <div class="welcome-eyebrow"><span class="eyebrow-line"></span> PRIVAT LÄGE AKTIVT</div>
          <h2>Privat börjar<br /><em>här.</em></h2>
          <p>Öppna en flik. Låt resten stanna hos dig.</p>
        </div>
        <div class="shield-visual" aria-hidden="true">
          <div class="shield-glow"></div><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
          <div class="shield-core">${icon('shield-check', 'icon-xl')}</div><span class="orbit-dot orbit-dot-one"></span><span class="orbit-dot orbit-dot-two"></span>
        </div>
      </div>
      <form class="private-search" id="private-search-form">
        ${icon('search', 'search-icon')}<input id="private-search-input" type="text" placeholder="Sök privat eller ange en webbadress" autocomplete="off" />
        <button class="search-submit" type="submit"><span>Sök</span>${icon('arrow-right', 'icon-sm')}</button>
      </form>
      <div class="search-hint"><span>Tryck</span><kbd>⌘</kbd><kbd>K</kbd><span>för att fokusera</span></div>
      <div class="quick-section">
        <div class="section-heading-row"><div><span class="mini-label">SNABBÅTKOMST</span><h3>Dina platser</h3></div><button class="text-button" type="button" data-action="manage-bookmarks">Hantera ${icon('chevron-right', 'icon-xs')}</button></div>
        <div class="quick-links">
          <button class="quick-link quick-link--blue" type="button" data-url="https://duckduckgo.com/"><span class="quick-link-icon">D</span><span><strong>DuckDuckGo</strong><small>Privat sökning</small></span>${icon('external', 'icon-sm quick-link-arrow')}</button>
          <button class="quick-link quick-link--purple" type="button" data-url="https://wikipedia.org/"><span class="quick-link-icon">W</span><span><strong>Wikipedia</strong><small>Fri kunskap</small></span>${icon('external', 'icon-sm quick-link-arrow')}</button>
          <button class="quick-link quick-link--orange" type="button" data-url="https://github.com/"><span class="quick-link-icon">⌘</span><span><strong>GitHub</strong><small>Dina projekt</small></span>${icon('external', 'icon-sm quick-link-arrow')}</button>
        </div>
      </div>
      <div class="page-disclaimer">${icon('info', 'icon-sm')}<span>Det här är en webbläsarprototyp. En webbsida kan inte skapa en riktig VPN-tunnel utan en separat VPN-klient eller server.</span></div>
    </div>
  `;
  $('#private-search-form').addEventListener('submit', handlePrivateSearchSubmit);
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  if (/^[\w-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    try {
      return new URL(`https://${trimmed}`).href;
    } catch (error) {
      return null;
    }
  }

  return null;
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (error) {
    return url;
  }
}

function openDestination(url, label = hostLabel(url)) {
  const safeUrl = normalizeUrl(url);
  if (!safeUrl) {
    showToast('Adressen kunde inte öppnas. Använd en http- eller https-adress.');
    return;
  }

  const host = hostLabel(safeUrl);
  state.currentUrl = safeUrl;
  $('#address-input').value = safeUrl;
  $('#active-tab-title').textContent = host;
  state.bookmarked = false;
  $('#bookmark-button').classList.remove('is-bookmarked');
  $('#bookmark-button').setAttribute('aria-label', 'Bokmärk sidan');
  addHistory({ icon: 'external', title: label, detail: host, time: 'Nu', tone: 'purple' });

  $('#browser-page').innerHTML = `
    <div class="destination-view">
      <div class="destination-card">
        <div class="destination-icon">${icon('external', 'icon-lg')}</div>
        <span class="mini-label">LÄNK REDO</span>
        <h2>${escapeHtml(label)}</h2>
        <p>NOVA kan förbereda adressen här. Öppna den i en ny flik när du vill fortsätta.</p>
        <span class="destination-url">${escapeHtml(safeUrl)}</span>
        <button class="primary-button" id="destination-open" type="button">Öppna i ny flik ${icon('arrow-right', 'icon-sm')}</button>
        <div class="page-disclaimer" style="margin-top: 18px; text-align: left;">${icon('info', 'icon-sm')}<span>Den här prototypen skickar inte trafik genom en riktig VPN-tunnel.</span></div>
      </div>
    </div>
  `;

  $('#destination-open').addEventListener('click', () => {
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
    showToast(`Öppnar ${host} i en ny flik.`);
  });
}

function renderSearchResults(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    showToast('Skriv något att söka efter.');
    $('#private-search-input')?.focus();
    return;
  }

  const escapedQuery = escapeHtml(cleanQuery);
  $('#active-tab-title').textContent = `Sök: ${cleanQuery.slice(0, 16)}`;
  $('#address-input').value = cleanQuery;
  state.currentUrl = `search:${cleanQuery}`;
  state.bookmarked = false;
  $('#bookmark-button').classList.remove('is-bookmarked');
  $('#bookmark-button').setAttribute('aria-label', 'Bokmärk sidan');
  addHistory({ icon: 'search', title: `Sökning: ${cleanQuery}`, detail: 'Lokal demosökning', time: 'Nu', tone: 'green' });

  const results = [
    { domain: 'nova.guide', title: `Så skyddar du din integritet online`, description: 'En enkel guide till säkrare lösenord, privat sökning och tydliga sekretessval.', url: 'https://nova.guide/privacy' },
    { domain: 'privacy.tools', title: `Verktyg för en lugnare webbläsare`, description: 'Lär dig hur spårarskydd, säkra anslutningar och lokala inställningar fungerar.', url: 'https://privacy.tools/browser' },
    { domain: 'open.knowledge', title: `Kunskap om ${cleanQuery}`, description: 'Utforska ett neutralt perspektiv och hitta källor som hjälper dig vidare.', url: 'https://open.knowledge/explore' },
  ];

  $('#browser-page').innerHTML = `
    <div class="search-results-view">
      <div class="search-results-head"><div><span class="mini-label">PRIVAT DEMOSÖKNING</span><h2>Resultat för “${escapedQuery}”</h2><p>Tre exempel på hur sökresultat kan presenteras utan brus.</p></div>${icon('search', 'icon-lg')}</div>
      <div class="result-list">
        ${results.map((result) => `<button class="result-item" type="button" data-url="${result.url}" data-label="${escapeHtml(result.title)}"><span class="result-domain">${result.domain}</span><h3>${escapeHtml(result.title)}</h3><p>${escapeHtml(result.description)}</p></button>`).join('')}
      </div>
      <div class="page-disclaimer" style="margin-top: 25px;">${icon('info', 'icon-sm')}<span>Detta är lokala exempelresultat i prototypen — ingen sökmotoranrop görs från servern.</span></div>
    </div>
  `;
}

function handleSearch(value) {
  const trimmed = value.trim();
  const url = normalizeUrl(trimmed);
  if (url) {
    openDestination(url);
  } else {
    renderSearchResults(trimmed);
  }
}

function handlePrivateSearchSubmit(event) {
  event.preventDefault();
  handleSearch($('#private-search-input')?.value || '');
}

function toggleBookmark() {
  if (!state.currentUrl) {
    showToast('Öppna en adress eller sök först för att bokmärka.');
    return;
  }
  state.bookmarked = !state.bookmarked;
  $('#bookmark-button').classList.toggle('is-bookmarked', state.bookmarked);
  $('#bookmark-button').setAttribute('aria-label', state.bookmarked ? 'Ta bort bokmärke' : 'Bokmärk sidan');
  showToast(state.bookmarked ? 'Sidan sparades bland dina bokmärken.' : 'Bokmärket togs bort.');
}

function toggleSetting(button) {
  const key = button.dataset.setting;
  if (!key) return;
  state.settings[key] = !state.settings[key];
  storage.set('nova-settings', state.settings);
  button.classList.toggle('is-on', state.settings[key]);
  button.setAttribute('aria-label', `${key} ${state.settings[key] ? 'på' : 'av'}`);
  showToast(`${settingLabel(key)} ${state.settings[key] ? 'aktiverad' : 'avstängd'}.`);

  if (key === 'ads') {
    $('#ads-blocked').textContent = state.settings.ads ? '46' : '0';
  }
}

function settingLabel(key) {
  return {
    'private-connection': 'Privat anslutning',
    trackers: 'Spårarblockering',
    ads: 'Annonsblockering',
    'kill-switch': 'Kill switch',
  }[key] || 'Inställningen';
}

function clearLocalData() {
  storage.remove('nova-location');
  storage.remove('nova-history');
  storage.remove('nova-settings');
  state.selectedLocationId = 'stockholm';
  state.history = [...defaultHistory];
  state.settings = { ...defaultSettings };
  renderConnection();
  renderPicker();
  renderActivity();
  $$('.switch[data-setting]').forEach((button) => {
    const isOn = Boolean(state.settings[button.dataset.setting]);
    button.classList.toggle('is-on', isOn);
  });
  showToast('Lokal data återställd i prototypen.');
}

function showToast(message) {
  const container = $('#toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `${icon('check', 'icon-sm')}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 210);
  }, 3000);
}

function refreshBrowser() {
  const button = $('[data-action="refresh"]');
  button?.classList.add('is-spinning');
  window.setTimeout(() => button?.classList.remove('is-spinning'), 650);
  showToast(state.currentUrl ? 'Sidan uppdaterades i prototypen.' : 'NOVA startsida är redan aktuell.');
}

function autoSelectLocation() {
  const fastest = [...locations].sort((a, b) => a.latency - b.latency)[0];
  selectLocation(fastest.id);
  setView('locations');
}

function handleAction(action) {
  switch (action) {
    case 'toggle-connection':
      toggleConnection();
      break;
    case 'new-tab':
      setView('browser');
      renderWelcome();
      showToast('En ny privat flik öppnades.');
      break;
    case 'refresh':
      refreshBrowser();
      break;
    case 'go-back':
    case 'go-forward':
      showToast('Navigering mellan sidor är avstängd i prototypen.');
      break;
    case 'browser-menu':
      showToast('Webbläsarmenyn kommer i nästa version.');
      break;
    case 'manage-bookmarks':
      showToast('Bokmärken sparas lokalt på den här enheten.');
      break;
    case 'close-picker':
      togglePicker(false);
      break;
    case 'auto-location':
      autoSelectLocation();
      break;
    case 'clear-history':
      clearHistory();
      break;
    case 'clear-local-data':
      clearLocalData();
      break;
    case 'help':
      showToast('Tips: anslut först och välj sedan en serverplats.');
      break;
    case 'notifications':
      showToast('Du har inga nya aviseringar.');
      break;
    default:
      break;
  }
}

function bindEvents() {
  $$('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => setView(item.dataset.view));
  });

  document.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (actionElement) handleAction(actionElement.dataset.action);

    const viewTarget = event.target.closest('[data-view-target]');
    if (viewTarget) setView(viewTarget.dataset.viewTarget);

    const locationElement = event.target.closest('[data-location-id]');
    if (locationElement) selectLocation(locationElement.dataset.locationId);

    const quickLink = event.target.closest('.quick-link[data-url]');
    if (quickLink) openDestination(quickLink.dataset.url, quickLink.querySelector('strong')?.textContent || hostLabel(quickLink.dataset.url));

    const result = event.target.closest('.result-item[data-url]');
    if (result) openDestination(result.dataset.url, result.dataset.label || hostLabel(result.dataset.url));

    const selectedServer = event.target.closest('#selected-server-trigger');
    if (selectedServer) togglePicker();

    if (!event.target.closest('#connection-card')) togglePicker(false);
  });

  $('#address-form').addEventListener('submit', (event) => {
    event.preventDefault();
    handleSearch($('#address-input').value);
  });

  $('#private-search-form')?.addEventListener('submit', handlePrivateSearchSubmit);
  $('#bookmark-button').addEventListener('click', toggleBookmark);

  $('#location-search').addEventListener('input', (event) => renderLocationGrid(event.target.value));

  $$('.switch[data-setting]').forEach((button) => {
    const isOn = Boolean(state.settings[button.dataset.setting]);
    button.classList.toggle('is-on', isOn);
    button.setAttribute('aria-label', `${settingLabel(button.dataset.setting)} ${isOn ? 'på' : 'av'}`);
    button.addEventListener('click', () => toggleSetting(button));
  });

  $('#selected-server-trigger').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePicker();
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setView('browser');
      $('#private-search-input')?.focus();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setView('browser');
      $('#address-input')?.focus();
      $('#address-input')?.select();
    }
    if (event.key === 'Escape') togglePicker(false);
  });

}

async function loadServerConfig() {
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const config = await response.json();
    if (config.onlineLocations) $('#locations-online-count').textContent = config.onlineLocations;
  } catch (error) {
    // The browser is intentionally usable even when the optional API is unavailable.
  }
}

function init() {
  renderConnection();
  renderPicker();
  renderLocationGrid();
  renderActivity();
  bindEvents();
  loadServerConfig();
}

document.addEventListener('DOMContentLoaded', init);
