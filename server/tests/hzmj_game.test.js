//
// hzmj_game.test.js —— 红中麻将全链路无头集成测试
//
// 打桩数据库后，创建 4 机器人房间，快速对局直到房间销毁。
// 验证：房间创建 -> 开局 -> 摸打出碰杠胡 -> 结算 -> 多局 -> 销毁 全流程无异常，且零和。
// 运行：node tests/hzmj_game.test.js
//

'use strict';

// ================= 打桩 db（必须在 require 游戏模块之前） =================
var db = require('../utils/db');
var nop = function () {};
db.init = nop;
db.is_room_exist = function (id, cb) { cb(false); };
db.create_room = function (id, conf, ip, port, t, cb) { cb('test-uuid-' + id); };
db.delete_room = nop;
db.set_room_id_of_user = nop;
db.update_seat_info = nop;
db.update_next_button = nop;
db.create_game = function (uuid, idx, info, cb) { if (cb) cb(true); };
db.update_game_result = nop;
db.update_game_action_records = nop;
db.update_num_of_turns = nop;
db.cost_gems = nop;
db.archive_games = nop;
db.get_user_history = function (uid, cb) { cb([]); };
db.update_user_history = nop;
db.get_room_data = function (id, cb) { cb(null); };

var roomMgr = require('../game_server/roommgr');
var userMgr = require('../game_server/usermgr');
var botmgr = require('../game_server/botmgr');

botmgr.setThinkDelay(3, 10);

// ================= 监听结算广播，校验零和 =================
var overCount = 0;
var lastResults = null;
var origBroadcast = userMgr.broacastInRoom;
userMgr.broacastInRoom = function (event, data, sender, includingSender) {
    if (event === 'game_over_push' && data && data.results && data.results.length === 4) {
        overCount++;
        lastResults = data.results;
        var sum = 0;
        for (var i = 0; i < 4; i++) sum += data.results[i].score;
        if (sum !== 0) {
            console.error('✗ 非零和！score sum = ' + sum);
            process.exit(1);
        }
    }
    return origBroadcast.call(userMgr, event, data, sender, includingSender);
};

// ================= 创建房间 + 4 机器人 =================
var conf = {
    type: 'hzmj',
    difen: 0,           // 底分 1
    jushuxuanze: 0,
    maxGames: 2,        // 打 2 局就结束
    robots: 0,
    actionTimeout: 0    // 测试由机器人驱动，关闭托管超时
};

console.log('[test] 创建红中麻将房间...');
roomMgr.createRoom(999001, conf, 99, '127.0.0.1', 9001, function (err, roomId) {
    if (err !== 0 || roomId == null) {
        console.error('✗ 创建房间失败 err=' + err);
        process.exit(1);
    }
    console.log('[test] 房间创建成功 roomId=' + roomId);

    var added = botmgr.addBots(roomId, 4);
    console.log('[test] 加入机器人 x' + added);
    if (added !== 4) {
        console.error('✗ 机器人数量不足');
        process.exit(1);
    }

    var t0 = Date.now();
    var timer = setInterval(function () {
        var room = roomMgr.getRoom(roomId);
        if (room == null) {
            clearInterval(timer);
            console.log('[test] ✓ 房间已销毁（' + overCount + ' 局完成，耗时 ' + (Date.now() - t0) + 'ms）');
            if (overCount >= 2 && lastResults != null) {
                console.log('[test] ✓ 红中麻将全链路集成测试通过');
                process.exit(0);
            } else {
                console.error('✗ 局数不足 overCount=' + overCount);
                process.exit(1);
            }
        }
        if (Date.now() - t0 > 60000) {
            clearInterval(timer);
            console.error('✗ 超时！60 秒内未完成对局（numOfGames=' + room.numOfGames + '）');
            process.exit(1);
        }
    }, 200);
});
