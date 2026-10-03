//
// TileMap.js —— 牌值映射
//
// babykylin 框架（客户端+服务端）的牌 ID 制式：
//   0-8   筒    9-17  条    18-26 万
//   27    红中  28    发财  29    白板   30-33 东/西/南/北
//
// 算法模块（xiyoufang 移植）的 0x 制式：
//   0x01-0x09 筒   0x11-0x19 万   0x21-0x29 条   0x31-0x37 东南西北中发白
//

'use strict';

var GameLogic = require('./GameLogic');

var HZ_CARD = 0x35;                                 // 红中（0x 制）
var LAIZI_INDEX = GameLogic.switchToCardIndex(HZ_CARD); // 红中索引 = 31

/** babykylin 牌 id -> 0x 牌值 */
function idToCard(id) {
    if (id >= 0 && id < 9)   return 0x01 + id;        // 筒
    if (id >= 9 && id < 18)  return 0x21 + (id - 9);  // 条
    if (id >= 18 && id < 27) return 0x11 + (id - 18); // 万
    if (id === 27) return 0x35;  // 红中
    if (id === 28) return 0x36;  // 发财
    if (id === 29) return 0x37;  // 白板
    if (id === 30) return 0x31;  // 东
    if (id === 31) return 0x33;  // 西
    if (id === 32) return 0x32;  // 南
    if (id === 33) return 0x34;  // 北
    return 0;
}

/** 0x 牌值 -> babykylin 牌 id */
function cardToId(card) {
    var color = (card & GameLogic.MASK_COLOR) >> 4;
    var value = card & GameLogic.MASK_VALUE;
    if (color === 0) return value - 1;        // 筒 0-8
    if (color === 2) return 9 + value - 1;    // 条 9-17
    if (color === 1) return 18 + value - 1;   // 万 18-26
    // 番子
    if (card === 0x35) return 27;
    if (card === 0x36) return 28;
    if (card === 0x37) return 29;
    if (card === 0x31) return 30;
    if (card === 0x33) return 31;
    if (card === 0x32) return 32;
    if (card === 0x34) return 33;
    return -1;
}

/** babykylin holds(id 数组) -> index 数组(34) */
function holdsToIndex(holds) {
    var idx = GameLogic.newZeroIndex();
    for (var i = 0; i < holds.length; i++) {
        idx[GameLogic.switchToCardIndex(idToCard(holds[i]))]++;
    }
    return idx;
}

/** babykylin 碰杠组合 -> 算法 weaveItems */
function pengGangsToWeaves(pengGangs) {
    var weaves = [];
    for (var i = 0; i < pengGangs.length; i++) {
        var pg = pengGangs[i];
        weaves.push({
            cbWeaveKind: pg.type === 'gang' ? GameLogic.WIK_G : GameLogic.WIK_P,
            cbCenterCard: idToCard(pg.card != null ? pg.card : pg),
            cbPublicCard: 1,
            cbProvideUser: 0,
            cbValid: 1
        });
    }
    return weaves;
}

module.exports = {
    HZ_CARD: HZ_CARD,
    LAIZI_INDEX: LAIZI_INDEX,
    HONGZHONG_ID: 27,
    idToCard: idToCard,
    cardToId: cardToId,
    holdsToIndex: holdsToIndex,
    pengGangsToWeaves: pengGangsToWeaves
};
