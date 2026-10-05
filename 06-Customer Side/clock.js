/* =========================================================
 * 顾客端 · 共享工具（全局提示条 + 时钟格式化）
 * 供各视图组件复用；统一挂载到 window.MallUI 命名空间
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;

  /* ---------- 通用工具 ---------- */
  var TOASTS = Vue.reactive([]);
  function toast(msg, type) {
    var id = Date.now() + Math.random();
    TOASTS.push({ id: id, msg: msg, type: type || 'info' });
    setTimeout(function () {
      var i = TOASTS.findIndex(function (t) { return t.id === id; });
      if (i >= 0) TOASTS.splice(i, 1);
    }, 2800);
  }

  function fmtTime(mins) {
    var m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60);
  }

  global.MallUI = global.MallUI || {};
  global.MallUI.TOASTS = TOASTS;
  global.MallUI.toast = toast;
  global.MallUI.fmtTime = fmtTime;
})(window);
