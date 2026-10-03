//
// LaiziLogic.js —— 癞子（红中万能牌）麻将算法
//
// 在 GameLogic.js（移植自 xiyoufang/mahjong）基础上新增癞子支持：
//   - 癞子牌从手牌中剥离计数，递归拆分时允许用癞子补齐 将眼/刻子/顺子
//   - 支持 七对 / 碰碰胡 / 清一色 的癞子牌型判定
//   - 支持听牌枚举与最佳出牌推荐（供 AI 与提示使用）
//
// 牌值/索引编码与 GameLogic.js 一致（0x 制 / 34 索引）。
//

'use strict';

var GameLogic = require('./GameLogic');

var MAX_INDEX = GameLogic.MAX_INDEX;

// =====================================================================
// 内部：递归拆分（允许癞子补位）
// =====================================================================

/**
 * 递归判断剩余手牌能否组成 needWeaves 个面子（刻子或顺子）
 * 不变式：sum(arr) + wilds === needWeaves * 3
 * @param arr    index 数组（已剔除癞子与将眼，原地修改后回溯还原）
 * @param wilds  可用癞子数
 * @param needWeaves  还需的面子数
 */
function canFormWeaves(arr, wilds, needWeaves) {
    if (needWeaves === 0) return true;

    // 找第一个非零索引
    var i = -1;
    for (var k = 0; k < MAX_INDEX; k++) {
        if (arr[k] > 0) { i = k; break; }
    }
    if (i === -1) {
        // 手牌清空，剩余癞子必为 3 的倍数（由不变式保证），可自行组成面子
        return wilds % 3 === 0;
    }

    //—— 尝试 1：刻子（含癞子补位）——
    if (arr[i] >= 3) {
        arr[i] -= 3;
        if (canFormWeaves(arr, wilds, needWeaves - 1)) { arr[i] += 3; return true; }
        arr[i] += 3;
    }
    if (arr[i] >= 2 && wilds >= 1) {
        arr[i] -= 2;
        if (canFormWeaves(arr, wilds - 1, needWeaves - 1)) { arr[i] += 2; return true; }
        arr[i] += 2;
    }
    if (arr[i] >= 1 && wilds >= 2) {
        arr[i] -= 1;
        if (canFormWeaves(arr, wilds - 2, needWeaves - 1)) { arr[i] += 1; return true; }
        arr[i] += 1;
    }

    //—— 尝试 2：顺子 i,i+1,i+2（仅序数牌，i 为首个非零故只需考虑从 i 起）——
    var color = Math.floor(i / 9);
    var value = i % 9;
    if (color <= 2 && value <= 6) {
        var use1 = arr[i] > 0 ? 1 : 0;
        var use2 = arr[i + 1] > 0 ? 1 : 0;
        var use3 = arr[i + 2] > 0 ? 1 : 0;
        var missing = 3 - (use1 + use2 + use3);
        if (missing <= wilds) {
            arr[i] -= use1; arr[i + 1] -= use2; arr[i + 2] -= use3;
            if (canFormWeaves(arr, wilds - missing, needWeaves - 1)) {
                arr[i] += use1; arr[i + 1] += use2; arr[i + 2] += use3;
                return true;
            }
            arr[i] += use1; arr[i + 1] += use2; arr[i + 2] += use3;
        }
    }

    return false;
}

/**
 * 递归判断剩余手牌能否全部组成刻子（碰碰胡判定用）
 */
function canFormTriplets(arr, wilds, needWeaves) {
    if (needWeaves === 0) return true;
    var i = -1;
    for (var k = 0; k < MAX_INDEX; k++) {
        if (arr[k] > 0) { i = k; break; }
    }
    if (i === -1) return wilds % 3 === 0;

    if (arr[i] >= 3) {
        arr[i] -= 3;
        if (canFormTriplets(arr, wilds, needWeaves - 1)) { arr[i] += 3; return true; }
        arr[i] += 3;
    }
    if (arr[i] >= 2 && wilds >= 1) {
        arr[i] -= 2;
        if (canFormTriplets(arr, wilds - 1, needWeaves - 1)) { arr[i] += 2; return true; }
        arr[i] += 2;
    }
    if (arr[i] >= 1 && wilds >= 2) {
        arr[i] -= 1;
        if (canFormTriplets(arr, wilds - 2, needWeaves - 1)) { arr[i] += 1; return true; }
        arr[i] += 1;
    }
    return false;
}

// =====================================================================
// 胡牌判定（癞子）
// =====================================================================

/**
 * 七对判定（癞子版）：weaveCount 必须为 0
 * 对子用实牌，单张补 1 癞，空手补 2 癞
 */
function isQiDuiLaizi(arr, laiziCount) {
    var pairs = 0, odds = 0;
    for (var i = 0; i < MAX_INDEX; i++) {
        pairs += Math.floor(arr[i] / 2);
        odds += arr[i] % 2;
    }
    var need = 7 - pairs;
    if (need < 0) return false;
    var costSingles = Math.min(need, odds);
    var costBlank = (need - costSingles) * 2;
    return (costSingles + costBlank) <= laiziCount;
}

/**
 * 常规胡判定（癞子版）：枚举将眼（含癞子充当将眼），递归拆面子
 * @param arrNoLaizi  已剔除癞子的 index 数组（不会被修改）
 * @param laiziCount  癞子数量
 * @param needWeaves  需要的面子数 = (手牌数-2)/3
 */
function canHuNormalLaizi(arrNoLaizi, laiziCount, needWeaves) {
    // 枚举将眼：任意一种牌（实牌够 2 张 cost 0；1 张补 1 癞；0 张补 2 癞）
    for (var eye = 0; eye < MAX_INDEX; eye++) {
        var have = arrNoLaizi[eye];
        var costEye = have >= 2 ? 0 : (2 - have);
        if (costEye > laiziCount) continue;

        var arr = arrNoLaizi.slice();
        arr[eye] = have >= 2 ? have - 2 : 0;
        if (canFormWeaves(arr, laiziCount - costEye, needWeaves)) {
            return true;
        }
    }
    return false;
}

/**
 * 碰碰胡判定（癞子版）
 */
function canHuPengPengLaizi(arrNoLaizi, laiziCount, needWeaves) {
    for (var eye = 0; eye < MAX_INDEX; eye++) {
        var have = arrNoLaizi[eye];
        var costEye = have >= 2 ? 0 : (2 - have);
        if (costEye > laiziCount) continue;
        var arr = arrNoLaizi.slice();
        arr[eye] = have >= 2 ? have - 2 : 0;
        if (canFormTriplets(arr, laiziCount - costEye, needWeaves)) {
            return true;
        }
    }
    return false;
}

/**
 * 清一色判定（癞子版）：所有实牌（含碰杠组合）同一花色，癞子不算花色
 */
function isQingYiSeLaizi(arrNoLaizi, weaveItems, cbWeaveCount, laiziIndex) {
    var color = -1;
    for (var i = 0; i < MAX_INDEX; i++) {
        if (i === laiziIndex) continue;
        if (arrNoLaizi[i] > 0) {
            var c = Math.floor(i / 9);
            if (c > 2) return false; // 有番子实牌，不可能清一色
            if (color === -1) color = c;
            if (c !== color) return false;
        }
    }
    for (var w = 0; w < cbWeaveCount; w++) {
        var wc = (weaveItems[w].cbCenterCard & GameLogic.MASK_COLOR) >> 4;
        if (wc > 2) return false;
        if (color !== -1 && wc !== color) return false;
        if (color === -1) color = wc;
    }
    return color !== -1;
}

/**
 * 胡牌总入口（癞子版）
 * @param cbCardIndex   手上的牌 index 数组（不含 currentCard）
 * @param weaveItems    已碰杠组合
 * @param cbWeaveCount  组合数量
 * @param cbCurrentCard 当前牌（摸的或别人打的，0 表示无）
 * @param laiziIndex    癞子的索引（如红中 0x35 -> 31）
 * @returns {canHu, isQiDui, isPengPeng, isQingYiSe, laiziCount}
 */
function analyseHuLaizi(cbCardIndex, weaveItems, cbWeaveCount, cbCurrentCard, laiziIndex) {
    var temp = cbCardIndex.slice();
    if (cbCurrentCard !== 0) {
        temp[GameLogic.switchToCardIndex(cbCurrentCard)]++;
    }
    var total = GameLogic.getCardCount(temp);

    var laiziCount = temp[laiziIndex];
    var arrNoLaizi = temp.slice();
    arrNoLaizi[laiziIndex] = 0;

    var result = {
        canHu: false,
        isQiDui: false,
        isPengPeng: false,
        isQingYiSe: false,
        laiziCount: laiziCount
    };

    if (total < 2 || (total - 2) % 3 !== 0) return result;

    // 七对（仅无碰杠且 14 张）
    if (cbWeaveCount === 0 && total === 14) {
        result.isQiDui = isQiDuiLaizi(arrNoLaizi, laiziCount);
    }

    var needWeaves = Math.floor((total - 2) / 3);
    var normal = canHuNormalLaizi(arrNoLaizi, laiziCount, needWeaves);
    result.canHu = normal || result.isQiDui;

    if (result.canHu) {
        result.isPengPeng = canHuPengPengLaizi(arrNoLaizi, laiziCount, needWeaves) && !result.isQiDui;
        result.isQingYiSe = isQingYiSeLaizi(arrNoLaizi, weaveItems, cbWeaveCount, laiziIndex);
    }
    return result;
}

/**
 * 摸入某张牌后能否胡（癞子版）
 */
function analyseCanHuCardLaizi(cbCardIndex, weaveItems, cbWeaveCount, cbCurrentCard, laiziIndex) {
    return analyseHuLaizi(cbCardIndex, weaveItems, cbWeaveCount, cbCurrentCard, laiziIndex).canHu;
}

/**
 * 听牌枚举（癞子版）：当前手牌不动，列出摸哪些牌可胡
 * 注：若列表非空，摸到癞子同样可胡（癞子可变任意所需牌），此处只列实牌
 * @returns {tingCount, tingCard[]}
 */
function analyseTingCardResultLaizi(cbCardIndex, weaveItems, cbWeaveCount, laiziIndex) {
    var ting = { tingCount: 0, tingCard: [] };
    for (var j = 0; j < MAX_INDEX; j++) {
        if (j === laiziIndex) continue;
        var card = GameLogic.switchToCardData(j);
        if (analyseCanHuCardLaizi(cbCardIndex, weaveItems, cbWeaveCount, card, laiziIndex)) {
            ting.tingCard[ting.tingCount++] = card;
        }
    }
    return ting;
}

/**
 * 最佳出牌推荐（癞子版，供 AI 与托管使用）
 * 遍历手牌中每张实牌：打出后计算听牌数量，取听口最多者；
 * 无人听牌时退化为"孤立牌优先"启发式。
 * 癞子永远不建议打出。
 * @param cbCardIndex  14 张（或摸牌后）手牌 index 数组
 * @returns {card: 建议打出的牌值(0 表示无), tingCount: 打出后的听口数}
 */
function getBestDiscardLaizi(cbCardIndex, weaveItems, cbWeaveCount, laiziIndex) {
    var best = { card: 0, tingCount: -1, score: -1 };
    for (var i = 0; i < MAX_INDEX; i++) {
        if (i === laiziIndex || cbCardIndex[i] === 0) continue;

        var temp = cbCardIndex.slice();
        temp[i]--;
        var ting = analyseTingCardResultLaizi(temp, weaveItems, cbWeaveCount, laiziIndex);

        // 次级评分：孤立度（无靠张的牌优先打出）
        var isolation = isolationScore(temp, i);

        // 综合：听口数优先，其次孤立度
        var score = ting.tingCount * 100 + isolation;
        if (score > best.score) {
            best.score = score;
            best.card = GameLogic.switchToCardData(i);
            best.tingCount = ting.tingCount;
        }
    }
    return best;
}

/** 孤立度评分：越孤立越高分（越该打出） */
function isolationScore(arrAfterRemove, idx) {
    var color = Math.floor(idx / 9);
    if (color > 2) return 8; // 番子无顺子，孤立度高
    var value = idx % 9;
    var score = 0;
    // 同款剩余
    score -= arrAfterRemove[idx] * 4;
    // 邻近靠张
    var near = [1, 2];
    for (var n = 0; n < near.length; n++) {
        var d = near[n];
        var w = d === 1 ? 2 : 1;
        if (value - d >= 0 && arrAfterRemove[idx - d] > 0) score -= w;
        if (value + d <= 8 && arrAfterRemove[idx + d] > 0) score -= w;
    }
    // 边张(1/9)略孤立
    if (value === 0 || value === 8) score += 1;
    return score;
}

module.exports = {
    canFormWeaves: canFormWeaves,
    canFormTriplets: canFormTriplets,
    isQiDuiLaizi: isQiDuiLaizi,
    canHuNormalLaizi: canHuNormalLaizi,
    canHuPengPengLaizi: canHuPengPengLaizi,
    isQingYiSeLaizi: isQingYiSeLaizi,
    analyseHuLaizi: analyseHuLaizi,
    analyseCanHuCardLaizi: analyseCanHuCardLaizi,
    analyseTingCardResultLaizi: analyseTingCardResultLaizi,
    getBestDiscardLaizi: getBestDiscardLaizi
};
