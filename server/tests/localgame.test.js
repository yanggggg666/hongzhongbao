//
// localgame.test.js —— 单机模式（客户端内嵌服务端）无头仿真测试
//
// 在纯 Node 中模拟 Cocos Creator 的 CommonJS 模块环境（按名 require），
// 驱动 LocalGame + LocalNet 完整打一局红中麻将：
//   本地玩家也用一个 AI 代理自动操作，验证内嵌服务端 + 协议路由全链路。
// 运行：node tests/localgame.test.js
//

'use strict';
var path = require('path');
var Module = require('module');

var CLIENT_SCRIPTS = path.resolve(__dirname, '../../client/assets/scripts');

// ================= 模拟 Cocos 的按名 require =================
var NAME_MAP = {
    'LocalGame': path.join(CLIENT_SCRIPTS, 'LocalGame.js'),
    'LocalNet': path.join(CLIENT_SCRIPTS, 'LocalNet.js')
};
var origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
    if (NAME_MAP[request]) return NAME_MAP[request];
    return origResolve.call(this, request, parent);
};

// ================= 模拟 cc 全局 =================
global.cc = {
    vv: {
        userMgr: { userName: '单机测试员', userId: 88880001 },
        net: null,
        _realNet: null,
        gameNetMgr: null
    }
};

var LocalGame = require(CLIENT_SCRIPTS + '/LocalGame.js');
var LocalNet = require(CLIENT_SCRIPTS + '/LocalNet.js');
var AIEngine = require(CLIENT_SCRIPTS + '/localserver/algorithm/AIEngine.js');
var botmgr = require(CLIENT_SCRIPTS + '/localserver/botmgr.js');

botmgr.setThinkDelay(3, 10);

// ================= 本地玩家的 AI 代理 =================
var me = AIEngine.createBotState(88880001);
me.gameType = 'hzmj';

var overInfo = null;
var handlers = {
    login_result: function (data) {
        console.log('[sim] login_result errcode=' + data.errcode + ' seats=' + data.data.seats.length);
    },
    login_finished: function () {
        console.log('[sim] login_finished');
    },
    game_action_push: function (data) {
        if (data == null) return;
        setTimeout(function () {
            var act = AIEngine.decideAction(me, data);
            if (act.op === 'hu') LocalNet.send('hu');
            else if (act.op === 'gang') LocalNet.send('gang', act.pai);
            else if (act.op === 'peng') LocalNet.send('peng');
            else LocalNet.send('guo');
        }, 5);
    },
    game_chupai_push: function (userId) {
        if (userId !== 88880001) return;
        setTimeout(function () {
            var weaveCnt = me.pengs.length + me.angangs.length + me.diangangs.length + me.wangangs.length;
            if (me.holds.length !== 14 - weaveCnt * 3) return;
            var pai = AIEngine.decideDiscard(me);
            LocalNet.send('chupai', pai);
        }, 5);
    },
    game_over_push: function (data) {
        overInfo = data;
        var sum = 0;
        for (var i = 0; i < data.results.length; i++) sum += data.results[i].score;
        console.log('[sim] game_over zero-sum=' + (sum === 0) + ' endinfo=' + (data.endinfo != null));
    }
};

// 事件镜像：维护"我"的手牌视图
var MIRROR_EVENTS = ['game_holds_push', 'game_mopai_push', 'game_chupai_notify_push',
    'peng_notify_push', 'gang_notify_push', 'hu_push', 'game_begin_push', 'game_over_push'];
MIRROR_EVENTS.forEach(function (evt) {
    var prev = handlers[evt];
    handlers[evt] = function (data) {
        AIEngine.updateOnEvent(me, evt, data);
        if (prev) prev(data);
    };
});

// ================= 启动 =================
console.log('[sim] 启动单机对局...');
cc.vv.net = LocalNet;
LocalNet.attach({ handlers: handlers });

LocalGame.start({ maxGames: 1 }, function (roomInfo) {
    if (roomInfo == null) {
        console.error('✗ 单机房间创建失败');
        process.exit(1);
    }
    console.log('[sim] 房间就绪 roomId=' + roomInfo.roomid);
    // 模拟 GameNetMgr.connectGameServer 流程
    LocalNet.connect(function () {
        LocalNet.send('login', { token: 'local', roomid: roomInfo.roomid, time: 0, sign: 'local' });
    }, function () {
        console.error('✗ connect failed');
        process.exit(1);
    });
});

var t0 = Date.now();
var timer = setInterval(function () {
    if (overInfo != null) {
        clearInterval(timer);
        console.log('[sim] ✓ 单机模式全链路仿真通过（耗时 ' + (Date.now() - t0) + 'ms）');
        process.exit(0);
    }
    if (Date.now() - t0 > 60000) {
        clearInterval(timer);
        console.error('✗ 超时：60 秒内未完成单机对局');
        process.exit(1);
    }
}, 200);
