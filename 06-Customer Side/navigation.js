/* =========================================================
 * 顾客端 · 顶部导航栏
 * 品牌区、楼层切换卡片、演示时钟、断网模拟、页面切换
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  var TopBar = {
    name: 'TopBar',
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      var clockOpen = Vue.ref(false);
      var clocks = [
        { m: 10 * 60, name: '上午平峰 10:00' },
        { m: 12 * 60 + 20, name: '午高峰 12:20' },
        { m: 15 * 60, name: '下午平峰 15:00' },
        { m: 18 * 60 + 40, name: '晚高峰 18:40' },
        { m: 21 * 60 + 40, name: '即将打烊 21:40' },
        { m: 22 * 60 + 40, name: '已打烊 22:40' }
      ];
      function go(tab) { state.tab = tab; }
      function netText() {
        return { open: 'WebSocket 已连接', connecting: '连接中…', reconnecting: '重连中…', closed: '连接中断' }[state.netStatus];
      }
      return { store: store, state: state, clockOpen: clockOpen, clocks: clocks, go: go, fmtTime: fmtTime, netText: netText, toast: toast };
    },
    template: `
    <header class="topbar">
      <div class="brand">
        <div class="logo">gt</div>
        <div class="brand-text">
          <h1>gt广场 · 实时监测与室内导航系统</h1>
          <p>Mall Real-time Monitoring &amp; Indoor Navigation · B1 / 1F-3F · {{ store.data.merchants.length }} 家商户</p>
        </div>
      </div>

      <nav class="floor-tabs">
        <button v-for="f in store.data.floors" :key="f.no" class="floor-tab" :class="{active: state.currentFloor===f.no}"
                @click="store.setFloor(f.no)">
          <strong>{{ f.label }}</strong><span>{{ f.title }}</span>
        </button>
      </nav>

      <div class="top-right">
        <div class="clock-chip" @click="clockOpen=!clockOpen">
          <span class="dot" :class="{live: state.clockAuto}"></span>
          <b>{{ fmtTime(state.clockMinutes) }}</b>
          <span class="clock-sub">演示时钟</span>
        </div>
        <div class="clock-pop" v-if="clockOpen">
          <div class="pop-head">演示时钟（用于演示营业状态判定与客流时段差异）</div>
          <input type="range" min="0" max="1439" :value="state.clockMinutes" @change="store.setClock(Number($event.target.value))" class="range" />
          <div class="pop-chips">
            <button v-for="c in clocks" :key="c.m" class="chip sm" @click="store.setClock(c.m)">{{ c.name }}</button>
          </div>
          <div class="pop-foot">
            <span>{{ state.dateLabel }}</span>
            <span class="pop-actions">
              <button class="link" @click="store.syncRealTime()">同步真实时间</button>
              <label class="sw"><input type="checkbox" :checked="state.clockAuto" @change="store.setClockAuto($event.target.checked)" /> 自动推进</label>
            </span>
          </div>
          <p class="pop-note">自动推进时 1 真实秒 ≈ {{ store.sim.params.timeScale }} 秒仿真时间，便于观察客流随时段变化</p>
        </div>

        <button class="btn btn-locate" @click="state.locateOpen=true">
          <span class="ico">◎</span> {{ state.userPos ? '重新定位' : '定位' }}
        </button>
        <button class="btn btn-ghost btn-sm" @click="store.toggleNet()">
          {{ state.offlineDemo ? '恢复网络' : '模拟断网' }}
        </button>
        <div class="seg-group tabs">
          <button class="seg" :class="{active: state.tab==='guide'}" @click="go('guide')">顾客导览</button>
          <button class="seg" :class="{active: state.tab==='dashboard'}" @click="go('dashboard')">运营看板</button>
          <button class="seg" :class="{active: state.tab==='admin'}" @click="go('admin')">管理后台</button>
        </div>
      </div>
    </header>`
  };

  U.TopBar = TopBar;
})(window);
