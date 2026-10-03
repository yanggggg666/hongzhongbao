//
// algorithm.test.js —— GameLogic.js / LaiziLogic.js 单元测试
// 运行：node tests/algorithm.test.js
//

'use strict';

var assert = require('assert');
var GL = require('../game_server/algorithm/GameLogic');
var LZ = require('../game_server/algorithm/LaiziLogic');

var TONG = 0x00, WAN = 0x10, TIAO = 0x20;
function T(v) { return TONG | v; }   // 筒
function W(v) { return WAN | v; }    // 万
function S(v) { return TIAO | v; }   // 条
var HZ = 0x35;                        // 红中
var LAIZI = GL.switchToCardIndex(HZ); // 红中索引

/** 牌值数组 -> index 数组 */
function idx(cards) {
    var a = GL.newZeroIndex();
    for (var i = 0; i < cards.length; i++) a[GL.switchToCardIndex(cards[i])]++;
    return a;
}

var passed = 0;
function ok(name, cond) {
    assert.strictEqual(!!cond, true, name);
    passed++;
    console.log('  ✓ ' + name);
}

// =====================================================================
console.log('\n[1] 编码转换');
for (var i = 0; i < 34; i++) {
    assert.strictEqual(GL.switchToCardIndex(GL.switchToCardData(i)), i);
}
passed++;
console.log('  ✓ switchToCardData/Index 34 索引往返一致');
ok('红中索引为 31', LAIZI === 31);
ok('isValidCard 筒1/条9/红中有效', GL.isValidCard(T(1)) && GL.isValidCard(S(9)) && GL.isValidCard(HZ));
ok('isValidCard 0x3A/0x00 无效', !GL.isValidCard(0x3A) && !GL.isValidCard(0x00));

// =====================================================================
console.log('\n[2] 洗牌与牌数');
var deck = [];
GL.shuffle(deck, 136);
ok('洗牌 136 张', deck.length === 136);
var seen = {};
var dup = false;
for (var d = 0; d < deck.length; d++) {
    var k = deck[d];
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] > 4) dup = true;
}
ok('每种牌不超过 4 张', !dup && Object.keys(seen).length === 34);

// =====================================================================
console.log('\n[3] 碰/杠判断');
var hand = idx([T(1), T(1), T(2), T(3)]);
ok('有 2 张可碰', GL.estimatePengCard(hand, T(1)) === GL.WIK_P);
ok('仅 1 张不可碰', GL.estimatePengCard(hand, T(2)) === GL.WIK_NULL);
ok('3 张可杠', GL.estimateGangCard(idx([T(1), T(1), T(1)]), T(1)) === GL.WIK_G);

var gangRes = GL.analyseGangCard(idx([T(5), T(5), T(5), T(5)]), [], 0);
ok('手上 4 张 -> 暗杠', (gangRes.actionMask & GL.WIK_G) !== 0 && gangRes.result.cardCount === 1 && gangRes.result.isPublic[0] === 0);
var weaves = [{ cbWeaveKind: GL.WIK_P, cbCenterCard: T(7), cbPublicCard: 1, cbProvideUser: 1, cbValid: 1 }];
var gangRes2 = GL.analyseGangCard(idx([T(7), W(1), W(2)]), weaves, 1);
ok('碰后摸 1 张 -> 补杠', (gangRes2.actionMask & GL.WIK_G) !== 0 && gangRes2.result.isPublic[0] === 1);

// =====================================================================
console.log('\n[4] 基础胡牌（无癞子）');
// 平胡：123 456 789 筒 + 123 万 + 55 条
var pingHand = idx([T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8), T(9), W(1), W(2), W(3), S(5)]);
ok('13 张 + 摸 5条 -> 平胡可胡', GL.analyseCanHuCard(pingHand, [], 0, S(5)));
ok('13 张 + 摸 9万 -> 不可胡', !GL.analyseCanHuCard(pingHand, [], 0, W(9)));

// 七对：11 22 33 44 55 66 筒 + 77 条
var qiduiHand = idx([T(1), T(1), T(2), T(2), T(3), T(3), T(4), T(4), T(5), T(5), T(6), T(6), S(7)]);
ok('七对可胡（摸 7条）', GL.analyseCanHuCard(qiduiHand, [], 0, S(7)));

// 碰碰胡：111 222 333 444 筒 + 55 条
var pphHand = idx([T(1), T(1), T(1), T(2), T(2), T(2), T(3), T(3), T(3), T(4), T(4), T(4), S(5)]);
ok('碰碰胡可胡（摸 5条）', GL.analyseCanHuCard(pphHand, [], 0, S(5)));

var huRes = GL.analyseHuCard(pphHand, [], 0, S(5), { zimo: true, sendCardCount: 9, outCardCount: 9 });
ok('analyseHuCard 返回 WIK_H', huRes.actionMask === GL.WIK_H);
ok('牌型含碰碰胡', (huRes.huRight & GL.CHR_PPH) !== 0);
ok('胡方式为自摸', (huRes.huKind & GL.CHK_ZM) !== 0);

// 清一色：全筒
var qsHand = idx([T(1), T(1), T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8), T(9), T(9), T(9)]);
var qsRes = GL.analyseHuCard(qsHand, [], 0, T(1), { zimo: true });
ok('清一色牌型', (qsRes.huRight & GL.CHR_QS) !== 0);

// 七对牌型检测
var qdRes = GL.analyseHuCard(qiduiHand, [], 0, S(7), { zimo: true });
ok('七对牌型', (qdRes.huRight & GL.CHR_QD) !== 0);

// =====================================================================
console.log('\n[5] 听牌分析（无癞子）');
// 2345678 筒 + 111 万 + 111 条 -> 连七结构，听 2/5/8 筒
var tingHand = idx([T(2), T(3), T(4), T(5), T(6), T(7), T(8), W(1), W(1), W(1), S(1), S(1), S(1)]);
var ting = GL.analyseTingCardResult(tingHand, [], 0);
ok('听牌非空', ting.tingCount > 0);
ok('听 2筒', ting.tingCard.indexOf(T(2)) !== -1);
ok('听 5筒', ting.tingCard.indexOf(T(5)) !== -1);
ok('听 8筒', ting.tingCard.indexOf(T(8)) !== -1);
ok('不听 1筒', ting.tingCard.indexOf(T(1)) === -1);
ok('不听 9筒', ting.tingCard.indexOf(T(9)) === -1);
// analyseTingCard 语义：14 张手牌（摸牌后），存在某种打法可进入听口
var hand14 = idx([T(2), T(3), T(4), T(5), T(6), T(7), T(8), W(1), W(1), W(1), S(1), S(1), S(1), W(9)]);
ok('14 张打 9万 后听牌', GL.analyseTingCard(hand14, [], 0));
var scatter14 = idx([T(1), T(3), T(5), T(7), T(9), W(1), W(3), W(5), W(7), W(9), S(2), S(4), S(6), S(8)]);
ok('14 张散牌不听牌', !GL.analyseTingCard(scatter14, [], 0));

// =====================================================================
console.log('\n[6] 癞子胡牌（红中）');
// A: 123456789 筒 + 123 万 + 红中 + 5条 -> 摸 5条? 不对, 直接构造 14 张判定
// 手牌 13: [123456789 筒][123 万][红中] + 摸 5条 -> 眼 = 5条+红中
var lzA = idx([T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8), T(9), W(1), W(2), W(3), HZ]);
ok('癞子补将眼可胡', LZ.analyseCanHuCardLaizi(lzA, [], 0, S(5), LAIZI));
ok('无癞子算法此时不可胡', !GL.analyseCanHuCard(lzA, [], 0, S(5)));

// B: 七对带癞子: 11 22 33 44 55 66 筒 + 7 筒 + 红中
var lzB = idx([T(1), T(1), T(2), T(2), T(3), T(3), T(4), T(4), T(5), T(5), T(6), T(6), T(7), HZ]);
var lzBRes = LZ.analyseHuLaizi(lzB, [], 0, 0, LAIZI);
ok('癞子七对可胡', lzBRes.canHu && lzBRes.isQiDui);

// C: 碰碰胡带癞子: 111 222 333 筒 + 4万4万 + 5万5万 + 红中
var lzC = idx([T(1), T(1), T(1), T(2), T(2), T(2), T(3), T(3), T(3), W(4), W(4), W(5), W(5), HZ]);
var lzCRes = LZ.analyseHuLaizi(lzC, [], 0, 0, LAIZI);
ok('癞子碰碰胡可胡', lzCRes.canHu && lzCRes.isPengPeng);

// D: 癞子补顺子: 123 456 79 筒 + 123 万 + 55 条 + 红中 (红中补 8筒)
var lzD = idx([T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(9), W(1), W(2), W(3), S(5), S(5), HZ]);
ok('癞子补顺子可胡', LZ.analyseCanHuCardLaizi(lzD, [], 0, 0, LAIZI) || LZ.analyseHuLaizi(lzD, [], 0, 0, LAIZI).canHu);

// E: 全癞子将眼(2 癞作眼): 123 456 789 筒 + 123 万 + 红中 + 红中
var lzE = idx([T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8), T(9), W(1), W(2), W(3), HZ, HZ]);
var lzERes = LZ.analyseHuLaizi(lzE, [], 0, 0, LAIZI);
ok('双癞作将眼可胡', lzERes.canHu && lzERes.laiziCount === 2);

// F: 不应误判: 13579 筒 + 2468 万 + 246 条 + 红中
var lzF = idx([T(1), T(3), T(5), T(7), T(9), W(2), W(4), W(6), W(8), S(2), S(4), S(6), HZ]);
ok('散牌+1癞不可胡', !LZ.analyseHuLaizi(lzF, [], 0, 0, LAIZI).canHu);

// =====================================================================
console.log('\n[7] 癞子听牌与最佳出牌');
// 111 222 333 筒 + 4万 5万 + 红中 红中 -> 听 3万/6万
var lzTing = idx([T(1), T(1), T(1), T(2), T(2), T(2), T(3), T(3), T(3), W(4), W(5), HZ, HZ]);
var lzTingRes = LZ.analyseTingCardResultLaizi(lzTing, [], 0, LAIZI);
ok('癞子听牌含 3万', lzTingRes.tingCard.indexOf(W(3)) !== -1);
ok('癞子听牌含 6万', lzTingRes.tingCard.indexOf(W(6)) !== -1);
ok('癞子听牌含 4万(44+癞眼)', lzTingRes.tingCard.indexOf(W(4)) !== -1);
ok('癞子听牌含 5万(55+癞眼)', lzTingRes.tingCard.indexOf(W(5)) !== -1);

// 最佳出牌: 12345678 筒 + 123 万 + 5条 9条 + 红中
var lzDiscard = idx([T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8), W(1), W(2), W(3), S(5), S(9), HZ]);
var best = LZ.getBestDiscardLaizi(lzDiscard, [], 0, LAIZI);
ok('不会建议打出红中', best.card !== HZ);
ok('建议打出 9条(孤立边张)', best.card === S(9));

// =====================================================================
console.log('\n[8] 性能抽样');
var t0 = Date.now();
for (var p = 0; p < 1000; p++) {
    LZ.analyseHuLaizi(lzC, [], 0, 0, LAIZI);
}
var cost = Date.now() - t0;
ok('1000 次癞子胡判定 < 2s（实际 ' + cost + 'ms）', cost < 2000);

console.log('\n全部通过：' + passed + ' 项断言 ✓\n');
