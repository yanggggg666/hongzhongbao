//
// LocalGame.js —— 单机模式（本地红中麻将 + 3 个 AI）
//
// 设计：把服务端的 roommgr/usermgr/gamemgr_hzmj/botmgr 完整嵌入客户端
// （localserver/ 目录），本地玩家通过 LocalNet 以与联网完全一致的
// socket 协议收发消息，3 个 AI 由 botmgr 驱动。
//
// 用法：
//   LocalGame.start({baseScore, maxGames, ...})  // 进入单机对局
//   LocalGame.stop()                             // 退出并清理
//

'use strict';

var roomMgr = require('./localserver/roommgr');
var userMgr = require('./localserver/usermgr');
var botmgr = require('./localserver/botmgr');

var LOCAL_USER_ID = 88880001;

var LocalGame = {
    roomId: null,
    conf: null,
    _started: false,

    /**
     * 启动单机对局
     * @param opts {baseScore, maxGames, maxFan, canJiePao, qiangGang, laiziChu, fanPerLaizi, zimoFan, robots}
     * @param onRoomReady function(roomInfo) 房间就绪回调（用于加载游戏场景）
     */
    start: function (opts, onRoomReady) {
        if (this._started) return;
        opts = opts || {};

        var conf = {
            type: 'hzmj',
            difen: 0,
            jushuxuanze: 1,
            maxGames: opts.maxGames || 8,
            zuidafanshu: 2,
            canJiePao: opts.canJiePao !== false,
            qiangGang: opts.qiangGang !== false,
            laiziChu: opts.laiziChu === true,
            fanPerLaizi: opts.fanPerLaizi || 0,
            zimoFan: opts.zimoFan != null ? opts.zimoFan : 1,
            robots: 0, // 机器人由这里手动添加
            actionTimeout: 0
        };

        var self = this;
        roomMgr.createRoom(LOCAL_USER_ID, conf, 9999, '127.0.0.1', 0, function (err, roomId) {
            if (err !== 0 || roomId == null) {
                console.log('[LocalGame] create room failed: ' + err);
                return;
            }
            self.roomId = roomId;
            self.conf = roomMgr.getRoom(roomId).conf;
            self._started = true;

            // 本地玩家入座
            roomMgr.enterRoom(roomId, LOCAL_USER_ID, self.playerName(), function () { });

            // 3 个 AI 入座（机器人自动准备）
            botmgr.setThinkDelay(800, 1600);
            botmgr.addBots(roomId, 3);

            console.log('[LocalGame] room created: ' + roomId);
            if (onRoomReady) {
                onRoomReady(self.roomInfo());
            }
        });
    },

    playerName: function () {
        if (cc.vv && cc.vv.userMgr && cc.vv.userMgr.userName) {
            return cc.vv.userMgr.userName;
        }
        return '红中宝玩家';
    },

    localUserId: function () {
        return LOCAL_USER_ID;
    },

    roomInfo: function () {
        var roomInfo = roomMgr.getRoom(this.roomId);
        if (roomInfo == null) return null;
        var seats = [];
        for (var i = 0; i < roomInfo.seats.length; ++i) {
            var rs = roomInfo.seats[i];
            seats.push({
                userid: rs.userId,
                ip: '127.0.0.1',
                score: rs.score,
                name: rs.name,
                online: true,
                ready: rs.ready,
                seatindex: i
            });
        }
        return {
            roomid: roomInfo.id,
            conf: roomInfo.conf,
            numofgames: roomInfo.numOfGames,
            seats: seats
        };
    },

    gameMgr: function () {
        var roomInfo = roomMgr.getRoom(this.roomId);
        return roomInfo ? roomInfo.gameMgr : null;
    },

    /** 停止并清理（退出房间/返回大厅时调用） */
    stop: function () {
        if (!this._started) return;
        this._started = false;
        if (this.roomId != null) {
            try {
                botmgr.removeBotsInRoom(this.roomId);
                roomMgr.destroy(this.roomId);
            } catch (e) {
                console.log('[LocalGame] stop error: ' + e);
            }
            this.roomId = null;
        }
    }
};

module.exports = LocalGame;
