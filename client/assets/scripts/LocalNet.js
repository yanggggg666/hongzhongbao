//
// LocalNet.js —— 单机模式网络层（与 Net.js 同接口）
//
// 替换 cc.vv.net 后，GameNetMgr/牌桌 UI 的所有网络调用都被路由到本地
// 嵌入的服务端（localserver/），UI 代码零改动。
//
// 用法：
//   cc.vv._realNet = cc.vv.net;
//   cc.vv.net = require("LocalNet");
//   LocalNet.attach(cc.vv._realNet);   // 共享已注册的事件处理器
//

'use strict';

var LocalGame = require('LocalGame');
var roomMgr = require('./localserver/roommgr');
var userMgr = require('./localserver/usermgr');

var _realNet = null;
var _socketBound = false;

function dispatch(event, data) {
    var handlers = LocalNet.handlers;
    if (handlers && handlers[event]) {
        try {
            handlers[event](data);
        } catch (e) {
            console.log('[LocalNet] handler error ' + event + ': ' + (e && e.stack));
        }
    }
}

/** 本地玩家的假 socket：服务端事件直接派发给 GameNetMgr 处理器 */
function bindLocalSocket() {
    if (_socketBound) return;
    _socketBound = true;
    var fakeSocket = {
        userId: LocalGame.localUserId(),
        emit: function (event, data) {
            dispatch(event, data);
        },
        disconnect: function () {
            // 服务器踢人（整局结束）-> 走与联网相同的断线流程
            LocalNet.close();
        }
    };
    userMgr.bind(LocalGame.localUserId(), fakeSocket);
}

var LocalNet = {
    ip: 'local',
    sio: null,
    isPinging: false,
    fnDisconnect: null,
    handlers: {},
    lastRecieveTime: 0,
    lastSendTime: 0,
    delayMS: null,

    /** 绑定真实 Net 的处理器注册表（GameNetMgr 已注册在其中） */
    attach: function (realNet) {
        _realNet = realNet;
        this.handlers = realNet.handlers;
    },

    addHandler: function (event, fn) {
        this.handlers[event] = fn;
    },

    connect: function (fnConnect, fnError) {
        if (LocalGame.roomId == null) {
            if (fnError) fnError();
            return;
        }
        bindLocalSocket();
        var self = this;
        setTimeout(function () {
            fnConnect();
        }, 0);
    },

    send: function (event, data) {
        var mgr = LocalGame.gameMgr();
        var uid = LocalGame.localUserId();

        switch (event) {
            case 'login':
                // 与服务器登录响应同构
                var roomInfo = LocalGame.roomInfo();
                if (roomInfo == null) return;
                dispatch('login_result', { errcode: 0, errmsg: 'ok', data: roomInfo });
                // 服务器行为：登录即自动准备（可能触发开局/断线同步）
                if (mgr) mgr.setReady(uid);
                dispatch('login_finished');
                break;

            case 'ready':
                if (mgr) mgr.setReady(uid);
                userMgr.broacastInRoom('user_ready_push', { userid: uid, ready: true }, uid, true);
                break;

            case 'chupai':
                if (mgr) mgr.chuPai(uid, data);
                break;
            case 'peng':
                if (mgr) mgr.peng(uid);
                break;
            case 'gang':
                if (mgr) mgr.gang(uid, data);
                break;
            case 'hu':
                if (mgr) mgr.hu(uid);
                break;
            case 'guo':
                if (mgr) mgr.guo(uid);
                break;

            case 'game_ping':
                dispatch('game_pong');
                break;

            case 'chat':
                userMgr.broacastInRoom('chat_push', { sender: uid, content: data }, uid, true);
                break;
            case 'quick_chat':
                userMgr.broacastInRoom('quick_chat_push', { sender: uid, content: data }, uid, true);
                break;
            case 'emoji':
                userMgr.broacastInRoom('emoji_push', { sender: uid, content: data }, uid, true);
                break;

            case 'exit':
                if (mgr && mgr.hasBegan(LocalGame.roomId)) return;
                roomMgr.exitRoom(uid);
                userMgr.del(uid);
                _socketBound = false;
                dispatch('exit_result');
                this.close();
                break;

            case 'dispress':
                dispatch('dispress_push', {});
                this.close();
                break;

            case 'dissolve_request':
                if (mgr) {
                    var ret = mgr.dissolveRequest(LocalGame.roomId, uid);
                    if (ret != null) {
                        var dr = ret.dr;
                        dispatch('dissolve_notice_push', {
                            time: (dr.endTime - Date.now()) / 1000,
                            states: dr.states
                        });
                        // 机器人自动同意（botmgr 处理），解散由 gamemgr 驱动
                    }
                }
                break;
            case 'dissolve_agree':
                if (mgr) {
                    var r2 = mgr.dissolveAgree(LocalGame.roomId, uid, true);
                    if (r2 != null) {
                        var all = true;
                        for (var i = 0; i < r2.dr.states.length; i++) {
                            if (r2.dr.states[i] === false) { all = false; break; }
                        }
                        if (all) mgr.doDissolve(LocalGame.roomId);
                    }
                }
                break;
            case 'dissolve_reject':
                if (mgr) {
                    var r3 = mgr.dissolveAgree(LocalGame.roomId, uid, false);
                    if (r3 != null) {
                        dispatch('dissolve_cancel_push', {});
                    }
                }
                break;

            default:
                console.log('[LocalNet] unhandled event: ' + event);
        }
    },

    ping: function () {
        this.send('game_ping');
    },

    test: function (fnResult) {
        fnResult(true);
    },

    /** 断开并清理（返回大厅时恢复真实网络层） */
    close: function () {
        LocalGame.stop();
        _socketBound = false;
        if (cc.vv && cc.vv._realNet) {
            cc.vv.net = cc.vv._realNet;
            cc.vv._realNet = null;
        }
        var fn = this.fnDisconnect || (this.handlers && this.handlers['disconnect']);
        if (fn) {
            try { fn(); } catch (e) { }
        }
    }
};

module.exports = LocalNet;
