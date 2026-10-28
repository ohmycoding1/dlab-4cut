# 디랩네컷 · GGF 2026

micro:bit를 **에어 마우스**처럼 들고 기울여서 조작하는 네컷 포토부스 웹앱입니다.
카메라 촬영 → 1200×3600 네컷 합성 → QR로 휴대폰 저장까지 한 화면에서 끝납니다.

```
micro:bit ──BLE──▶ 브라우저(Chrome/Edge)  ──HTTP──▶ Node 서버 ──QR──▶ 손님 휴대폰
 기울기 = 커서                카메라·합성                사진 임시 보관(24h)
 A = 선택 / B = 뒤로
```

## 실행

```bash
npm install
npm start
```

촬영 노트북의 Chrome/Edge에서 `http://localhost:3000`을 엽니다. 카메라와 Web Bluetooth는 `localhost` 또는 HTTPS에서만 동작합니다.

## micro:bit 준비

1. [makecode.microbit.org](https://makecode.microbit.org)에서 새 프로젝트를 만들고, 확장 프로그램에서 **bluetooth**를 추가합니다.
2. **JavaScript** 탭에 [`firmware/dlab-fourcuts.ts`](firmware/dlab-fourcuts.ts)를 붙여넣습니다.
3. ⚙ **프로젝트 설정** → **No Pairing Required: Anyone can connect via Bluetooth**를 선택합니다. Windows에서 페어링 문제를 피하려면 꼭 필요합니다.
4. 다운로드한 파일을 micro:bit에 복사합니다. LED에 카메라 모양이 뜨면 준비된 것입니다.
5. 웹앱 상단의 **micro:bit 미연결** 칩(또는 ⚙ → 블루투스 연결)을 눌러 `BBC micro:bit [...]`을 고릅니다.

> micro:bit V1에서 메모리 부족 오류(020)가 나면 펌웨어의 `startLEDService()` 줄을 지우세요. LED 카운트다운만 빠지고 나머지는 그대로 동작합니다.

### 조작

| 입력 | 동작 |
|---|---|
| 기울이기 | 화면 커서 이동. 살짝 기울이면 천천히, 많이 기울이면 빠르게 움직이고, 버튼 위에서는 느려져 조준하기 쉽습니다. |
| **A** | 커서 아래 버튼 클릭. 대기 화면에서 빈 곳을 가리키고 누르면 바로 촬영이 시작됩니다. |
| **B** | 뒤로: 촬영 중이면 취소, 결과 화면이면 처음으로, 설정창이면 닫기 |

- 연결되면 그때 들고 있는 자세가 "정지" 기준이 됩니다. 커서가 혼자 흘러가면 ⚙ → **지금 자세를 기준으로**를 누릅니다.
- 방향이 반대로 움직이면 ⚙에서 **좌우 반전/상하 반전**을 켭니다. 커서 속도는 1~5단계로 조절합니다.
- 연결이 끊기면 자동으로 다시 연결합니다. Chrome에서 새로고침했을 때는 이미 허용한 장치로 자동 재연결을 시도합니다.
- 리모컨 없이 리허설할 때는 ⚙ → **가상 micro:bit**를 켭니다. 방향키로 기울이기를 흉내 내고, A/B 키가 버튼 역할을 합니다.
- 일반 마우스와 키보드(Enter = 촬영, Esc = 취소)도 항상 함께 쓸 수 있습니다.

## 사진 QR 전달

- 결과 화면이 뜨면 JPEG로 업로드하고, 서버가 QR을 바로 만들어 돌려줍니다(`POST /api/photos` → `{ url, qr }`).
- **`localhost`로 접속해도 QR에는 노트북의 LAN 주소**(예: `http://192.168.0.12:3000/p/...`)가 들어갑니다. 따라서 **같은 와이파이에 있는 휴대폰**이라면 배포 없이 바로 열립니다. 실제 주소는 ⚙ → QR 공유에서 확인할 수 있습니다.
- 행사장 와이파이가 기기 간 통신을 막으면(게스트망에서 흔함) 공개 주소로 배포하고 `PUBLIC_BASE_URL`을 지정합니다.
- `.photos/`에 저장된 사진은 기본 24시간 뒤 자동 삭제됩니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `PHOTO_TTL_HOURS` | `24` | 사진 보관 시간 |
| `PUBLIC_BASE_URL` | (자동) | QR에 넣을 주소. 예: `https://fourcuts.dlab.kr` |
| `TRUST_PROXY` | (꺼짐) | HTTPS 리버스 프록시 뒤라면 `1` |
| `UPLOADS_PER_MIN` | `20` | IP당 분당 업로드 제한 |

## 행사 전 체크리스트

- [ ] 25팀 기준 전체 흐름 리허설: 촬영 → QR → 휴대폰 저장
- [ ] 손님 휴대폰(행사 와이파이)으로 QR이 실제로 열리는지 확인
- [ ] micro:bit 배터리 여분, 노트북과 3m 이내 거리 유지
- [ ] 조명 / 카메라 선택(⚙ → 카메라) / 거울 모드 확인
- [ ] ⚙ → 전체 화면으로 키오스크 모드 전환
- [ ] 아동 사진: 보호자 동의, 보관 기간(24시간) 고지

## 구조

```
server.js              업로드·QR·사진 페이지·자동 삭제
public/index.html      화면
public/css/app.css     디자인
public/js/app.js       촬영 흐름·합성·업로드
public/js/microbit.js  BLE 연결 + 에어 마우스 커서
firmware/              micro:bit MakeCode 코드
```
