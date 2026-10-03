//
// gamemgr_hzmj.js —— 红中麻将（癞子玩法）游戏管理器
//
// 基于 babykylin_scmj 的 gamemgr 框架风格实现，事件协议与客户端 GameNetMgr 完全兼容，
// 胡牌/听牌/杠分析使用 xiyoufang 移植算法（algorithm/GameLogic.js + LaiziLogic.js）。
//
// 规则要点（均可通过房间配置覆盖，见 applyConfDefaults）：
//   - 112 张牌：万条筒各 36 张 + 红中 4 张
//   - 红中为癞子（万能牌），默认不可打出、不可碰、不可杠
//   - 可碰、可杠（明杠/暗杠/补杠），不可吃
//   - 可自摸，可选接炮、抢杠胡
//   - 一家胡牌即结束（截胡，按出牌者下家起顺序优先）
//   - 支持动作超时自动过、出牌超时 AI 代打（天然支持托管与机器人）
//

'use strict';

var roomMgr = require("./roommgr");
var userMgr = require("./usermgr");
var db = require("../utils/db");
var crypto = require("../utils/crypto");
var LaiziLogic = require("./algorithm/LaiziLogic");
var GameLogic = require("./algorithm/GameLogic");
var TileMap = require("./algorithm/TileMap");

var LAIZI_ID = TileMap.HONGZHONG_ID; // 红中在 babykylin 牌 id 制式中的值

var ACTION_CHUPAI = 1;
var ACTION_MOPAI = 2;
var ACTION_PENG = 3;
var ACTION_GANG = 4;
var ACTION_HU = 5;
var ACTION_ZIMO = 6;

var games = {};
var gameSeatsOfUsers = {};

// =====================================================================
// 工具
// =====================================================================

/** 房间配置默认值（红中麻将规则可配置） */
function applyConfDefaults(conf) {
    conf = conf || {};
    if (conf.baseScore == null) conf.baseScore = 1;       // 底分
    if (conf.maxGames == null) conf.maxGames = 8;         // 局数
    if (conf.maxFan == null) conf.maxFan = 5;             // 封顶番数
    if (conf.canJiePao == null) conf.canJiePao = true;    // 可接炮
    if (conf.qiangGang == null) conf.qiangGang = true;    // 可抢杠胡
    if (conf.laiziChu == null) conf.laiziChu = false;     // 红中可打出（癞子杠）
    if (conf.fanPerLaizi == null) conf.fanPerLaizi = 0;   // 结算时手中每个红中加番
    if (conf.zimoFan == null) conf.zimoFan = 1;           // 自摸加番
    if (conf.pphFan == null) conf.pphFan = 2;             // 碰碰胡番
    if (conf.qdFan == null) conf.qdFan = 2;               // 七对番
    if (conf.qysFan == null) conf.qysFan = 3;             // 清一色番
    if (conf.gangScore == null) conf.gangScore = 1;       // 杠分(底分倍数)：暗杠x2每家/点杠x2/补杠x1每家
    if (conf.actionTimeout == null) conf.actionTimeout = 15; // 动作/出牌超时(秒)，0=关闭
    return conf;
}

function getMJType(id) {
    if (id >= 0 && id < 9) return 0;    // 筒
    if (id >= 9 && id < 18) return 1;   // 条
    if (id >= 18 && id < 27) return 2;  // 万
    return 3;                            // 字牌（红中）
}

/** 洗牌：112 张（27 序数各 4 张 + 4 红中） */
function shuffle(game) {
    var mahjongs = game.mahjongs;
    var index = 0;
    for (var i = 0; i < 27; ++i) {
        for (var c = 0; c < 4; ++c) {
            mahjongs[index++] = i;
        }
    }
    for (var z = 0; z < 4; ++z) {
        mahjongs[index++] = LAIZI_ID;
    }
    for (var k = 0; k < mahjongs.length; ++k) {
        var lastIndex = mahjongs.length - 1 - k;
        var r = Math.floor(Math.random() * (lastIndex + 1));
        var t = mahjongs[r];
        mahjongs[r] = mahjongs[lastIndex];
        mahjongs[lastIndex] = t;
    }
}

/** 摸一张牌（从牌墙头部），-1 表示无牌 */
function mopai(game, seatIndex) {
    if (game.currentIndex >= game.mahjongs.length) return -1;
    var data = game.gameSeats[seatIndex];
    var pai = game.mahjongs[game.currentIndex];
    data.holds.push(pai);
    data.countMap[pai] = (data.countMap[pai] || 0) + 1;
    game.currentIndex++;
    return pai;
}

/** 发牌：每人 13 张，庄家 14 张 */
function deal(game) {
    game.currentIndex = 0;
    var seatIndex = game.button;
    for (var i = 0; i < 52; ++i) {
        if (game.gameSeats[seatIndex].holds == null) game.gameSeats[seatIndex].holds = [];
        mopai(game, seatIndex);
        seatIndex = (seatIndex + 1) % 4;
    }
    mopai(game, game.button);
    game.turn = game.button;
}

// =====================================================================
// 算法桥接：babykylin 牌 id -> 算法层
// =====================================================================

function seatIndex34(seatData, extraCardId) {
    var idx = TileMap.holdsToIndex(seatData.holds);
    if (extraCardId != null && extraCardId >= 0) {
        idx[GameLogic.switchToCardIndex(TileMap.idToCard(extraCardId))]++;
    }
    return idx;
}

function seatWeaves(seatData) {
    var weaves = [];
    var i;
    for (i = 0; i < seatData.pengs.length; i++) {
        weaves.push({ cbWeaveKind: GameLogic.WIK_P, cbCenterCard: TileMap.idToCard(seatData.pengs[i]), cbPublicCard: 1, cbProvideUser: 0, cbValid: 1 });
    }
    var gangs = seatData.angangs.concat(seatData.diangangs, seatData.wangangs);
    for (i = 0; i < gangs.length; i++) {
        weaves.push({ cbWeaveKind: GameLogic.WIK_G, cbCenterCard: TileMap.idToCard(gangs[i]), cbPublicCard: 1, cbProvideUser: 0, cbValid: 1 });
    }
    return weaves;
}

/** 摸入 targetPai 后能否胡（癞子算法） */
function canHuWith(seatData, targetPai) {
    var idx = seatIndex34(seatData);
    var weaves = seatWeaves(seatData);
    var card = targetPai != null && targetPai >= 0 ? TileMap.idToCard(targetPai) : 0;
    return LaiziLogic.analyseCanHuCardLaizi(idx, weaves, weaves.length, card, TileMap.LAIZI_INDEX);
}

/** 当前 13 张（或碰后 13 张）的听牌枚举 */
function tingList(seatData) {
    var idx = seatIndex34(seatData);
    var weaves = seatWeaves(seatData);
    var res = LaiziLogic.analyseTingCardResultLaizi(idx, weaves, weaves.length, TileMap.LAIZI_INDEX);
    var ids = [];
    for (var i = 0; i < res.tingCount; i++) ids.push(TileMap.cardToId(res.tingCard[i]));
    return ids;
}

/** AI 代打：从 14 张手牌中选最佳出牌（id 制式） */
function bestDiscard(seatData) {
    var idx = seatIndex34(seatData);
    var weaves = seatWeaves(seatData);
    var best = LaiziLogic.getBestDiscardLaizi(idx, weaves, weaves.length, TileMap.LAIZI_INDEX);
    if (best.card === 0) {
        // 保底：打第一张非红中
        for (var i = 0; i < seatData.holds.length; i++) {
            if (seatData.holds[i] !== LAIZI_ID) return seatData.holds[i];
        }
        return seatData.holds[0];
    }
    return TileMap.cardToId(best.card);
}

// =====================================================================
// 动作检查
// =====================================================================

function checkCanPeng(game, seatData, targetPai) {
    if (targetPai === LAIZI_ID) return;
    var count = seatData.countMap[targetPai];
    if (count != null && count >= 2) {
        seatData.canPeng = true;
    }
}

function checkCanDianGang(game, seatData, targetPai) {
    if (game.mahjongs.length <= game.currentIndex) return; // 无牌不能杠
    if (targetPai === LAIZI_ID) return;
    var count = seatData.countMap[targetPai];
    if (count != null && count >= 3) {
        seatData.canGang = true;
        seatData.gangPai.push(targetPai);
    }
}

function checkCanAnGang(game, seatData) {
    if (game.mahjongs.length <= game.currentIndex) return;
    for (var key in seatData.countMap) {
        var pai = parseInt(key);
        if (pai === LAIZI_ID) continue;
        if (seatData.countMap[key] === 4) {
            seatData.canGang = true;
            seatData.gangPai.push(pai);
        }
    }
}

function checkCanWanGang(game, seatData) {
    if (game.mahjongs.length <= game.currentIndex) return;
    for (var i = 0; i < seatData.pengs.length; ++i) {
        var pai = seatData.pengs[i];
        if (pai === LAIZI_ID) continue;
        if (seatData.countMap[pai] === 1) {
            seatData.canGang = true;
            seatData.gangPai.push(pai);
        }
    }
}

function hasOperations(seatData) {
    return seatData.canGang || seatData.canPeng || seatData.canHu;
}

function clearAllOptions(game, seatData) {
    var fnClear = function (sd) {
        sd.canPeng = false;
        sd.canGang = false;
        sd.gangPai = [];
        sd.canHu = false;
        sd.respondedAction = null;
    };
    if (seatData) {
        fnClear(seatData);
    } else {
        for (var i = 0; i < game.gameSeats.length; ++i) {
            fnClear(game.gameSeats[i]);
        }
    }
}

function sendOperations(game, seatData, pai) {
    if (hasOperations(seatData)) {
        if (pai == -1 || pai == null) {
            pai = seatData.holds[seatData.holds.length - 1];
        }
        var data = {
            pai: pai,
            hu: seatData.canHu,
            peng: seatData.canPeng,
            gang: seatData.canGang,
            gangpai: seatData.gangPai
        };
        userMgr.sendMsg(seatData.userId, 'game_action_push', data);
        data.si = seatData.seatIndex;
    } else {
        userMgr.sendMsg(seatData.userId, 'game_action_push');
    }
}

// =====================================================================
// 动作超时（托管）
// =====================================================================

function clearActionTimer(game) {
    if (game.actionTimer != null) {
        clearTimeout(game.actionTimer);
        game.actionTimer = null;
    }
}

/** 为"出牌"阶段设置超时：超时后 AI 代打 */
function armChuPaiTimer(game) {
    clearActionTimer(game);
    var timeout = game.conf.actionTimeout;
    if (!timeout || timeout <= 0) return;
    game.actionTimer = setTimeout(function () {
        var seatData = game.gameSeats[game.turn];
        if (seatData == null || seatData.hued || !seatData.canChuPai) return;
        // 若有可胡/可杠提示未响应，先自动过
        if (hasOperations(seatData)) {
            clearAllOptions(game, seatData);
            userMgr.sendMsg(seatData.userId, "guo_result");
        }
        var pai = bestDiscard(seatData);
        console.log("[hzmj] 超时托管出牌 seat=" + seatData.seatIndex + " pai=" + pai);
        exports.chuPai(seatData.userId, pai);
    }, timeout * 1000);
}

/** 为"动作响应"阶段设置超时：超时后对未响应者自动过 */
function armActionTimer(game) {
    clearActionTimer(game);
    var timeout = game.conf.actionTimeout;
    if (!timeout || timeout <= 0) return;
    game.actionTimer = setTimeout(function () {
        for (var i = 0; i < 4; i++) {
            var sd = game.gameSeats[i];
            if (hasOperations(sd) && sd.respondedAction == null) {
                console.log("[hzmj] 超时自动过 seat=" + i);
                exports.guo(sd.userId);
            }
        }
    }, timeout * 1000);
}

// =====================================================================
// 回合流转
// =====================================================================

function moveToNextUser(game, nextSeat) {
    if (nextSeat == null) {
        game.turn = (game.turn + 1) % 4;
    } else {
        game.turn = nextSeat;
    }
}

function recordGameAction(game, si, action, pai) {
    game.actionList.push(si);
    game.actionList.push(action);
    if (pai != null) {
        game.actionList.push(pai);
    }
}

/** 当前玩家摸牌，并进入出牌阶段 */
function doUserMoPai(game) {
    game.chuPai = -1;
    var turnSeat = game.gameSeats[game.turn];
    var pai = mopai(game, game.turn);

    if (pai === -1) {
        // 流局
        doGameOver(game, turnSeat.userId);
        return;
    }

    var numOfMJ = game.mahjongs.length - game.currentIndex;
    userMgr.broacastInRoom('mj_count_push', numOfMJ, turnSeat.userId, true);

    recordGameAction(game, game.turn, ACTION_MOPAI, pai);
    userMgr.sendMsg(turnSeat.userId, 'game_mopai_push', pai);

    // 检查暗杠、补杠、自摸
    checkCanAnGang(game, turnSeat);
    checkCanWanGang(game, turnSeat);
    if (canHuWith(turnSeat, -1)) {
        turnSeat.canHu = true;
    }

    turnSeat.canChuPai = true;
    userMgr.broacastInRoom('game_chupai_push', turnSeat.userId, turnSeat.userId, true);

    sendOperations(game, turnSeat, game.chuPai);
    armChuPaiTimer(game);
}

// =====================================================================
// 出牌
// =====================================================================

exports.chuPai = function (userId, pai) {
    pai = Number.parseInt(pai);
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) return;
    var game = seatData.game;
    var seatIndex = seatData.seatIndex;

    if (game.turn != seatIndex) { console.log("[hzmj] not your turn."); return; }
    if (seatData.hued) { console.log('[hzmj] already hued.'); return; }
    if (seatData.canChuPai == false) { console.log('[hzmj] no need chupai.'); return; }
    if (pai === LAIZI_ID && !game.conf.laiziChu) { console.log('[hzmj] laizi cannot be discarded.'); return; }

    var index = seatData.holds.indexOf(pai);
    if (index === -1) { console.log("[hzmj] can't find mj " + pai); return; }

    clearActionTimer(game);

    // 出牌视为放弃自身的自摸/杠提示
    clearAllOptions(game, seatData);

    seatData.canChuPai = false;
    game.chupaiCnt++;
    seatData.holds.splice(index, 1);
    seatData.countMap[pai]--;
    game.chuPai = pai;
    recordGameAction(game, seatIndex, ACTION_CHUPAI, pai);

    userMgr.broacastInRoom('game_chupai_notify_push', { userId: seatData.userId, pai: pai }, seatData.userId, true);

    // 癞子牌不可被任何动作响应
    if (pai === LAIZI_ID) {
        settleFoldAndNext(game, seatData);
        return;
    }

    // 检查其他玩家的胡/碰/杠
    var hasActions = false;
    for (var i = 0; i < 4; ++i) {
        if (game.turn === i) continue;
        var ddd = game.gameSeats[i];
        if (ddd.hued) continue;

        if (game.conf.canJiePao && canHuWith(ddd, pai)) {
            ddd.canHu = true;
        }
        checkCanPeng(game, ddd, pai);
        checkCanDianGang(game, ddd, pai);
        if (hasOperations(ddd)) {
            ddd.respondedAction = null;
            sendOperations(game, ddd, game.chuPai);
            hasActions = true;
        }
    }

    if (!hasActions) {
        settleFoldAndNext(game, seatData);
    } else {
        game.actionContext = { type: "chupai", fromSeat: seatIndex, pai: pai };
        armActionTimer(game);
    }
};

/** 无人响应出牌：牌入folds，下家摸牌 */
function settleFoldAndNext(game, seatData) {
    setTimeout(function () {
        userMgr.broacastInRoom('guo_notify_push', { userId: seatData.userId, pai: game.chuPai }, seatData.userId, true);
        seatData.folds.push(game.chuPai);
        game.chuPai = -1;
        game.actionContext = null;
        moveToNextUser(game);
        doUserMoPai(game);
    }, 300);
}

// =====================================================================
// 动作响应统一裁决
//   多人响应上下文（出牌/抢杠）中，所有有操作的玩家响应完毕后，
//   按 胡(按出牌者起顺序截胡) > 杠 > 碰 > 全过 的顺序裁决。
// =====================================================================

/** 是否为"自己回合"的动作（自摸/暗杠/补杠提示），非多人响应 */
function isSelfTurnContext(game, seatData) {
    return game.chuPai === -1
        && game.turn === seatData.seatIndex
        && game.qiangGangContext == null
        && game.actionContext == null;
}

/** 检查是否仍有未响应的操作 */
function hasUnresponded(game) {
    for (var i = 0; i < 4; ++i) {
        var sd = game.gameSeats[i];
        if (hasOperations(sd) && sd.respondedAction == null) return true;
    }
    return false;
}

/** 响应收集完毕后的统一裁决 */
function tryResolveActions(game) {
    if (hasUnresponded(game)) return;

    clearActionTimer(game);
    var ctx = game.actionContext;
    game.actionContext = null;
    if (ctx == null) return;

    // 响应顺序：从动作发起者的下家开始（截胡规则）
    var order = [];
    for (var k = 1; k < 4; ++k) order.push((ctx.fromSeat + k) % 4);

    // 1) 胡（截胡，顺序优先）
    for (var h = 0; h < order.length; h++) {
        var hs = game.gameSeats[order[h]];
        if (hs.respondedAction != null && hs.respondedAction.op === 'hu') {
            exports.hu(hs.userId);
            return;
        }
    }

    // 2) 杠
    for (var g = 0; g < order.length; g++) {
        var gs = game.gameSeats[order[g]];
        if (gs.respondedAction != null && gs.respondedAction.op === 'gang') {
            doGangResponse(game, gs);
            return;
        }
    }

    // 3) 碰
    for (var p = 0; p < order.length; p++) {
        var ps = game.gameSeats[order[p]];
        if (ps.respondedAction != null && ps.respondedAction.op === 'peng') {
            resolvePeng(game, ps);
            return;
        }
    }

    // 4) 全过
    clearAllOptions(game);
    var qiangGangContext = game.qiangGangContext;
    if (qiangGangContext != null && qiangGangContext.isValid) {
        game.qiangGangContext = null;
        doGang(game, qiangGangContext.turnSeat, qiangGangContext.seatData, "wangang", 1, qiangGangContext.pai);
        return;
    }

    if (ctx.type === "chupai" && game.chuPai >= 0) {
        var fromSeat = game.gameSeats[ctx.fromSeat];
        userMgr.broacastInRoom('guo_notify_push', { userId: fromSeat.userId, pai: game.chuPai }, fromSeat.userId, true);
        fromSeat.folds.push(game.chuPai);
        game.chuPai = -1;
        moveToNextUser(game);
        doUserMoPai(game);
    }
}

/** 裁决执行：点杠/暗杠（响应上下文中的杠） */
function doGangResponse(game, seatData) {
    var pai = seatData.respondedAction.pai;
    var numOfCnt = seatData.countMap[pai];
    var gangtype = "";
    if (numOfCnt === 1) gangtype = "wangang";
    else if (numOfCnt === 3) gangtype = "diangang";
    else if (numOfCnt === 4) gangtype = "angang";
    else return;

    var turnSeat = game.gameSeats[game.turn];
    game.chuPai = -1;
    clearAllOptions(game);
    seatData.canChuPai = false;

    userMgr.broacastInRoom('hangang_notify_push', seatData.seatIndex, seatData.userId, true);

    // 补杠需检查抢杠
    if (numOfCnt === 1 && game.conf.qiangGang) {
        var hasQiang = false;
        for (var i = 0; i < 4; ++i) {
            if (seatData.seatIndex === i) continue;
            var ddd = game.gameSeats[i];
            if (ddd.hued) continue;
            if (canHuWith(ddd, pai)) {
                ddd.canHu = true;
                ddd.respondedAction = null;
                sendOperations(game, ddd, pai);
                hasQiang = true;
            }
        }
        if (hasQiang) {
            game.qiangGangContext = { turnSeat: turnSeat, seatData: seatData, pai: pai, isValid: true };
            game.actionContext = { type: "qianggang", fromSeat: seatData.seatIndex, pai: pai };
            armActionTimer(game);
            return;
        }
    }

    doGang(game, turnSeat, seatData, gangtype, numOfCnt, pai);
}

// =====================================================================
// 碰
// =====================================================================

exports.peng = function (userId) {
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) return;
    var game = seatData.game;

    if (game.turn === seatData.seatIndex) return;
    if (seatData.canPeng === false) return;
    if (seatData.hued) return;

    seatData.respondedAction = { op: 'peng' };
    tryResolveActions(game);
};

function resolvePeng(game, seatData) {
    clearActionTimer(game);
    clearAllOptions(game);

    var pai = game.chuPai;
    var c = seatData.countMap[pai];
    if (c == null || c < 2) return;

    for (var i = 0; i < 2; ++i) {
        var index = seatData.holds.indexOf(pai);
        if (index === -1) return;
        seatData.holds.splice(index, 1);
        seatData.countMap[pai]--;
    }
    seatData.pengs.push(pai);
    game.chuPai = -1;
    game.actionContext = null;

    recordGameAction(game, seatData.seatIndex, ACTION_PENG, pai);
    userMgr.broacastInRoom('peng_notify_push', { userid: seatData.userId, pai: pai }, seatData.userId, true);

    moveToNextUser(game, seatData.seatIndex);
    seatData.canChuPai = true;
    userMgr.broacastInRoom('game_chupai_push', seatData.userId, seatData.userId, true);
    armChuPaiTimer(game);
}

// =====================================================================
// 杠
// =====================================================================

exports.gang = function (userId, pai) {
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) return;
    var game = seatData.game;

    if (seatData.canGang === false) return;
    if (seatData.hued) return;
    if (seatData.gangPai.indexOf(pai) === -1) return;
    if (pai === LAIZI_ID) return;

    // 多人响应上下文：记录响应，等待统一裁决
    if (!isSelfTurnContext(game, seatData)) {
        seatData.respondedAction = { op: 'gang', pai: pai };
        tryResolveActions(game);
        return;
    }

    // 自己回合（暗杠/补杠）：直接执行
    seatData.respondedAction = { op: 'gang', pai: pai };
    doGangResponse(game, seatData);
};

function doGang(game, turnSeat, seatData, gangtype, numOfCnt, pai) {
    clearActionTimer(game);
    var seatIndex = seatData.seatIndex;
    var gameTurn = turnSeat.seatIndex;

    if (gangtype === "wangang") {
        var idx = seatData.pengs.indexOf(pai);
        if (idx >= 0) seatData.pengs.splice(idx, 1);
    }

    for (var i = 0; i < numOfCnt; ++i) {
        var index = seatData.holds.indexOf(pai);
        if (index === -1) return;
        seatData.holds.splice(index, 1);
        seatData.countMap[pai]--;
    }

    recordGameAction(game, seatIndex, ACTION_GANG, pai);

    // 杠分即时结算
    var conf = game.conf;
    var per = conf.gangScore * conf.baseScore;
    if (gangtype === "angang") {
        seatData.angangs.push(pai);
        seatData.numAnGang++;
        for (var t = 0; t < 4; ++t) {
            if (t !== seatIndex) {
                game.gameSeats[t].score -= per * 2;
                seatData.score += per * 2;
            }
        }
    } else if (gangtype === "diangang") {
        seatData.diangangs.push(pai);
        seatData.numMingGang++;
        game.gameSeats[gameTurn].score -= per * 2;
        seatData.score += per * 2;
    } else if (gangtype === "wangang") {
        seatData.wangangs.push(pai);
        seatData.numMingGang++;
        for (var w = 0; w < 4; ++w) {
            if (w !== seatIndex) {
                game.gameSeats[w].score -= per;
                seatData.score += per;
            }
        }
    }

    userMgr.broacastInRoom('gang_notify_push', { userid: seatData.userId, pai: pai, gangtype: gangtype }, seatData.userId, true);

    moveToNextUser(game, seatIndex);
    doUserMoPai(game);
}

// =====================================================================
// 胡
// =====================================================================

exports.hu = function (userId) {
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) return;
    var seatIndex = seatData.seatIndex;
    var game = seatData.game;

    if (seatData.canHu === false) return;
    if (seatData.hued) return;

    // 多人响应上下文（点炮/抢杠）：记录响应，等待统一裁决（截胡顺序）
    if (game.actionContext != null && !isSelfTurnContext(game, seatData)) {
        seatData.respondedAction = { op: 'hu' };
        tryResolveActions(game);
        return;
    }

    // 抢杠上下文中的胡：杠者取消杠
    var hupai;
    var isZimo = false;
    var huType; // "zimo" | "hu" | "qiangganghu"
    var targetSeat = -1; // 付分者（点炮/被抢杠），自摸为 -1

    if (game.qiangGangContext != null && game.qiangGangContext.isValid) {
        var ctx = game.qiangGangContext;
        hupai = ctx.pai;
        huType = "qiangganghu";
        targetSeat = ctx.seatData.seatIndex;
        ctx.isValid = false;
        // 把被抢的牌从杠者手中扣回（补杠的 1 张还在手上）
        var idx = ctx.seatData.holds.indexOf(hupai);
        if (idx !== -1) {
            ctx.seatData.holds.splice(idx, 1);
            ctx.seatData.countMap[hupai]--;
            userMgr.sendMsg(ctx.seatData.userId, 'game_holds_push', ctx.seatData.holds);
        }
        seatData.holds.push(hupai);
        seatData.countMap[hupai] = (seatData.countMap[hupai] || 0) + 1;
        game.qiangGangContext = null;
    } else if (game.chuPai === -1) {
        // 自摸
        hupai = seatData.holds[seatData.holds.length - 1];
        huType = "zimo";
        isZimo = true;
    } else {
        hupai = game.chuPai;
        huType = "hu";
        targetSeat = game.turn;
        seatData.holds.push(game.chuPai);
        seatData.countMap[game.chuPai] = (seatData.countMap[game.chuPai] || 0) + 1;
    }

    seatData.hued = true;
    seatData.iszimo = isZimo;
    seatData.huCard = hupai;
    recordGameAction(game, seatIndex, isZimo ? ACTION_ZIMO : ACTION_HU, hupai);

    // 统计
    if (isZimo) seatData.numZiMo++;
    else seatData.numJiePao++;
    if (targetSeat >= 0) game.gameSeats[targetSeat].numDianPao++;

    // 胡牌牌型与番数（癞子算法）
    var idx34 = seatIndex34(seatData);
    var weaves = seatWeaves(seatData);
    var huInfo = LaiziLogic.analyseHuLaizi(idx34, weaves, weaves.length, 0, TileMap.LAIZI_INDEX);

    var conf = game.conf;
    var fan = 0;
    var patterns = [];
    if (huInfo.isQiDui) { fan += conf.qdFan; patterns.push("7pairs"); }
    if (huInfo.isPengPeng) { fan += conf.pphFan; patterns.push("duidui"); }
    if (huInfo.isQingYiSe) { fan += conf.qysFan; patterns.push("qingyise"); seatData.qingyise = true; }
    if (isZimo) fan += conf.zimoFan;
    if (huType === "qiangganghu") fan += 1;
    if (patterns.length === 0) patterns.push("pinghu");

    // 每个手中红中加番（可配置）
    var laiziInHand = seatData.countMap[LAIZI_ID] || 0;
    if (conf.fanPerLaizi > 0 && laiziInHand > 0) {
        fan += conf.fanPerLaizi * laiziInHand;
    }

    if (fan > conf.maxFan) fan = conf.maxFan;
    seatData.fan = fan;
    seatData.pattern = patterns.join(",");

    var score = conf.baseScore * (1 << fan);
    if (isZimo) {
        for (var i = 0; i < 4; ++i) {
            if (i !== seatIndex) {
                game.gameSeats[i].score -= score;
                seatData.score += score;
            }
        }
    } else {
        game.gameSeats[targetSeat].score -= score;
        seatData.score += score;
    }

    // 天地胡（简单版）：庄家首轮自摸为天胡，非庄家首轮胡为地胡
    seatData.isTianHu = isZimo && game.chupaiCnt === 0 && seatIndex === game.button;
    seatData.isDiHu = !isZimo && game.chupaiCnt === 1 && game.turn === game.button;
    seatData.isHaiDiHu = game.currentIndex >= game.mahjongs.length;
    seatData.isGangHu = false;

    game.hupaiList.push(seatIndex);

    clearAllOptions(game);
    clearActionTimer(game);

    userMgr.broacastInRoom('hu_push', { seatindex: seatIndex, iszimo: isZimo, hupai: hupai }, seatData.userId, true);

    // 红中麻将：一家胡牌即结束
    doGameOver(game, seatData.userId);
};

// =====================================================================
// 过
// =====================================================================

exports.guo = function (userId) {
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) return;
    var game = seatData.game;

    if (hasOperations(seatData) === false) return;

    userMgr.sendMsg(seatData.userId, "guo_result");

    // 自己回合的过（放弃自摸/杠），仅清除提示，继续出牌
    if (isSelfTurnContext(game, seatData)) {
        clearAllOptions(game, seatData);
        return;
    }

    // 多人响应上下文：记录"过"，等待统一裁决
    clearAllOptions(game, seatData); // 清除操作标记（该家不再计入未响应等待）
    seatData.respondedAction = { op: 'guo' };
    tryResolveActions(game);
};

// =====================================================================
// 结算
// =====================================================================

function store_history(roomInfo) {
    var seats = roomInfo.seats;
    var history = {
        uuid: roomInfo.uuid,
        id: roomInfo.id,
        time: roomInfo.createTime,
        seats: new Array(4)
    };
    for (var i = 0; i < seats.length; ++i) {
        var rs = seats[i];
        history.seats[i] = {
            userid: rs.userId,
            name: crypto.toBase64(rs.name || ""),
            score: rs.score
        };
    }
    for (var j = 0; j < seats.length; ++j) {
        if (seats[j].userId > 0) {
            store_single_history(seats[j].userId, history);
        }
    }
}

function store_single_history(userId, history) {
    db.get_user_history(userId, function (data) {
        if (data == null) data = [];
        while (data.length >= 10) data.shift();
        data.push(history);
        db.update_user_history(userId, data);
    });
}

function construct_game_base_info(game) {
    var baseInfo = {
        type: game.conf.type,
        button: game.button,
        index: game.gameIndex,
        mahjongs: game.mahjongs,
        game_seats: new Array(4)
    };
    for (var i = 0; i < 4; ++i) {
        baseInfo.game_seats[i] = game.gameSeats[i].holds;
    }
    game.baseInfoJson = JSON.stringify(baseInfo);
}

function store_game(game, callback) {
    db.create_game(game.roomInfo.uuid, game.gameIndex, game.baseInfoJson, callback);
}

function doGameOver(game, userId, forceEnd) {
    var roomId = game.roomInfo.id;
    var roomInfo = game.roomInfo;
    clearActionTimer(game);

    var results = [];
    var dbresult = [0, 0, 0, 0];

    var fnNoticeResult = function (isEnd) {
        var endinfo = null;
        if (isEnd) {
            endinfo = [];
            for (var i = 0; i < roomInfo.seats.length; ++i) {
                var rs = roomInfo.seats[i];
                endinfo.push({
                    numzimo: rs.numZiMo,
                    numjiepao: rs.numJiePao,
                    numdianpao: rs.numDianPao,
                    numangang: rs.numAnGang,
                    numminggang: rs.numMingGang,
                    numchadajiao: 0
                });
            }
        }
        userMgr.broacastInRoom('game_over_push', { results: results, endinfo: endinfo }, userId, true);
        if (isEnd) {
            setTimeout(function () {
                if (roomInfo.numOfGames > 1) {
                    store_history(roomInfo);
                }
                userMgr.kickAllInRoom(roomId);
                roomMgr.destroy(roomId);
                if (db.archive_games) db.archive_games(roomInfo.uuid);
            }, 1500);
        }
    };

    for (var i = 0; i < 4; ++i) {
        var rs = roomInfo.seats[i];
        var sd = game.gameSeats[i];

        rs.ready = false;
        rs.score += sd.score;
        rs.numZiMo += sd.numZiMo;
        rs.numJiePao += sd.numJiePao;
        rs.numDianPao += sd.numDianPao;
        rs.numAnGang += sd.numAnGang;
        rs.numMingGang += sd.numMingGang;

        var userRT = {
            userId: sd.userId,
            pengs: sd.pengs,
            actions: [],
            wangangs: sd.wangangs,
            diangangs: sd.diangangs,
            angangs: sd.angangs,
            numofgen: 0,
            holds: sd.holds,
            fan: sd.fan,
            score: sd.score,
            totalscore: rs.score,
            qingyise: sd.qingyise === true,
            pattern: sd.pattern || "",
            isganghu: false,
            menqing: false,
            zhongzhang: false,
            jingouhu: false,
            haidihu: sd.isHaiDiHu === true,
            tianhu: sd.isTianHu === true,
            dihu: sd.isDiHu === true,
            huorder: game.hupaiList.indexOf(i)
        };
        results.push(userRT);
        dbresult[i] = sd.score;
        delete gameSeatsOfUsers[sd.userId];
    }
    delete games[roomId];

    // 庄家轮换：有胡则胡牌者坐庄，流局则下家
    var old = roomInfo.nextButton;
    if (game.hupaiList.length > 0) {
        roomInfo.nextButton = game.hupaiList[0];
    } else {
        roomInfo.nextButton = (game.button + 1) % 4;
    }
    if (old !== roomInfo.nextButton && db.update_next_button) {
        db.update_next_button(roomId, roomInfo.nextButton);
    }

    if (forceEnd || game == null) {
        fnNoticeResult(true);
        return;
    }

    construct_game_base_info(game);
    store_game(game, function () {
        if (db.update_game_result) db.update_game_result(roomInfo.uuid, game.gameIndex, dbresult);
        if (db.update_game_action_records) db.update_game_action_records(roomInfo.uuid, game.gameIndex, JSON.stringify(game.actionList));
        if (db.update_num_of_turns) db.update_num_of_turns(roomId, roomInfo.numOfGames);

        // 第一局扣房卡（仅真实玩家）
        if (roomInfo.numOfGames === 1) {
            var cost = roomInfo.conf.maxGames >= 8 ? 3 : 2;
            if (roomInfo.seats[0].userId > 0 && db.cost_gems) {
                db.cost_gems(roomInfo.seats[0].userId, cost);
            }
        }

        var isEnd = roomInfo.numOfGames >= roomInfo.conf.maxGames;
        fnNoticeResult(isEnd);
    });
}

// =====================================================================
// 开局 / 准备 / 同步
// =====================================================================

exports.setReady = function (userId, callback) {
    var roomId = roomMgr.getUserRoom(userId);
    if (roomId == null) return;
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) return;

    roomMgr.setReady(userId, true);

    var game = games[roomId];
    if (game == null) {
        if (roomInfo.seats.length === 4) {
            for (var i = 0; i < 4; ++i) {
                var s = roomInfo.seats[i];
                if (s.ready === false || userMgr.isOnline(s.userId) === false) {
                    return;
                }
            }
            exports.begin(roomId);
        }
    } else {
        // 断线重连：同步整局数据
        var numOfMJ = game.mahjongs.length - game.currentIndex;
        var data = {
            state: game.state,
            numofmj: numOfMJ,
            button: game.button,
            turn: game.turn,
            chuPai: game.chuPai,
            huanpaimethod: -1
        };
        data.seats = [];
        var seatData = null;
        for (var j = 0; j < 4; ++j) {
            var sd = game.gameSeats[j];
            var s = {
                userid: sd.userId,
                folds: sd.folds,
                angangs: sd.angangs,
                diangangs: sd.diangangs,
                wangangs: sd.wangangs,
                pengs: sd.pengs,
                que: -1,
                hued: sd.hued,
                iszimo: sd.iszimo
            };
            if (sd.userId === userId) {
                s.holds = sd.holds;
                seatData = sd;
            }
            data.seats.push(s);
        }
        userMgr.sendMsg(userId, 'game_sync_push', data);
        if (seatData != null) {
            sendOperations(game, seatData, game.chuPai);
        }
    }
};

exports.begin = function (roomId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) return;
    applyConfDefaults(roomInfo.conf);
    var seats = roomInfo.seats;

    var game = {
        conf: roomInfo.conf,
        roomInfo: roomInfo,
        gameIndex: roomInfo.numOfGames,
        button: roomInfo.nextButton,
        mahjongs: new Array(112),
        currentIndex: 0,
        gameSeats: new Array(4),
        turn: 0,
        chuPai: -1,
        state: "playing",
        actionList: [],
        hupaiList: [],
        chupaiCnt: 0,
        actionContext: null,
        qiangGangContext: null,
        actionTimer: null
    };
    roomInfo.numOfGames++;

    for (var i = 0; i < 4; ++i) {
        var data = game.gameSeats[i] = {};
        data.game = game;
        data.seatIndex = i;
        data.userId = seats[i].userId;
        data.holds = [];
        data.folds = [];
        data.angangs = [];
        data.diangangs = [];
        data.wangangs = [];
        data.pengs = [];
        data.countMap = {};
        data.canGang = false;
        data.gangPai = [];
        data.canPeng = false;
        data.canHu = false;
        data.canChuPai = false;
        data.respondedAction = null;
        data.hued = false;
        data.iszimo = false;
        data.fan = 0;
        data.score = 0;
        data.pattern = "";
        data.huCard = -1;
        data.qingyise = false;
        data.isTianHu = false;
        data.isDiHu = false;
        data.isHaiDiHu = false;
        data.isGangHu = false;
        data.numZiMo = 0;
        data.numJiePao = 0;
        data.numDianPao = 0;
        data.numAnGang = 0;
        data.numMingGang = 0;
        gameSeatsOfUsers[data.userId] = data;
    }

    games[roomId] = game;
    shuffle(game);
    deal(game);

    var numOfMJ = game.mahjongs.length - game.currentIndex;
    for (var k = 0; k < 4; ++k) {
        var s = seats[k];
        userMgr.sendMsg(s.userId, 'game_holds_push', game.gameSeats[k].holds);
        userMgr.sendMsg(s.userId, 'mj_count_push', numOfMJ);
        userMgr.sendMsg(s.userId, 'game_num_push', roomInfo.numOfGames);
        userMgr.sendMsg(s.userId, 'game_begin_push', game.button);
        userMgr.sendMsg(s.userId, 'game_playing_push');
    }

    // 庄家直接出牌
    var turnSeat = game.gameSeats[game.turn];
    // 庄家起手检查天胡/暗杠
    checkCanAnGang(game, turnSeat);
    if (canHuWith(turnSeat, -1)) {
        turnSeat.canHu = true;
    }
    turnSeat.canChuPai = true;
    userMgr.broacastInRoom('game_chupai_push', turnSeat.userId, turnSeat.userId, true);
    sendOperations(game, turnSeat, game.chuPai);
    armChuPaiTimer(game);
};

exports.isPlaying = function (userId) {
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) return false;
    return seatData.game.state !== "idle";
};

exports.hasBegan = function (roomId) {
    var game = games[roomId];
    if (game != null) return true;
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo != null) return roomInfo.numOfGames > 0;
    return false;
};

// =====================================================================
// 解散
// =====================================================================

var dissolvingList = [];

exports.doDissolve = function (roomId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) return null;
    var game = games[roomId];
    if (game != null) {
        doGameOver(game, roomInfo.seats[0].userId, true);
    }
};

exports.dissolveRequest = function (roomId, userId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) return null;
    if (roomInfo.dr != null) return null;
    var seatIndex = roomMgr.getUserSeat(userId);
    if (seatIndex == null) return null;
    roomInfo.dr = { endTime: Date.now() + 30000, states: [false, false, false, false] };
    roomInfo.dr.states[seatIndex] = true;
    dissolvingList.push(roomId);
    return roomInfo;
};

exports.dissolveAgree = function (roomId, userId, agree) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) return null;
    if (roomInfo.dr == null) return null;
    var seatIndex = roomMgr.getUserSeat(userId);
    if (seatIndex == null) return null;
    if (agree) {
        roomInfo.dr.states[seatIndex] = true;
    } else {
        roomInfo.dr = null;
        var idx = dissolvingList.indexOf(roomId);
        if (idx !== -1) dissolvingList.splice(idx, 1);
    }
    return roomInfo;
};

function update() {
    for (var i = dissolvingList.length - 1; i >= 0; --i) {
        var roomId = dissolvingList[i];
        var roomInfo = roomMgr.getRoom(roomId);
        if (roomInfo != null && roomInfo.dr != null) {
            if (Date.now() > roomInfo.dr.endTime) {
                exports.doDissolve(roomId);
                dissolvingList.splice(i, 1);
            }
        } else {
            dissolvingList.splice(i, 1);
        }
    }
}

setInterval(update, 1000);

// 测试用（不暴露给客户端消息）
exports.__test__ = {
    games: games,
    gameSeatsOfUsers: gameSeatsOfUsers,
    mopai: mopai,
    doGameOver: doGameOver
};
