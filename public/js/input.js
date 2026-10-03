// Tangentbord, mus och pointer lock.

export const KEY_HELP = [
  ['W A S D', 'Gå'],
  ['Shift', 'Spring'],
  ['Mellanslag', 'Hoppa / simma upp'],
  ['Vänsterklick', 'Slå / hugg / skjut (bygg: placera)'],
  ['Högerklick', 'Använd föremål (ät bär / placera eld)'],
  ['E', 'Interagera (dörr, låda, drick, plocka)'],
  ['1 – 6', 'Välj i hotbar'],
  ['Tab', 'Inventarie'],
  ['C', 'Crafting'],
  ['B', 'Byggläge (1–7 väljer byggdel)'],
  ['U', 'Uppgradera byggdel (trä → sten → metall)'],
  ['X', 'Riv egen byggdel'],
  ['Q', 'Släpp föremål'],
  ['T', 'Chatt'],
  ['Esc', 'Meny / släpp musen'],
];

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false };
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.typing = false;
    this.onLockChange = null;
    this.onClick = null;
    this.onKey = null;
    this.element = null;
  }

  attach(el) {
    this.element = el;
    if (typeof window === 'undefined' || !window.addEventListener) return;

    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (['Tab', 'Space', 'F1'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      if (this.onClick) this.onClick(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.element && this.element.requestPointerLock) this.element.requestPointerLock();
  }
  releaseLock() { if (typeof document !== 'undefined' && document.exitPointerLock) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }

  movement() {
    return {
      f: this.down('KeyW') || this.down('ArrowUp'),
      b: this.down('KeyS') || this.down('ArrowDown'),
      l: this.down('KeyA') || this.down('ArrowLeft'),
      r: this.down('KeyD') || this.down('ArrowRight'),
      jump: this.down('Space'),
      sprint: this.down('ShiftLeft') || this.down('ShiftRight'),
    };
  }

  consumeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, leftPressed: this.mouse.leftPressed, rightPressed: this.mouse.rightPressed, left: this.mouse.left };
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
    return m;
  }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
}
