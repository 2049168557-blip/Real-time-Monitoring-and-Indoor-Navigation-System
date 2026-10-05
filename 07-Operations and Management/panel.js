/* =========================================================
 * 运营端 · 数据看板视图
 * 4 张 ECharts 图表（客流趋势/楼层对比/业态占比/热门榜）+ KPI 卡 + CSV 导出
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch;

  /* ================= 运营数据看板 ================= */
  var DashboardView = {
    name: 'DashboardView',
    props: ['store'],
    setup(props) {
      var store = props.store;
      var state = store.state;
      var refresh = Vue.ref(0);
      var timer = null;
      Vue.onMounted(function () {
        timer = setInterval(function () { refresh.value++; }, 3000);
        Vue.nextTick(renderAll);
      });
      Vue.onUnmounted(function () { clearInterval(timer); });

      var rangeOption = Vue.ref('最近 ' + 30 + ' 次采样');
      var ranges = [{ label: '最近 10 次采样', n: 10 }, { label: '最近 30 次采样', n: 30 }, { label: '全部采样', n: 999 }];
      var floorFilter = Vue.ref('全部');
      var catFilter = Vue.ref('全部');
      var sortKey = Vue.ref('current');
      var toast = Vue.ref('');

      function sampleOf() {
        var hs = store.sim.history;
        if (!hs.length) return [];
        var opt = ranges.filter(function (r) { return r.label === rangeOption.value; })[0] || ranges[1];
        return hs.slice(-opt.n);
      }

      var summary = computed(function () { refresh.value; return store.summary(); });

      var flowRows = computed(function () {
        refresh.value;
        var s = sampleOf();
        var latest = s.length ? s[s.length - 1] : null;
        return latest ? { label: store.sim.fmtClock(state.clockMinutes), total: latest.total, queue: latest.queue } : null;
      });

      var tableRows = computed(function () {
        refresh.value;
        var rows = store.data.merchants.map(function (m) {
          var rt = store.realtimeOf(m);
          return {
            id: m.id, name: m.name, floor: store.floorsOf(m.floorNo).label, floorNo: m.floorNo,
            area: m.areaCode, category: m.category, status: store.judgeStatus(m),
            current: rt.currentCount, queue: rt.queueCount, wait: rt.waitMinutes, cap: rt.capacity,
            avg: m.avgPrice, source: rt.dataSource, full: rt.full
          };
        });
        if (floorFilter.value !== '全部') rows = rows.filter(function (r) { return String(r.floorNo) === String(floorFilter.value); });
        if (catFilter.value !== '全部') rows = rows.filter(function (r) { return r.category === catFilter.value; });
        var key = sortKey.value;
        rows.sort(function (a, b) { return b[key] - a[key]; });
        return rows.slice(0, 40);
      });

      function renderAll() {
        if (!global.echarts) return;
        var s = sampleOf();
        global.MallCharts.trafficFlow(document.getElementById('chart-flow'), s, flowRows.value);
        global.MallCharts.floorBar(document.getElementById('chart-floor'), summary.value.byFloor, store.data.floors);
        global.MallCharts.categoryPie(document.getElementById('chart-cat'), summary.value.byCategory);
        global.MallCharts.topBar(document.getElementById('chart-top'), summary.value.hottest);
      }

      watch([refresh, rangeOption, floorFilter, catFilter, sortKey], function () { Vue.nextTick(renderAll); });

      function doExport() {
        store.exportCsv();
        toast.value = '客流报表已导出（CSV，含全部 ' + store.data.merchants.length + ' 家商户）';
        setTimeout(function () { toast.value = ''; }, 2600);
      }
      function globalResize() {
        ['chart-flow', 'chart-floor', 'chart-cat', 'chart-top'].forEach(function (id) {
          global.MallCharts.resize(document.getElementById(id));
        });
      }
      Vue.onMounted(function () { global.addEventListener('resize', globalResize); });
      Vue.onUnmounted(function () { global.removeEventListener('resize', globalResize); });

      return {
        state: state, store: store, summary: summary, rows: tableRows, floorFilter: floorFilter,
        catFilter: catFilter, sortKey: sortKey, rangeOption: rangeOption, ranges: ranges,
        doExport: doExport, toast: toast, renderAll: renderAll, sampleOf: sampleOf,
        statusMeta: store.STATUS_META, sourceLabel: store.sourceLabel
      };
    },
    template: `
    <div class="dash">
      <div class="dash-kpis">
        <div class="kpi">
          <span class="kpi-label">全场在场人数</span>
          <strong class="kpi-value">{{ summary.total }}<i>人</i></strong>
          <span class="kpi-foot">含排队人员，每 {{ store.sim.params.intervalSec }} 秒刷新</span>
        </div>
        <div class="kpi kpi-warn">
          <span class="kpi-label">当前排队人数</span>
          <strong class="kpi-value">{{ summary.queue }}<i>人</i></strong>
          <span class="kpi-foot">平均等位 {{ summary.avgWait }} 分钟 · 最长 {{ summary.maxWait }} 分钟</span>
        </div>
        <div class="kpi kpi-danger">
          <span class="kpi-label">满员 / 拥挤店铺</span>
          <strong class="kpi-value">{{ summary.full }}<i>家</i></strong>
          <span class="kpi-foot">达容量 95% 触发红色高亮</span>
        </div>
        <div class="kpi kpi-ok">
          <span class="kpi-label">营业中店铺</span>
          <strong class="kpi-value">{{ summary.open }}<i>家</i></strong>
          <span class="kpi-foot">在营 {{ store.data.merchants.length }} 家商户中</span>
        </div>
      </div>

      <div class="dash-toolbar">
        <div class="seg-group">
          <button v-for="r in ranges" :key="r.label" class="seg" :class="{active: rangeOption===r.label}" @click="rangeOption=r.label">{{ r.label }}</button>
        </div>
        <div class="spacer"></div>
        <label class="mini-label">楼层</label>
        <select v-model="floorFilter" class="mini-select">
          <option>全部</option>
          <option v-for="f in store.data.floors" :key="f.no" :value="String(f.no)">{{ f.name }}</option>
        </select>
        <label class="mini-label">业态</label>
        <select v-model="catFilter" class="mini-select">
          <option>全部</option>
          <option v-for="c in store.data.categories" :key="c">{{ c }}</option>
        </select>
        <label class="mini-label">排序</label>
        <select v-model="sortKey" class="mini-select">
          <option value="current">按在场人数</option>
          <option value="queue">按排队人数</option>
          <option value="wait">按等位时长</option>
          <option value="avg">按人均消费</option>
        </select>
        <button class="btn btn-primary btn-sm" @click="doExport"><span class="ico">⬇</span> 导出客流报表</button>
      </div>

      <div class="dash-grid">
        <div class="card chart-card span2">
          <div class="card-head"><h4>分时客流趋势</h4><span class="tag tag-sim">{{ store.sourceLabel(state.dataSource) }}</span></div>
          <div id="chart-flow" class="chart chart-lg"></div>
          <p class="chart-note">横轴为仿真时间刻度，每 {{ store.sim.params.intervalSec }} 秒采样一次（演示倍速 ×{{ store.sim.params.timeScale }}）</p>
        </div>
        <div class="card chart-card">
          <div class="card-head"><h4>楼层客流分布</h4></div>
          <div id="chart-floor" class="chart"></div>
        </div>
        <div class="card chart-card">
          <div class="card-head"><h4>业态客流占比</h4></div>
          <div id="chart-cat" class="chart"></div>
        </div>
        <div class="card chart-card">
          <div class="card-head"><h4>热门店铺 TOP6</h4></div>
          <div id="chart-top" class="chart"></div>
        </div>
      </div>

      <div class="card table-card">
        <div class="card-head"><h4>店铺实时排行</h4><span class="hint">按 {{ sortKey==='current'?'在场人数':sortKey==='queue'?'排队人数':sortKey==='wait'?'等位时长':'人均消费' }} 降序，展示前 40 家</span></div>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr><th>#</th><th>商户</th><th>楼层</th><th>业态</th><th>状态</th><th>在场</th><th>排队</th><th>等位(分)</th><th>人均</th><th>数据来源</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r,i) in rows" :key="r.id" :class="{rowfull:r.full}">
                <td class="idx">{{ i+1 }}</td>
                <td class="strong">{{ r.name }}</td>
                <td>{{ r.floor }}</td>
                <td>{{ r.category }}</td>
                <td><span class="dot" :style="{background:statusMeta[r.status].color}"></span>{{ statusMeta[r.status].text }}</td>
                <td :class="{hot:r.current>=r.cap*0.8}">{{ r.current }} / {{ r.cap }}</td>
                <td>{{ r.queue }}</td>
                <td>{{ r.wait }}</td>
                <td>¥{{ r.avg }}</td>
                <td><span class="tag tag-sim">{{ sourceLabel(r.source) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="toast" class="toast-float">{{ toast }}</div>
    </div>`
  };

  global.MallViews = global.MallViews || {};
  global.MallViews.DashboardView = DashboardView;
})(window);
