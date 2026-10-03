//
// crypto.js —— 客户端单机模式加解密桩件（仅实现 localserver 用到的接口）
//
'use strict';

exports.toBase64 = function (str) {
    if (typeof btoa === 'function') {
        try {
            return btoa(unescape(encodeURIComponent(str || '')));
        } catch (e) { }
    }
    return str || '';
};

exports.fromBase64 = function (str) {
    if (typeof atob === 'function') {
        try {
            return decodeURIComponent(escape(atob(str)));
        } catch (e) { }
    }
    return str || '';
};

exports.md5 = function (content) {
    // 单机模式不需要真实 MD5，返回稳定占位
    return 'local_' + String(content).length;
};
