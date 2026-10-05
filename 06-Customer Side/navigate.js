/* =========================================================
 * 顾客端 · 定位弹窗
 * 鼠标在图上选点、精确坐标录入、扫码定位、快捷定位
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  var LocateModal = {
    name: 'LocateModal',
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      var floors = store.data.floors;
      var mFloor = Vue.ref(state.currentFloor);
      var mX = Vue.ref(24);
      var mZ = Vue.ref(2);
      /* 鼠标选点：关闭弹窗 + 切到二维平面图并进入拾取模式 */
      function pickOnMap() {
        mFloor.value = state.currentFloor;
        store.startLocatePick();
        toast('已进入定位模式：在地图上点击你的位置');
      }
      /* 精确录入坐标（手动选点的文字版） */
      function applyManual() {
        var L = store.data.layout;
        var x = Math.max(0, Math.min(L.width, Number(mX.value) || 0));
        var z = Math.max(0, Math.min(L.depth, Number(mZ.value) || 0));
        store.locateAt(Number(mFloor.value), Math.round(x * 10) / 10, Math.round(z * 10) / 10, 'manual');
        toast('已定位到 ' + store.floorsOf(Number(mFloor.value)).label + '（' + x.toFixed(1) + ', ' + z.toFixed(1) + '）米', 'success');
      }
      function qrScan() {
        // 演示：扫码定位（实际部署时扫描楼层二维码触发）
        var f = floors[Math.floor(Math.random() * floors.length)];
        var nodeCodes = store.data.nodes.filter(function (n) { return n.type === 'cross' && n.floorNo === f.no; });
        var n = nodeCodes[Math.floor(Math.random() * nodeCodes.length)];
        store.locateAt(f.no, n.x, n.z, 'qrcode');
        toast('扫码成功：已定位至 ' + f.name + '（精度 ±1 米）', 'success');
      }
      function useDefault() {
        store.locateAt(1, 24, 2, 'manual');
        toast('已定位至 1F 南主入口附近（手动选点，精度 ±5-10 米）');
      }
      function clear() {
        state.userPos = null;
        if (store.runtime.scene) store.runtime.scene.setUserPosition(null);
        store.clearRoute();
        toast('已清除定位信息');
      }
      return {
        store: store, state: state, floors: floors, qrScan: qrScan, useDefault: useDefault, clear: clear,
        pickOnMap: pickOnMap, applyManual: applyManual, mFloor: mFloor, mX: mX, mZ: mZ
      };
    },
    template: `
    <div class="modal-mask" v-if="state.locateOpen" @click.self="state.locateOpen=false">
      <div class="modal narrow">
        <div class="modal-head"><h4>定位当前位置</h4><button class="x" @click="state.locateOpen=false">×</button></div>
        <div class="modal-body">
          <div class="locate-opts">
            <button class="locate-opt primary" @click="pickOnMap">
              <strong>🖱 鼠标选点</strong>
              <p>在地图上直接点击你的实际位置，点哪定哪（推荐）</p>
            </button>
            <button class="locate-opt" @click="qrScan">
              <strong>📷 扫码定位</strong>
              <p>扫描楼层专属二维码触发定位，精度 ±1 米</p>
            </button>
          </div>
          <div class="locate-coord">
            <label class="mini-label first">精确录入</label>
            <select v-model="mFloor" class="mini-select">
              <option v-for="f in floors" :key="f.no" :value="f.no">{{ f.label }}</option>
            </select>
            <label class="mini-label">X</label><input class="mini-input" type="number" step="0.5" v-model="mX" />
            <label class="mini-label">Z</label><input class="mini-input" type="number" step="0.5" v-model="mZ" />
            <button class="mini-btn" @click="applyManual">按坐标定位</button>
            <button class="mini-btn" @click="useDefault">快捷：南主入口</button>
          </div>
          <p class="hint block">「鼠标选点」会自动切到二维平面图并进入定位模式：在地图上点击即可完成定位，期间可用顶部楼层按钮切换楼层，按 <b>Esc</b> 或点提示条上的「取消」退出。</p>
          <div class="locate-note">
            <b>真实部署升级路径：</b>蓝牙信标（±1-3 米，基于 RSSI 三点定位）或 WiFi 指纹（±2-5 米，预先采集指纹库）；毕业设计阶段采用「手动选点 + 扫码定位」组合方案，成本更低且演示稳定。
          </div>
          <div class="form-actions">
            <button class="btn btn-ghost btn-sm" @click="clear">清除定位</button>
          </div>
        </div>
      </div>
    </div>`
  };

  U.LocateModal = LocateModal;
})(window);
