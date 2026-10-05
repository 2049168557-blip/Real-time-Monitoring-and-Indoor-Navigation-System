/* =========================================================
 * 顾客端 · 底部操作栏与状态提示
 * 导航进度、路径回放、推送通道状态、数据更新时间
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  var BottomBar = {
    name: 'BottomBar',
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      var lastUpdateText = Vue.ref('');
      var timer = setInterval(function () {
        var s = Math.floor((Date.now() - state.lastUpdate) / 1000);
        lastUpdateText.value = s < 2 ? '刚刚更新' : s + ' 秒前更新';
      }, 1000);
      Vue.onUnmounted(function () { clearInterval(timer); });
      function play() { if (!state.route) { toast('请先选择商户并发起导航', 'warn'); return; } store.playRoute(); }
      var replayRunning = computed(function () { return state.replay.playing && !state.replay.paused; });
      function doReplay() {
        if (replayRunning.value) { store.pauseReplay(); return; }
        if (state.replay.playing && state.replay.paused) { store.resumeReplay(); return; }
        if (!store.playReplay()) { toast('暂无轨迹：请先播放一次导航动画以记录移动轨迹', 'warn'); return; }
        toast('开始轨迹回放（共 ' + state.trail.length + ' 个采样点）');
      }
      function netClass() {
        return { open: 'ok', connecting: 'wait', reconnecting: 'wait', closed: 'err' }[state.netStatus];
      }
      function netLabel() {
        return { open: '推送通道正常', connecting: '正在建立连接', reconnecting: '连接中断，正在重连', closed: '连接中断，展示缓存数据' }[state.netStatus];
      }
      return { store: store, state: state, play: play, lastUpdateText: lastUpdateText, netClass: netClass, netLabel: netLabel, replayRunning: replayRunning, doReplay: doReplay, toast: toast };
    },
    template: `
    <footer class="bottombar">
      <div class="bb-left">
        <button class="btn btn-primary btn-sm" @click="play" :disabled="!state.route">▶ 播放动画</button>
        <button class="btn btn-ghost btn-sm" v-if="state.nav.playing && !state.nav.paused" @click="store.pauseRoute()">⏸ 暂停</button>
        <button class="btn btn-ghost btn-sm" v-if="state.nav.paused" @click="store.resumeRoute()">⏵ 继续</button>
        <button class="btn btn-ghost btn-sm" @click="store.clearRoute()">■ 停止</button>
        <span class="vrule"></span>
        <label class="switch"><input type="checkbox" :checked="state.trailRecording" @change="store.toggleTrailRecord()" /><span>记录轨迹</span></label>
        <button class="btn btn-ghost btn-sm" :disabled="state.trail.length<2" @click="doReplay()">{{ replayRunning ? '⏸ 回放暂停' : '↻ 轨迹回放' }}</button>
        <button class="btn btn-ghost btn-sm" v-if="state.trail.length" @click="store.stopReplay(); store.clearTrail()">清除轨迹</button>
        <span class="trail-count" v-if="state.trail.length">{{ state.trail.length }} 个采样点</span>
        <span class="vrule"></span>
        <span class="bb-label">倍速</span>
        <div class="seg-group">
          <button v-for="s in [0.5,1,2]" :key="s" class="seg xs" :class="{active: state.nav.speed===s}" @click="store.setSpeed(s)">{{ s }}x</button>
        </div>
        <label class="switch"><input type="checkbox" :checked="state.nav.follow" @change="store.toggleFollow()" /><span>视角跟随</span></label>
      </div>

      <div class="bb-progress" v-if="state.replay.playing">
        <span class="pb-label">轨迹回放</span>
        <div class="pb"><i class="trail" :style="{width: (state.replay.t*100)+'%'}"></i></div>
        <span class="pb-text">{{ Math.round(state.replay.t*100) }}%</span>
      </div>
      <div class="bb-progress" v-else-if="state.route">
        <div class="pb"><i :style="{width: (state.nav.progress*100)+'%'}"></i></div>
        <span class="pb-text">{{ Math.round(state.nav.progress*100) }}%</span>
      </div>

      <div class="bb-right">
        <span class="status-item"><i class="net-dot" :class="netClass()"></i>{{ netLabel() }}</span>
        <span class="status-item">数据 {{ lastUpdateText }}</span>
        <button class="link" @click="state.tab='admin'">数据来源说明</button>
      </div>
    </footer>`
  };

  U.BottomBar = BottomBar;
})(window);
