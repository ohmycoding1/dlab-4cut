// 디랩네컷 micro:bit 리모컨 펌웨어 (micro:bit V2 / CODAL)
// 웹앱(public/js/microbit.js)이 쓰는 표준 BLE 서비스만 켭니다.
//   Accelerometer Service → 기울여서 커서 이동
//   Button Service        → A = 선택, B = 뒤로
//   LED Service           → 카운트다운 숫자 표시
// 페어링 없이(Open link) 바로 연결됩니다.
#include "MicroBit.h"

MicroBit uBit;

static const char *CAMERA =
    "0,0,0,0,0\n"
    "1,1,1,1,1\n"
    "1,0,1,0,1\n"
    "1,1,1,1,1\n"
    "0,0,0,0,0\n";
static const char *HAPPY =
    "0,0,0,0,0\n"
    "0,1,0,1,0\n"
    "0,0,0,0,0\n"
    "1,0,0,0,1\n"
    "0,1,1,1,0\n";

static void onConnected(MicroBitEvent)
{
    uBit.display.print(MicroBitImage(HAPPY));
}

static void onDisconnected(MicroBitEvent)
{
    uBit.display.print(MicroBitImage(CAMERA));
}

int main()
{
    uBit.init();

    uBit.messageBus.listen(MICROBIT_ID_BLE, MICROBIT_BLE_EVT_CONNECTED, onConnected);
    uBit.messageBus.listen(MICROBIT_ID_BLE, MICROBIT_BLE_EVT_DISCONNECTED, onDisconnected);

    new MicroBitAccelerometerService(*uBit.ble, uBit.accelerometer);
    new MicroBitButtonService(*uBit.ble);
    new MicroBitLEDService(*uBit.ble, uBit.display);

    uBit.display.print(MicroBitImage(CAMERA));

    while (true)
        uBit.sleep(1000);
}
