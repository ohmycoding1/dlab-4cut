# 디랩네컷 · GGF 2026

micro:bit를 **에어 마우스**처럼 들고 기울여서 조작하는 네컷 포토부스 웹앱입니다.
카메라 촬영 → 1200×3600 네컷 합성 → QR로 휴대폰 저장까지 한 화면에서 끝납니다.

```
micro:bit ──BLE──▶ 브라우저(Chrome/Edge) ──업로드──▶ 디랩레포트시스템 Firebase Storage ──QR──▶ 손님 휴대폰(p.html)
 A = 이전 / B = 다음          카메라·합성                  fourcuts/<무작위ID>.jpg (7일 보관)
 흔들기·A+B = 촬영
```

## 실행

```bash
npm install
npm start
```

촬영 노트북의 Chrome/Edge에서 `http://localhost:3000`을 엽니다. 카메라와 Web Bluetooth는 `localhost` 또는 HTTPS에서만 동작합니다.

## micro:bit 준비

### 방법 A — hex 바로 넣기 (micro:bit V2)

1. GitHub → **Actions** → **micro:bit 펌웨어 빌드** → 최근 실행 → 아래 **Artifacts**의 `dlab-fourcuts-microbit-hex`를 내려받습니다.
2. 압축을 풀어 나온 `dlab-fourcuts-v2.hex`를 USB로 연결한 `MICROBIT` 드라이브에 끌어다 놓습니다.
3. LED에 카메라 모양이 뜨면 준비 완료입니다. 페어링 없이 바로 연결됩니다.

펌웨어 소스는 [`firmware/codal/`](firmware/codal/)에 있습니다(CODAL C++, V2 전용). 소스를 고쳐 푸시하면 자동으로 다시 빌드되고, Actions 탭에서 **Run workflow**로 수동 실행할 수도 있습니다.

### 방법 B — MakeCode로 만들기 (V1·V2 모두)

1. [makecode.microbit.org](https://makecode.microbit.org)에서 새 프로젝트를 만들고, 확장 프로그램에서 **bluetooth**를 추가합니다.
2. **JavaScript** 탭에 [`firmware/dlab-fourcuts.ts`](firmware/dlab-fourcuts.ts)를 붙여넣습니다.
3. ⚙ **프로젝트 설정** → **No Pairing Required: Anyone can connect via Bluetooth**를 선택합니다. Windows에서 페어링 문제를 피하려면 꼭 필요합니다.
4. 다운로드한 파일을 micro:bit에 복사합니다. LED에 카메라 모양이 뜨면 준비된 것입니다.
5. 웹앱 상단의 **micro:bit 미연결** 칩(또는 ⚙ → 블루투스 연결)을 눌러 `BBC micro:bit [...]`을 고릅니다.

> micro:bit V1에서 메모리 부족 오류(020)가 나면 펌웨어의 `startLEDService()` 줄을 지우세요. LED 카운트다운만 빠지고 나머지는 그대로 동작합니다.

### 조작

화면은 **시작 → 프레임 → 촬영 → 완성** 4장이 한 장씩 넘어가는 구성이고, 스크롤은 없습니다.
micro:bit는 **A = 이전, B = 다음, 흔들기 또는 A+B 동시 = 촬영** 세 가지만 기억하면 됩니다.

| 화면 | A (이전) · ← · Esc | B (다음) · → · Enter | 흔들기 · A+B · Space · 📸 |
|---|---|---|---|
| 시작 | — | 프레임 화면으로(카메라도 이때 켜짐) | 바로 촬영 시작 |
| 프레임 | 처음으로 | 촬영 화면으로 | 바로 촬영 시작 |
| 촬영 | 촬영 취소 | 이번 컷 찍기 | 이번 컷 찍기 |
| 완성 | 다시 찍기 | 처음으로 | 다시 찍기(바로 카운트다운) |

- **촬영:** 컷마다 '찍기' 신호를 기다립니다. 신호가 오면 **3초 카운트다운 뒤 촬영**하고, **30초** 동안 신호가 없으면 자동으로 카운트다운을 시작합니다. 남은 시간은 카메라 화면 아래 막대로 보입니다.
- **프레임 고르기:** micro:bit를 기울여 커서로 프레임 카드를 가리키면 바로 선택됩니다. 키보드는 ↑/↓ 또는 1~4.
- **A+B 판정:** 두 버튼을 0.25초 안에 누르거나, 한 버튼을 누른 채 다른 버튼을 누르면 A+B로 봅니다. 그래서 A·B 단독 입력은 0.25초 늦게 반영됩니다.
- **흔들기 판정:** 0.7초 안에 큰 가속도(약 1.9g 이상 또는 거의 0g)가 4번 이상 잡히면 흔들기로 보고, 1.8초 동안은 다시 반응하지 않습니다. 펌웨어는 그대로이고 브라우저가 가속도 값으로 판단합니다.
- 프레임 화면에서 60초 동안 조작이 없거나 완성 화면이 60초 지나면 처음 화면으로 돌아갑니다.
- 기울이기 커서는 살짝 기울이면 천천히, 많이 기울이면 빠르게 움직입니다. 설정창(⚙)에서는 A가 커서 아래 버튼을 누르고 B가 창을 닫습니다.
- 연결되면 그때 들고 있는 자세가 "정지" 기준이 됩니다. 커서가 혼자 흘러가면 ⚙ → **지금 자세를 기준으로**를 누릅니다.
- 방향이 반대로 움직이면 ⚙에서 **좌우 반전/상하 반전**을 켭니다. 커서 속도는 1~5단계로 조절합니다.
- 연결이 끊기면 자동으로 다시 연결합니다. Chrome에서 새로고침했을 때는 이미 허용한 장치로 자동 재연결을 시도합니다.
- 리모컨 없이 리허설할 때는 ⚙ → **가상 micro:bit**를 켭니다. 방향키로 기울이기를 흉내 내고, A/B 키가 버튼(두 키 동시 = A+B), Z 키가 흔들기 역할을 합니다.
- 일반 마우스와 키보드(→/Enter = 다음, ←/Esc = 이전, Space = 촬영)도 항상 함께 쓸 수 있습니다.

## 사진 QR 전달

### 기본: 디랩레포트시스템 Firebase (휴대폰 데이터로도 열림)

1. 완성 화면이 뜨면 사진을 디랩레포트시스템(Firebase 프로젝트 `dlab-sc-feedback`)의 Storage에 `fourcuts/<무작위 24자>.jpg`로 올립니다. 로그인이나 API 키는 필요 없습니다.
2. QR은 브라우저에서 바로 그리고, **사진 받기 페이지** `https://ohmycoding1.github.io/dlab-4cut/p.html?id=...`를 가리킵니다.
3. 손님 휴대폰에서 이 페이지를 열면 사진과 **사진 저장하기** 버튼(공유 시트 → 사진 앱 저장)이 나옵니다.

설정은 [`public/js/share-config.js`](public/js/share-config.js)에 있습니다(버킷, 폴더, 사진 받기 페이지 주소, 보관 일수 표시).

**처음 한 번 해야 할 일 (디랩레포트시스템 쪽)**

- **Storage 규칙 배포:** `ohmycoding1/dlab-feedback`의 `storage.rules`에 `match /fourcuts/{file}` 규칙이 있어야 합니다. 로그인 없이 **새 파일 만들기만** 허용하고(24자 이름의 JPEG, 8MB 미만, 덮어쓰기·삭제 불가), 읽기는 **이름을 아는 단건만** 허용합니다(목록 조회 불가). 그 저장소 `main`에 들어가면 배포 워크플로가 Storage 규칙도 함께 배포합니다. 바로 배포하려면 그 저장소에서 `firebase deploy --only storage --project dlab-sc-feedback`.
- **7일 뒤 자동 삭제:** 버킷 수명 주기 규칙으로 `fourcuts/`만 지웁니다. 아래 명령은 버킷의 기존 수명 주기 설정을 **덮어쓰므로**, 먼저 `gcloud storage buckets describe gs://dlab-sc-feedback.firebasestorage.app --format="default(lifecycle_config)"`로 기존 규칙이 없는지 확인하세요.

  ```bash
  echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7,"matchesPrefix":["fourcuts/"]}}]}' > lifecycle.json
  gcloud storage buckets update gs://dlab-sc-feedback.firebasestorage.app --lifecycle-file=lifecycle.json
  ```

- **사진 받기 페이지:** `p.html`은 이 저장소의 GitHub Pages로 배포되므로 이 변경이 `main`에 들어가야 QR이 열립니다.
- 디랩레포트시스템에서 Storage에 **App Check 강제**를 켜 두었다면 로그인 없는 업로드가 막힙니다. 그때는 강제를 끄거나 2순위 사진 서버를 씁니다.

### 2순위: 노트북 사진 서버 (같은 와이파이)

Firebase 업로드가 실패하면 `npm start`로 띄운 노트북 사진 서버로 올립니다(서버가 있을 때만).

- **`localhost`로 접속해도 QR에는 노트북의 LAN 주소**(예: `http://192.168.0.12:3000/p/...`)가 들어갑니다. 따라서 **같은 와이파이에 있는 휴대폰**에서만 열립니다. 실제 주소는 ⚙ → QR 공유에서 확인할 수 있습니다.
- 행사장 와이파이가 기기 간 통신을 막으면(게스트망에서 흔함) 공개 주소로 배포하고 `PUBLIC_BASE_URL`을 지정합니다.
- `.photos/`에 저장된 사진은 기본 24시간 뒤 자동 삭제됩니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `PHOTO_TTL_HOURS` | `24` | 사진 보관 시간 |
| `PUBLIC_BASE_URL` | (자동) | QR에 넣을 주소. 예: `https://fourcuts.dlab.kr` |
| `TRUST_PROXY` | (꺼짐) | HTTPS 리버스 프록시 뒤라면 `1` |
| `UPLOADS_PER_MIN` | `20` | IP당 분당 업로드 제한 |
| `CORS_ORIGIN` | (꺼짐) | 다른 주소의 화면(예: GitHub Pages)에서 업로드 허용. 쉼표로 여러 개 |

## GitHub Pages로 쓰기

`main`에 푸시하면 `public/`이 **https://ohmycoding1.github.io/dlab-4cut/**에 배포됩니다(처음 한 번은 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 바꿔야 합니다). 키오스크 화면(`index.html`)과 사진 받기 페이지(`p.html`)가 함께 배포됩니다.

- Pages로 띄워도 촬영·micro:bit·합성·PC 저장, Firebase QR 전달까지 모두 됩니다(사진은 Firebase에 보관).
- 노트북 사진 서버를 2순위로 함께 쓰려면 `https://ohmycoding1.github.io/dlab-4cut/?api=https://서버주소`(또는 ⚙ → 2순위 사진 서버)로 연결하고, 서버는 `CORS_ORIGIN=https://ohmycoding1.github.io`를 지정해 HTTPS로 띄웁니다.

## 행사 전 체크리스트

- [ ] 25팀 기준 전체 흐름 리허설: 촬영 → QR → 휴대폰 저장
- [ ] Storage 규칙 배포 후, 손님 휴대폰(와이파이·데이터 모두)으로 QR → 사진 저장까지 실제로 되는지 확인
- [ ] micro:bit 배터리 여분, 노트북과 3m 이내 거리 유지
- [ ] 조명 / 카메라 선택(⚙ → 카메라) / 거울 모드 확인
- [ ] ⚙ → 전체 화면으로 키오스크 모드 전환
- [ ] 아동 사진: 보호자 동의, 보관 기간(7일) 고지

## 구조

```
server.js              업로드·QR·사진 페이지·자동 삭제
public/index.html      화면
public/css/app.css     디자인
public/js/app.js       촬영 흐름·합성·업로드
public/js/microbit.js  BLE 연결 + 에어 마우스 커서
firmware/codal/        micro:bit V2 펌웨어(C++) — Actions가 hex로 빌드
firmware/*.ts          같은 기능의 MakeCode 코드
.github/workflows/     펌웨어 빌드 · Pages 배포
```
