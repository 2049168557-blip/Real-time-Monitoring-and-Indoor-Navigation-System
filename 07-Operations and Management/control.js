/* =========================================================
 * 管理端独立入口引导脚本
 * 依据《需求规格说明书》第 11 章：管理端与用户端需分离部署，
 * 管理端仅限内网访问，避免管理接口暴露于公网。
 * 因此单独提供 admin.html，只挂载数据管理视图，不含顾客端。
 * ========================================================= */
(function (global) {
  'use strict';
  function boot() {
    var data = global.MallData.build();
    var sim = global.MallSim.create(data, {});
    var router = global.IndoorRouter.create(data);
    var store = global.MallStore.create(data, sim, router);
    global.__mallStore = store;
    sim.start();

    var AdminApp = {
      name: 'AdminApp',
      components: { AdminView: global.MallViews.AdminView },
      setup: function () {
        return {
          store: store,
          goUser: function () { global.location.href = 'index.html'; },
          clockText: global.Vue.computed(function () { return store.sim.fmtClock(Math.round(store.state.clockMinutes)); })
        };
      },
      template: [
        '<div class="app-shell">',
        '  <header class="topbar">',
        '    <div class="brand">',
        '      <div class="logo">gt</div>',
        '      <div class="brand-text">',
        '        <h1>管理端 · 商场实时监测与室内导航系统</h1>',
        '        <p>Data Management Console · 仅限内网访问（需求第 11 章：管理端与用户端分离部署）</p>',
        '      </div>',
        '    </div>',
        '    <div class="top-right">',
        '      <span class="status-item">仿真时钟 {{ clockText }}</span>',
        '      <span class="status-item"><i class="net-dot ok"></i>数据来源：{{ store.sourceLabel(store.state.dataSource) }}</span>',
        '      <button class="btn btn-ghost btn-sm" @click="goUser">← 返回顾客端</button>',
        '    </div>',
        '  </header>',
        '  <div class="full-page"><admin-view :store="store"></admin-view></div>',
        '</div>'
      ].join('')
    };

    global.Vue.createApp(AdminApp).mount('#admin');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
