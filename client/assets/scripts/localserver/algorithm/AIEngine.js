//
// AIEngine.js —— 麻将机器人大脑
//
// 移植自 xiyoufang/mahjong 的 Classes/GameLogic/AIEngine.cpp（MIT 协议），
// 并在其"胡>杠>碰、摸啥打啥"的基础策略上增强：
//   - 出牌使用癞子听口评估（LaiziLogic.getBestDiscardLaizi）
//   - 无癞子玩法（血战/血流）使用 GameLogic 听口评估 + 缺门约束
//   - 碰牌策略：已听牌不拆听，未听牌有碰就碰
//
// 该模块为纯决策逻辑，不含任何网络/定时器依赖，方便单元测试与客户端单机复用。
//

'use strict';

var GameLogic = require('./GameLogic');
var LaiziLogic = require('./LaiziLogic');
var TileMap = require('./TileMap');

var LAIZI_ID = TileMap.HONGZHONG_ID;

// =====================================================================
// 机器人状态
// =====================================================================

function createBotState(userId) {
    return {
        userId: userId,
        seatIndex: -1,
        holds: [],
        pengs: [],
        angangs: [],
        diangangs: [],
        wangangs: [],
        que: -1,            // 血战/血流缺门
        gameType: "hzmj",
        hued: false
    };
}

function resetForNewGame(bot) {
    bot.holds = [];
    bot.pengs = [];
    bot.angangs = [];
    bot.diangangs = [];
    bot.wangangs = [];
    bot.que = -1;
    bot.hued = false;
}

function countWeaves(bot) {
    return bot.pengs.length + bot.angangs.length + bot.diangangs.length + bot.wangangs.length;
}

function botIndex34(bot, extraId) {
    var idx = TileMap.holdsToIndex(bot.holds);
    if (extraId != null && extraId >= 0) {
        idx[GameLogic.switchToCardIndex(TileMap.idToCard(extraId))]++;
    }
    return idx;
}

function botWeaves(bot) {
    var weaves = [];
    var i;
    for (i = 0; i < bot.pengs.length; i++) {
        weaves.push({ cbWeaveKind: GameLogic.WIK_P, cbCenterCard: TileMap.idToCard(bot.pengs[i]), cbPublicCard: 1, cbProvideUser: 0, cbValid: 1 });
    }
    var gangs = bot.angangs.concat(bot.diangangs, bot.wangangs);
    for (i = 0; i < gangs.length; i++) {
        weaves.push({ cbWeaveKind: GameLogic.WIK_G, cbCenterCard: TileMap.idToCard(gangs[i]), cbPublicCard: 1, cbProvideUser: 0, cbValid: 1 });
    }
    return weaves;
}

// =====================================================================
// 事件镜像（维护机器人手牌视图，与客户端 GameNetMgr 同协议）
// =====================================================================

function removeFromHolds(bot, pai, count) {
    for (var i = 0; i < count; i++) {
        var idx = bot.holds.indexOf(pai);
        if (idx === -1) return false;
        bot.holds.splice(idx, 1);
    }
    return true;
}

/** 根据服务器推送维护本地状态，返回是否需要决策提示 */
function updateOnEvent(bot, event, data) {
    switch (event) {
        case 'game_holds_push':
            // 新一局总是以 game_holds_push 开始：先重置再装填手牌
            // （不能放在 game_begin_push 重置——它在 holds 之后到达，会把牌清掉）
            resetForNewGame(bot);
            bot.holds = (data || []).slice();
            break;
        case 'game_over_push':
            resetForNewGame(bot);
            break;
        case 'game_mopai_push':
            bot.holds.push(data);
            break;
        case 'game_chupai_notify_push':
            if (data && data.userId === bot.userId) {
                removeFromHolds(bot, data.pai, 1);
            }
            break;
        case 'peng_notify_push':
            if (data && data.userid === bot.userId) {
                removeFromHolds(bot, data.pai, 2);
                bot.pengs.push(data.pai);
            }
            break;
        case 'gang_notify_push':
            if (data && data.userid === bot.userId) {
                if (data.gangtype === 'wangang') {
                    var pi = bot.pengs.indexOf(data.pai);
                    if (pi !== -1) bot.pengs.splice(pi, 1);
                    removeFromHolds(bot, data.pai, 1);
                    bot.wangangs.push(data.pai);
                } else if (data.gangtype === 'angang') {
                    removeFromHolds(bot, data.pai, 4);
                    bot.angangs.push(data.pai);
                } else {
                    removeFromHolds(bot, data.pai, 3);
                    bot.diangangs.push(data.pai);
                }
            }
            break;
        case 'hu_push':
            if (data && data.seatindex === bot.seatIndex) bot.hued = true;
            break;
        case 'game_sync_push':
            if (data && data.seats) {
                for (var i = 0; i < data.seats.length; i++) {
                    var sd = data.seats[i];
                    if (sd.userid === bot.userId) {
                        bot.holds = (sd.holds || []).slice();
                        bot.pengs = (sd.pengs || []).slice();
                        bot.angangs = (sd.angangs || []).slice();
                        bot.diangangs = (sd.diangangs || []).slice();
                        bot.wangangs = (sd.wangangs || []).slice();
                        bot.que = sd.que != null ? sd.que : -1;
                        bot.hued = sd.hued === true;
                    }
                }
            }
            break;
        case 'game_dingque_finish_push':
            if (data && bot.seatIndex >= 0 && data[bot.seatIndex] != null) {
                bot.que = data[bot.seatIndex];
            }
            break;
    }
}

// =====================================================================
// 决策：动作响应（game_action_push）
// =====================================================================

/**
 * @param bot   机器人状态
 * @param data  game_action_push 数据 {pai, hu, peng, gang, gangpai}
 * @returns {op:'hu'} | {op:'gang', pai} | {op:'peng'} | {op:'guo'}
 */
function decideAction(bot, data) {
    if (data == null) return { op: 'guo' };

    // 胡优先
    if (data.hu) return { op: 'hu' };

    // 杠其次（红中麻将杠分即时到账，基本稳赚；血战类同理）
    if (data.gang && data.gangpai && data.gangpai.length > 0) {
        var gp = data.gangpai[0];
        if (gp !== LAIZI_ID) return { op: 'gang', pai: gp };
    }

    // 碰：已听牌不拆听，未听牌有碰就碰
    if (data.peng) {
        if (bot.gameType === 'hzmj') {
            var idx = botIndex34(bot);
            var weaves = botWeaves(bot);
            var ting = LaiziLogic.analyseTingCardResultLaizi(idx, weaves, weaves.length, TileMap.LAIZI_INDEX);
            if (ting.tingCount > 0) return { op: 'guo' }; // 已听不碰
        }
        return { op: 'peng' };
    }

    return { op: 'guo' };
}

// =====================================================================
// 决策：出牌
// =====================================================================

/** 红中麻将：癞子听口评估选牌 */
function decideDiscardHzmj(bot) {
    var idx = botIndex34(bot);
    var weaves = botWeaves(bot);
    var best = LaiziLogic.getBestDiscardLaizi(idx, weaves, weaves.length, TileMap.LAIZI_INDEX);
    if (best.card !== 0) return TileMap.cardToId(best.card);
    for (var i = 0; i < bot.holds.length; i++) {
        if (bot.holds[i] !== LAIZI_ID) return bot.holds[i];
    }
    return bot.holds[0];
}

/** 血战/血流：缺门优先，其次听口评估（无癞子） */
function decideDiscardXzdd(bot) {
    // 缺门：必须先打缺门花色
    if (bot.que >= 0) {
        var lo = bot.que * 9, hi = lo + 9;
        var quePais = bot.holds.filter(function (p) { return p >= lo && p < hi; });
        if (quePais.length > 0) {
            // 打缺门中最孤立的
            return mostIsolated(bot.holds, quePais);
        }
    }

    // 听口评估：枚举每张可打牌，取听后听口最大者
    var weaves = botWeaves(bot);
    var bestPai = -1;
    var bestScore = -1;
    var uniq = {};
    for (var i = 0; i < bot.holds.length; i++) {
        var pai = bot.holds[i];
        if (uniq[pai]) continue;
        uniq[pai] = true;

        var temp = bot.holds.slice();
        temp.splice(temp.indexOf(pai), 1);
        var idx = TileMap.holdsToIndex(temp);
        var ting = GameLogic.analyseTingCardResult(idx, weaves, weaves.length);
        var score = ting.tingCount * 100 + isolationInHand(temp, pai);
        if (score > bestScore) {
            bestScore = score;
            bestPai = pai;
        }
    }
    if (bestPai !== -1) return bestPai;
    return bot.holds[0];
}

/** 孤立度（越大越该打）：无靠张、无对子 */
function isolationInHand(holdsAfterRemove, pai) {
    var color = Math.floor(pai / 9);
    if (color > 2) return 8;
    var v = pai % 9;
    var score = 0;
    for (var i = 0; i < holdsAfterRemove.length; i++) {
        var h = holdsAfterRemove[i];
        if (Math.floor(h / 9) !== color) continue;
        var d = Math.abs((h % 9) - v);
        if (d === 0) score -= 4;
        else if (d === 1) score -= 2;
        else if (d === 2) score -= 1;
    }
    if (v === 0 || v === 8) score += 1;
    return score;
}

function mostIsolated(holds, candidates) {
    var bestPai = candidates[0];
    var bestScore = -999;
    for (var i = 0; i < candidates.length; i++) {
        var pai = candidates[i];
        var temp = holds.slice();
        temp.splice(temp.indexOf(pai), 1);
        var s = isolationInHand(temp, pai);
        if (s > bestScore) {
            bestScore = s;
            bestPai = pai;
        }
    }
    return bestPai;
}

function decideDiscard(bot) {
    if (bot.gameType === 'hzmj') return decideDiscardHzmj(bot);
    return decideDiscardXzdd(bot);
}

// =====================================================================
// 决策：血战换三张 / 定缺
// =====================================================================

function suitOf(pai) { return Math.floor(pai / 9); }

/** 定缺：选张数最少的花色 */
function decideDingQue(holds) {
    var cnt = [0, 0, 0];
    for (var i = 0; i < holds.length; i++) {
        var s = suitOf(holds[i]);
        if (s <= 2) cnt[s]++;
    }
    var que = 0;
    for (var k = 1; k < 3; k++) {
        if (cnt[k] < cnt[que]) que = k;
    }
    return que;
}

/** 换三张：从张数最少的花色中选 3 张（不足则取次少花色补齐） */
function decideHuanPai(holds) {
    var bySuit = [[], [], []];
    for (var i = 0; i < holds.length; i++) {
        var s = suitOf(holds[i]);
        if (s <= 2) bySuit[s].push(holds[i]);
    }
    bySuit.sort(function (a, b) { return a.length - b.length; });
    var result = [];
    for (var k = 0; k < 3 && result.length < 3; k++) {
        for (var j = 0; j < bySuit[k].length && result.length < 3; j++) {
            result.push(bySuit[k][j]);
        }
    }
    while (result.length < 3 && holds.length >= 3) {
        result.push(holds[result.length]);
    }
    return result.slice(0, 3);
}

module.exports = {
    createBotState: createBotState,
    resetForNewGame: resetForNewGame,
    updateOnEvent: updateOnEvent,
    decideAction: decideAction,
    decideDiscard: decideDiscard,
    decideDingQue: decideDingQue,
    decideHuanPai: decideHuanPai
};
