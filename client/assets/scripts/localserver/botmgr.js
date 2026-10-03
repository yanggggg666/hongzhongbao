//
// botmgr.js —— 机器人管理器
//
// 原理：
//   babykylin 框架中 userMgr 通过 socket.emit(event, data) 给玩家发消息，
//   游戏动作通过 gameMgr.chuPai/peng/gang/hu/guo(userId, ...) 触发。
//   机器人为每个虚拟玩家绑定一个"假 socket"，emit 即路由到 AI 大脑（AIEngine），
//   AI 以拟人延时调用 gameMgr 的同名接口。对游戏管理器而言机器人与真人无异。
//
// 机器人 userId 使用负数（-1 起递减），与 babykylin 约定一致（座位 userId<=0 为空位/机器人）。
//

'use strict';

var roomMgr = require('./roommgr');
var userMgr = require('./usermgr');
var AIEngine = require('./algorithm/AIEngine');

var botSeq = 0;                 // 机器人编号（userId = -(++botSeq)）
var bots = {};                  // userId -> bot 上下文
var BOT_NAMES = [
    "红中宝·阿福", "红中宝·旺财", "红中宝·小雀", "红中宝·来顺",
    "红中宝·发财", "红中宝·杠上花", "红中宝·摸鱼", "红中宝·听风"
];
var botNameSeq = 0;

/** 机器人响应拟人延时（毫秒），测试时可调快 */
var thinkDelayMin = 600;
var thinkDelayMax = 1500;

exports.setThinkDelay = function (min, max) {
    thinkDelayMin = min;
    thinkDelayMax = max;
};

function thinkDelay() {
    return thinkDelayMin + Math.floor(Math.random() * Math.max(1, thinkDelayMax - thinkDelayMin));
}

exports.isBot = function (userId) {
    return bots[userId] != null;
};

exports.getBot = function (userId) {
    return bots[userId];
};

/** 向房间添加 count 个机器人，返回添加数量 */
exports.addBots = function (roomId, count) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) return 0;

    var added = 0;
    for (var i = 0; i < count; i++) {
        // 注意：循环内必须用 let/const，避免闭包共享导致所有定时器/假 socket 指向最后一只机器人
        let userId = -(++botSeq);
        let name = BOT_NAMES[botNameSeq++ % BOT_NAMES.length] + "-" + userId;

        let ret = -1;
        roomMgr.enterRoom(roomId, userId, name, function (r) { ret = r; });
        if (ret !== 0) {
            break; // 房间已满
        }

        let bot = {
            userId: userId,
            name: name,
            roomId: roomId,
            state: AIEngine.createBotState(userId),
            timers: []
        };
        bot.state.gameType = (roomInfo.conf && roomInfo.conf.type) || "hzmj";
        bot.state.seatIndex = roomMgr.getUserSeat(userId);
        bots[userId] = bot;

        // 绑定假 socket：所有发给该玩家的消息路由到 AI
        var fakeSocket = {
            userId: userId,
            emit: function (event, data) {
                routeEvent(bot, event, data);
            },
            disconnect: function () {}
        };
        userMgr.bind(userId, fakeSocket);
        added++;

        // 通知房间内其他玩家：机器人入座（与真人登录推送同构）
        userMgr.broacastInRoom('new_user_comes_push', {
            userid: userId,
            ip: "127.0.0.1",
            score: 0,
            name: name,
            online: true,
            ready: false,
            seatindex: bot.state.seatIndex
        }, userId, false);

        // 自动准备（会触发开局检查）
        schedule(bot, function () {
            var ri = roomMgr.getRoom(roomId);
            if (ri && ri.gameMgr) {
                ri.gameMgr.setReady(userId);
                userMgr.broacastInRoom('user_ready_push', { userid: userId, ready: true }, userId, true);
            }
        });
    }
    return added;
};

/** 从房间移除全部机器人（房间销毁时调用；座位/位置由 roommgr 自行清理，此处不触碰 roommgr，避免递归） */
exports.removeBotsInRoom = function (roomId) {
    for (var userId in bots) {
        var bot = bots[userId];
        if (bot.roomId === roomId) {
            destroyBot(bot);
        }
    }
};

function destroyBot(bot) {
    if (bot == null) return;
    clearTimers(bot);
    userMgr.del(bot.userId);
    delete bots[bot.userId];
}

function clearTimers(bot) {
    for (var i = 0; i < bot.timers.length; i++) {
        clearTimeout(bot.timers[i]);
    }
    bot.timers = [];
}

function schedule(bot, fn) {
    var t = setTimeout(function () {
        var idx = bot.timers.indexOf(t);
        if (idx !== -1) bot.timers.splice(idx, 1);
        fn();
    }, thinkDelay());
    bot.timers.push(t);
}

function gameMgrOf(bot) {
    var roomInfo = roomMgr.getRoom(bot.roomId);
    return roomInfo ? roomInfo.gameMgr : null;
}

// =====================================================================
// 事件路由：服务器 -> AI
// =====================================================================

function routeEvent(bot, event, data) {
    if (process.env.BOT_DEBUG) console.log('[bot ' + bot.userId + '] evt=' + event + ' data=' + JSON.stringify(data));
    if (bots[bot.userId] == null) return; // 已销毁

    // 维护本地镜像
    AIEngine.updateOnEvent(bot.state, event, data);

    var mgr = gameMgrOf(bot);
    if (mgr == null) return;

    switch (event) {
        case 'game_mopai_push':
            // 轮到自己：如无操作提示则直接出牌（有提示时等 game_action_push 决策）
            schedule(bot, function () {
                if (bot.pendingAction == null) {
                    doDiscard(bot);
                }
            });
            break;

        case 'game_chupai_push':
            // 碰/杠后轮到自己出牌
            if (data === bot.userId) {
                schedule(bot, function () {
                    if (bot.pendingAction == null) {
                        doDiscard(bot);
                    }
                });
            }
            break;

        case 'game_action_push':
            if (data == null || (data.hu !== true && data.peng !== true && data.gang !== true)) {
                break; // 空提示
            }
            bot.pendingAction = data;
            schedule(bot, function () {
                var act = AIEngine.decideAction(bot.state, bot.pendingAction);
                bot.pendingAction = null;
                var m = gameMgrOf(bot);
                if (m == null) return;
                if (act.op === 'hu') {
                    m.hu(bot.userId);
                } else if (act.op === 'gang') {
                    m.gang(bot.userId, act.pai);
                } else if (act.op === 'peng') {
                    m.peng(bot.userId);
                } else {
                    m.guo(bot.userId);
                    // 过完自己回合的提示后仍需出牌
                    schedule(bot, function () { doDiscard(bot); });
                }
            });
            break;

        case 'game_huanpai_push':
            schedule(bot, function () {
                var m = gameMgrOf(bot);
                if (m && m.huanSanZhang) {
                    var ps = AIEngine.decideHuanPai(bot.state.holds);
                    if (ps.length === 3) m.huanSanZhang(bot.userId, ps[0], ps[1], ps[2]);
                }
            });
            break;

        case 'game_dingque_push':
            schedule(bot, function () {
                var m = gameMgrOf(bot);
                if (m && m.dingQue) {
                    m.dingQue(bot.userId, AIEngine.decideDingQue(bot.state.holds));
                }
            });
            break;

        case 'game_over_push':
            bot.pendingAction = null;
            // 一局结束后自动准备下一局（若房间已销毁则为无害空操作）
            schedule(bot, function () {
                var ri = roomMgr.getRoom(bot.roomId);
                if (ri && ri.gameMgr) {
                    ri.gameMgr.setReady(bot.userId);
                    userMgr.broacastInRoom('user_ready_push', { userid: bot.userId, ready: true }, bot.userId, true);
                }
            });
            break;

        case 'game_sync_push':
            break;

        case 'dissolve_notice_push':
            // 机器人总是同意解散
            schedule(bot, function () {
                var m = gameMgrOf(bot);
                if (m && m.dissolveAgree) {
                    var ret = m.dissolveAgree(bot.roomId, bot.userId, true);
                    if (ret != null && m.doDissolve) {
                        var all = true;
                        for (var i = 0; i < ret.dr.states.length; i++) {
                            if (ret.dr.states[i] === false) { all = false; break; }
                        }
                        if (all) m.doDissolve(bot.roomId);
                    }
                }
            });
            break;
    }
}

function doDiscard(bot) {
    var mgr = gameMgrOf(bot);
    if (mgr == null || bot.state.hued) return;
    if (bot.state.holds.length === 0) return;
    // 手牌数应为 3n+2（摸牌后/碰后），否则不该出
    var weaveCnt = bot.state.pengs.length + bot.state.angangs.length +
        bot.state.diangangs.length + bot.state.wangangs.length;
    var expect = 14 - weaveCnt * 3;
    if (process.env.BOT_DEBUG) console.log('[bot ' + bot.userId + '] doDiscard holds=' + bot.state.holds.length + ' expect=' + expect);
    if (bot.state.holds.length !== expect) return;

    var pai = AIEngine.decideDiscard(bot.state);
    mgr.chuPai(bot.userId, pai);
}
