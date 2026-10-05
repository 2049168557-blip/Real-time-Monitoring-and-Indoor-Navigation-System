/* =========================================================
 * 顾客端 · 应用外壳（根组件）与启动入口
 *   负责组装各视图组件、挂载 Vue 应用、初始化数据/仿真/路由/状态
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  /* 子组件别名（各自在独立文件中定义并挂到 MallUI） */
  var TopBar = U.TopBar, MerchantPanel = U.MerchantPanel, InfoPanel = U.InfoPanel,
      MainStage = U.MainStage, BottomBar = U.BottomBar, LocateModal = U.LocateModal;
  var TOASTS = U.TOASTS;   // 全局提示条集合（由 01-共享工具 提供）

  var App = {
    name: 'App',
    components: {
      TopBar: TopBar, MerchantPanel: MerchantPanel, InfoPanel: InfoPanel,
      MainStage: MainStage, BottomBar: BottomBar, LocateModal: LocateModal,
      DashboardView: global.MallViews.DashboardView, AdminView: global.MallViews.AdminView
    },
    props: ['store'],
    setup() { return { toasts: TOASTS }; },
    template: `
    <div class="app-shell">
      <top-bar :store="store"></top-bar>
      <main class="app-main" v-show="store.state.tab==='guide'">
        <merchant-panel :store="store"></merchant-panel>
        <main-stage :store="store"></main-stage>
        <info-panel :store="store"></info-panel>
      </main>
      <div class="bottom-host" v-show="store.state.tab==='guide'">
        <bottom-bar :store="store"></bottom-bar>
      </div>
      <div class="full-page" v-if="store.state.tab==='dashboard'">
        <dashboard-view :store="store"></dashboard-view>
      </div>
      <div class="full-page" v-if="store.state.tab==='admin'">
        <admin-view :store="store"></admin-view>
      </div>
      <locate-modal :store="store"></locate-modal>
      <div class="toast-wrap">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.msg }}</div>
      </div>
    </div>`
  };

  /* ================= 启动 ================= */
  function boot() {
    var data = global.MallData.build();
    var sim = global.MallSim.create(data, {});
    var router = global.IndoorRouter.create(data);
    var store = global.MallStore.create(data, sim, router);
    global.__mallStore = store;

    // 演示默认定位：一层南主入口
    store.locateAt(1, 24, 2, 'manual');
    sim.start();

    var app = Vue.createApp(App, { store: store });
    app.mount('#app');

    // 每 3 秒刷新一次状态条稀数据（保证统计口径一致）
    setInterval(function () { store.sim.socket.status === 'open' && (store.state.lastUpdate = Date.now()); }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  U.App = App;
})(window);
