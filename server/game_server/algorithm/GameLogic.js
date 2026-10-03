//
// GameLogic.js —— 商业级麻将算法（JavaScript 移植版）
//
// 移植自 xiyoufang/mahjong 的 Classes/GameLogic/GameLogic.cpp（Cocos2d-X 单机麻将，
// 作者 farmer，MIT 协议），保持算法逻辑 1:1 一致，仅将 C++ 出参改为 JS 对象返回。
//
// 牌值编码（0x 制，商业麻将标准）：
//   0x01-0x09 筒子   0x11-0x19 万子   0x21-0x29 条子   0x31-0x37 番子(东南西北中发白)
// 索引编码（MAX_INDEX=34）：
//   index = color*9 + value-1   （筒0-8，万9-17，条18-26，番27-33）
//

'use strict';

var MASK_COLOR = 0xF0;   // 花色掩码
var MASK_VALUE = 0x0F;   // 数值掩码

// 动作标识
var WIK_NULL = 0x00;  // 过
var WIK_P    = 0x01;  // 碰
var WIK_G    = 0x02;  // 杠
var WIK_H    = 0x04;  // 胡
var WIK_S    = 0x08;  // 吃

// 胡牌类型（牌型）
var CHR_NULL = 0x00;  // 没胡标识
var CHR_PH   = 0x01;  // 平胡
var CHR_PPH  = 0x02;  // 碰碰胡
var CHR_QS   = 0x04;  // 清色
var CHR_DY   = 0x08;  // 钓鱼
var CHR_QD   = 0x10;  // 七对
var CHR_DH   = 0x20;  // 地胡
var CHR_TH   = 0x40;  // 天胡

// 胡牌方式
var CHK_NULL = 0x00;  // 非胡
var CHK_ZM   = 0x01;  // 自摸
var CHK_JP   = 0x02;  // 接炮
var CHK_QG   = 0x04;  // 抢杠
var CHK_GK   = 0x08;  // 杠开

// 特殊情况
var CHS_NULL = 0x00;  // 无情况
var CHS_DZ   = 0x01;  // 单张
var CHS_DH   = 0x02;  // 地胡
var CHS_TH   = 0x04;  // 天胡
var CHS_GP   = 0x08;  // 有杠
var CHS_KZ   = 0x10;  // 卡张

var INVALID_CHAIR = 0xFF;
var INVALID_BYTE  = 0xFF;
var GAME_PLAYER   = 4;
var MAX_WEAVE     = 4;    // 最大组合
var MAX_INDEX     = 34;   // 最大索引
var MAX_REPERTORY = 136;  // 最大库存
var MAX_COUNT     = 14;   // 最大手牌数

// 麻将牌数据（一整副 136 张）
var MJ_CARD_DATA_ARRAY = (function () {
    var arr = [];
    var suits = [0x00, 0x10, 0x20]; // 筒、万、条
    for (var s = 0; s < suits.length; s++) {
        for (var c = 0; c < 4; c++) {
            for (var v = 1; v <= 9; v++) arr.push(suits[s] | v);
        }
    }
    for (var h = 0; h < 4; h++) {
        for (var v = 1; v <= 7; v++) arr.push(0x30 | v); // 番子
    }
    return arr;
})();

function newZeroIndex() {
    var a = new Array(MAX_INDEX);
    for (var i = 0; i < MAX_INDEX; i++) a[i] = 0;
    return a;
}

// =====================================================================
// 基础转换
// =====================================================================

/** 洗牌：从一整副 136 张中洗出 cbMaxCount 张写入 cardData 数组 */
function shuffle(cardData, cbMaxCount) {
    var temp = MJ_CARD_DATA_ARRAY.slice();
    var randCount = 0;
    while (randCount < cbMaxCount) {
        var position = Math.floor(Math.random() * (cbMaxCount - randCount));
        cardData[randCount++] = temp[position];
        temp[position] = temp[cbMaxCount - randCount];
    }
    return cardData;
}

/** index -> 牌值 */
function switchToCardData(cbCardIndex) {
    return ((Math.floor(cbCardIndex / 9)) << 4) | (cbCardIndex % 9 + 1);
}

/** 牌值 -> index */
function switchToCardIndex(cbCardData) {
    return ((cbCardData & MASK_COLOR) >> 4) * 9 + (cbCardData & MASK_VALUE) - 1;
}

/** index 数组 -> 牌值数组，返回牌数量 */
function indexArrayToCardData(cbCardIndex, cbCardData) {
    var pos = 0;
    for (var i = 0; i < MAX_INDEX; i++) {
        if (cbCardIndex[i] !== 0) {
            for (var j = 0; j < cbCardIndex[i]; j++) {
                cbCardData[pos++] = switchToCardData(i);
            }
        }
    }
    return pos;
}

/** 牌值数组 -> index 数组（新数组），返回 index 数组 */
function cardDataToIndexArray(cbCardData, cbCardCount) {
    var idx = newZeroIndex();
    for (var i = 0; i < cbCardCount; i++) {
        idx[switchToCardIndex(cbCardData[i])]++;
    }
    return idx;
}

/** 是否有效的牌 */
function isValidCard(cbCardData) {
    var cbValue = cbCardData & MASK_VALUE;
    var cbColor = (cbCardData & MASK_COLOR) >> 4;
    return ((cbValue >= 1 && cbValue <= 9 && cbColor <= 2) ||
            (cbValue >= 1 && cbValue <= 7 && cbColor === 3));
}

/** 从 index 数组中移除一张牌 */
function removeCard(cbCardIndex, cbRemoveCard) {
    var cbRemoveIndex = switchToCardIndex(cbRemoveCard);
    if (cbCardIndex[cbRemoveIndex] > 0) {
        cbCardIndex[cbRemoveIndex]--;
        return true;
    }
    return false;
}

/** 从 index 数组中移除多张牌（cbRemoveCard 为牌值数组） */
function removeCards(cbCardIndex, cbRemoveCard, cbRemoveCount) {
    for (var i = 0; i < cbRemoveCount; i++) {
        var cbRemoveIndex = switchToCardIndex(cbRemoveCard[i]);
        if (cbCardIndex[cbRemoveIndex] === 0) {
            for (var j = 0; j < i; j++) {
                cbCardIndex[switchToCardIndex(cbRemoveCard[j])]++;
            }
            return false;
        }
        cbCardIndex[cbRemoveIndex]--;
    }
    return true;
}

/** 从牌值数组中移除多张牌，原地修改 cbCardData，返回是否成功 */
function removeCardsFromData(cbCardData, cbCardCount, cbRemoveCard, cbRemoveCount) {
    var deleteCount = 0;
    var temp = cbCardData.slice(0, cbCardCount);
    for (var i = 0; i < cbRemoveCount; i++) {
        for (var j = 0; j < cbCardCount; j++) {
            if (cbRemoveCard[i] === temp[j]) {
                deleteCount++;
                temp[j] = 0;
                break;
            }
        }
    }
    if (deleteCount !== cbRemoveCount) return false;
    var pos = 0;
    for (var k = 0; k < cbCardCount; k++) {
        if (temp[k] !== 0) cbCardData[pos++] = temp[k];
    }
    return true;
}

/** 移除指定牌的全部（杠完从手上清除） */
function removeAllCard(cbCardIndex, cbRemoveCard) {
    cbCardIndex[switchToCardIndex(cbRemoveCard)] = 0;
    return true;
}

/** 统计 index 数组中的牌数 */
function getCardCount(cbCardIndex) {
    var count = 0;
    for (var i = 0; i < MAX_INDEX; i++) count += cbCardIndex[i];
    return count;
}

/** 获取组合的牌（碰/杠），返回张数 */
function getWeaveCard(cbWeaveKind, cbCenterCard, cbCardBuffer) {
    if (cbWeaveKind === WIK_P) {
        cbCardBuffer[0] = cbCenterCard;
        cbCardBuffer[1] = cbCenterCard;
        cbCardBuffer[2] = cbCenterCard;
        return 3;
    }
    if (cbWeaveKind === WIK_G) {
        cbCardBuffer[0] = cbCenterCard;
        cbCardBuffer[1] = cbCenterCard;
        cbCardBuffer[2] = cbCenterCard;
        cbCardBuffer[3] = cbCenterCard;
        return 4;
    }
    return 0;
}

// =====================================================================
// 动作判断
// =====================================================================

/** 碰牌判断 */
function estimatePengCard(cbCardIndex, cbCurrentCard) {
    return (cbCardIndex[switchToCardIndex(cbCurrentCard)] >= 2) ? WIK_P : WIK_NULL;
}

/** 杠牌判断（手上有 3 张可杠别人打出的） */
function estimateGangCard(cbCardIndex, cbCurrentCard) {
    return (cbCardIndex[switchToCardIndex(cbCurrentCard)] === 3) ? WIK_G : WIK_NULL;
}

/**
 * 杠牌分析（自己回合：暗杠 + 补杠）
 * @returns {actionMask, result:{cardCount, cardData[], isPublic[]}}
 */
function analyseGangCard(cbCardIndex, weaveItems, cbWeaveCount) {
    var actionMask = WIK_NULL;
    var result = { cardCount: 0, cardData: [], isPublic: [] };
    // 手上杠牌（暗杠）
    for (var i = 0; i < MAX_INDEX; i++) {
        if (cbCardIndex[i] === 4) {
            actionMask |= WIK_G;
            result.isPublic[result.cardCount] = 0;
            result.cardData[result.cardCount++] = switchToCardData(i);
        }
    }
    // 组合杠牌（碰后再摸一张 -> 补杠）
    for (var w = 0; w < cbWeaveCount; w++) {
        if (weaveItems[w].cbWeaveKind === WIK_P) {
            if (cbCardIndex[switchToCardIndex(weaveItems[w].cbCenterCard)] === 1) {
                actionMask |= WIK_G;
                result.isPublic[result.cardCount] = 1;
                result.cardData[result.cardCount++] = weaveItems[w].cbCenterCard;
            }
        }
    }
    return { actionMask: actionMask, result: result };
}

// =====================================================================
// 等级函数
// =====================================================================

/** 动作优先级 胡>杠>碰 */
function getUserActionRank(action) {
    if ((action & WIK_H) !== 0) return 3;
    if ((action & WIK_G) !== 0) return 2;
    if ((action & WIK_P) !== 0) return 1;
    return 0;
}

/** 胡牌番数（地方玩法可覆盖此函数） */
function getHuFanShu(huRight, huKind, huSpecial) {
    return 1;
}

// =====================================================================
// 核心：牌型分析
// =====================================================================

/**
 * 分析扑克（拆分明细）
 * @param cbCardIndex  index 数组（34）
 * @param cbCardCount  牌数量（2,5,8,11,14）
 * @param weaveItems   已碰杠组合 [{cbWeaveKind,cbCenterCard,...}]
 * @param cbItemCount  组合数量
 * @param analyseItemArray  输出数组，元素 {cbCardEye, cbWeaveKind[4], cbCenterCard[4]}
 * @returns bool 是否存在合法分解
 */
function analyseCard(cbCardIndex, cbCardCount, weaveItems, cbItemCount, analyseItemArray) {
    // 校验数目
    if (cbCardCount < 2 || cbCardCount > MAX_COUNT || (cbCardCount - 2) % 3 !== 0) return false;

    var kindItems = []; // {cbWeaveKind, cbCenterCard, cbCardIndex[3]}
    var cbLessKindItem = Math.floor((cbCardCount - 2) / 3);

    // 单吊判断（只剩将眼）
    if (cbLessKindItem === 0) {
        for (var i = 0; i < MAX_INDEX; i++) {
            if (cbCardIndex[i] === 2) {
                var item0 = { cbCardEye: switchToCardData(i), cbWeaveKind: [0, 0, 0, 0], cbCenterCard: [0, 0, 0, 0] };
                for (var j0 = 0; j0 < cbItemCount; j0++) {
                    item0.cbWeaveKind[j0] = weaveItems[j0].cbWeaveKind;
                    item0.cbCenterCard[j0] = weaveItems[j0].cbCenterCard;
                }
                analyseItemArray.push(item0);
                return true;
            }
        }
        return false;
    }

    // 拆分分析
    if (cbCardCount >= 3) {
        for (var i2 = 0; i2 < MAX_INDEX; i2++) {
            // 同牌（刻子）判断
            if (cbCardIndex[i2] >= 3) {
                kindItems.push({
                    cbWeaveKind: WIK_P,
                    cbCenterCard: switchToCardData(i2),
                    cbCardIndex: [i2, i2, i2]
                });
            }
            // 连牌（顺子）判断（不跨界，番子无顺子）
            if (i2 < (MAX_INDEX - 2 - 7) && cbCardIndex[i2] > 0 && (i2 % 9) < 7) {
                for (var j = 1; j <= cbCardIndex[i2]; j++) {
                    if (cbCardIndex[i2 + 1] >= j && cbCardIndex[i2 + 2] >= j) {
                        kindItems.push({
                            cbWeaveKind: WIK_S,
                            cbCenterCard: switchToCardData(i2 + 1),
                            cbCardIndex: [i2, i2 + 1, i2 + 2]
                        });
                    }
                }
            }
        }
    }

    var cbKindItemCount = kindItems.length;

    // 组合分析
    if (cbKindItemCount >= cbLessKindItem) {
        var cbCardIndexTemp = newZeroIndex();
        var cbIndex = [0, 1, 2, 3];
        var pKindItem = [null, null, null, null];

        do {
            // 复制手牌
            for (var c = 0; c < MAX_INDEX; c++) cbCardIndexTemp[c] = cbCardIndex[c];
            for (var k = 0; k < cbLessKindItem; k++) pKindItem[k] = kindItems[cbIndex[k]];

            // 数量判断（这组组合是否够用牌）
            var bEnoughCard = true;
            for (var m = 0; m < cbLessKindItem * 3; m++) {
                var cbTempCardIndex = pKindItem[Math.floor(m / 3)].cbCardIndex[m % 3];
                if (cbCardIndexTemp[cbTempCardIndex] === 0) {
                    bEnoughCard = false;
                    break;
                }
                cbCardIndexTemp[cbTempCardIndex]--;
            }

            if (bEnoughCard) {
                // 胡牌判断：剩余两张必须为将眼
                var cbCardEye = 0;
                for (var e = 0; e < MAX_INDEX; e++) {
                    if (cbCardIndexTemp[e] === 2) {
                        cbCardEye = switchToCardData(e);
                        break;
                    }
                }
                if (cbCardEye !== 0) {
                    var analyseItem = { cbCardEye: cbCardEye, cbWeaveKind: [0, 0, 0, 0], cbCenterCard: [0, 0, 0, 0] };
                    for (var w2 = 0; w2 < cbItemCount; w2++) {
                        analyseItem.cbWeaveKind[w2] = weaveItems[w2].cbWeaveKind;
                        analyseItem.cbCenterCard[w2] = weaveItems[w2].cbCenterCard;
                    }
                    for (var n = 0; n < cbLessKindItem; n++) {
                        analyseItem.cbWeaveKind[n + cbItemCount] = pKindItem[n].cbWeaveKind;
                        analyseItem.cbCenterCard[n + cbItemCount] = pKindItem[n].cbCenterCard;
                    }
                    analyseItem.cbCardEye = cbCardEye;
                    analyseItemArray.push(analyseItem);
                }
            }

            // 设置索引（下一个组合）
            if (cbIndex[cbLessKindItem - 1] === (cbKindItemCount - 1)) {
                var ii = cbLessKindItem - 1;
                for (; ii > 0; ii--) {
                    if ((cbIndex[ii - 1] + 1) !== cbIndex[ii]) {
                        var cbNewIndex = cbIndex[ii - 1];
                        for (var jj = ii - 1; jj < cbLessKindItem; jj++) {
                            cbIndex[jj] = cbNewIndex + jj - ii + 2;
                        }
                        break;
                    }
                }
                if (ii === 0) break;
            } else {
                cbIndex[cbLessKindItem - 1]++;
            }
        } while (true);
    }

    return analyseItemArray.length > 0;
}

/** 判断是否能胡（七对 + 常规分解） */
function canHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) {
    if (cbWeaveCount === 0) {
        // 计算七对（不存在碰、杠）
        var cbDuiCount = 0;
        for (var i = 0; i < MAX_INDEX; i++) {
            if (cbCardIndexTemp[i] === 2) cbDuiCount++;
        }
        if (cbDuiCount === 7) return true;
    }
    return analyseItemArray.length > 0;
}

/** 判断是否能胡牌（摸入 cbCurrentCard 后） */
function analyseCanHuCard(cbCardIndex, weaveItems, cbWeaveCount, cbCurrentCard) {
    var cbCardIndexTemp = cbCardIndex.slice();
    if (cbCurrentCard !== 0) cbCardIndexTemp[switchToCardIndex(cbCurrentCard)]++;
    var cbCardCountTemp = getCardCount(cbCardIndexTemp);
    var cbCardCount = cbCardCountTemp - 1;
    var analyseItemArray = [];
    analyseCard(cbCardIndexTemp, cbCardCountTemp, weaveItems, cbWeaveCount, analyseItemArray);
    return canHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray);
}

/** 是否听牌（打出任意一张后存在可胡的牌） */
function analyseTingCard(cbCardIndex, weaveItems, cbWeaveCount) {
    var cbCardIndexTemp = cbCardIndex.slice();
    for (var i = 0; i < MAX_INDEX; i++) {
        if (cbCardIndexTemp[i] === 0) continue;
        cbCardIndexTemp[i]--; // 假设出掉的牌
        for (var j = 0; j < MAX_INDEX; j++) {
            var cbCurrentCard = switchToCardData(j);
            if (analyseCanHuCard(cbCardIndexTemp, weaveItems, cbWeaveCount, cbCurrentCard)) {
                return true;
            }
        }
        cbCardIndexTemp[i]++; // 还原
    }
    return false;
}

/**
 * 分析听牌结果（当前手牌不动，列出所有能胡的牌）
 * @returns {tingCount, tingCard[]}
 */
function analyseTingCardResult(cbCardIndex, weaveItems, cbWeaveCount) {
    var tingResult = { tingCount: 0, tingCard: [] };
    var cbCardIndexTemp = cbCardIndex.slice();
    for (var j = 0; j < MAX_INDEX; j++) {
        var cbCurrentCard = switchToCardData(j);
        if (analyseCanHuCard(cbCardIndexTemp, weaveItems, cbWeaveCount, cbCurrentCard)) {
            tingResult.tingCard[tingResult.tingCount++] = cbCurrentCard;
        }
    }
    return tingResult;
}

/** 分析能够胡牌的数量 */
function analyseHuCardCount(cbCardIndex, weaveItems, cbWeaveCount) {
    var count = 0;
    var cbCardIndexTemp = cbCardIndex.slice();
    for (var j = 0; j < MAX_INDEX; j++) {
        var cbCurrentCard = switchToCardData(j);
        if (analyseCanHuCard(cbCardIndexTemp, weaveItems, cbWeaveCount, cbCurrentCard)) count++;
    }
    return count;
}

// =====================================================================
// 胡牌类型判定（牌型）
// =====================================================================

/** 平胡：存在顺子的合法分解 */
function pingHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) {
    if (analyseItemArray.length > 0) {
        for (var i = 0; i < analyseItemArray.length; i++) {
            var bLianCard = false;
            var item = analyseItemArray[i];
            for (var j = 0; j < item.cbWeaveKind.length; j++) {
                if ((item.cbWeaveKind[j] & WIK_S) !== 0) bLianCard = true;
            }
            if (bLianCard) return CHR_PH;
        }
    }
    return CHR_NULL;
}

/** 清一色 */
function qingSe(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) {
    var cbCardColor = 0xFF;
    for (var i = 0; i < MAX_INDEX; i++) {
        if (cbCardIndexTemp[i] !== 0) {
            var cbTempCardColor = switchToCardData(i) & MASK_COLOR;
            if (cbCardColor === 0xFF) cbCardColor = cbTempCardColor;
            if (cbTempCardColor !== cbCardColor) return CHR_NULL;
        }
    }
    for (var w = 0; w < cbWeaveCount; w++) {
        if ((weaveItems[w].cbCenterCard & MASK_COLOR) !== cbCardColor) return CHR_NULL;
    }
    if (canHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray)) {
        return CHR_QS;
    }
    return CHR_NULL;
}

/** 碰碰胡：无顺子且有碰/杠的合法分解 */
function pengPengHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) {
    if (analyseItemArray.length > 0) {
        for (var i = 0; i < analyseItemArray.length; i++) {
            var bLianCard = false, bPengCard = false;
            var item = analyseItemArray[i];
            for (var j = 0; j < item.cbWeaveKind.length; j++) {
                var k = item.cbWeaveKind[j];
                if ((k & (WIK_G | WIK_P)) !== 0) bPengCard = true;
                if ((k & WIK_S) !== 0) bLianCard = true;
            }
            if (!bLianCard && bPengCard) return CHR_PPH;
        }
    }
    return CHR_NULL;
}

/** 七对 */
function qiDui(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) {
    if (cbWeaveCount > 0) return CHR_NULL;
    for (var i = 0; i < MAX_INDEX; i++) {
        if (cbCardIndexTemp[i] === 1 || cbCardIndexTemp[i] === 3) return CHR_NULL;
    }
    return CHR_QD;
}

/** 钓鱼（碰碰胡只剩两张单吊） */
function diaoYu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) {
    if (pengPengHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray) === CHR_PPH
        && cbCardCountTemp === 2) {
        return CHR_DY;
    }
    return CHR_NULL;
}

// =====================================================================
// 特殊情况 / 胡牌方式
// =====================================================================

/** 手上有杠 */
function gangPai(cbCardIndex) {
    for (var i = 0; i < MAX_INDEX; i++) {
        if (cbCardIndex[i] === 4) return CHS_GP;
    }
    return CHS_NULL;
}

/** 单张 */
function danZhang(cbCardCount) {
    return cbCardCount === 2 ? CHS_DZ : CHS_NULL;
}

/** 天胡 */
function tianHu(sendCardCount, outCardCount) {
    return (sendCardCount === 1 && outCardCount === 0) ? CHS_TH : CHS_NULL;
}

/** 地胡 */
function diHu(sendCardCount, outCardCount) {
    return (sendCardCount === 1 && outCardCount === 1) ? CHS_DH : CHS_NULL;
}

/** 卡张（只听一张） */
function kaZhang(cbCardIndex, weaveItems, cbWeaveCount) {
    return analyseHuCardCount(cbCardIndex, weaveItems, cbWeaveCount) === 1 ? CHS_KZ : CHS_NULL;
}

/** 自摸 */
function ziMo(huRight, bGangStatus, bZimo) {
    return (huRight !== 0 && bZimo === true && bGangStatus === false) ? CHK_ZM : CHK_NULL;
}

/** 杠开 */
function gangKai(huRight, bGangStatus, bZimo) {
    return (huRight !== 0 && bZimo === true && bGangStatus === true) ? CHK_GK : CHK_NULL;
}

/** 抢杠 */
function qiangGang(huRight, bQiangGangStatus, bZimo) {
    return (huRight !== 0 && bZimo === false && bQiangGangStatus === true) ? CHK_QG : CHK_NULL;
}

/** 接炮 */
function jiePao(huRight, bQiangGangStatus, bZimo) {
    return (huRight !== 0 && bZimo === false && bQiangGangStatus === false) ? CHK_JP : CHK_NULL;
}

// =====================================================================
// 胡牌分析（总入口）
// =====================================================================

/**
 * 分析胡牌
 * @param cbCardIndex     手上的牌（index 数组，不含 cbCurrentCard）
 * @param weaveItems      已碰杠组合
 * @param cbWeaveCount    组合数量
 * @param cbCurrentCard   当前牌（摸的或别人打的，0 表示无）
 * @param opts            {sendCardCount, outCardCount, gangStatus, zimo, qiangGangStatus}
 * @returns {actionMask: WIK_H|WIK_NULL, huKind, huRight, huSpecial}
 */
function analyseHuCard(cbCardIndex, weaveItems, cbWeaveCount, cbCurrentCard, opts) {
    opts = opts || {};
    var sendCardCount = opts.sendCardCount || 0;
    var outCardCount = opts.outCardCount || 0;
    var bGangStatus = opts.gangStatus === true;
    var bZimo = opts.zimo === true;
    var bQiangGangStatus = opts.qiangGangStatus === true;

    // 构造 14 张牌
    var cbCardIndexTemp = cbCardIndex.slice();
    if (cbCurrentCard !== 0) cbCardIndexTemp[switchToCardIndex(cbCurrentCard)]++;
    var cbCardCountTemp = getCardCount(cbCardIndexTemp);
    var cbCardCount = cbCardCountTemp - 1;

    // 分析扑克
    var analyseItemArray = [];
    analyseCard(cbCardIndexTemp, cbCardCountTemp, weaveItems, cbWeaveCount, analyseItemArray);

    // 胡牌类型
    var huRight = CHR_NULL;
    huRight |= pingHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray);
    huRight |= pengPengHu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray);
    huRight |= qingSe(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray);
    huRight |= qiDui(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray);
    huRight |= diaoYu(cbCardIndexTemp, cbCardCountTemp, cbCardIndex, cbCardCount, weaveItems, cbWeaveCount, analyseItemArray);

    // 胡牌方式
    var huKind = CHK_NULL;
    huKind |= ziMo(huRight, bGangStatus, bZimo);
    huKind |= gangKai(huRight, bGangStatus, bZimo);
    huKind |= qiangGang(huRight, bQiangGangStatus, bZimo);
    huKind |= jiePao(huRight, bQiangGangStatus, bZimo);

    // 特殊情况
    var huSpecial = CHS_NULL;
    huSpecial |= gangPai(cbCardIndexTemp);
    huSpecial |= danZhang(cbCardCount);
    huSpecial |= diHu(sendCardCount, outCardCount);
    huSpecial |= tianHu(sendCardCount, outCardCount);
    huSpecial |= kaZhang(cbCardIndex, weaveItems, cbWeaveCount);

    return {
        actionMask: huRight !== CHR_NULL ? WIK_H : WIK_NULL,
        huKind: huKind,
        huRight: huRight,
        huSpecial: huSpecial
    };
}

// =====================================================================
module.exports = {
    // 常量
    MASK_COLOR: MASK_COLOR, MASK_VALUE: MASK_VALUE,
    WIK_NULL: WIK_NULL, WIK_P: WIK_P, WIK_G: WIK_G, WIK_H: WIK_H, WIK_S: WIK_S,
    CHR_NULL: CHR_NULL, CHR_PH: CHR_PH, CHR_PPH: CHR_PPH, CHR_QS: CHR_QS,
    CHR_DY: CHR_DY, CHR_QD: CHR_QD, CHR_DH: CHR_DH, CHR_TH: CHR_TH,
    CHK_NULL: CHK_NULL, CHK_ZM: CHK_ZM, CHK_JP: CHK_JP, CHK_QG: CHK_QG, CHK_GK: CHK_GK,
    CHS_NULL: CHS_NULL, CHS_DZ: CHS_DZ, CHS_DH: CHS_DH, CHS_TH: CHS_TH, CHS_GP: CHS_GP, CHS_KZ: CHS_KZ,
    GAME_PLAYER: GAME_PLAYER, MAX_WEAVE: MAX_WEAVE, MAX_INDEX: MAX_INDEX,
    MAX_REPERTORY: MAX_REPERTORY, MAX_COUNT: MAX_COUNT,
    INVALID_CHAIR: INVALID_CHAIR, INVALID_BYTE: INVALID_BYTE,

    newZeroIndex: newZeroIndex,

    // 基础
    shuffle: shuffle,
    switchToCardData: switchToCardData,
    switchToCardIndex: switchToCardIndex,
    indexArrayToCardData: indexArrayToCardData,
    cardDataToIndexArray: cardDataToIndexArray,
    isValidCard: isValidCard,
    removeCard: removeCard,
    removeCards: removeCards,
    removeCardsFromData: removeCardsFromData,
    removeAllCard: removeAllCard,
    getCardCount: getCardCount,
    getWeaveCard: getWeaveCard,

    // 动作
    estimatePengCard: estimatePengCard,
    estimateGangCard: estimateGangCard,
    analyseGangCard: analyseGangCard,
    getUserActionRank: getUserActionRank,
    getHuFanShu: getHuFanShu,

    // 分析
    analyseCard: analyseCard,
    canHu: canHu,
    analyseCanHuCard: analyseCanHuCard,
    analyseTingCard: analyseTingCard,
    analyseTingCardResult: analyseTingCardResult,
    analyseHuCardCount: analyseHuCardCount,
    analyseHuCard: analyseHuCard,

    // 牌型（暴露以便癞子扩展与测试）
    pingHu: pingHu,
    pengPengHu: pengPengHu,
    qingSe: qingSe,
    qiDui: qiDui,
    diaoYu: diaoYu
};
