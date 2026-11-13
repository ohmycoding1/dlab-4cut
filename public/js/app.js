'use strict';
import { MicrobitMouse } from './microbit.js';
import { FIREBASE_SHARE, uploadToFirebase } from './share-config.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ───────── 설정(운영자 PC에 저장) ─────────
const DEFAULTS = { apiBase: '', frame: 'navy', sensitivity: 3, invertX: false, invertY: false, countSec: 3, sound: true, mirror: true, camId: '', simulate: false };
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('dlab4cut') || '{}')); } catch { /* 저장소 없음 */ }
const save = () => { try { localStorage.setItem('dlab4cut', JSON.stringify(settings)); } catch { /* 무시 */ } };

// 사진 서버 주소: ?api=https://... > 설정값 > 같은 주소(npm start 로 실행한 경우)
// GitHub Pages 같은 정적 호스팅에서는 서버가 없으므로 QR 대신 PC 저장만 사용
const apiParam = new URLSearchParams(location.search).get('api');
if (apiParam !== null) { settings.apiBase = apiParam; save(); }
const apiBase = () => (settings.apiBase || '').trim().replace(/\/+$/, '');
let serverOK = null;   // null=확인 중, true/false

// ───────── 프레임 ─────────
const FRAMES = [
  { id: 'navy', name: '디랩 네이비', bg: '#1b2733', ink: '#ffffff' },
  { id: 'cream', name: '크림', bg: '#f4efe6', ink: '#1b2733' },
  { id: 'pink', name: '체리 핑크', bg: '#ffc7d6', ink: '#4a1d2c' },
  { id: 'sky', name: '하늘', bg: '#bcd8ff', ink: '#13294b' },
];
const frame = () => FRAMES.find(f => f.id === settings.frame) || FRAMES[0];

// 결과물 규격: 1200×3600(2×6인치 @600dpi 비율) / 각 컷 3:2
const OUT = { w: 1200, h: 3600, pad: 60, top: 70, cw: 1080, ch: 720, gap: 36 };
const SHOT = { w: 1500, h: 1000 };
const CUT_LIMIT_SEC = 30;   // 컷마다 '찍기'를 기다리는 최대 시간(지나면 자동 촬영)

let stream = null;
let stage = 'intro';
const ORDER = ['intro', 'frame', 'shooting', 'result'];
let lastInput = Date.now();
let shots = [];
let runId = 0;              // 촬영 취소용
let resultBlob = null, resultURL = '';
let autoHomeTimer = null;

// ───────── UI 헬퍼 ─────────
let toastTimer;
function toast(msg, err = false, ms = 3800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function chip(id, cls, text) {
  const c = $(id);
  c.classList.remove('ok', 'warn');
  if (cls) c.classList.add(cls);
  c.querySelector('span').textContent = text;
}
const K = {
  a: '<span class="key a">A</span>', b: '<span class="key b">B</span>',
  k: t => `<span class="key">${t}</span>`, sep: '<span class="sep"></span>',
};
const FIRE = `${K.k('흔들기')} 또는 ${K.a}+${K.b}`;
const HINTS = {
  intro: `${K.b} 사용법 보고 시작 ${K.sep} ${FIRE} 바로 촬영 ${K.sep} 키보드 ${K.k('→')} 시작 · ${K.k('Space')} 촬영`,
  frame: `${K.a} ◀ 이전 색 ${K.sep} ${K.b} 다음 색 ▶ ${K.sep} ${FIRE} 촬영 시작 ${K.sep} 키보드 ${K.k('Esc')} 처음으로`,
  shooting: `${FIRE} 3초 뒤 찰칵 (컷마다 ${CUT_LIMIT_SEC}초 지나면 자동) ${K.sep} ${K.a} 취소 ${K.sep} 키보드 ${K.k('Space')} 찍기 · ${K.k('←')} 취소`,
  result: `${K.a} 다시 찍기 ${K.sep} ${K.b} 처음으로 ${K.sep} 키보드 ${K.k('←')} ${K.k('→')} · ${K.k('S')} PC에 저장`,
};
// 화면 넘김: 현재 화면보다 앞은 왼쪽(past), 뒤는 오른쪽(future)으로 접힘
function setStage(s) {
  const changed = s !== stage;
  stage = s;
  document.body.dataset.stage = s;
  const idx = ORDER.indexOf(s);
  document.querySelectorAll('.screen').forEach(el => {
    const i = ORDER.indexOf(el.dataset.screen);
    el.classList.toggle('past', i < idx);
    el.classList.toggle('current', i === idx);
    el.classList.toggle('future', i > idx);
    el.inert = i !== idx;
  });
  document.querySelectorAll('.steps li').forEach(li => {
    const i = ORDER.indexOf(li.dataset.for);
    li.classList.toggle('on', i === idx);
    li.classList.toggle('done', i < idx);
  });
  $('start-btn').disabled = !stream || s !== 'frame';
  $('shoot-msg').innerHTML = stream ? `흔들거나 ${K.a}+${K.b} 를 누르면 3초 뒤 첫 컷!` : '카메라를 켜는 중이에요…';
  if (changed && howtoOpen) { howtoOpen = false; document.body.classList.remove('howto-on'); }
  $('hint').innerHTML = HINTS[s];
  if (s !== 'result') stopAutoHome();
  if (changed) {
    document.activeElement?.blur?.();
    const aim = { intro: null, frame: document.querySelector('.frame.sel') || $('start-btn'), result: $('home-btn') }[s];
    setTimeout(() => { if (stage === s) aim ? mouse.warpTo(aim) : mouse.warpTo($('deck')); }, 850);
  }
}

function renderFrames() {
  $('frames').replaceChildren(...FRAMES.map(f => {
    const b = document.createElement('button');
    b.className = 'frame' + (f.id === settings.frame ? ' sel' : '');
    b.style.setProperty('--c', f.bg);
    b.style.setProperty('--k', f.ink);
    b.innerHTML = `<span class="sw"></span>${f.name}`;
    b.onclick = () => pickFrame(f.id);
    return b;
  }));
}
function pickFrame(id) { settings.frame = id; save(); applyFrame(); renderFrames(); }
function stepFrame(d) {
  const i = FRAMES.findIndex(f => f.id === frame().id);
  pickFrame(FRAMES[(i + d + FRAMES.length) % FRAMES.length].id);
}
function applyFrame() {
  const f = frame();
  document.documentElement.style.setProperty('--frame-bg', f.bg);
  document.documentElement.style.setProperty('--frame-ink', f.ink);
}
function renderStrip(nextIndex = -1) {
  // 프레임 화면 미리보기와 촬영 화면 오른쪽 프레임 모두: 찍은 컷을 차례로 채우고, 다음 칸은 깜빡임
  document.querySelectorAll('.strip').forEach(strip => strip.querySelectorAll('.cell').forEach((c, i) => {
    c.classList.toggle('next', i === nextIndex && !shots[i]);
    const src = shots[i]?.url;
    if (!src) { c.replaceChildren(); return; }
    if (c.firstChild?.src !== src) {
      const img = new Image();
      img.src = src;
      img.alt = `${i + 1}번째 컷`;
      c.replaceChildren(img);
    }
  }));
}
const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

// ───────── 효과음 ─────────
let audio;
function beep(freq = 880, dur = 0.12, vol = 0.18) {
  if (!settings.sound) return;
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch { /* 오디오 불가 */ }
}
function shutter() {
  if (!settings.sound) return;
  try {
    audio ||= new AudioContext();
    const len = audio.sampleRate * 0.09, buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = audio.createBufferSource(), g = audio.createGain();
    g.gain.value = 0.35;
    s.buffer = buf;
    s.connect(g).connect(audio.destination);
    s.start();
  } catch { /* 오디오 불가 */ }
}

// ───────── 카메라 ─────────
async function openCamera() {
  try {
    stream?.getTracks().forEach(t => t.stop());
    const video = settings.camId
      ? { deviceId: { exact: settings.camId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } };
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    $('video').srcObject = stream;
    $('intro-video').srcObject = stream;
    await $('video').play();
    $('intro-video').play().then(() => $('intro-video').classList.add('live')).catch(() => {});
    $('placeholder').classList.add('hide');
    const track = stream.getVideoTracks()[0];
    const { width, height } = track.getSettings();
    chip('cam-chip', 'ok', `카메라 ${width || ''}${height ? '×' + height : ''}`);
    track.addEventListener('ended', () => {
      stream = null;
      chip('cam-chip', 'warn', '카메라 끊김');
      $('intro-video').classList.remove('live');
      $('placeholder').classList.remove('hide');
      if (stage === 'shooting') { runId++; clearShots(); setStage('frame'); } else setStage(stage);
    });
    fillCameraList();
    setStage(stage);
  } catch (e) {
    stream = null;
    chip('cam-chip', 'warn', '카메라 오류');
    $('placeholder').classList.remove('hide');
    $('placeholder').querySelector('p').textContent = '카메라를 열 수 없어요';
    setStage(stage);
    toast('카메라를 열 수 없어요. 브라우저 카메라 권한과 다른 앱 사용 여부를 확인해 주세요.', true);
    console.warn(e);
  }
}
async function fillCameraList() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const sel = $('cam-select');
    sel.replaceChildren(new Option('기본 카메라', ''), ...cams.map((c, i) => new Option(c.label || `카메라 ${i + 1}`, c.deviceId)));
    sel.value = settings.camId;
  } catch { /* 목록 불가 */ }
}

// 미리보기(3:2 cover)와 같은 영역을 그대로 잘라냄 → 화면에 보인 그대로 저장
function capture() {
  const v = $('video');
  const c = document.createElement('canvas');
  c.width = SHOT.w;
  c.height = SHOT.h;
  const ctx = c.getContext('2d');
  const z = Math.max(SHOT.w / v.videoWidth, SHOT.h / v.videoHeight);
  const w = v.videoWidth * z, h = v.videoHeight * z;
  if (settings.mirror) { ctx.translate(SHOT.w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(v, (SHOT.w - w) / 2, (SHOT.h - h) / 2, w, h);
  return new Promise(res => c.toBlob(b => res({ blob: b, url: URL.createObjectURL(b) }), 'image/jpeg', 0.92));
}

// ───────── 촬영 ─────────
// 컷마다 '찍기' 신호(흔들기 · A+B · 📸 · Space)를 최대 CUT_LIMIT_SEC 초 기다렸다가 3초 카운트다운 후 촬영
let fireWaiter = null;     // 지금 신호를 기다리는 컷의 resolve
let preFired = false;      // 다른 화면에서 이미 '찍기' 신호를 보냄 → 첫 컷은 바로 카운트다운
function waitFire(alive) {
  if (preFired) { preFired = false; return Promise.resolve('fire'); }
  return new Promise(resolve => {
    const end = Date.now() + CUT_LIMIT_SEC * 1000;
    document.body.classList.add('cue-on');
    const done = why => { clearInterval(t); fireWaiter = null; document.body.classList.remove('cue-on', 'cue-low'); resolve(why); };
    const tick = () => {
      if (!alive()) return done('abort');
      const left = Math.max(0, end - Date.now());
      $('cue-time').textContent = Math.ceil(left / 1000);
      $('cue-bar').style.transform = `scaleX(${left / (CUT_LIMIT_SEC * 1000)})`;
      document.body.classList.toggle('cue-low', left <= 5000);
      if (left <= 0) done('timeout');
    };
    const t = setInterval(tick, 250);
    tick();
    fireWaiter = () => done('fire');
  });
}
// '찍기' 신호 — 어느 화면에서든: 촬영 중이면 이번 컷, 아니면 촬영을 바로 시작
function fire() {
  if (dlg.open) return;
  if (stage === 'shooting') { fireWaiter?.(); return; }
  if (howtoOpen) closeHowto();
  if (stage === 'intro' && !stream) { begin(); return; }   // 카메라부터 켜야 함
  shoot(true);
}

async function shoot(pre = false) {
  if (stage === 'shooting') return;
  if (!stream) { toast('카메라가 아직 준비되지 않았어요', true); openCamera(); return; }
  const id = ++runId;
  clearShots();
  preFired = pre;
  setStage('shooting');
  const alive = () => id === runId && stage === 'shooting';
  try {
    $('shot-badge').textContent = '';
    if (pre) {   // 화면이 넘어오는 동안 "포즈 준비!"
      $('count').classList.add('on', 'ready');
      $('count').innerHTML = '<span>포즈 준비!</span>';
      await sleep(1300);
      $('count').classList.remove('on', 'ready');
    } else {
      await sleep(700);
    }
    for (let i = 0; i < 4; i++) {
      if (!alive()) return;
      renderStrip(i);
      $('shot-badge').textContent = `${i + 1} / 4 컷`;
      mouse.show('dot');
      const why = await waitFire(alive);
      if (why === 'abort' || !alive()) return;
      for (let n = settings.countSec; n >= 1; n--) {
        if (!alive()) return;
        $('count').innerHTML = `<span>${n}</span>`;
        $('count').classList.add('on');
        mouse.show(n <= 5 ? String(n) : 'dot');
        beep(n === 1 ? 1175 : 880);
        await sleep(1000);
      }
      if (!alive()) return;
      $('count').classList.remove('on');
      const shot = await capture();
      shutter();
      const fl = $('flash');
      fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
      mouse.show('heart');
      shots.push(shot);
      renderStrip(i + 1 < 4 ? i + 1 : -1);
      await sleep(i < 3 ? 900 : 500);
    }
    if (!alive()) return;
    $('shot-badge').textContent = '사진 합성 중…';
    await compose();
    showResult();
  } catch (e) {
    console.error(e);
    toast('촬영 중 문제가 생겼어요: ' + e.message, true);
    if (id === runId) setStage('frame');
  } finally {
    if (id === runId) { $('count').classList.remove('on', 'ready'); document.body.classList.remove('cue-on', 'cue-low'); mouse.show('smile'); }
  }
}
function cancelShoot() {
  runId++;
  fireWaiter?.();
  $('count').classList.remove('on', 'ready');
  clearShots();
  setStage('frame');
  mouse.show('smile');
  toast('촬영을 취소했어요');
}
function clearShots() {
  shots.forEach(s => URL.revokeObjectURL(s.url));
  shots = [];
  renderStrip();
}

// ───────── 합성 ─────────
const LOGO_PATHS = {
  frame: new Path2D('M8 46 H154 V76 H757 V220 H118 V188 H8 Z'),
  lambda: new Path2D('M232 189.4 L276 106.6 L320 189.4 L301.3 189.4 L276 141.8 L250.7 189.4 Z'),
};
// 디랩코딩 로고(mark) — 규격 좌표 그대로, 폭 width 로 스케일
function drawLogo(ctx, x, y, width, color) {
  const s = width / 765;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(0, -32);
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = 16;
  ctx.lineJoin = 'miter';
  ctx.stroke(LOGO_PATHS.frame);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 118px PoppinsL';
  ctx.fillText('D', 36, 158.4);
  ctx.fillText('L', 168, 189.4);
  ctx.fillText('B', 330, 189.4);
  ctx.fill(LOGO_PATHS.lambda);
  ctx.beginPath(); ctx.arc(141, 133, 9.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(428, 106.6, 10, 82.8);
  ctx.font = '600 66px PoppinsL';
  ctx.fillText('CODING', 462, 171.1);
  ctx.restore();
}

async function compose() {
  await Promise.allSettled([document.fonts.load('600 118px PoppinsL'), document.fonts.load('800 46px Pretendard'), document.fonts.load('600 34px Pretendard')]);
  const f = frame();
  const c = document.createElement('canvas');
  c.width = OUT.w;
  c.height = OUT.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, OUT.w, OUT.h);

  for (let i = 0; i < 4; i++) {
    const img = new Image();
    img.src = shots[i].url;
    await img.decode();
    const y = OUT.top + i * (OUT.ch + OUT.gap);
    ctx.drawImage(img, OUT.pad, y, OUT.cw, OUT.ch);
  }

  const footTop = OUT.top + 4 * OUT.ch + 3 * OUT.gap;   // 3058
  const logoW = 520, logoH = 198 * logoW / 765;
  drawLogo(ctx, (OUT.w - logoW) / 2, footTop + 92, logoW, f.ink);
  ctx.fillStyle = f.ink;
  ctx.textAlign = 'center';
  ctx.font = "800 46px Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  ctx.fillText('GGF 2026 · 오늘은 내가 주인공!', OUT.w / 2, footTop + 92 + logoH + 104);
  ctx.globalAlpha = 0.6;
  ctx.font = "600 34px Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  ctx.fillText(`디랩네컷  ·  ${today()}`, OUT.w / 2, footTop + 92 + logoH + 166);
  ctx.globalAlpha = 1;

  resultBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
  if (!resultBlob) throw new Error('이미지 합성 실패');
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = URL.createObjectURL(resultBlob);
}

// ───────── 결과 / 공유 ─────────
function showResult() {
  $('final-img').src = resultURL;
  setStage('result');
  upload();
  startAutoHome();
}

// QR 을 브라우저에서 직접 그림 (js/vendor/qrcode.js)
function qrImage(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 2, px = 10, size = (n + m * 2) * px;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1b2733';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) ctx.fillRect((k + m) * px, (r + m) * px, px, px);
  const img = new Image();
  img.src = c.toDataURL('image/png');
  img.alt = '사진 받기 QR 코드';
  return img;
}

// 1순위: 디랩레포트시스템 Firebase Storage (휴대폰 데이터로도 열림)
// 2순위: 노트북 사진 서버(npm start, 같은 와이파이)
async function upload() {
  const blob = resultBlob;
  $('qr').innerHTML = '<span>QR 만드는 중…</span>';
  $('qr-note').textContent = '';
  let fbError;
  try {
    const { url } = await uploadToFirebase(blob);
    window.__lastShareUrl = url;   // 운영 확인용(콘솔에서 마지막 QR 주소 보기)
    if (blob !== resultBlob) return; // 그사이 다음 손님으로 넘어감
    $('qr').replaceChildren(qrImage(url));
    $('qr-note').textContent = `휴대폰 데이터로도 열려요 · 사진은 ${FIREBASE_SHARE.keepDays}일 동안 보관돼요`;
    return;
  } catch (e) {
    fbError = e;
    console.warn('Firebase 업로드 실패', e);
  }
  if (blob !== resultBlob) return;
  try {
    if (serverOK !== true) throw fbError;
    const resp = await fetch(`${apiBase()}/api/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: AbortSignal.timeout(20000) });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `서버 응답 ${resp.status}`);
    const data = await resp.json();
    if (blob !== resultBlob) return;
    $('qr').replaceChildren(qrImage(data.url));
    $('qr-note').textContent = `같은 와이파이에서 열려요 · 사진은 ${data.expiresHours}시간 뒤 자동 삭제돼요`;
  } catch (e) {
    if (blob !== resultBlob) return;
    const retry = document.createElement('button');
    retry.className = 'btn primary';
    retry.textContent = 'QR 다시 시도';
    retry.onclick = upload;
    const msg = document.createElement('span');
    msg.textContent = '사진 전송에 실패했어요';
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:center';
    box.append(msg, retry);
    $('qr').replaceChildren(box);
    $('qr-note').textContent = `인터넷 연결을 확인하거나 PC에 저장을 이용해 주세요 (${e.message})`;
  }
}

function download() {
  if (!resultURL) return;
  const d = new Date();
  const stamp = `${today().replaceAll('.', '')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = resultURL;
  a.download = `DLAB_FOURCUTS_${stamp}.jpg`;
  a.click();
  toast('PC에 저장했어요');
}

function goHome() {
  runId++;
  fireWaiter?.();
  $('count').classList.remove('on', 'ready');
  clearShots();
  resultBlob = null;
  setStage('intro');
}
// 시작 화면 → 프레임 화면. 카메라가 아직이면 이때 켬(사용자 조작이 있어야 권한 창이 뜸)
function begin() {
  if (howtoOpen) closeHowto();
  if (stage !== 'intro') return;
  if (!stream) openCamera();
  setStage('frame');
}
// 사용법 안내창: 시작 화면에서 B(다음) → 안내 → B → 프레임 화면, A → 닫기
let howtoOpen = false;
function openHowto() {
  if (stage !== 'intro' || howtoOpen) return;
  howtoOpen = true;
  lastInput = Date.now();
  document.body.classList.add('howto-on');
  $('hint').innerHTML = `${K.b} 시작하기 ${K.sep} ${K.a} 닫기 ${K.sep} ${FIRE} 바로 촬영`;
  if (!stream) openCamera();   // 안내를 읽는 동안 카메라 준비
}
function closeHowto() {
  if (!howtoOpen) return;
  howtoOpen = false;
  document.body.classList.remove('howto-on');
  $('hint').innerHTML = HINTS[stage];
}

const AUTO_HOME_SEC = 60;
const IDLE_HOME_SEC = 60;   // 프레임 화면에서 아무 조작이 없으면 처음으로
function startAutoHome() {
  stopAutoHome();
  let left = AUTO_HOME_SEC;
  const tick = () => {
    $('auto-home').textContent = `${left}초 뒤 처음 화면으로 돌아가요`;
    if (left-- <= 0) goHome();
  };
  tick();
  autoHomeTimer = setInterval(tick, 1000);
}
function stopAutoHome() { clearInterval(autoHomeTimer); autoHomeTimer = null; $('auto-home').textContent = ''; }

// ───────── micro:bit ─────────
const mouse = new MicrobitMouse($('cursor'), settings);

mouse.addEventListener('status', ({ detail }) => {
  const map = {
    connecting: ['warn', '연결 중…', `${detail.name || 'micro:bit'}에 연결하는 중…`],
    connected: ['ok', 'micro:bit 연결됨', `${detail.name} 연결됨${detail.missing?.length ? ` (없는 서비스: ${detail.missing.join(', ')})` : ''}`],
    disconnected: ['warn', 'micro:bit 재연결 중', '연결이 끊겼어요. 자동으로 다시 연결하는 중…'],
    lost: ['', 'micro:bit 미연결', '연결 안 됨 — 다시 연결을 눌러 주세요'],
    simulating: ['ok', '가상 micro:bit', '가상 micro:bit 사용 중 (A·B 키, 두 키 동시 = A+B, Z = 흔들기)'],
  };
  const [cls, short, long] = map[detail.state] || map.lost;
  chip('ble-chip', cls, short);
  $('ble-state').textContent = long;
  $('ble-btn').textContent = detail.state === 'connected' ? '연결 끊기' : 'ᛒ 블루투스 연결';
  if (detail.state === 'connected') toast('micro:bit 연결 완료! A 이전 · B 다음 · 흔들면 찰칵');
});

// micro:bit: A=이전, B=다음, A+B 동시·흔들기=촬영 (기울이기 커서는 쓰지 않음)
mouse.addEventListener('press', ({ detail: { which, target } }) => {
  touch();
  const dlg = $('settings');
  if (dlg.open) {   // 설정창(운영자용, 마우스로 조작): B=닫기
    if (which === 'B') dlg.close();
    return;
  }
  if (which === 'AB') fire();
  else if (which === 'A') prev();
  else if (which === 'B') next();
});
mouse.addEventListener('shake', () => { touch(); fire(); });

// 화면별 이전/다음 — micro:bit A/B, 키보드 ←/→ 가 같은 동작
function next() {
  if (howtoOpen) { begin(); return; }
  if (stage === 'intro') openHowto();
  else if (stage === 'frame') stepFrame(1);   // 프레임 화면: B = 다음 색
  else if (stage === 'shooting') fire();      // 촬영 중 '다음' = 이번 컷 찍기
  else if (stage === 'result') goHome();
}
function prev() {
  if (howtoOpen) { closeHowto(); return; }
  if (stage === 'shooting') cancelShoot();
  else if (stage === 'frame') stepFrame(-1);   // 프레임 화면: A = 이전 색
  else if (stage === 'result') shoot(false);  // 다시 찍기(같은 프레임)
}
function touch() {
  lastInput = Date.now();
  if (stage === 'result') startAutoHome();     // 누군가 조작 중이면 자동 복귀 연장
}
setInterval(() => {
  if (stage === 'frame' && !dlg.open && Date.now() - lastInput > IDLE_HOME_SEC * 1000) goHome();
  if (howtoOpen && Date.now() - lastInput > IDLE_HOME_SEC * 1000) closeHowto();
}, 1000);

async function toggleBLE(all = false) {
  if (mouse.connected && !all) { mouse.disconnect(); return; }
  try { await mouse.connect(all); } catch (e) {
    if (e.name === 'NotFoundError') return; // 사용자가 선택창을 닫음
    chip('ble-chip', '', 'micro:bit 미연결');
    const why = e.name === 'SecurityError'
      ? '이 화면에서는 블루투스를 쓸 수 없어요. Chrome/Edge 새 탭에서 https://ohmycoding1.github.io/dlab-4cut/ 를 직접 열어 주세요.'
      : e.message;
    $('ble-state').textContent = why;
    toast('블루투스 연결 실패: ' + why, true, 8000);
  }
}

// 커서가 모달(dialog) 위에서도 보이도록 대화상자 안으로 옮김(top layer)
const dlg = $('settings');
function openSettings() { dlg.showModal(); dlg.append($('cursor')); }
dlg.addEventListener('close', () => document.body.append($('cursor')));

// ───────── 이벤트 연결 ─────────
$('intro').addEventListener('click', () => next());
$('howto').addEventListener('click', () => begin());
$('start-btn').onclick = () => shoot(true);
$('shutter-btn').onclick = fire;
$('download-btn').onclick = download;
$('retry-btn').onclick = () => shoot(false);
$('home-btn').onclick = goHome;
$('settings-btn').onclick = openSettings;
$('cam-chip').onclick = () => (stream ? openSettings() : openCamera());
$('ble-chip').onclick = () => (mouse.connected ? openSettings() : toggleBLE(false));
$('ble-btn').onclick = () => toggleBLE(false);
$('ble-all-btn').onclick = () => toggleBLE(true);
$('calib-btn').onclick = () => { mouse.calibrate(); toast('지금 자세를 기준으로 맞췄어요'); };
$('fs-btn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

function bindSetting(id, key, prop = 'checked', cast = v => v) {
  const el = $(id);
  el[prop] = settings[key];
  el.addEventListener('change', () => { settings[key] = cast(el[prop]); save(); onSettingChange(key); });
}
function onSettingChange(key) {
  if (key === 'sensitivity') $('sens-out').textContent = settings.sensitivity;
  if (key === 'mirror') document.body.classList.toggle('mirror', settings.mirror);
  if (key === 'simulate') mouse.setSimulate(settings.simulate);
  if (key === 'camId' && stream) openCamera();
}
bindSetting('sens', 'sensitivity', 'value', Number);
bindSetting('inv-x', 'invertX');
bindSetting('inv-y', 'invertY');
bindSetting('sound', 'sound');
bindSetting('mirror', 'mirror');
bindSetting('sim', 'simulate');
bindSetting('count-sec', 'countSec', 'value', Number);
bindSetting('cam-select', 'camId', 'value');
['sensitivity', 'mirror'].forEach(onSettingChange);
if (settings.simulate) mouse.setSimulate(true);

addEventListener('keydown', e => {
  if (e.target.closest?.('select, input')) return;
  if (dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
  touch();
  if (mouse.simKey(e, true)) { e.preventDefault(); return; }
  const k = e.key;
  if (k === ' ') { e.preventDefault(); if (!e.repeat) fire(); return; }                       // 촬영
  if (k === 'Enter' || k === 'ArrowRight') { e.preventDefault(); if (!e.repeat) next(); return; }
  if ((k === 'Escape' || k === 'Backspace') && stage === 'frame') { e.preventDefault(); goHome(); return; }
  if (k === 'Escape' || k === 'Backspace' || k === 'ArrowLeft') { e.preventDefault(); if (!e.repeat) prev(); return; }
  if (stage === 'frame' && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); stepFrame(k === 'ArrowUp' ? -1 : 1); return; }
  if (stage === 'frame' && k >= '1' && k <= String(FRAMES.length)) { pickFrame(FRAMES[k - 1].id); return; }
  if (stage === 'result' && (k === 's' || k === 'S')) { download(); return; }
  if (stage === 'intro' && !howtoOpen && k.length === 1) { openHowto(); return; }    // 시작 화면은 아무 키나
});
addEventListener('keyup', e => mouse.simKey(e, false));
addEventListener('pointerdown', touch);

// ───────── 시작 ─────────
document.querySelectorAll('.strip-date').forEach(el => { el.textContent = `GGF 2026 · ${today()}`; });
applyFrame();
renderFrames();
setStage('intro');

function checkServer() {
  serverOK = null;
  const fb = `1순위: <b>디랩레포트시스템 Firebase</b>(<code>${FIREBASE_SHARE.bucket}</code>)에 올리고 QR로 <code>p.html</code> 사진 받기 페이지를 열어요. 휴대폰 데이터로도 열려요.`;
  $('share-info').innerHTML = fb + '<br>2순위 사진 서버 확인 중…';
  fetch(`${apiBase()}/api/health`, { signal: AbortSignal.timeout(6000) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(h => {
    serverOK = true;
    $('share-info').innerHTML = fb + `<br>2순위(Firebase 실패 시): 노트북 사진 서버 <code>${h.shareBase}</code> — 같은 와이파이에서만 열려요.`;
  }).catch(() => {
    serverOK = false;
    $('share-info').innerHTML = fb + '<br>2순위 노트북 사진 서버는 없음(선택 사항).';
  });
}
checkServer();
$('api-base').value = settings.apiBase;
$('api-base').addEventListener('change', () => { settings.apiBase = $('api-base').value.trim(); save(); checkServer(); });

// 이미 카메라 권한이 있으면 바로 켜기, 이미 허용한 micro:bit 는 자동 재연결
navigator.permissions?.query({ name: 'camera' }).then(p => { if (p.state === 'granted') openCamera(); }).catch(() => {});
mouse.reconnectKnown().catch(() => {});
