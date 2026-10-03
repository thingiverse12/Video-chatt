// All DOM-HUD: mätare, hotbar, inventarie, crafting, bygge, låda, chatt,
// minimap, skadenummer, dödskärm.

import { ITEMS, RECIPES, RECIPE_GROUPS, countItem } from '../../shared/items.js';
import { PIECES, BUILD_ORDER, buildCost, TIER_INFO } from '../../shared/building.js';
import { MAP_SIZE, HALF, WATER_LEVEL, HOTBAR_SIZE, INVENTORY_SIZE } from '../../shared/const.js';
import { KEY_HELP } from './input.js';
import { clamp } from '../../shared/math.js';

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), vignette: $('vignette'), cold: $('coldvignette'), water: $('waterOverlay'),
      crosshair: $('crosshair'), hitmark: $('hitmark'),
      clock: $('clocktext'), clockIcon: $('clockicon'), daynum: $('daynum'), compass: $('compass'),
      playercount: $('playercount'), ping: $('ping'), fps: $('fps'), roster: $('roster'),
      vitals: $('vitals'), hotbar: $('hotbar'), heldname: $('heldname'),
      interact: $('interact'), buildhint: $('buildhint'), toasts: $('toasts'), dmgnums: $('dmgnums'),
      chatlog: $('chatlog'), chatinput: $('chatinput'), chatfield: $('chatfield'),
      invpanel: $('invpanel'), invgrid: $('invgrid'), iteminfo: $('iteminfo'),
      craftpanel: $('craftpanel'), craftlist: $('craftlist'),
      buildpanel: $('buildpanel'), buildlist: $('buildlist'),
      boxpanel: $('boxpanel'), boxgrid: $('boxgrid'), boxinv: $('boxinv'),
      death: $('deathscreen'), deathcause: $('deathcause'), respawnbtn: $('respawnbtn'), respawntimer: $('respawntimer'),
      pausehint: $('pausehint'), menu: $('menu'), loading: $('loading'), errbox: $('errbox'),
      mapcv: $('mapcv'), keytable: $('keytable'),
    };
    this.cb = {};
    this.slots = [];
    this.held = 0;
    this.box = null;
    this.selCell = -1;
    this.panel = null;
    this.buildType = null;
    this._lastVitals = {};
    this._toasts = [];
    this.mapCtx = this.el.mapcv ? this.el.mapcv.getContext('2d') : null;
    this.mapBase = null;
    this._mapT = 0;
    this._rosterSig = '';
    this._day = 1;
    this._buildKeytable();
    this._buildHotbar();
    this._bind();
  }

  on(name, fn) { this.cb[name] = fn; }

  _buildKeytable() {
    if (!this.el.keytable) return;
    this.el.keytable.innerHTML = KEY_HELP.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  }

  _buildHotbar() {
    if (!this.el.hotbar) return;
    this.el.hotbar.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const d = document.createElement('div');
      d.className = 'slot empty';
      d.innerHTML = `<span class="num">${i + 1}</span><span class="ic"></span><span class="amt"></span><span class="dur"><i style="width:100%"></i></span>`;
      d.addEventListener('click', () => this.cb.hotbar && this.cb.hotbar(i));
      this.el.hotbar.appendChild(d);
    }
  }

  _bind() {
    if (this.el.respawnbtn) this.el.respawnbtn.addEventListener('click', () => this.cb.respawn && this.cb.respawn());
    if (this.el.pausehint) this.el.pausehint.addEventListener('click', () => this.cb.lock && this.cb.lock());
    if (this.el.chatfield) {
      this.el.chatfield.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const t = this.el.chatfield.value.trim();
          if (t && this.cb.chat) this.cb.chat(t);
          this.el.chatfield.value = '';
          this.setChatOpen(false);
        } else if (e.key === 'Escape') { this.setChatOpen(false); }
      });
    }
  }

  // ------------------------------------------------------------- visning ---
  show(ready) { if (this.el.hud) this.el.hud.classList.toggle('hidden', !ready); }
  setMenu(visible) { if (this.el.menu) this.el.menu.classList.toggle('hidden', !visible); }
  setMenuStatus(text) { const el = $('menustatus'); if (el) el.textContent = text; }
  setLoading(visible) { if (this.el.loading) this.el.loading.classList.toggle('hidden', !visible); }
  setPauseHint(visible) { if (this.el.pausehint) this.el.pausehint.classList.toggle('hidden', !visible); }
  error(text) {
    if (!this.el.errbox) return;
    this.el.errbox.classList.remove('hidden');
    this.el.errbox.textContent = (this.el.errbox.textContent ? this.el.errbox.textContent + '\n' : '') + text;
  }

  setChatOpen(open) {
    if (!this.el.chatinput) return;
    this.el.chatinput.classList.toggle('hidden', !open);
    if (open && this.el.chatfield) setTimeout(() => this.el.chatfield.focus(), 10);
    if (!open && this.el.chatfield) this.el.chatfield.blur();
    if (this.cb.typing) this.cb.typing(open);
  }

  // -------------------------------------------------------------- mätare ---
  setVitals(me) {
    const sig = [me.hp, me.hunger, me.thirst, me.temp].map((v) => Math.round(v)).join(',');
    if (sig === this._vitalSig) return;
    this._vitalSig = sig;
    const set = (id, v, max, extra) => {
      const el = $(id);
      if (!el) return;
      const i = el.querySelector('i');
      const s = el.querySelector('span');
      const pct = clamp((v / max) * 100, 0, 100);
      if (i) i.style.width = pct + '%';
      if (s) s.textContent = Math.round(v);
      el.classList.toggle('low', pct < 22);
      if (extra) el.classList.toggle(extra, true);
    };
    set('bar-hp', me.hp, 100);
    set('bar-hunger', me.hunger, 100);
    set('bar-thirst', me.thirst, 100);
    const t = $('bar-temp');
    set('bar-temp', me.temp, 100);
    if (t) { t.classList.toggle('cold', me.temp < 30); t.querySelector('label').textContent = me.temp < 30 ? '❄' : '🌡'; }
    if (this.el.cold) this.el.cold.style.opacity = clamp((28 - me.temp) / 28, 0, 0.85).toFixed(2);
  }

  setWater(under, wet) {
    if (this.el.water) this.el.water.style.opacity = under ? 1 : 0;
  }

  hurtFlash(amount) {
    if (!this.el.vignette) return;
    const a = clamp(0.25 + amount / 90, 0.25, 0.95);
    this.el.vignette.style.opacity = a;
    setTimeout(() => { if (this.el.vignette) this.el.vignette.style.opacity = 0; }, 220);
  }

  setClock(tod) {
    if (!this.el.clock) return;
    if (Math.abs(tod - (this._clockTod === undefined ? -1 : this._clockTod)) < 0.0004) return;
    this._clockTod = tod;
    const totalMin = Math.floor(tod * 24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    this.el.clock.textContent = `${hh}:${mm}`;
    const night = tod < 0.22 || tod > 0.8;
    this.el.clockIcon.textContent = night ? '☾' : tod < 0.3 || tod > 0.72 ? '☼' : '☀';
    this.el.daynum.textContent = 'Dag ' + this._day;
  }
  bumpDay() { this._day++; }

  setCompass(yaw) {
    if (!this.el.compass) return;
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = ['N', 'NV', 'V', 'SV', 'S', 'SO', 'O', 'NO'];
    const d = dirs[Math.round(deg / 45) % 8];
    this.el.compass.textContent = `${d}  ${Math.round(deg)}°`;
  }

  setNet(players, ping, fps) {
    if (this.el.playercount) this.el.playercount.textContent = players + (players === 1 ? ' spelare' : ' spelare');
    if (this.el.ping) this.el.ping.textContent = Math.round(ping) + ' ms';
    if (this.el.fps) this.el.fps.textContent = Math.round(fps) + ' fps';
  }

  setRoster(list) {
    if (!this.el.roster) return;
    const sig = list.map((p) => `${p.name}:${p.kills}:${p.deaths}:${p.dead}`).join('|');
    if (sig === this._rosterSig) return;
    this._rosterSig = sig;
    this.el.roster.innerHTML = list
      .sort((a, b) => b.kills - a.kills)
      .map((p) => `<div class="roster-row${p.dead ? ' dead' : ''}"><span>${esc(p.name)}</span><span class="k">${p.kills}⚔</span><span>${p.deaths}☠</span></div>`)
      .join('');
  }

  // --------------------------------------------------------------- hotbar ---
  setInventory(slots, held) {
    this.slots = slots || [];
    this.held = held || 0;
    const cells = this.el.hotbar ? this.el.hotbar.children : [];
    for (let i = 0; i < cells.length; i++) {
      const s = this.slots[i];
      const c = cells[i];
      c.classList.toggle('sel', i === this.held);
      c.classList.toggle('empty', !s);
      const d = s ? ITEMS[s.id] : null;
      c.querySelector('.ic').textContent = d ? d.icon : '';
      c.querySelector('.amt').textContent = s && s.amount > 1 ? s.amount : '';
      const dur = c.querySelector('.dur');
      if (d && d.dur && s && s.dur !== undefined) {
        dur.style.display = 'block';
        dur.querySelector('i').style.width = clamp((s.dur / d.dur) * 100, 0, 100) + '%';
      } else dur.style.display = 'none';
      c.title = d ? `${d.name}${s.dur ? ' · hållbarhet ' + s.dur : ''}` : '';
    }
    const h = this.slots[this.held];
    if (this.el.heldname) this.el.heldname.textContent = h && ITEMS[h.id] ? ITEMS[h.id].name : '';
    if (this.panel === 'inv') this.renderInvPanel();
    if (this.panel === 'craft') this.renderCraftPanel();
    if (this.panel === 'box') this.renderBoxPanel();
    if (this.panel === 'build') this.renderBuildPanel();
  }

  // ------------------------------------------------------------- paneler ---
  setPanel(name) {
    this.panel = name;
    for (const [k, el] of [['inv', this.el.invpanel], ['craft', this.el.craftpanel], ['build', this.el.buildpanel], ['box', this.el.boxpanel]]) {
      if (el) el.classList.toggle('hidden', name !== k);
    }
    if (name === 'inv') this.renderInvPanel();
    if (name === 'craft') this.renderCraftPanel();
    if (name === 'build') this.renderBuildPanel();
    if (name === 'box') this.renderBoxPanel();
    if (this.cb.panel) this.cb.panel(name);
  }
  togglePanel(name) { this.setPanel(this.panel === name ? null : name); }

  renderInvPanel() {
    if (!this.el.invgrid) return;
    this.el.invgrid.innerHTML = '';
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const s = this.slots[i];
      const d = s ? ITEMS[s.id] : null;
      const c = document.createElement('div');
      c.className = 'cell' + (i === this.selCell ? ' sel' : '') + (i === this.held && i < HOTBAR_SIZE ? ' sel' : '');
      c.innerHTML = `${i < HOTBAR_SIZE ? `<span class="hb">${i + 1}</span>` : ''}<span>${d ? d.icon : ''}</span>` +
        (s && s.amount > 1 ? `<span class="amt">${s.amount}</span>` : '') +
        (d && d.dur && s && s.dur !== undefined ? `<span class="dur"><i style="width:${clamp((s.dur / d.dur) * 100, 0, 100)}%"></i></span>` : '');
      c.addEventListener('click', (e) => this.cellClick(i, e));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cellRight(i, e); });
      c.addEventListener('mouseenter', () => { if (this.el.iteminfo) this.el.iteminfo.innerHTML = s ? itemInfo(s) : ''; });
      this.el.invgrid.appendChild(c);
    }
  }

  cellClick(i, e) {
    if (e.shiftKey) { this.cb.drop && this.cb.drop(i, true); return; }
    if (this.selCell < 0) { this.selCell = i; this.renderInvPanel(); return; }
    this.cb.move && this.cb.move(this.selCell, i);
    this.selCell = -1;
    this.renderInvPanel();
  }
  cellRight(i, e) {
    if (this.selCell < 0) { this.selCell = i; this.renderInvPanel(); return; }
    this.cb.move && this.cb.move(this.selCell, i, true);
    this.selCell = -1;
  }

  renderCraftPanel() {
    if (!this.el.craftlist) return;
    let html = '';
    let group = null;
    for (const r of RECIPES) {
      if (r.group !== group) { group = r.group; html += `<div class="craftgroup">${group}</div>`; }
      const out = Object.keys(r.out).map((k) => `${ITEMS[k].icon} ${ITEMS[k].name}${r.out[k] > 1 ? ' ×' + r.out[k] : ''}`).join(', ');
      const afford = Object.keys(r.cost).every((k) => countItem(this.slots, k) >= r.cost[k]);
      const cost = Object.keys(r.cost).map((k) => {
        const have = countItem(this.slots, k);
        return `<span class="${have >= r.cost[k] ? 'has' : 'lack'}">${r.cost[k]} ${ITEMS[k].name}</span>`;
      }).join(' · ');
      html += `<div class="recipe${afford ? '' : ' no'}" data-id="${r.id}">
        <span class="ic">${ITEMS[Object.keys(r.out)[0]].icon}</span>
        <span class="nm">${out}</span>
        <span class="cst">${cost}</span></div>`;
    }
    this.el.craftlist.innerHTML = html;
    for (const el of this.el.craftlist.querySelectorAll('.recipe')) {
      el.addEventListener('click', (e) => this.cb.craft && this.cb.craft(el.dataset.id, e.shiftKey ? 5 : 1));
    }
  }

  renderBuildPanel() {
    if (!this.el.buildlist) return;
    const all = [...BUILD_ORDER, 'campfire'];
    this.el.buildlist.innerHTML = all.map((t) => {
      const p = PIECES[t];
      const cost = buildCost(t);
      let afford = true;
      if (t === 'campfire') afford = countItem(this.slots, 'campfire') > 0;
      else afford = Object.keys(cost).every((k) => countItem(this.slots, k) >= cost[k]);
      const costTxt = t === 'campfire' ? '1 × lägereld' : Object.keys(cost).map((k) => `${cost[k]} ${ITEMS[k].name}`).join(' + ');
      return `<div class="bpiece${this.buildType === t ? ' sel' : ''}${afford ? '' : ' no'}" data-t="${t}">
        ${p.name}<span class="cost">${costTxt}</span></div>`;
    }).join('');
    for (const el of this.el.buildlist.querySelectorAll('.bpiece')) {
      el.addEventListener('click', () => { this.buildType = el.dataset.t; this.cb.buildSelect && this.cb.buildSelect(el.dataset.t); this.renderBuildPanel(); });
    }
  }

  setBuildMode(type) {
    this.buildType = type;
    if (this.el.crosshair) this.el.crosshair.classList.toggle('build', !!type);
    if (type && this.panel !== 'build') this.setPanel(null);
    if (!type) this.setPanel(null);
  }

  renderBoxPanel() {
    if (!this.box) return;
    if (this.el.boxgrid) {
      this.el.boxgrid.innerHTML = '';
      for (let i = 0; i < this.box.slots.length; i++) {
        const s = this.box.slots[i];
        const d = s ? ITEMS[s.id] : null;
        const c = document.createElement('div');
        c.className = 'cell';
        c.innerHTML = `<span>${d ? d.icon : ''}</span>${s && s.amount > 1 ? `<span class="amt">${s.amount}</span>` : ''}`;
        c.title = d ? d.name : '';
        c.addEventListener('click', () => { if (s) this.cb.boxXfer && this.cb.boxXfer(false, i); });
        this.el.boxgrid.appendChild(c);
      }
    }
    if (this.el.boxinv) {
      this.el.boxinv.innerHTML = '';
      for (let i = 0; i < INVENTORY_SIZE; i++) {
        const s = this.slots[i];
        const d = s ? ITEMS[s.id] : null;
        const c = document.createElement('div');
        c.className = 'cell';
        c.innerHTML = `<span>${d ? d.icon : ''}</span>${s && s.amount > 1 ? `<span class="amt">${s.amount}</span>` : ''}`;
        c.title = d ? d.name : '';
        c.addEventListener('click', () => { if (s) this.cb.boxXfer && this.cb.boxXfer(true, i); });
        this.el.boxinv.appendChild(c);
      }
    }
  }

  setBox(box) {
    this.box = box;
    if (box) this.setPanel('box');
    else if (this.panel === 'box') this.setPanel(null);
  }

  // --------------------------------------------------------------- texter ---
  setInteract(text) {
    if (!this.el.interact) return;
    if (!text) { this.el.interact.classList.add('hidden'); return; }
    this.el.interact.classList.remove('hidden');
    this.el.interact.innerHTML = text;
  }

  setBuildHint(text, ok) {
    if (!this.el.buildhint) return;
    if (!text) { this.el.buildhint.classList.add('hidden'); return; }
    this.el.buildhint.classList.remove('hidden');
    this.el.buildhint.classList.toggle('bad', ok === false);
    this.el.buildhint.innerHTML = text;
  }

  toast(text, kind = 'info') {
    if (!this.el.toasts) return;
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.classList.add('fade'), 2600);
    setTimeout(() => d.remove(), 3100);
    while (this.el.toasts.children.length > 6) this.el.toasts.firstChild.remove();
  }

  loot(items) {
    if (!this.el.dmgnums) return;
    for (const l of items) {
      const d = ITEMS[l.item];
      const e = document.createElement('div');
      e.className = 'loot';
      e.textContent = `+${l.qty} ${d ? d.icon + ' ' + d.name : l.item}`;
      e.style.top = (52 + Math.random() * 6) + '%';
      this.el.dmgnums.appendChild(e);
      setTimeout(() => e.remove(), 1150);
    }
  }

  damageNumber(x, y, text, cls = '') {
    if (!this.el.dmgnums) return;
    const e = document.createElement('div');
    e.className = 'dmgnum ' + cls;
    e.textContent = text;
    e.style.left = x + 'px';
    e.style.top = y + 'px';
    this.el.dmgnums.appendChild(e);
    setTimeout(() => e.remove(), 820);
  }

  hitmark() {
    if (!this.el.hitmark) return;
    this.el.hitmark.classList.remove('show');
    void this.el.hitmark.offsetWidth;
    this.el.hitmark.classList.add('show');
  }

  chat(msg) {
    if (!this.el.chatlog) return;
    const d = document.createElement('div');
    d.className = 'chatline' + (msg.sys ? ' sys' : '');
    d.innerHTML = msg.sys ? esc(msg.text) : `<span class="who">${esc(msg.name)}:</span> ${esc(msg.text)}`;
    this.el.chatlog.appendChild(d);
    while (this.el.chatlog.children.length > 7) this.el.chatlog.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity 1s'; setTimeout(() => d.remove(), 1100); }, 14000);
  }

  died(info) {
    if (!this.el.death) return;
    this.el.death.classList.remove('hidden');
    this.el.deathcause.textContent = info && info.by ? `Dödad av ${info.by}` : `Du dog av ${info && info.cause ? info.cause : 'skador'}`;
  }
  hideDeath() { if (this.el.death) this.el.death.classList.add('hidden'); }
  setRespawnTimer(sec) { if (this.el.respawntimer) this.el.respawntimer.textContent = sec > 0 ? `Automatisk respawn om ${sec} s` : ''; }

  // -------------------------------------------------------------- minimap ---
  setTerrain(hm, res) {
    if (!this.mapCtx || typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d');
    const img = g.createImageData(res, res);
    for (let i = 0; i < res * res; i++) {
      const h = hm[i];
      let r, gg, b;
      if (h < WATER_LEVEL - 1.5) { r = 22; gg = 52; b = 68; }
      else if (h < WATER_LEVEL) { r = 34; gg = 78; b = 96; }
      else if (h < WATER_LEVEL + 1.4) { r = 176; gg = 160; b = 118; }
      else if (h < 17) { const v = 0.85 + ((i * 37) % 11) / 60; r = 68 * v; gg = 96 * v; b = 48 * v; }
      else if (h < 26) { r = 104; gg = 100; b = 88; }
      else { r = 196; gg = 202; b = 208; }
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.mapBase = c;
    this.mapRes = res;
  }

  drawMap(me, nodes, blocks, others, now) {
    if (!this.mapCtx || !this.mapBase) return;
    if (now - this._mapT < 110) return;
    this._mapT = now;
    const cv = this.el.mapcv, g = this.mapCtx;
    const W = cv.width, H = cv.height;
    const range = 95;                              // meter i varje riktning
    const scale = (W / 2) / range;                 // px per meter
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#123';
    g.fillRect(0, 0, W, H);

    // terräng
    const srcPx = (range * 2) / MAP_SIZE * this.mapRes;
    const sx = clamp(((me.x + HALF - range) / MAP_SIZE) * this.mapRes, 0, Math.max(0, this.mapRes - srcPx));
    const sy = clamp(((me.z + HALF - range) / MAP_SIZE) * this.mapRes, 0, Math.max(0, this.mapRes - srcPx));
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mapBase, sx, sy, srcPx, srcPx, 0, 0, W, H);

    const toX = (x) => (x - me.x) * scale + W / 2;
    const toY = (z) => (z - me.z) * scale + H / 2;
    const inView = (x, z) => Math.abs(x - me.x) < range && Math.abs(z - me.z) < range;

    // noder
    for (const n of nodes.values()) {
      if (!n.alive || !inView(n.x, n.z)) continue;
      g.fillStyle = n.kind === 'tree' ? '#1f3a1c' : n.kind === 'rock' ? '#8a8580' : n.kind === 'metal' ? '#d08a30' : '#b03a55';
      const s = n.kind === 'tree' ? 2 : 2.4;
      g.fillRect(toX(n.x) - s / 2, toY(n.z) - s / 2, s, s);
    }
    // byggnader
    g.fillStyle = '#e0a44f';
    for (const b of blocks.values()) {
      if (!inView(b.x, b.z)) continue;
      const s = b.type === 'foundation' || b.type === 'roof' ? 3.4 : 2.2;
      g.globalAlpha = 0.9;
      g.fillRect(toX(b.x) - s / 2, toY(b.z) - s / 2, s, s);
    }
    g.globalAlpha = 1;
    // andra spelare
    for (const o of others.values()) {
      if (o.dead || !inView(o.x, o.z)) continue;
      g.fillStyle = '#e04a3a';
      g.beginPath(); g.arc(toX(o.x), toY(o.z), 3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1; g.stroke();
    }
    // egen pil
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-me.yaw + Math.PI);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(0, 2.6); g.lineTo(-4, 5); g.closePath(); g.fill();
    g.restore();
    // ram
    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
}

function itemInfo(s) {
  const d = ITEMS[s.id];
  if (!d) return '';
  const bits = [];
  if (d.dmg) bits.push(`skada <b>${d.dmg}</b>`);
  if (d.range) bits.push(`räckvidd <b>${d.range} m</b>`);
  if (d.gather) bits.push('samlar: ' + Object.keys(d.gather).map((k) => `${ITEMS[k].name} ×${d.gather[k]}`).join(', '));
  if (d.hunger) bits.push(`mättar <b>${d.hunger}</b>`);
  if (d.dur && s.dur !== undefined) bits.push(`hållbarhet <b>${s.dur}/${d.dur}</b>`);
  if (d.cat === 'ranged') bits.push('kräver <b>pilar</b>');
  return `<b>${d.name}</b> · ${d.cat === 'res' ? 'resurs' : d.cat === 'food' ? 'mat' : d.cat === 'tool' ? 'verktyg' : d.cat === 'weapon' ? 'vapen' : d.cat === 'ranged' ? 'avståndsvapen' : d.cat === 'ammo' ? 'ammunition' : 'placerbar'}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { itemInfo, esc };
