// 휴대폰 사진 전달 설정 — 디랩레포트시스템(Firebase 프로젝트 dlab-sc-feedback)의 Storage 를 사용
//  · 포토부스가 완성 사진을 fourcuts/<무작위ID>.jpg 로 업로드 (로그인 없이, 새 파일 만들기만 허용)
//  · QR 은 사진 받기 페이지(p.html?id=...)를 가리키고, 그 페이지가 Storage 에서 사진을 불러옴
//  · 허용 규칙은 dlab-feedback 저장소의 storage.rules (match /fourcuts/{file}) 에 있음
export const FIREBASE_SHARE = {
  host: 'https://firebasestorage.googleapis.com',
  bucket: 'dlab-sc-feedback.firebasestorage.app',
  folder: 'fourcuts',
  // QR 로 열릴 사진 받기 페이지. 비우면 지금 페이지와 같은 폴더의 p.html
  // (localhost 로 띄운 노트북에서도 휴대폰이 열 수 있도록 공개 주소를 기본값으로 둠)
  viewer: 'https://ohmycoding1.github.io/dlab-4cut/p.html',
  keepDays: 7,
};

export const isPhotoId = id => /^[A-Za-z0-9]{24}$/.test(id || '');
export const photoURL = id =>
  `${FIREBASE_SHARE.host}/v0/b/${FIREBASE_SHARE.bucket}/o/${encodeURIComponent(`${FIREBASE_SHARE.folder}/${id}.jpg`)}?alt=media`;

export function newPhotoId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const r = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(r, b => abc[b % 62]).join('');
}

// 로그인 없이 Firebase Storage REST 로 바로 업로드 (SDK 불필요)
// SDK 와 같은 multipart 방식: 메타데이터(JSON)에 contentType 을 실어야 규칙의 image/jpeg 검사를 통과함
export async function uploadToFirebase(blob) {
  const id = newPhotoId();
  const name = `${FIREBASE_SHARE.folder}/${id}.jpg`;
  const boundary = 'dlab4cut' + id;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`,
    JSON.stringify({ name, contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' }),
    `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const url = `${FIREBASE_SHARE.host}/v0/b/${FIREBASE_SHARE.bucket}/o?name=${encodeURIComponent(name)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Firebase 응답 ${resp.status}`);
  }
  const viewer = FIREBASE_SHARE.viewer || new URL('p.html', location.href).href;
  return { id, url: `${viewer}?id=${id}` };
}
