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
 * (※※) 이 플러그인 상의 Update는 Enter과 Exit가 진행되는 동안은 Update가 호출되지 않는 구조임 참고. 만약 다른 이벤트 동안 호출하고 싶은 루프 이벤트가 있을 시, 기존 (RPG MV 정통 방식대로 병렬 이벤트 처리) 방식으로 구현.
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
 * Version 2.00:
 * new Game_Interpreter 생성 방식으로 구조 변경
 * Version 1.02:
 * 특정 맵(원인 확인 불가)에서 Enter->Exit 바로 호출되는 버그 개선
 * Version 1.01:
 * update 내부에서 맵 이동 실행 시 Exit가 시작되지 않는 비동기 이슈 발생 개선
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
    function getMapTechName() { //현재 맵 이름 리턴(맵 이름 == 기술 이름으로 취급)
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

    // =========================================================================
    // Interpreter Pool
    // -------------------------------------------------------------------------
    // enter / exit / update 세 역할의 Game_Interpreter 인스턴스를 한 배열에서 관리
    // 실제 폴링(매 프레임 update + 완료 시 제거)은 Game_Map.prototype.update 에서 processPool()로 처리
    // =========================================================================
    let stateKey = 'enter'; // 현재 상태, 'enter' -> 'update' (재귀) -> 'exit'
 
    function isRoleRunning(role) {
        if (!$gameMap._msPool) return false;
        return $gameMap._msPool.some(i => i._msRole === role && i.isRunning());
    }
 
    function pushInterp(_ref, _role) {  //이벤트 등록 (new Game_Interpreter 방식)
        if (!_ref) return false;
        const list = getEventPageList(_ref.eventId, _ref.pageIndex);
        if (!list) return false;
 
        const interp = new Game_Interpreter(0);
        interp.setup(list, _ref.eventId);
        interp._msRole = _role;
        $gameMap._msPool.push(interp);
 
        if ($gameTemp.isPlaytest()) if (NMHN.MapStateM.isShowDetailLogs) {
            console.log('[MapStateM] pushInterp _role=' + _role + ' eventId=' + _ref.eventId + ' page=' + (_ref.pageIndex + 1));
        }
        return true;
    }
 
    // -------------------------------------------------------------------------
    // Enter
    // -------------------------------------------------------------------------
    NMHN.MapStateM.Enter = function () {
        if ($gameTemp.isPlaytest()) if (NMHN.MapStateM.isShowLogs) {
            console.log('[MapStateM] Enter: ' + getMapTechName());
        }
 
        const meta = parseMapStateMeta();
        if (!meta) return;
        pushInterp(meta.enterRef, 'enter');
    };
 
    const _Game_Map_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function (mapId) {
        _Game_Map_setup.call(this, mapId);
        this._msPool = [];
        stateKey = 'enter';
        NMHN.MapStateM.Enter();
    };
 
    // -------------------------------------------------------------------------
    // Exit
    // -------------------------------------------------------------------------
    NMHN.MapStateM.Exit = function () {
        if (getMapTechName() == null) return;
        if (stateKey === 'enter') return; // enter 상태가 종료되지 않은 경우 exit 진입 불가
        if (stateKey === 'exit') return; // exit 이벤트 이미 진행 도중 중복 호출 방지
        stateKey = 'exit';
 
        const meta = parseMapStateMeta();
        if (!meta) return;
 
        if ($gameTemp.isPlaytest()) if (NMHN.MapStateM.isShowLogs) {
            console.log('[MapStateM] Exit: ' + getMapTechName());
        }
 
        pushInterp(meta.exitRef, 'exit');
    };
 
    // -------------------------------------------------------------------------
    // Pool 처리
    // -------------------------------------------------------------------------
    let testLogTimer = 0;
 
    NMHN.MapStateM.processPool = function () {
        const pool = $gameMap._msPool;
        if (!pool) return;
 
        // 1) pool 순회: update 실행, 끝난 것은 제거
        let i = 0;
        while (i < pool.length) {
            const interp = pool[i];
            interp.update();
 
            if (interp.isRunning()) {
                i++;
                continue;
            }
 
            // 완료된 interp 처리
            if (interp._msRole === 'exit') {
                $gamePlayer._mapStateExitPending = false; // 이동 지연 해제
            }
            pool.splice(i, 1);
        }
 
        // 2) enter -> update 전환
        if (stateKey === 'enter') if (!isRoleRunning('enter')) {
            stateKey = 'update';
 
            if ($gamePlayer._mapStateExitDeferred) {
                $gamePlayer._mapStateExitDeferred = false;
                NMHN.MapStateM.Exit();
            }
        }
 
        // 3) update 상태 로직 (Update interp 종료 시 재호출하는 재귀 방식)
        if (stateKey === 'update') {
            // 로그
            if ($gameTemp.isPlaytest()) if (NMHN.MapStateM.isShowLogs) {
                if (testLogTimer >= NMHN.MapStateM.updateFrequency) {
                    console.log('[MapStateM] Update: ' + getMapTechName());
                    testLogTimer = 0;
                }
                ++testLogTimer;
            }
 
            if (!isRoleRunning('update')) {
                const meta = parseMapStateMeta();
                if (meta && meta.updateRef) {
                    pushInterp(meta.updateRef, 'update');
                }
            }
        }

        // exit interp 끝 여부는 다른 위치에서 pending 해제로 확인.
    };
 
    const _Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        _Game_Map_update.call(this, sceneActive);
        NMHN.MapStateM.processPool();
    };
 
    // =========================================================================
    // 엔진 연동 패치
    // -------------------------------------------------------------------------
    // pool 안의 Game_Interpreter 들은 엔진이 모르는 별도 객체이므로,
    // "이벤트 실행 중"이라는 사실과 "이동 지연"을 엔진에게 알려주기 위해
    // 아래 세 오버라이드가 계속 필요함
    // =========================================================================
 
    // enter/exit 진행 중엔 플레이어 조작 불가 처리
    const _Game_Map_isEventRunning = Game_Map.prototype.isEventRunning;
    Game_Map.prototype.isEventRunning = function () {
        if (_Game_Map_isEventRunning.call(this)) return true;
        if (this._msPool) {
            return this._msPool.some(i => (i._msRole === 'enter' || i._msRole === 'exit') && i.isRunning());
        }
        return false;
    };
 
    // 맵 이동 예약 시 exit 이벤트를 먼저 걸어주는 후크
    const _Game_Player_reserveTransfer = Game_Player.prototype.reserveTransfer;
    Game_Player.prototype.reserveTransfer = function (mapId, x, y, d, type) {
        _Game_Player_reserveTransfer.call(this, mapId, x, y, d, type);
 
        // 같은 맵 내에서 이동이라 enter exit를 타지 않는 예외 처리
        if (mapId === $gameMap._mapId) return;

        if (this._mapStateExitPending) return; // 중복 등록 방지
 
        const meta = parseMapStateMeta();
        if (!meta || !meta.exitRef) return;
 
        if (stateKey === 'update') {
            NMHN.MapStateM.Exit();            // exit interp를 pool에 등록
            this._mapStateExitPending = true; // 이동 지연 플래그
        } else if (stateKey === 'enter') {
            // enter가 아직 안 끝났으면, enter 종료 시점에 exit를 걸도록 예약만 해둠
            this._mapStateExitPending = true;
            this._mapStateExitDeferred = true;
        }
    };
 
    // exit가 끝날 때까지 실제 전송을 미룸
    const _Game_Player_isTransferring = Game_Player.prototype.isTransferring;
    Game_Player.prototype.isTransferring = function () {
        if (this._mapStateExitPending) return false; // exit 미완료 -> 이동 없는 척
        return _Game_Player_isTransferring.call(this);
    };
})();
