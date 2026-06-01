//=============================================================================
// Newmoonhana Plugins - Map Note StateMachine Manager
// NMHN_MapStateManager.js
//=============================================================================

var NMHN = NMHN || {};
NMHN.MapStateM = NMHN.MapStateM || {};
NMHN.MapStateM.version = 1.00;

/*:ko
 * @plugindesc 맵 입장 퇴장 처리 관련 이벤트 상태 머신(맵 노트 호출 방식)
 * @author 뉴문하나(Newmoonhana)
 * 
 * @param ---Debug---
 * @default
 *
 * @param Show Logic Logs
 * @parent ---Debug---
 * @type boolean
 * @on YES
 * @off NO
 * @desc 상태 패턴에 대한 흐름을 읽는 로그 출력 여부. 테스트 모드에서만 작동
 * NO - false     YES - true
 * @default false
 * 
 * @param Show Detail Logic Logs
 * @parent Show Logic Logs
 * @type boolean
 * @on YES
 * @off NO
 * @desc 상태 패턴에 대한 흐름을 읽는 '상세' 로그 출력 여부. 테스트 모드에서만 작동
 * NO - false     YES - true
 * @default false
 * 
 * @param Update Event Frequency
 * @parent Show Detail Logic Logs
 * @type number
 * @min 0
 * @desc 업데이트 호출 로그 출력 빈도. 숫자가 낮을 수록 자주 호출.
 * Default: 9999
 * @default 9999
 * 
 * @help
 * ============================================================================
 * 사용법
 * ============================================================================
 *
 * 맵 메모란에 아래 태그를 입력
 * <MapStateM:enterId,exitId,updateId>
 *
 * 각 ID 는 "이벤트ID-페이지번호" 형식. 1부터 시작, 미사용 시 0
 * ex) <MapStateM:3-1,3-2,3-3>
 * ex2) <MapStateM:3-1,0,3-2>
 * 
 * (※) 해당 연결 이벤트는 플레이어가 접근하지 못하도록 설정 필요(ex: 제일 마지막 장에 빈 이벤트 페이지를 할당)
 * (TIP) 연결 이벤트들은 위 ※으로 인해 캐릭터 스프라이트를 등록해도 보이지 않으므로, 더미 스프라이트를 만들어 이벤트에 넣으면 에디터에서 구분하기 편함.
 *
 * ----------
 * State 종류
 * ----------
 *
 * Enter  : 맵 진입 시(이동 시작 전)
 * Exit   : 맵을 떠나는 순간(이동 시작 전)
 * Update : 해당 맵 내 상시 루프
 *
 * ============================================================================
 * 사용 약관
 * ============================================================================
 * 
 * MIT 라이센스
 * 크레딧에 'Newmoonhana'(또는 '뉴문하나') 표기 필수
 *  - 필수라고 적긴 했지만 사실 안했다고 제가 머리를 깨러 찾아가지는 않습니다. 다만 저는 명성을 원합니다.
 * 비상업적, 상업적 사용 가능, 편집 가능
 * 기능 편집이 전혀 없는 원본 그대로의 파일을 판매 금지 (우우우 쌀쌀쌀)
 * 
 * ============================================================================
 * Changelog
 * ============================================================================
 * Version 1.00:
 * - 플러그인 완성
 */

// ----------------------------------------------------------------

(function () {
    //=============================================================================
    // Parameter Variables
    //=============================================================================
    var Params = PluginManager.parameters('NMHN_MapStateManager');
    NMHN.MapStateM.isShowLogs = JSON.parse(Params['Show Logic Logs']);
    NMHN.MapStateM.isShowDetailLogs = JSON.parse(Params['Show Detail Logic Logs']);
    NMHN.MapStateM.updateFrequency = JSON.parse(Params['Update Event Frequency']);

    // =========================================================================
    // 맵 메모 파싱
    // =========================================================================
    function parseRef(token) {  //이벤트 ID-페이지 ID 파싱
        if (!token) return null;
        if (token === '') return null;
        if (token === '0') return null;
        token = token.trim();

        const parts = token.split('-');
        const eventId   = parseInt(parts[0], 10);
        const pageIndex = parts.length >= 2 ? parseInt(parts[1], 10) - 1 : 0;

        if (isNaN(eventId) || eventId <= 0) return null;
        if (isNaN(pageIndex) || pageIndex < 0) return null;

        return { eventId, pageIndex };
    }
    function parseMapStateMeta() {  //<MapStateM> 태그 파싱
        if (!$dataMap || !$dataMap.meta) return null;

        const raw = $dataMap.meta['MapStateM'];
        if (!raw) return null;

        const tokens = String(raw).trim().split(',');
        return {
            enterRef  : parseRef(tokens[0]),
            exitRef   : parseRef(tokens[1]),
            updateRef : parseRef(tokens[2]),
        };
    }
    // =========================================================================
    // 유틸
    // =========================================================================
    function getMapTechName() { //현재 맵 이름
        if (!$dataMapInfos) return null;
        if (!$dataMap) return null;
        if (!$dataMap.meta) return null;
        if (!$gameMap) return null;
        if ($gameMap._mapId == 0) return null;
        return $dataMapInfos[$gameMap._mapId].name;
    }
    function getEventPageList(eventId, pageIndex) { //$dataMap.events 에서 지정 페이지의 커맨드 목록 반환
        if (!$dataMap) return null;
        if (!$dataMap.meta) return null;
        const ev = $dataMap.events[eventId];
        if (!ev) return null;
        if (!ev.pages) return null;
        const page = ev.pages[pageIndex];
        if (!page) return null;
        return page.list;
    }
    // 이벤트 페이지 커맨드를 새 Game_Interpreter로 실행
    // 생성된 인터프리터는 $gameMap._mapStateInterps 에 추가 후 Game_Map.update 훅에서 매 프레임 실행
    function runEventPage(_ref, _role) {
        if (!_ref) return;
        const list = getEventPageList(_ref.eventId, _ref.pageIndex);
        if (!list) return;
 
        const interp = new Game_Interpreter(0);
        interp.setup(list, _ref.eventId);
        interp._msRole = _role;
        $gameMap._mapStateInterps.push(interp);

        if ($gameTemp.isPlaytest())
            if (NMHN.MapStateM.isShowDetailLogs) {
                console.log('[MapStateM] runEventPage _role=' +_role + ' eventId=' + _ref.eventId + ' page=' + (_ref.pageIndex + 1));
            }
    }

    let stateKey = 'enter';

    NMHN.MapStateM.Enter = function() {
        if ($gameTemp.isPlaytest())
            if (NMHN.MapStateM.isShowLogs)
                console.log('[MapStateM] Enter: ' + getMapTechName());

        const meta = parseMapStateMeta();
        if (!meta) return;
        if (!meta.enterRef) return;

        runEventPage(meta.enterRef, 'enter');
    }
    const _Game_Map_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function (mapId) {
        _Game_Map_setup.call(this, mapId);
        this._mapStateInterps = [];
        stateKey = 'enter';
        NMHN.MapStateM.Enter();
        stateKey = 'update';
    };
    // enter 또는 exit 이벤트 진행 중 플레이어 조작 가능 이슈 개선(enter 이벤트가 실행 중이면 이벤트 실행 중으로 간주)
    const _Game_Map_isEventRunning = Game_Map.prototype.isEventRunning;
    Game_Map.prototype.isEventRunning = function() {
        if (_Game_Map_isEventRunning.call(this)) return true;

        if (this._mapStateInterps) {
            return this._mapStateInterps.some(i => (i._msRole === 'enter' || i._msRole === 'exit') && i.isRunning());
        }
        return false;
    };

    NMHN.MapStateM.Exit = function() {
        if (getMapTechName() == null) return;
        if (stateKey != 'update') return;
        stateKey = 'exit';

        const meta = parseMapStateMeta();
        if (!meta) return;
        if (!meta.exitRef) return;

        if ($gameTemp.isPlaytest())
            if (NMHN.MapStateM.isShowLogs)
                console.log('[MapStateM] Exit: ' + getMapTechName());

        runEventPage(meta.exitRef, 'exit');
    }
    const _Game_Player_reserveTransfer = Game_Player.prototype.reserveTransfer;
    Game_Player.prototype.reserveTransfer = function(mapId, x, y, d, type) {
        _Game_Player_reserveTransfer.call(this, mapId, x, y, d, type);

        // Exit 이벤트가 있는 맵에서만 지연
        if (!this._mapStateExitPending) { ///중복 풀 등록 방지 조건 코드
            //[WTF] 이 조건식 없으면 게임 실행 오류 남...
            const meta = parseMapStateMeta();
            if (!meta) return;
            if (!meta.exitRef) return;

            NMHN.MapStateM.Exit();             // Exit interp를 풀에 등록
            this._mapStateExitPending = true;  // 이동 지연 플래그
        }
    };
    const _Game_Player_isTransferring = Game_Player.prototype.isTransferring;
    Game_Player.prototype.isTransferring = function() {
        if (this._mapStateExitPending) return false;  // Exit 미완료 → 이동 없는 척
        return _Game_Player_isTransferring.call(this);
    };


    let testLogTimer = 0;
    NMHN.MapStateM.Update = function() {
        if (stateKey != 'update') return;

        if ($gameTemp.isPlaytest()) 
            if (NMHN.MapStateM.isShowLogs) {
                if (testLogTimer >= NMHN.MapStateM.updateFrequency) {
                    console.log('[MapStateM] Update: ' + getMapTechName());
                    testLogTimer = 0;
                }
                testLogTimer++;
            }

        //업데이트 풀 재등록
        const meta = parseMapStateMeta();
        if (!meta) return;
        if (!meta.updateRef) return;

        // 이미 update role이 실행 중이면 새로 추가하지 않음
        const running = $gameMap._mapStateInterps.some(i => i._msRole === 'update');
        if (running) return;
        runEventPage(meta.updateRef, 'update');
    }
    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);

        // 풀 업데이트 — 완료된 것은 제거(Update는 완료 후 풀에서 제거 후 Update 함수에서 재등록하는 구조)
        $gameMap._mapStateInterps = $gameMap._mapStateInterps.filter(interp => {
            interp.update();
            const stillRunning = interp.isRunning();

            // Exit 이벤트가 완료된 순간 → 맵 이동 지연 해제
            if (!stillRunning && interp._msRole === 'exit') {
                $gamePlayer._mapStateExitPending = false;
            }

            return stillRunning;
        });

        NMHN.MapStateM.Update();
    };
})();
