'use strict';
const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const TTL_HOURS = Number(process.env.PHOTO_TTL_HOURS || 24);
const TTL = TTL_HOURS * 3600 * 1000;
const MAX_BYTES = 12 * 1024 * 1024;
// 휴대폰이 열 수 있는 주소. 비우면 요청 Host 기준(localhost 접속이면 같은 와이파이 LAN IP로 대체).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const UPLOADS_PER_MIN = Number(process.env.UPLOADS_PER_MIN || 20);

const photosDir = path.join(__dirname, '.photos');
fs.mkdirSync(photosDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
// 리버스 프록시(HTTPS 종료) 뒤에서 req.protocol 을 https 로 인식하려면 TRUST_PROXY=1
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); },
}));

const ID_RE = /^[a-f0-9]{32}$/;
const FILE_RE = /^([a-f0-9]{32})\.(png|jpg)$/;
const TYPES = { png: 'image/png', jpg: 'image/jpeg' };

function sniff(buf) {
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (buf.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpg';
  return null;
}

async function findPhoto(id) {
  for (const ext of ['jpg', 'png']) {
    const file = path.join(photosDir, `${id}.${ext}`);
    try {
      const st = await fsp.stat(file);
      if (Date.now() - st.mtimeMs <= TTL) return { file, ext };
    } catch { /* 없음 */ }
  }
  return null;
}

async function clean() {
  try {
    for (const name of await fsp.readdir(photosDir)) {
      if (!FILE_RE.test(name)) continue;
      const file = path.join(photosDir, name);
      const st = await fsp.stat(file).catch(() => null);
      if (st && Date.now() - st.mtimeMs > TTL) await fsp.unlink(file).catch(() => {});
    }
  } catch (e) { console.warn('cleanup:', e.message); }
}
clean();
setInterval(clean, 30 * 60 * 1000).unref();

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

function baseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const host = req.get('host') || `localhost:${PORT}`;
  const [hostname, port] = host.split(':');
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    const ip = lanAddress();
    if (ip) return `http://${ip}${port ? ':' + port : ''}`;
  }
  return `${req.protocol}://${host}`;
}

// 아주 단순한 IP별 업로드 제한(행사장 남용 방지)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > UPLOADS_PER_MIN;
}
setInterval(() => { const now = Date.now(); for (const [ip, arr] of hits) if (!arr.some(t => now - t < 60_000)) hits.delete(ip); }, 60_000).unref();

app.get('/api/health', (req, res) => res.json({ ok: true, ttlHours: TTL_HOURS, shareBase: baseUrl(req) }));

app.post('/api/photos', express.raw({ type: ['image/png', 'image/jpeg'], limit: MAX_BYTES }), async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (rateLimited(req.ip)) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
    const body = req.body;
    const ext = Buffer.isBuffer(body) && body.length > 100 ? sniff(body) : null;
    if (!ext) return res.status(400).json({ error: '유효한 PNG/JPEG 이미지만 업로드할 수 있어요.' });
    const id = crypto.randomBytes(16).toString('hex');
    await fsp.writeFile(path.join(photosDir, `${id}.${ext}`), body, { flag: 'wx', mode: 0o600 });
    const url = `${baseUrl(req)}/p/${id}`;
    const qr = await QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1b2733', light: '#ffffff' } });
    res.status(201).json({ id, url, qr, expiresHours: TTL_HOURS });
  } catch (e) { next(e); }
});

const pageStyle = `*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;background:#11161f;color:#f4f1ea;display:flex;justify-content:center;padding:28px 18px 40px}main{width:100%;max-width:420px;text-align:center}.tag{display:inline-block;font-size:12px;letter-spacing:.2em;color:#ffd54a;font-weight:800}h1{font-size:28px;margin:8px 0 6px;letter-spacing:-.02em}p{margin:0 0 22px;color:#aab3c2;line-height:1.6}img{width:100%;border-radius:6px;box-shadow:0 18px 50px #0008;display:block}a.save{display:block;margin:22px 0 0;padding:17px;border-radius:14px;background:#ffd54a;color:#1b2733;font-weight:900;font-size:17px;text-decoration:none}small{display:block;margin-top:16px;color:#7d8798;line-height:1.6;font-size:12px}`;

app.get('/p/:id', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const id = req.params.id;
    const photo = ID_RE.test(id) ? await findPhoto(id) : null;
    const head = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>디랩네컷 사진 받기</title><style>${pageStyle}</style></head><body><main>`;
    if (!photo) return res.status(404).type('html').send(`${head}<span class="tag">D·LAB FOUR CUTS</span><h1>링크가 만료되었어요</h1><p>사진은 ${TTL_HOURS}시간 동안만 보관돼요.</p></main></body></html>`);
    const src = `/photo/${id}.${photo.ext}`;
    res.type('html').send(`${head}<span class="tag">D·LAB FOUR CUTS</span><h1>네컷 사진이 도착했어요 📸</h1><p>아래 버튼을 누르거나, 사진을 길게 눌러 저장하세요.</p><img src="${src}" alt="나의 디랩네컷"><a class="save" href="${src}" download="DLAB_FOUR_CUTS.${photo.ext}">사진 저장하기</a><small>사진은 ${TTL_HOURS}시간 후 자동 삭제됩니다.<br>디랩코딩학원 · GGF 2026</small></main></body></html>`);
  } catch (e) { next(e); }
});

app.get('/photo/:file', async (req, res, next) => {
  try {
    const m = FILE_RE.exec(req.params.file);
    const photo = m ? await findPhoto(m[1]) : null;
    if (!photo || photo.ext !== m[2]) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.type(TYPES[photo.ext]).sendFile(photo.file);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: '이미지는 12MB 이하만 업로드할 수 있어요.' });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했어요.' });
});

app.listen(PORT, () => {
  const ip = lanAddress();
  console.log(`디랩네컷 실행: http://localhost:${PORT}`);
  console.log(PUBLIC_BASE_URL ? `QR 공유 주소: ${PUBLIC_BASE_URL}` : ip ? `QR 공유 주소(같은 와이파이): http://${ip}:${PORT}` : 'LAN 주소를 찾지 못했어요. PUBLIC_BASE_URL 을 설정하세요.');
});
