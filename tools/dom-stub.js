// Minimal DOM-/canvas-stub så att klientkoden kan testas headless i Node.

export function installDom() {
  const listeners = new Map();

  class ClassList {
    constructor() { this.set = new Set(); }
    add(...c) { for (const x of c) this.set.add(x); }
    remove(...c) { for (const x of c) this.set.delete(x); }
    toggle(c, force) {
      const on = force === undefined ? !this.set.has(c) : !!force;
      if (on) this.set.add(c); else this.set.delete(c);
      return on;
    }
    contains(c) { return this.set.has(c); }
  }

  function ctx2d() {
    const noop = () => {};
    return {
      canvas: null,
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
      globalAlpha: 1, imageSmoothingEnabled: true, filter: 'none',
      fillRect: noop, clearRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop,
      translate: noop, rotate: noop, scale: noop, fillText: noop, strokeText: noop, drawImage: noop,
      measureText: () => ({ width: 10 }),
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
    };
  }

  class El {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase();
      this.classList = new ClassList();
      this.style = new Proxy({}, { get: (t, k) => t[k] || '', set: (t, k, v) => { t[k] = v; return true; } });
      this.children = [];
      this.dataset = {};
      this.listeners = new Map();
      this._html = '';
      this.textContent = '';
      this.value = '';
      this.title = '';
      this.width = 300; this.height = 150;
      this.checked = false;
      this.disabled = false;
      this.offsetWidth = 10;
      this.parentNode = null;
      if (this.tagName === 'CANVAS') this._ctx = ctx2d();
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v); this.children = []; }
    get firstChild() { return this.children[0] || null; }
    get className() { return [...this.classList.set].join(' '); }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    getContext(kind) { return kind === '2d' ? this._ctx : null; }
    appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    insertBefore(c) { return this.appendChild(c); }
    querySelector() { return new El('i'); }
    querySelectorAll() { return []; }
    addEventListener(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn); }
    removeEventListener() {}
    dispatch(ev, arg) { const l = this.listeners.get(ev); if (l) for (const f of l) f(arg || { preventDefault() {}, stopPropagation() {}, key: '', code: '', button: 0 }); }
    focus() {}
    blur() {}
    requestPointerLock() { this._locked = true; }
    setAttribute(k, v) { this[k] = v; }
    getAttribute(k) { return this[k]; }
    toDataURL() { return 'data:,'; }
  }

  const byId = new Map();
  const document = {
    createElement: (t) => new El(t),
    createElementNS: (ns, t) => new El(t),
    getElementById(id) {
      if (!byId.has(id)) { const e = new El(id === 'gl' || id === 'mapcv' ? 'canvas' : 'div'); e.id = id; byId.set(id, e); }
      return byId.get(id);
    },
    querySelector: () => new El(),
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
    removeEventListener: () => {},
    body: new El('body'),
    documentElement: new El('html'),
    pointerLockElement: null,
    exitPointerLock() { document.pointerLockElement = null; },
    hidden: false,
  };

  const store = new Map();
  const window = {
    document,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    performance: globalThis.performance,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    addEventListener: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
    removeEventListener: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
    navigator: { userAgent: 'node' },
    io: null,
    fetch: globalThis.fetch,
    __HEADLESS__: true,
    AudioContext: null,
  };

  const setGlobal = (k, v) => {
    try { Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true }); }
    catch (e) { try { globalThis[k] = v; } catch (e2) { /* read-only i Node – ignorera */ } }
  };
  setGlobal('window', window);
  setGlobal('document', document);
  setGlobal('localStorage', window.localStorage);
  setGlobal('navigator', window.navigator);
  setGlobal('requestAnimationFrame', window.requestAnimationFrame);
  setGlobal('cancelAnimationFrame', window.cancelAnimationFrame);
  setGlobal('devicePixelRatio', 1);
  setGlobal('El', El);
  return { window, document, listeners, El };
}

/** Fejk-renderer som ersätter THREE.WebGLRenderer i headless-läge. */
export function makeFakeRenderer() {
  return {
    domElement: null,
    shadowMap: { enabled: false, type: 0 },
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 1 },
    info: { render: { calls: 0, triangles: 0 }, memory: {} },
    _renders: 0,
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    getSize: (v) => ({ x: 1280, y: 720 }),
    render(scene, camera) {
      this._renders++;
      // räkna noder/meshar så att vi märker om scenen är tom
      let meshes = 0, tris = 0;
      scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isSprite) meshes++; });
      this.info.render.calls = meshes;
      this.info.render.triangles = tris;
    },
    dispose() {},
  };
}
