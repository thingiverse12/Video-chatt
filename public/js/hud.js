/**
 * All HTML-HUD: livsmätare, hotbar, chatt, hantverksmeny, byggmeny,
 * behållare, dödskärm och startmeny.
 */

import { ITEMS, RECIPES, itemName, itemIcon, maxStack } from '../../shared/items.js';
import { PIECES } from '../../shared/building.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(net) {
    this.net = net;
    this.el = {
      online: $('infoOnline'),
      clock: $('infoClock'),
      temp: $('infoTemp'),
      ping: $('infoPing'),
      pos: $('infoPos'),
      barHp: $('barHp'),
      barHunger: $('barHunger'),
      barThirst: $('barThirst'),
      barWarmth: $('barWarmth'),
      numHp: $('numHp'),
      numHunger: $('numHunger'),
      numThirst: $('numThirst'),
      numWarmth: $('numWarmth'),
      warmthRow: document.querySelector('.vital.warmth'),
      hotbar: $('hotbar'),
      chatlog: $('chatlog'),
      chatform: $('chatform'),
      chatinput: $('chatinput'),
      killfeed: $('killfeed'),
      toasts: $('toasts'),
      hint: $('hint'),
      fxlayer: $('fxlayer'),
      hudmsg: $('hudmsg'),
      buildbar: $('buildbar'),
      buildSlots: $('buildSlots'),
      buildModeName: $('buildModeName'),
      craftpanel: $('craftpanel'),
      resList: $('resList'),
      itemList: $('itemList'),
      statList: $('statList'),
      recipeList: $('recipeList'),
      containerpanel: $('containerpanel'),
      containerName: $('containerName'),
      containerItems: $('containerItems'),
      playerItems: $('playerItems'),
      lootpanel: $('lootpanel'),
      lootItems: $('lootItems'),
      lootAll: $('lootAll'),
      lootWarn: $('lootWarn'),
      deathCause: $('deathCause'),
      deathTimer: $('deathTimer'),
      respawnBtn: $('respawnBtn'),
      menu: $('menu'),
      menuStatus: $('menuStatus'),
      joinForm: $('joinForm'),
      nameInput: $('nameInput'),
      joinBtn: $('joinBtn'),
      resumeBtn: $('resumeBtn'),
      serverinfo: $('serverinfo'),
      disconnect: $('disconnect'),
      disconnectText: $('disconnectText'),
      reconnectBtn: $('reconnectBtn'),
    };
    this.state = {
      inv: {},
      hotbar: new Array(10).fill(null),
      selected: 0,
      stats: null,
      day: 0,
      online: 0,
      you: null,
      containerId: null,
      containerInv: {},
      bag: null,
      buildKind: null,
      canBuild: {},
      stats2: null,
    };
    this.chatOpen = false;
    this.playing = false;
    this._buildHotbar();
    this._bind();
  }

  // ------------------------------------------------------------------ hotbar

  _buildHotbar() {
    const el = this.el.hotbar;
    el.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot empty';
      slot.dataset.slot = String(i);
      slot.innerHTML = `<span class="key">${(i + 1) % 10}</span><span class="ico"></span><span class="count"></span>`;
      slot.addEventListener('click', () => this.net.send({ t: 'select', slot: i }));
      el.appendChild(slot);
    }
  }

  _bind() {
    this.el.chatform.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.el.chatinput.value.trim();
      this.el.chatinput.value = '';
      this.closeChat();
      if (text) this.net.send({ t: 'chat', msg: text });
    });
    this.el.chatinput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.el.chatinput.value = '';
        this.closeChat();
        document.exitPointerLock?.();
      }
    });
    this.el.respawnBtn.addEventListener('click', () => {
      this.net.send({ t: 'respawn' });
    });
    this.el.lootAll.addEventListener('click', () => {
      if (this.state.bag) this.net.send({ t: 'loot', id: this.state.bag.id, force: this.state.bag.id });
      this.closePanel('lootpanel');
    });
    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.closePanel(btn.dataset.close));
    }
    this.el.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.el.joinBtn.disabled = true;
      this.el.menuStatus.textContent = 'Ansluter…';
      this.onJoin?.(this.el.nameInput.value.trim());
    });
    this.el.reconnectBtn.addEventListener('click', () => location.reload());
    this.el.resumeBtn.addEventListener('click', () => {
      this.hideMenu();
      document.getElementById('game')?.requestPointerLock?.();
    });
  }

  onJoinRequest(fn) {
    this.onJoin = fn;
  }

  // ------------------------------------------------------------------ lägen

  showMenu(status) {
    if (status) this.el.menuStatus.textContent = status;
    this.el.joinForm.style.display = '';
    this.el.joinBtn.style.display = '';
    this.el.resumeBtn.style.display = 'none';
    this.el.menu.style.display = 'flex';
  }

  /** Pausvy mitt i spelet: visa kontroller och låt spelaren hoppa tillbaka */
  showPauseMenu() {
    if (!this.playing) return;
    this.el.menuStatus.textContent = 'Spelet fortsätter på servern – du är kvar på ön.';
    this.el.joinForm.style.display = 'none';
    this.el.joinBtn.style.display = 'none';
    this.el.resumeBtn.style.display = 'inline-block';
    this.el.menu.style.display = 'flex';
    document.exitPointerLock?.();
  }

  hideMenu() {
    this.el.menu.style.display = 'none';
    document.body.classList.remove('disconnected');
  }

  showDisconnect(text) {
    this.el.disconnectText.textContent = text || 'Anslutningen bröts.';
    document.body.classList.add('disconnected');
  }

  openChat() {
    this.chatOpen = true;
    document.body.classList.add('chatting');
    this.el.chatinput.focus();
  }

  closeChat() {
    this.chatOpen = false;
    document.body.classList.remove('chatting');
    this.el.chatinput.blur();
  }

  openPanel(id) {
    this.el[id].classList.add('open');
    if (id === 'craftpanel') this.renderCraftPanel();
    document.exitPointerLock?.();
  }

  closePanel(id) {
    this.el[id].classList.remove('open');
    if (id === 'containerpanel') this.state.containerId = null;
    if (id === 'lootpanel') this.state.bag = null;
    if (!this.isPanelOpen() && !this.chatOpen) document.getElementById('game')?.requestPointerLock?.();
  }

  togglePanel(id) {
    if (this.el[id].classList.contains('open')) this.closePanel(id);
    else this.openPanel(id);
  }

  isPanelOpen() {
    return ['craftpanel', 'containerpanel', 'lootpanel'].some((id) => this.el[id].classList.contains('open'));
  }

  // ------------------------------------------------------------------ mätare

  setVitals(s) {
    this.state.stats2 = s;
    const set = (bar, num, v) => {
      const pct = Math.max(0, Math.min(100, v));
      bar.style.width = `${pct}%`;
      num.textContent = String(Math.round(v));
    };
    set(this.el.barHp, this.el.numHp, s.hp);
    set(this.el.barHunger, this.el.numHunger, s.hunger);
    set(this.el.barThirst, this.el.numThirst, s.thirst);
    set(this.el.barWarmth, this.el.numWarmth, s.warmth);
    this.el.warmthRow.classList.toggle('hot', (s.fire || 0) > 0.4 && s.warmth > 70);
    this.el.warmthRow.classList.toggle('cold', s.warmth < 35);
    document.body.classList.toggle('cold', s.warmth < 25 && s.alive);
    if (s.sheltered) this.el.temp.textContent = s.fire > 0.05 ? '🔥 Skyddad' : '🏠 Skyddad';
    else if (s.inWater) this.el.temp.textContent = '🌊 Blöt';
    else this.el.temp.textContent = s.ambient > 15 ? '☀️ Varm' : s.ambient > 5 ? '🌤️ Sval' : s.ambient > -3 ? '🌙 Kall' : '❄️ Friande kall';
  }

  setTop({ online, day, ping, pos, latency }) {
    if (online !== undefined) {
      this.el.online.textContent = `${online} online`;
    }
    if (day !== undefined) {
      const hours = Math.floor(((day + 0.5) % 1) * 24);
      const mins = Math.floor((((day + 0.5) % 1) * 24 * 60) % 60);
      const night = day > 0.75 || day < 0.25;
      this.el.clock.textContent = `${night ? '🌙' : '☀️'} ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
    if (latency !== undefined) this.el.ping.textContent = `${latency} ms`;
    if (pos) this.el.pos.textContent = `${Math.round(pos[0])}, ${Math.round(pos[2])}`;
  }

  // ------------------------------------------------------------------ hotbar

  setInventory(inv, hotbar, selected, stats) {
    this.state.inv = inv || {};
    this.state.hotbar = hotbar || [];
    if (selected !== undefined) this.state.selected = selected;
    if (stats) this.state.stats = stats;
    const slots = this.el.hotbar.children;
    for (let i = 0; i < slots.length; i++) {
      const slot = this.state.hotbar[i];
      const el = slots[i];
      const ico = el.querySelector('.ico');
      const count = el.querySelector('.count');
      el.classList.toggle('selected', i === this.state.selected);
      el.classList.toggle('empty', !slot);
      if (slot) {
        ico.textContent = itemIcon(slot.item);
        count.textContent = slot.count > 1 ? String(slot.count) : '';
        el.title = itemName(slot.item);
      } else {
        ico.textContent = '';
        count.textContent = '';
        el.title = '';
      }
    }
    if (this.el.craftpanel.classList.contains('open')) this.renderCraftPanel();
    if (this.el.containerpanel.classList.contains('open')) this.renderContainer();
    if (document.body.classList.contains('building')) this.renderBuildSlots();
  }

  // ------------------------------------------------------------------ chatt

  addChat(entry) {
    const line = document.createElement('div');
    line.className = 'chatline' + (entry.system ? ' system' : '');
    line.innerHTML = entry.system
      ? this._esc(entry.msg)
      : `<b>${this._esc(entry.name)}:</b> ${this._esc(entry.msg)}`;
    this.el.chatlog.appendChild(line);
    while (this.el.chatlog.children.length > 12) this.el.chatlog.firstChild.remove();
  }

  addKill(text) {
    const el = document.createElement('div');
    el.className = 'kf';
    el.textContent = text;
    this.el.killfeed.appendChild(el);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
    setTimeout(() => el.remove(), 12000);
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    setTimeout(() => el.remove(), 3200);
  }

  hint(text) {
    if (text) {
      this.el.hint.textContent = text;
      this.el.hint.classList.add('show');
    } else {
      this.el.hint.classList.remove('show');
    }
  }

  floatText(screenX, screenY, text, color) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    if (color) el.style.color = color;
    el.textContent = text;
    this.el.fxlayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  hudMessage(text, ms = 2200) {
    this.el.hudmsg.textContent = text;
    this.el.hudmsg.classList.add('show');
    clearTimeout(this._hudTimer);
    this._hudTimer = setTimeout(() => this.el.hudmsg.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------------ byggmeny

  setBuildMode(kind) {
    this.state.buildKind = kind;
    document.body.classList.toggle('building', !!kind);
    if (kind) {
      this.renderBuildSlots();
      this.el.buildModeName.textContent = PIECES[kind].name;
    }
  }

  renderBuildSlots() {
    const kinds = ['foundation', 'wall', 'doorway', 'ceiling', 'door'];
    this.el.buildSlots.innerHTML = '';
    kinds.forEach((kind, i) => {
      const def = PIECES[kind];
      const afford = this.canAfford(def.cost);
      const div = document.createElement('div');
      div.className = 'bslot' + (this.state.buildKind === kind ? ' selected' : '') + (afford ? '' : ' no');
      const cost = Object.entries(def.cost)
        .map(([k, v]) => `${v} ${itemName(k).toLowerCase()}`)
        .join(' + ');
      div.innerHTML = `<span class="ico">${kind === 'door' ? '🚪' : kind === 'wall' ? '🧱' : kind === 'doorway' ? '🚪' : kind === 'ceiling' ? '🪜' : '🟫'}</span>${def.name}<br><span class="cost">${cost}</span>`;
      div.title = `${def.name} – ${cost}`;
      div.addEventListener('click', () => window.__setBuildKind?.(kind));
      this.el.buildSlots.appendChild(div);
    });
  }

  canAfford(cost) {
    for (const [item, n] of Object.entries(cost || {})) {
      const have = (this.state.inv[item] || 0) + this.state.hotbar.reduce((a, s) => a + (s && s.item === item ? s.count : 0), 0);
      if (have < n) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ hantverk

  renderCraftPanel() {
    const inv = this.state.inv;
    const order = ['wood', 'stone', 'metal'];
    this.el.resList.innerHTML = '';
    for (const item of order) {
      const n = inv[item] || 0;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ico">${itemIcon(item)}</span><span class="grow">${itemName(item)}</span><span class="qty">${n}</span>`;
      this.el.resList.appendChild(row);
    }
    const extra = Object.keys(inv).filter((k) => !order.includes(k));
    this.el.itemList.innerHTML = '';
    const hotbarItems = this.state.hotbar.filter(Boolean);
    for (const slot of hotbarItems) {
      const row = document.createElement('div');
      row.className = 'row';
      const def = ITEMS[slot.item] || {};
      const isFood = def.kind === 'food' || def.kind === 'heal';
      row.innerHTML = `<span class="ico">${itemIcon(slot.item)}</span><span class="grow">${itemName(slot.item)}</span><span class="qty">${slot.count}</span>`;
      if (isFood) {
        const btn = document.createElement('button');
        btn.textContent = 'Använd (F)';
        btn.addEventListener('click', () => this.net.send({ t: 'eat' }));
        row.appendChild(btn);
      }
      this.el.itemList.appendChild(row);
    }
    for (const key of extra) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ico">${itemIcon(key)}</span><span class="grow">${itemName(key)}</span><span class="qty">${inv[key]}</span>`;
      this.el.itemList.appendChild(row);
    }
    if (!hotbarItems.length && !extra.length) {
      this.el.itemList.innerHTML = '<div class="row small">Tomt – hantverka något!</div>';
    }

    const s = this.state.stats || {};
    this.el.statList.innerHTML = `
      <div class="row small"><span class="grow">Samlat</span>${Math.round(s.gathered || 0)}</div>
      <div class="row small"><span class="grow">Tillverkat</span>${s.crafted || 0}</div>
      <div class="row small"><span class="grow">Byggt</span>${s.built || 0}</div>
      <div class="row small"><span class="grow">Dödade</span>${s.kills || 0} / Dött ${s.deaths || 0}</div>`;

    this.el.recipeList.innerHTML = '';
    const tiers = { 1: 'Steg 1 – sten & trä', 2: 'Steg 2 – träbas & jakt', 3: 'Steg 3 – metall' };
    let lastTier = 0;
    for (const r of RECIPES) {
      if (r.tier !== lastTier) {
        lastTier = r.tier;
        const h = document.createElement('h3');
        h.textContent = tiers[r.tier] || `Steg ${r.tier}`;
        this.el.recipeList.appendChild(h);
      }
      const afford = this.canAfford(r.cost);
      const row = document.createElement('div');
      row.className = 'row' + (afford ? '' : ' missing');
      const cost = Object.entries(r.cost)
        .map(([k, v]) => `${v} ${itemName(k).toLowerCase()}`)
        .join(' + ');
      row.innerHTML = `<span class="ico">${itemIcon(r.out)}</span><span class="grow">${itemName(r.out)}${r.count > 1 ? ` ×${r.count}` : ''}<br><span class="small">${cost} · ${r.time.toFixed(1)} s</span></span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Tillverka';
      btn.disabled = !afford;
      btn.addEventListener('click', () => this.net.send({ t: 'craft', id: r.id }));
      row.appendChild(btn);
      this.el.recipeList.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ lådor

  renderContainer() {
    const inv = this.state.containerInv || {};
    this.el.containerName.textContent = `📦 ${this.state.containerName || 'Förvaringslåda'}`;
    const draw = (el, obj, dir) => {
      el.innerHTML = '';
      const entries = Object.entries(obj).filter(([, n]) => n > 0);
      if (!entries.length) {
        el.innerHTML = '<div class="row small">Tomt</div>';
        return;
      }
      for (const [item, n] of entries) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<span class="ico">${itemIcon(item)}</span><span class="grow">${itemName(item)}</span><span class="qty">${n}</span>`;
        const btn = document.createElement('button');
        btn.textContent = dir === 'take' ? '⬅ Ta' : 'Lägg in ➡';
        btn.addEventListener('click', () => {
          this.net.send({ t: 'move', id: this.state.containerId, item, count: dir === 'take' ? n : Math.min(n, 1), dir });
        });
        row.appendChild(btn);
        el.appendChild(row);
      }
    };
    draw(this.el.containerItems, inv, 'take');
    const mine = { ...this.state.inv };
    for (const slot of this.state.hotbar) if (slot) mine[slot.item] = (mine[slot.item] || 0) + slot.count;
    draw(this.el.playerItems, mine, 'put');
  }

  renderLoot(bag) {
    this.state.bag = bag;
    this.el.lootItems.innerHTML = '';
    const entries = Object.entries(bag.items || {}).filter(([, n]) => n > 0);
    if (!entries.length) this.el.lootItems.innerHTML = '<div class="row small">Tomt</div>';
    for (const [item, n] of entries) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ico">${itemIcon(item)}</span><span class="grow">${itemName(item)}</span><span class="qty">${n}</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Ta';
      btn.addEventListener('click', () => this.net.send({ t: 'loot', id: bag.id, item, count: n }));
      row.appendChild(btn);
      this.el.lootItems.appendChild(row);
    }
    this.el.lootWarn.textContent = bag.inCombat ? '⚠️ Du är i strid – du kan bara plocka ett föremål i taget.' : '';
    this.openPanel('lootpanel');
  }

  // ------------------------------------------------------------------ död

  showDeath(cause, seconds) {
    document.body.classList.add('dead');
    document.exitPointerLock?.();
    this.el.deathCause.textContent = cause ? `Dödad av ${cause}` : 'Du dog';
    this.setDeathTimer(seconds);
  }

  setDeathTimer(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
      this.el.deathTimer.textContent = 'Välj att återuppstå när du är redo.';
      return;
    }
    this.el.deathTimer.textContent = `Återuppstår automatiskt om ${Math.max(0, Math.ceil(seconds))} s…`;
  }

  hideDeath() {
    document.body.classList.remove('dead');
  }

  setServerInfo(text) {
    this.el.serverinfo.textContent = text;
  }

  _esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}

export { maxStack };
