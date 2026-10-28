// 디랩네컷 micro:bit 리모컨 (MakeCode → JavaScript 탭에 붙여넣기)
// 1) 확장 프로그램에서 "bluetooth" 추가 (radio 확장과는 함께 못 씀 — 자동 제거됨)
// 2) ⚙ 프로젝트 설정 → "No Pairing Required: Anyone can connect via Bluetooth" 선택
// 3) 다운로드 → micro:bit 에 복사
//
// 웹앱은 표준 서비스만 사용합니다.
//   가속도 서비스 → 기울여서 커서 이동
//   버튼 서비스   → A = 선택(클릭), B = 뒤로/취소
//   LED 서비스    → 카운트다운 숫자 표시 (micro:bit V1에서 메모리 부족 오류(020)가 나면 이 줄만 지우세요)

bluetooth.startAccelerometerService()
bluetooth.startButtonService()
bluetooth.startLEDService()

bluetooth.onBluetoothConnected(function () {
    basic.showIcon(IconNames.Happy)
})
bluetooth.onBluetoothDisconnected(function () {
    basic.showIcon(IconNames.Asleep)
})

// 전원 켜면 카메라 모양 → "연결 기다리는 중"
basic.showLeds(`
    . . . . .
    # # # # #
    # . # . #
    # # # # #
    . . . . .
    `)
