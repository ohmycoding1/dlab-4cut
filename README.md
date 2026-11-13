# 디랩네컷 · GGF 2026

micro:bit 하나로 조작하는 네컷 포토부스 웹앱입니다.
시작 → 프레임 → 촬영 → 완성 네 화면이 한 장씩 넘어가고, 1200×3600 네컷을 합성한 뒤 QR로 손님 휴대폰에 바로 저장합니다.

## 바로 쓰기

| 용도 | 주소 |
|---|---|
| 포토부스 (촬영 노트북의 Chrome/Edge) | https://ohmycoding1.github.io/dlab-4cut/ |
| 사진 받기 페이지 (QR로 열림) | https://ohmycoding1.github.io/dlab-4cut/p.html?id=... |

설치 없이 위 주소만 열면 됩니다. 처음 열 때 카메라 권한을 허용하고, ⚙ → **블루투스 연결**로 micro:bit를 붙입니다.
`p.html`을 `?id=` 없이 열면 "사진 주소가 올바르지 않아요"가 나오는 게 정상입니다.

```
micro:bit ──BLE──▶ 브라우저(Chrome/Edge) ──업로드──▶ 디랩레포트시스템 Firebase Storage ──QR──▶ 손님 휴대폰(p.html)
 A = 이전 / B = 다음          카메라·합성                  fourcuts/<무작위ID>.jpg (7일 보관)
 흔들기·A+B = 촬영
```

## 노트북에서 직접 띄우기 (선택)

인터넷이 불안한 행사장 대비용입니다. 평소에는 위의 GitHub Pages 주소를 쓰면 됩니다.

```bash
npm install
npm start
```

**이 방법을 쓸 때만** 위 GitHub Pages 주소 대신 `http://localhost:3000`을 엽니다(같은 노트북의 Chrome/Edge). 카메라와 Web Bluetooth는 `localhost` 또는 HTTPS에서만 동작해서, 노트북 IP 주소(`http://192.168.x.x:3000`)로 열면 안 됩니다. 이렇게 띄우면 노트북 사진 서버가 함께 켜져서, Firebase 업로드가 실패할 때 2순위 QR 전달로 쓰입니다.

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
micro:bit는 **A = 이전, B = 다음, 흔들기 또는 A+B 동시 = 촬영** 세 가지만 씁니다(기울이기 커서는 쓰지 않음).
시작 화면에서 B를 누르면 **사용법 안내창**이 크게 뜨고, B를 한 번 더 누르면 프레임 화면으로 넘어갑니다.

| 화면 | A · ← | B · → · Enter | 흔들기 · A+B · Space |
|---|---|---|---|
| 시작 | — | 사용법 안내창 열기 | 바로 촬영 시작 |
| 사용법 안내창 | 닫기 | 프레임 화면으로 | 바로 촬영 시작 |
| 프레임 | ◀ 이전 색 | 다음 색 ▶ | 촬영 시작(3초 뒤 첫 컷) |
| 촬영 | 촬영 취소 | 이번 컷 찍기 | 이번 컷 찍기 |
| 완성 | 다시 찍기 | 처음으로 | 다시 찍기(바로 카운트다운) |

- **촬영:** 컷마다 '찍기' 신호를 기다립니다. 신호가 오면 **3초 카운트다운 뒤 촬영**하고, **30초** 동안 신호가 없으면 자동으로 카운트다운을 시작합니다. 남은 시간은 카메라 화면 아래 막대로 보이고, 찍은 컷은 오른쪽 네컷 프레임에 하나씩 채워집니다.
- **A+B 판정:** 두 버튼을 0.25초 안에 누르거나, 한 버튼을 누른 채 다른 버튼을 누르면 A+B로 봅니다. 그래서 A·B 단독 입력은 0.25초 늦게 반영됩니다.
- **흔들기 판정:** 0.7초 안에 큰 가속도(약 1.9g 이상 또는 거의 0g)가 4번 이상 잡히면 흔들기로 보고, 1.8초 동안은 다시 반응하지 않습니다. 펌웨어는 그대로이고 브라우저가 가속도 값으로 판단합니다.
- 프레임 화면에서 60초 동안 조작이 없거나 완성 화면이 60초 지나면 처음 화면으로 돌아갑니다. 키보드로는 프레임 화면에서 Esc를 누르면 처음으로 갑니다.
- 연결이 끊기면 자동으로 다시 연결합니다. Chrome에서 새로고침했을 때는 이미 허용한 장치로 자동 재연결을 시도합니다.
- 목록에 micro:bit가 안 보이면 ⚙ → **🔍 모든 블루투스 기기에서 찾기**로 이름과 상관없이 주변 기기를 확인합니다.
- 리모컨 없이 리허설할 때는 ⚙ → **가상 micro:bit**를 켭니다. A/B 키가 버튼(두 키 동시 = A+B), Z 키가 흔들기 역할을 합니다.
- 일반 마우스와 키보드(→/Enter = 다음, ← = 이전, Space = 촬영)도 항상 함께 쓸 수 있습니다.

## 사진 QR 전달

### 기본: 디랩레포트시스템 Firebase (휴대폰 데이터로도 열림)

1. 완성 화면이 뜨면 사진을 디랩레포트시스템(Firebase 프로젝트 `dlab-sc-feedback`)의 Storage에 `fourcuts/<무작위 24자>.jpg`로 올립니다. 로그인이나 API 키는 필요 없습니다.
2. QR은 브라우저에서 바로 그리고, **사진 받기 페이지** `https://ohmycoding1.github.io/dlab-4cut/p.html?id=...`를 가리킵니다.
3. 손님 휴대폰에서 이 페이지를 열면 사진과 **사진 저장하기** 버튼(공유 시트 → 사진 앱 저장)이 나옵니다.

설정은 [`public/js/share-config.js`](public/js/share-config.js)에 있습니다(버킷, 폴더, 사진 받기 페이지 주소, 보관 일수 표시).

**설정 상태**

| 항목 | 상태 |
|---|---|
| Storage 규칙 (`dlab-feedback`의 `storage.rules` → `match /fourcuts/{file}`) | ✅ 배포됨 (2026-11-13) |
| 사진 받기 페이지 (GitHub Pages) | ✅ 배포됨 |
| 7일 뒤 자동 삭제 (버킷 수명 주기 규칙) | ⬜ 아직 — 아래 명령으로 설정 |

- **Storage 규칙:** 로그인 없이 **새 파일 만들기만** 허용합니다(24자 이름의 JPEG, 8MB 미만, 덮어쓰기·삭제 불가). 읽기는 **이름을 아는 단건만** 허용하고 목록 조회는 막습니다. 규칙 원본은 `ohmycoding1/dlab-feedback`이고, 그 저장소 `main`에 머지하면 배포 워크플로가 Storage 규칙도 함께 배포합니다.
- **7일 뒤 자동 삭제:** 버킷 수명 주기 규칙으로 `fourcuts/`만 지웁니다. 아래 명령은 버킷의 기존 수명 주기 설정을 **덮어쓰므로**, 먼저 `gcloud storage buckets describe gs://dlab-sc-feedback.firebasestorage.app --format="default(lifecycle_config)"`로 기존 규칙이 없는지 확인하세요. 설정하기 전까지는 사진이 자동으로 지워지지 않습니다.

  ```bash
  echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7,"matchesPrefix":["fourcuts/"]}}]}' > lifecycle.json
  gcloud storage buckets update gs://dlab-sc-feedback.firebasestorage.app --lifecycle-file=lifecycle.json
  ```

- **업로드가 실패할 때:** 완성 화면에 "사진 전송에 실패했어요"와 오류 문구가 나옵니다. 디랩레포트시스템에서 Storage에 **App Check 강제**를 켜 두었다면 로그인 없는 업로드가 막히므로, 강제를 끄거나 2순위 사진 서버를 씁니다. 브라우저 콘솔에서 `__lastShareUrl`을 입력하면 마지막 QR 주소를 볼 수 있습니다.

### 2순위: 노트북 사진 서버 (같은 와이파이)

Firebase 업로드가 실패하면 `npm start`로 띄운 노트북 사진 서버로 올립니다(서버가 있을 때만).

- `npm start`로 띄운 경우, **`localhost`로 접속해도 QR에는 노트북의 LAN 주소**(예: `http://192.168.0.12:3000/p/...`)가 들어갑니다. 따라서 **같은 와이파이에 있는 휴대폰**에서만 열립니다. 실제 주소는 ⚙ → QR 공유에서 확인할 수 있습니다.
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

## GitHub Pages 배포

`main`에 `public/` 변경이 들어가면 **GitHub Pages 배포** 워크플로가 키오스크 화면(`index.html`)과 사진 받기 페이지(`p.html`)를 https://ohmycoding1.github.io/dlab-4cut/ 에 올립니다. Actions 탭에서 **Run workflow**로 수동 배포도 할 수 있습니다.

- 저장소 설정(이미 완료): **Settings → Pages → Source = GitHub Actions**, **Settings → Environments → github-pages → Deployment branches**에 `main` 허용. 배포가 몇 초 만에 실패하면 이 두 곳부터 확인합니다.
- Pages로 띄워도 촬영·micro:bit·합성·PC 저장, Firebase QR 전달까지 모두 됩니다(사진은 Firebase에 보관).
- 노트북 사진 서버를 2순위로 함께 쓰려면 `https://ohmycoding1.github.io/dlab-4cut/?api=https://서버주소`(또는 ⚙ → 2순위 사진 서버)로 연결하고, 서버는 `CORS_ORIGIN=https://ohmycoding1.github.io`를 지정해 HTTPS로 띄웁니다.

## 행사 전 체크리스트

- [ ] 25팀 기준 전체 흐름 리허설: 촬영 → QR → 휴대폰 저장
- [ ] 손님 휴대폰(와이파이·데이터 모두)으로 QR → 사진 저장까지 실제로 되는지 확인 (iPhone·Android 각 1대)
- [ ] 실제 micro:bit로 흔들기·A+B가 잘 잡히는지 확인(너무 둔하거나 예민하면 알려 주세요)
- [ ] 7일 자동 삭제(버킷 수명 주기 규칙) 설정
- [ ] micro:bit 배터리 여분, 노트북과 3m 이내 거리 유지
- [ ] 조명 / 카메라 선택(⚙ → 카메라) / 거울 모드 확인
- [ ] ⚙ → 전체 화면으로 키오스크 모드 전환
- [ ] 아동 사진: 보호자 동의, 보관 기간(7일) 고지

## 구조

```
public/index.html            키오스크 화면 (시작·프레임·촬영·완성 4장)
public/p.html                사진 받기 페이지 (QR로 휴대폰에서 열림)
public/css/app.css           디자인 · 화면 넘김 효과
public/js/app.js             화면 흐름 · 촬영 · 합성 · 업로드 · QR
public/js/microbit.js        BLE 연결 · A/B · A+B · 흔들기 감지
public/js/share-config.js    Firebase 업로드 설정 (버킷 · 폴더 · 사진 받기 주소)
public/js/vendor/qrcode.js   QR 생성 (qrcode-generator 1.4.4, MIT)
server.js                    (선택) 노트북 사진 서버: 업로드 · QR · 사진 페이지 · 자동 삭제
firmware/codal/              micro:bit V2 펌웨어(C++) — Actions가 hex로 빌드
firmware/*.ts                같은 기능의 MakeCode 코드
.github/workflows/           펌웨어 빌드 · Pages 배포
```
