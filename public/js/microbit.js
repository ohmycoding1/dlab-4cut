'use strict';
// micro:bit 에어마우스
//  - 표준 BLE 서비스만 사용(MakeCode 블록으로 켜기만 하면 됨, 별도 프로토콜 없음)
//    · Accelerometer Service → 기울기로 화면 커서 이동
//    · Button Service        → A=클릭, B=뒤로
//    · LED Service(선택)      → 카운트다운 숫자를 micro:bit LED에 표시
//  - 연결이 없을 때는 "가상 micro:bit"(방향키 + A/B 키)로 같은 경로를 리허설할 수 있음

const UUID = id => `e95d${id}-251d-470a-a062-fa1922dfa9a8`;
const SVC = { accel: UUID('0753'), button: UUID('9882'), led: UUID('d91d') };
const CHR = {
  accelData: UUID('ca4b'), accelPeriod: UUID('fb24'),
  buttonA: UUID('da90'), buttonB: UUID('da91'),
  ledMatrix: UUID('7b77'),
};

// 5x5 LED 비트맵(행마다 5비트, 왼쪽 열 = bit4)
const GLYPHS = {
  1: ['00100', '01100', '00100', '00100', '01110'],
  2: ['11100', '00010', '01100', '10000', '11110'],
  3: ['11110', '00010', '00100', '10010', '01100'],
  4: ['00110', '01010', '10010', '11111', '00010'],
  5: ['11111', '10000', '11110', '00001', '11110'],
  heart: ['01010', '11111', '11111', '01110', '00100'],
  smile: ['00000', '01010', '00000', '10001', '01110'],
  dot: ['00000', '00000', '00100', '00000', '00000'],
  off: ['00000', '00000', '00000', '00000', '00000'],
};

export class MicrobitMouse extends EventTarget {
  constructor(cursorEl, settings) {
    super();
    this.cursor = cursorEl;
    this.settings = settings;          // { sensitivity, invertX, invertY } — 참조로 공유
    this.device = null;
    this.led = null;
    this.connected = false;
    this.simulating = false;
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    this.raw = { x: 0, y: 0 };         // 최근 가속도(mg)
    this.neutral = { x: 0, y: 0 };     // 보정된 '가만히 든' 자세
    this.vel = { x: 0, y: 0 };
    this.hover = null;
    this.calibrateNext = 0;
    this.manualClose = false;
    this.simKeys = new Set();
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
    addEventListener('resize', () => this._clamp());
  }

  get supported() { return !!navigator.bluetooth; }
  get active() { return this.connected || this.simulating; }

  // ───────── BLE 연결 ─────────
  async connect() {
    if (!this.supported) throw new Error('이 브라우저는 Web Bluetooth를 지원하지 않아요. PC용 Chrome/Edge에서 localhost 또는 HTTPS로 접속해 주세요.');
    // micro:bit 는 서비스 UUID를 광고하지 않으므로 이름으로 찾아야 목록에 뜸
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BBC micro:bit' }],
      optionalServices: [SVC.accel, SVC.button, SVC.led],
    });
    this.manualClose = false;
    await this._attach(device);
  }

  async _attach(device) {
    if (this.device && this.device !== device) this.device.removeEventListener('gattserverdisconnected', this._onDisc);
    this.device = device;
    this._onDisc = () => this._disconnected();
    device.addEventListener('gattserverdisconnected', this._onDisc);
    this._emit('status', { state: 'connecting', name: device.name });
    const server = await device.gatt.connect();

    const missing = [];
    try {
      const accel = await server.getPrimaryService(SVC.accel);
      try { // 20ms 주기로 받기(펌웨어 허용값: 1,2,5,10,20,80,160,640)
        const period = await accel.getCharacteristic(CHR.accelPeriod);
        await period.writeValue(new Uint16Array([20]));
      } catch { /* 주기 설정 실패해도 기본값으로 동작 */ }
      const data = await accel.getCharacteristic(CHR.accelData);
      data.addEventListener('characteristicvaluechanged', e => this._onAccel(e.target.value));
      await data.startNotifications();
    } catch { missing.push('가속도'); }

    try {
      const btn = await server.getPrimaryService(SVC.button);
      for (const [uuid, which] of [[CHR.buttonA, 'A'], [CHR.buttonB, 'B']]) {
        const c = await btn.getCharacteristic(uuid);
        // 0=뗌, 1=누름, 2=길게 누름 → 누르는 순간만 사용
        c.addEventListener('characteristicvaluechanged', e => { if (e.target.value.getUint8(0) === 1) this.press(which); });
        await c.startNotifications();
      }
    } catch { missing.push('버튼'); }

    try {
      const led = await server.getPrimaryService(SVC.led);
      this.led = await led.getCharacteristic(CHR.ledMatrix);
    } catch { this.led = null; }

    if (missing.length === 2) {
      device.gatt.disconnect();
      throw new Error('micro:bit에서 가속도·버튼 서비스를 찾지 못했어요. firmware/ 폴더의 MakeCode 코드를 넣었는지 확인해 주세요.');
    }
    this.connected = true;
    this.calibrate();
    this.show('smile');
    this._emit('status', { state: 'connected', name: device.name, missing });
  }

  async _disconnected() {
    this.connected = false;
    this.led = null;
    this._emit('status', { state: 'disconnected' });
    if (this.manualClose || !this.device) return;
    // 같은 세션에서 고른 장치는 사용자 클릭 없이 재연결 가능 → 점점 길게 재시도
    for (const wait of [500, 1500, 3000, 6000, 10000]) {
      await new Promise(r => setTimeout(r, wait));
      if (this.connected || this.manualClose) return;
      try { await this._attach(this.device); return; } catch { /* 다음 시도 */ }
    }
    this._emit('status', { state: 'lost' });
  }

  disconnect() {
    this.manualClose = true;
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
  }

  // 페이지 새로고침 후 이미 허용한 장치로 자동 재연결(Chrome의 getDevices 지원 시)
  async reconnectKnown() {
    if (!navigator.bluetooth?.getDevices) return false;
    const devices = await navigator.bluetooth.getDevices();
    const dev = devices.find(d => (d.name || '').startsWith('BBC micro:bit'));
    if (!dev) return false;
    try { await this._attach(dev); return true; } catch { return false; }
  }

  // ───────── 입력 처리 ─────────
  _onAccel(view) {
    // x, y, z: int16 little-endian, 단위 mg
    this.raw.x = view.getInt16(0, true);
    this.raw.y = view.getInt16(2, true);
    if (this.calibrateNext > 0) {
      this.neutral.x += (this.raw.x - this.neutral.x) * 0.5;
      this.neutral.y += (this.raw.y - this.neutral.y) * 0.5;
      this.calibrateNext--;
    }
  }

  // 지금 들고 있는 자세를 '정지' 기준으로
  calibrate() {
    this.neutral = { ...this.raw };
    this.calibrateNext = 8;
  }

  setSimulate(on) {
    this.simulating = on;
    if (on) { this.neutral = { x: 0, y: 0 }; this.raw = { x: 0, y: 0 }; }
    this._emit('status', { state: this.connected ? 'connected' : on ? 'simulating' : 'disconnected', name: this.device?.name });
  }

  simKey(e, down) {
    if (!this.simulating) return false;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
      down ? this.simKeys.add(k) : this.simKeys.delete(k);
      const t = 650; // 기울기 흉내(mg)
      this.raw.x = (this.simKeys.has('ArrowRight') ? t : 0) - (this.simKeys.has('ArrowLeft') ? t : 0);
      this.raw.y = (this.simKeys.has('ArrowDown') ? t : 0) - (this.simKeys.has('ArrowUp') ? t : 0);
      return true;
    }
    if (down && !e.repeat && (k === 'a' || k === 'A')) { this.press('A'); return true; }
    if (down && !e.repeat && (k === 'b' || k === 'B')) { this.press('B'); return true; }
    return false;
  }

  press(which) {
    this.cursor.classList.remove('pressing');
    void this.cursor.offsetWidth;
    this.cursor.classList.add('pressing');
    this._emit('press', { which, target: which === 'A' ? this.hover : null });
  }

  // ───────── 커서 ─────────
  _axis(v, n) {
    const dead = 110;            // 손떨림 무시 구간(mg)
    const d = v - n;
    const a = Math.abs(d);
    if (a < dead) return 0;
    const t = Math.min(a - dead, 700) / 700;   // 0..1
    return Math.sign(d) * Math.pow(t, 1.6);   // 살짝 기울이면 미세, 많이 기울이면 빠르게
  }

  _loop(now) {
    const dt = Math.min(48, now - this._last) / 1000;
    this._last = now;
    if (this.active) {
      const s = this.settings;
      const maxSpeed = 380 + s.sensitivity * 160;      // px/s
      let tx = this._axis(this.raw.x, this.neutral.x) * maxSpeed * (s.invertX ? -1 : 1);
      let ty = this._axis(this.raw.y, this.neutral.y) * maxSpeed * (s.invertY ? -1 : 1);
      if (this.hover) { tx *= 0.45; ty *= 0.45; }      // 버튼 위에서는 살짝 '끈적'하게 → 아이들도 조준 쉬움
      this.vel.x += (tx - this.vel.x) * 0.25;
      this.vel.y += (ty - this.vel.y) * 0.25;
      this.x += this.vel.x * dt;
      this.y += this.vel.y * dt;
      this._clamp();
      this.cursor.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
      this._updateHover();
    }
    this.cursor.classList.toggle('show', this.active);
    requestAnimationFrame(this._loop);
  }

  _clamp() {
    this.x = Math.max(0, Math.min(innerWidth - 1, this.x));
    this.y = Math.max(0, Math.min(innerHeight - 1, this.y));
  }

  _updateHover() {
    const el = document.elementFromPoint(this.x, this.y);
    const target = el?.closest('button:not(:disabled), [data-mb]') || null;
    if (target === this.hover) return;
    this.hover?.classList.remove('mb-hover');
    this.hover = target;
    target?.classList.add('mb-hover');
    this.cursor.classList.toggle('on-target', !!target);
  }

  warpTo(el) {
    const r = el.getBoundingClientRect();
    this.x = r.left + r.width / 2;
    this.y = r.top + r.height / 2;
    this.vel = { x: 0, y: 0 };
  }

  // ───────── LED 피드백 ─────────
  async show(name) {
    if (!this.led) return;
    const g = GLYPHS[name];
    if (!g) return;
    try { await this.led.writeValue(new Uint8Array(g.map(r => parseInt(r, 2)))); } catch { /* 진행 중 쓰기 충돌 무시 */ }
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
