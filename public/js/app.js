'use strict';
import { MicrobitMouse } from './microbit.js';

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

let stream = null;
let stage = 'idle';
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
function setStage(s) {
  stage = s;
  document.body.dataset.stage = s;
  $('start-btn').disabled = !stream || s !== 'idle';
  $('shoot-msg').textContent = s === 'shooting' ? '화면을 보고 포즈! B를 누르면 취소돼요' : stream ? '포즈를 바꿔 가며 4번 찍어요' : '먼저 카메라를 켜 주세요';
  if (s !== 'result') stopAutoHome();
}

function renderFrames() {
  $('frames').replaceChildren(...FRAMES.map(f => {
    const b = document.createElement('button');
    b.className = 'frame' + (f.id === settings.frame ? ' sel' : '');
    b.style.setProperty('--c', f.bg);
    b.style.setProperty('--k', f.ink);
    b.innerHTML = `<span class="sw"></span>${f.name}`;
    b.onclick = () => { settings.frame = f.id; save(); applyFrame(); renderFrames(); };
    return b;
  }));
}
function applyFrame() {
  const f = frame();
  document.documentElement.style.setProperty('--frame-bg', f.bg);
  document.documentElement.style.setProperty('--frame-ink', f.ink);
}
function renderStrip(nextIndex = -1) {
  document.querySelectorAll('#strip .cell').forEach((c, i) => {
    c.classList.toggle('next', i === nextIndex);
    const src = shots[i]?.url;
    if (!src) { c.replaceChildren(); return; }
    if (c.firstChild?.src !== src) {
      const img = new Image();
      img.src = src;
      img.alt = `${i + 1}번째 컷`;
      c.replaceChildren(img);
    }
  });
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
    await $('video').play();
    $('placeholder').classList.add('hide');
    const track = stream.getVideoTracks()[0];
    const { width, height } = track.getSettings();
    chip('cam-chip', 'ok', `카메라 ${width || ''}${height ? '×' + height : ''}`);
    track.addEventListener('ended', () => { stream = null; chip('cam-chip', 'warn', '카메라 끊김'); $('placeholder').classList.remove('hide'); setStage(stage === 'shooting' ? 'idle' : stage); });
    fillCameraList();
    setStage(stage);
  } catch (e) {
    stream = null;
    chip('cam-chip', 'warn', '카메라 오류');
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
async function shoot() {
  if (!stream || stage !== 'idle') return;
  const id = ++runId;
  clearShots();
  setStage('shooting');
  const alive = () => id === runId && stage === 'shooting';
  try {
    for (let i = 0; i < 4; i++) {
      renderStrip(i);
      $('shot-badge').textContent = `${i + 1} / 4 컷`;
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
      await sleep(i < 3 ? 1100 : 500);
    }
    if (!alive()) return;
    $('shot-badge').textContent = '사진 합성 중…';
    await compose();
    showResult();
  } catch (e) {
    console.error(e);
    toast('촬영 중 문제가 생겼어요: ' + e.message, true);
    if (id === runId) setStage('idle');
  } finally {
    if (id === runId) { $('count').classList.remove('on'); mouse.show('smile'); }
  }
}
function cancelShoot() {
  runId++;
  $('count').classList.remove('on');
  clearShots();
  setStage('idle');
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
  mouse.warpTo($('home-btn'));
  upload();
  startAutoHome();
}

async function upload() {
  const blob = resultBlob;
  if (serverOK === false) {
    $('qr').innerHTML = '<span>QR 전달은 사진 서버가 필요해요.<br><b>PC에 저장</b>을 이용해 주세요.</span>';
    $('qr-note').textContent = '운영자: ⚙ 설정 → 사진 서버 주소를 지정하면 QR이 켜져요';
    return;
  }
  $('qr').innerHTML = '<span>QR 만드는 중…</span>';
  $('qr-note').textContent = '';
  try {
    const resp = await fetch(`${apiBase()}/api/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: AbortSignal.timeout(20000) });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `서버 응답 ${resp.status}`);
    const data = await resp.json();
    if (blob !== resultBlob) return; // 그사이 다음 손님으로 넘어감
    const img = new Image();
    img.src = data.qr;
    img.alt = '사진 받기 QR 코드';
    $('qr').replaceChildren(img);
    $('qr-note').textContent = `사진은 ${data.expiresHours}시간 뒤 자동 삭제돼요`;
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
    $('qr-note').textContent = `와이파이·서버를 확인해 주세요 (${e.message})`;
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
  clearShots();
  resultBlob = null;
  setStage('idle');
  if (stream) mouse.warpTo($('start-btn'));
}

const AUTO_HOME_SEC = 90;
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
    simulating: ['ok', '가상 micro:bit', '가상 micro:bit 사용 중 (방향키로 기울이기, A·B 키)'],
  };
  const [cls, short, long] = map[detail.state] || map.lost;
  chip('ble-chip', cls, short);
  $('ble-state').textContent = long;
  $('ble-btn').textContent = detail.state === 'connected' ? '연결 끊기' : 'ᛒ 블루투스 연결';
  if (detail.state === 'connected') toast('micro:bit 연결 완료! 기울여서 커서를 움직여 보세요');
});

mouse.addEventListener('press', ({ detail: { which, target } }) => {
  if (stage === 'result') startAutoHome();     // 누군가 조작 중이면 자동 복귀 연장
  const dlg = $('settings');
  if (which === 'B') {
    if (dlg.open) dlg.close();
    else if (stage === 'shooting') cancelShoot();
    else if (stage === 'result') goHome();
    return;
  }
  // A: 커서 아래 버튼을 클릭. 아무것도 없으면 상황별 기본 동작
  if (target) { target.click(); return; }
  if (stage === 'idle' && !dlg.open) shoot();
});

async function toggleBLE() {
  if (mouse.connected) { mouse.disconnect(); return; }
  try { await mouse.connect(); } catch (e) {
    if (e.name === 'NotFoundError') return; // 사용자가 선택창을 닫음
    chip('ble-chip', '', 'micro:bit 미연결');
    $('ble-state').textContent = e.message;
    toast('블루투스 연결 실패: ' + e.message, true, 6000);
  }
}

// 커서가 모달(dialog) 위에서도 보이도록 대화상자 안으로 옮김(top layer)
const dlg = $('settings');
function openSettings() { dlg.showModal(); dlg.append($('cursor')); }
dlg.addEventListener('close', () => document.body.append($('cursor')));

// ───────── 이벤트 연결 ─────────
$('camera-btn').onclick = openCamera;
$('start-btn').onclick = shoot;
$('download-btn').onclick = download;
$('retry-btn').onclick = () => { goHome(); shoot(); };
$('home-btn').onclick = goHome;
$('settings-btn').onclick = openSettings;
$('cam-chip').onclick = () => (stream ? openSettings() : openCamera());
$('ble-chip').onclick = () => (mouse.connected ? openSettings() : toggleBLE());
$('ble-btn').onclick = toggleBLE;
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
  if (mouse.simKey(e, true)) { e.preventDefault(); return; }
  if (e.key === 'Enter' && stage === 'idle' && !dlg.open) shoot();
  if (e.key === 'Escape' && stage === 'shooting') cancelShoot();
});
addEventListener('keyup', e => mouse.simKey(e, false));

// ───────── 시작 ─────────
$('strip-date').textContent = `GGF 2026 · ${today()}`;
applyFrame();
renderFrames();
setStage('idle');

function checkServer() {
  serverOK = null;
  $('share-info').textContent = '확인 중…';
  fetch(`${apiBase()}/api/health`, { signal: AbortSignal.timeout(6000) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(h => {
  serverOK = true;
  const local = /^http:\/\/(\d+\.){3}\d+/.test(h.shareBase);
  $('share-info').innerHTML = `QR 주소: <code>${h.shareBase}</code><br>` + (local
    ? '휴대폰이 <b>이 노트북과 같은 와이파이</b>에 있어야 열려요. 행사장 와이파이가 기기 간 통신을 막으면 <code>PUBLIC_BASE_URL</code>로 공개 주소를 지정하세요.'
    : '이 주소로 휴대폰에서 사진을 받아요.');
}).catch(() => {
  serverOK = false;
  $('share-info').innerHTML = '사진 서버에 연결할 수 없어요. 촬영·PC 저장은 되지만 <b>QR 전달은 꺼져요</b>.<br>노트북에서 <code>npm start</code>로 실행하거나, 아래에 서버 주소를 넣으세요.';
});
}
checkServer();
$('api-base').value = settings.apiBase;
$('api-base').addEventListener('change', () => { settings.apiBase = $('api-base').value.trim(); save(); checkServer(); });

// 이미 카메라 권한이 있으면 바로 켜기, 이미 허용한 micro:bit 는 자동 재연결
navigator.permissions?.query({ name: 'camera' }).then(p => { if (p.state === 'granted') openCamera(); }).catch(() => {});
mouse.reconnectKnown().catch(() => {});
