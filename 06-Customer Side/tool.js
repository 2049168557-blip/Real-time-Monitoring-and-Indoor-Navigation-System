/* =========================================================
 * 顾客端 · 中央主视图容器与工具栏
 * 三种视图切换、楼层聚焦、图层与图例面板、定位拾取入口、全屏与鼠标悬停提示
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;


  var Plan2D = U.Plan2D, Iso3D = U.Iso3D;
  var MainStage = {
    name: 'MainStage',
    components: { Plan2D: Plan2D, Iso3D: Iso3D },
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      var container = Vue.ref(null);
      var tooltip = Vue.reactive({ show: false, x: 0, y: 0, title: '', sub: '' });
      var fps = Vue.ref(60);
      /* 界面偏好（图例 / 图层是否展开）：本地记忆，避免每次打开都挡住视野 */
      var UI_KEY = 'mall-ui-prefs-v1';
      function uiPrefs() {
        try { return JSON.parse(global.localStorage.getItem(UI_KEY) || '{}'); } catch (e) { return {}; }
      }
      function uiPref(k, dft) { var v = uiPrefs()[k]; return v === undefined ? dft : v; }
      function setUiPref(k, v) {
        try { var o = uiPrefs(); o[k] = v; global.localStorage.setItem(UI_KEY, JSON.stringify(o)); } catch (e) { /* file:// 可能禁用存储 */ }
      }
      var legendOpen = Vue.ref(uiPref('legendOpen', true));
      var layerOpen = Vue.ref(uiPref('layerOpen', true));
      /* 3D 标签显示模式：自动避让 / 全部显示 / 仅选中 / 关闭 */
      var labelMode = Vue.ref('declutter');
      var LABEL_MODES = [
        { v: 'declutter', label: '标签自动避让' },
        { v: 'all', label: '标签全部显示' },
        { v: 'selected', label: '仅选中标签' },
        { v: 'off', label: '标签关闭' }
      ];
      function labelModeLabel() {
        var m = LABEL_MODES.filter(function (x) { return x.v === labelMode.value; })[0];
        return m ? m.label : LABEL_MODES[0].label;
      }
      function cycleLabelMode() {
        var i = 0;
        LABEL_MODES.forEach(function (x, k) { if (x.v === labelMode.value) i = k; });
        labelMode.value = LABEL_MODES[(i + 1) % LABEL_MODES.length].v;
        if (store.runtime.scene) store.runtime.scene.setLabelMode(labelMode.value);
        toast('三维标签：' + labelModeLabel());
      }
      function toggleLegend() { legendOpen.value = !legendOpen.value; setUiPref('legendOpen', legendOpen.value); }
      function toggleLayers() { layerOpen.value = !layerOpen.value; setUiPref('layerOpen', layerOpen.value); }
      var interval = null;
      var animTimer = null;

      onMounted(function () {
        nextTick(function () {
          try {
            var scene = global.Scene3D.create(container.value, store.data, {});
            store.runtime.scene = scene;
            scene.on('select', function (info) {
              store.select(info);
            });
            scene.on('hover', function (info, pos) {
              if (!info) { tooltip.show = false; return; }
              if (info.kind === 'merchant') {
                var m = store.selectedMerchantById(info.id);
                if (!m) return;
                var rt = store.realtimeOf(m);
                tooltip.title = m.name + ' · ' + store.floorsOf(m.floorNo).label;
                tooltip.sub = m.category + ' · 人均 ¥' + m.avgPrice + ' · 当前 ' + rt.currentCount + ' 人 · 排队 ' + rt.queueCount + ' 人';
              } else {
                var fac = null;
                store.data.facilities.forEach(function (f) { if (f.id === info.id) fac = f; });
                if (!fac) return;
                tooltip.title = fac.name;
                tooltip.sub = fac.desc;
              }
              tooltip.x = pos.x; tooltip.y = pos.y; tooltip.show = true;
            });
            scene.on('arrive', function () {
              store.onArrive();
              var target = store.selectedMerchant() || store.selectedFacility();
              toast('已抵达' + (target ? '「' + target.name + '」' : '目的地'), 'success');
            });
            scene.on('frame', function (v) { fps.value = v; });
            scene.setFloorFocus(state.currentFloor, state.soloFloor);
            scene.setSelected(state.selectedKind === 'merchant' ? state.selectedId : null);
            interval = setInterval(function () {
              scene.setStatus(store.statusMap3D());
            }, 600);
            // 画面自检：上下文创建成功但画不出内容时，自动降级为等距三维视图
            setTimeout(function () {
              if (state.viewMode !== '3d') return;
              if (scene.probeBlank && scene.probeBlank()) {
                state.viewMode = 'iso';
                toast('检测到三维画面未能渲染（浏览器硬件加速可能未开启），已切换为等距三维视图', 'warn');
              }
            }, 2600);
          } catch (e) {
            console.error('三维场景初始化失败，已降级为等距视图：', e);
            state.webglError = e.message;
            // 规范 FR-03-03：三维不可用时自动降级为色块展示，保证功能可用
            state.viewMode = 'iso';
            toast('当前浏览器不支持 WebGL，已自动切换为等距三维视图（功能不受影响）', 'warn');
          }
        });
      });
      Vue.onUnmounted(function () {
        clearInterval(interval);
        if (animTimer) clearInterval(animTimer);
        if (store.runtime.scene) { store.runtime.scene.dispose(); store.runtime.scene = null; }
      });

      /* 路径进度轮询 + 轨迹记录 + 轨迹回放推进 */
      animTimer = setInterval(function () {
        if (state.route && state.nav.playing && !state.nav.paused) {
          if (store.runtime.scene) state.nav.progress = store.runtime.scene.getProgress();
          if (state.trailRecording) store.recordTrail(store.routePointAt(state.nav.progress));
        }
        if (state.replay.playing && !state.replay.paused) {
          state.replay.t += 0.006;
          if (state.replay.t >= 1) state.replay.t = 1;
          var p = store.trailPointAt(state.replay.t);
          if (store.runtime.scene) store.runtime.scene.setTrailMarker(p);
          if (state.replay.t >= 1) state.replay.playing = false;
        }
      }, 120);
      Vue.onUnmounted(function () { clearInterval(animTimer); });

      watch(function () { return [state.currentFloor, state.soloFloor, state.selectedId]; }, function () {
        if (store.runtime.scene) store.runtime.scene.setFloorFocus(state.currentFloor, state.soloFloor);
      });

      function toggleFullscreen() {
        var el = container.value && container.value.parentElement;
        if (!el) return;
        if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
        else document.exitFullscreen && document.exitFullscreen();
      }
      function locateOnPlan() {
        var was3d = state.viewMode !== '2d';
        store.startLocatePick();
        toast(was3d ? '已切换到二维平面图，请点击你的位置完成定位' : '请在地图上点击你的位置完成定位');
      }
      /* Esc 退出拾取模式 */
      function onKeydown(e) {
        if (e.key === 'Escape' && state.locateMode) store.cancelLocatePick();
      }
      if (global.addEventListener) global.addEventListener('keydown', onKeydown);
      Vue.onUnmounted(function () { if (global.removeEventListener) global.removeEventListener('keydown', onKeydown); });
      /* 只看当前楼层：切换时的轻提示（常驻说明已移除，避免工具栏冗余） */
      function soloLabel() {
        var f = store.floorsOf(state.currentFloor);
        return '仅显示 ' + (f ? f.label : state.currentFloor + 'F');
      }
      function toggleSolo() {
        state.soloFloor = !state.soloFloor;
        toast(state.soloFloor ? soloLabel() + '，取消勾选可恢复全部楼层' : '已恢复显示全部楼层');
      }
      var exploded = Vue.ref(true);
      function toggleExplode() {
        if (!store.runtime.scene) return;
        var k = store.runtime.scene.toggleExplode();
        exploded.value = k > 1.05;
        toast(exploded.value ? '已展开楼层：各层结构独立可见' : '已合并楼层：恢复真实层间距');
      }
      return {
        store: store, state: state, container: container, tooltip: tooltip, fps: fps,
        layerOpen: layerOpen, toggleFullscreen: toggleFullscreen, locateOnPlan: locateOnPlan,
        labelMode: labelMode, labelModeLabel: labelModeLabel, cycleLabelMode: cycleLabelMode,
        legendOpen: legendOpen, toggleLegend: toggleLegend, toggleLayers: toggleLayers,
        exploded: exploded, toggleExplode: toggleExplode, soloLabel: soloLabel, toggleSolo: toggleSolo, toast: toast
      };
    },
    template: `
    <section class="stage">
      <div class="stage-toolbar">
        <div class="seg-group">
          <button class="seg" :class="{active: state.viewMode==='3d'}" @click="state.viewMode='3d'">三维视图</button>
          <button class="seg" :class="{active: state.viewMode==='iso'}" @click="state.viewMode='iso'">等距三维</button>
          <button class="seg" :class="{active: state.viewMode==='2d'}" @click="state.viewMode='2d'">二维平面图</button>
        </div>
        <span class="vrule"></span>
        <label class="switch"><input type="checkbox" :checked="state.soloFloor" @change="toggleSolo" /><span>只看当前楼层</span></label>
        <div class="spacer"></div>
        <template v-if="state.viewMode==='3d'">
          <button class="mini-btn" @click="store.runtime.scene && store.runtime.scene.resetCamera()">复位视角</button>
          <button class="mini-btn" @click="store.runtime.scene && store.runtime.scene.setTopView()">俯视图</button>
          <button class="mini-btn" :class="{on: exploded}" @click="toggleExplode">楼层{{ exploded ? '合并' : '展开' }}</button>
          <button class="mini-btn" @click="store.runtime.scene && store.runtime.scene.setAutoRotate(!store.runtime.scene.isAutoRotate())">自动旋转</button>
          <button class="mini-btn" :title="'点击切换：自动避让 / 全部显示 / 仅选中 / 关闭'" @click="cycleLabelMode">{{ labelModeLabel() }}</button>
        </template>
        <button class="mini-btn" @click="toggleFullscreen">全屏</button>
        <button class="mini-btn primary" :class="{on: state.locateMode}" @click="locateOnPlan">图上选点</button>
      </div>


      <div class="stage-body">
        <div class="viewport" v-show="state.viewMode==='3d'">
          <div class="canvas-wrap" ref="container"></div>
          <div v-if="state.webglError" class="webgl-error">
            <p>WebGL 三维渲染不可用（{{ state.webglError }}）。已按规范 FR-03-03 降级为不依赖 WebGL 的等距三维视图，点击店铺、楼层聚焦与路径显示均不受影响。</p>
            <button class="btn btn-primary btn-sm" @click="state.viewMode='iso'">切换到等距三维视图</button>
          </div>
          <div class="fps-tag">{{ fps }} FPS</div>
          <div class="view-hint">左键拖拽旋转 · 滚轮缩放 · 右键拖拽平移 · 点击店铺查看详情</div>
        </div>
        <div class="viewport" v-show="state.viewMode==='iso'">
          <iso3-d :store="store"></iso3-d>
        </div>
        <div class="viewport" v-show="state.viewMode==='2d'">
          <plan2-d :store="store"></plan2-d>
        </div>

        <!-- 图例（点击标题可折叠，状态本地记忆） -->
        <div class="legend" :class="{collapsed: !legendOpen}">
          <div class="legend-title" @click="toggleLegend" :title="legendOpen ? '点击收起图例' : '点击展开图例'">
            <span>图例</span><span class="lg-chev">{{ legendOpen ? '▾' : '▸' }}</span>
          </div>
          <template v-if="legendOpen">
            <div class="legend-row"><i class="lg" style="background:#52C41A"></i>营业中</div>
            <div class="legend-row"><i class="lg" style="background:#FAAD14"></i>即将打烊</div>
            <div class="legend-row"><i class="lg" style="background:#BFBFBF"></i>已打烊 / 休息</div>
            <div class="legend-row"><i class="lg line" style="background:#1890FF"></i>导航路径</div>
            <div class="legend-row"><i class="lg round" style="background:#FF4D4F"></i>当前位置</div>
            <div class="legend-row"><i class="lg" style="background:#F2A33C"></i>客梯 / 扶梯</div>
            <div class="legend-row"><i class="lg round" style="background:#7A8DFF"></i>卫生间 / 母婴室</div>
            <div class="legend-row"><i class="lg round" style="background:#4CAF7D"></i>出入口</div>
            <div class="legend-row"><i class="lg round" style="background:linear-gradient(90deg,#3FA7FF,#FFB020,#36C2A6,#7C6CFF)"></i>便民设施（水/充/休/ATM）</div>
          </template>
        </div>

        <!-- 图层面板（点击标题可折叠，状态本地记忆） -->
        <div class="layer-panel" v-if="state.viewMode==='2d'" :class="{collapsed: !layerOpen}">
          <div class="legend-title" @click="toggleLayers" :title="layerOpen ? '点击收起图层' : '点击展开图层'">
            <span>图层</span><span class="lg-chev">{{ layerOpen ? '▾' : '▸' }}</span>
          </div>
          <template v-if="layerOpen">
            <label v-for="(v,k) in {base:'底图',plan:'平面图',shop:'店铺',user:'用户位置',transport:'电梯扶梯',facility:'公共设施',route:'路径线',label:'标注层'}" :key="k" class="sw">
              <input type="checkbox" v-model="state.layers[k]" /> {{ v }}
            </label>
          </template>
        </div>
      </div>

      <div class="hover-tip" v-if="tooltip.show" :style="{left: tooltip.x+14+'px', top: tooltip.y+14+'px'}">
        <strong>{{ tooltip.title }}</strong>
        <span>{{ tooltip.sub }}</span>
      </div>
    </section>`
  };

  U.MainStage = MainStage;
})(window);
