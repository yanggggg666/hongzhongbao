//
// db.js —— 客户端单机模式数据库桩件
// 单机模式下 localserver 的所有写库操作均为空操作（或返回空数据），
// 战绩由 LocalGame 在本地内存中保存。
//
'use strict';

var nop = function () {};
var localHistory = [];

exports.init = nop;
exports.is_room_exist = function (id, cb) { cb(false); };
exports.create_room = function (id, conf, ip, port, t, cb) { cb('local-uuid-' + id); };
exports.delete_room = nop;
exports.set_room_id_of_user = nop;
exports.update_seat_info = nop;
exports.update_next_button = nop;
exports.create_game = function (uuid, idx, info, cb) { if (cb) cb(true); };
exports.update_game_result = nop;
exports.update_game_action_records = nop;
exports.update_num_of_turns = nop;
exports.cost_gems = nop;
exports.archive_games = nop;
exports.get_user_history = function (uid, cb) { cb(localHistory.slice()); };
exports.update_user_history = function (uid, history, cb) {
    localHistory = (history || []).slice(-10);
    if (cb) cb(true);
};
exports.get_room_data = function (id, cb) { cb(null); };
exports.get_games_of_room = function (uuid, cb) { cb(null); };
exports.get_detail_of_game = function (uuid, index, cb) { cb(null); };
