/* =========================================================
 * 运营数据看板图表（ECharts）
 * 主色 #1F4E79 / 状态色 #52C41A #FAAD14 / 路径色 #1890FF
 * ========================================================= */
(function (global) {
  'use strict';

  var BRAND = '#1F4E79';
  var PALETTE = ['#1F4E79', '#3D7FB6', '#1890FF', '#52C41A', '#FAAD14', '#2EA8A0', '#9B5DE5', '#FF7A45', '#7A8DFF'];

  function base() {
    return {
      grid: { left: 54, right: 22, top: 36, bottom: 36 },
      textStyle: { fontFamily: 'Inter, "Microsoft YaHei", sans-serif' },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: '#D9E2EC', borderWidth: 1,
        textStyle: { color: '#23324D', fontSize: 12.5 },
        extraCssText: 'box-shadow:0 6px 20px rgba(31,78,121,0.16);border-radius:8px;'
      },
      color: PALETTE
    };
  }

  function ensure(el, key) {
    if (!el) return null;
    if (!el.__chart) el.__chart = global.echarts.init(el);
    return el.__chart;
  }

  /* 分时客流趋势 */
  function trafficFlow(el, history, livePoint) {
    var ch = ensure(el);
    if (!ch) return;
    var xs = history.map(function (h) { return h.label; });
    var total = history.map(function (h) { return h.total; });
    var queue = history.map(function (h) { return h.queue; });
    if (livePoint) { xs.push(livePoint.label); total.push(livePoint.total); queue.push(livePoint.queue); }
    ch.setOption(Object.assign(base(), {
      legend: { right: 8, top: 4, itemWidth: 11, itemHeight: 11, textStyle: { fontSize: 12, color: '#5A6B85' } },
      xAxis: {
        type: 'category', boundaryGap: false, data: xs,
        axisLine: { lineStyle: { color: '#D9E2EC' } },
        axisLabel: { color: '#7A8CA6', fontSize: 11.5, interval: Math.max(1, Math.floor(xs.length / 8)) },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value', name: '人数', nameTextStyle: { color: '#9AA9BE', fontSize: 11.5 },
        splitLine: { lineStyle: { color: '#EEF2F7' } },
        axisLabel: { color: '#7A8CA6', fontSize: 11.5 }
      },
      series: [
        {
          name: '在场人数', type: 'line', smooth: true, symbol: 'none', data: total,
          areaStyle: {
            color: new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(24,144,255,0.28)' },
              { offset: 1, color: 'rgba(24,144,255,0.02)' }
            ])
          },
          lineStyle: { width: 2.4, color: '#1890FF' }
        },
        {
          name: '排队人数', type: 'line', smooth: true, symbol: 'none', data: queue,
          lineStyle: { width: 2, color: '#FAAD14' }
        }
      ]
    }), true);
  }

  /* 楼层客流分布 */
  function floorBar(el, byFloor, floors) {
    var ch = ensure(el);
    if (!ch) return;
    var data = floors.map(function (f) { return { name: f.label, value: byFloor[f.no] || 0 }; });
    ch.setOption(Object.assign(base(), {
      grid: { left: 52, right: 18, top: 22, bottom: 28 },
      xAxis: { type: 'category', data: data.map(function (d) { return d.name; }), axisTick: { show: false }, axisLine: { lineStyle: { color: '#D9E2EC' } }, axisLabel: { color: '#7A8CA6', fontSize: 12 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#EEF2F7' } }, axisLabel: { color: '#7A8CA6', fontSize: 10 } },
      series: [{
        type: 'bar', barWidth: '46%', data: data.map(function (d) { return d.value; }),
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#3D7FB6' }, { offset: 1, color: '#1F4E79' }
          ])
        },
        label: { show: true, position: 'top', color: '#5A6B85', fontSize: 11.5 }
      }]
    }), true);
  }

  /* 业态客流占比 */
  function categoryPie(el, byCategory) {
    var ch = ensure(el);
    if (!ch) return;
    var data = Object.keys(byCategory).map(function (k) { return { name: k, value: byCategory[k] }; });
    data.sort(function (a, b) { return b.value - a.value; });
    ch.setOption(Object.assign(base(), {
      tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' },
      legend: { type: 'scroll', orient: 'vertical', right: 6, top: 18, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: '#5A6B85' } },
      series: [{
        type: 'pie', radius: ['42%', '72%'], center: ['38%', '52%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
        label: { show: false },
        data: data
      }]
    }), true);
  }

  /* 热门店铺 TOP 榜 */
  function topBar(el, hottest) {
    var ch = ensure(el);
    if (!ch) return;
    var data = hottest.slice().reverse();
    ch.setOption(Object.assign(base(), {
      grid: { left: 112, right: 46, top: 16, bottom: 18 },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#EEF2F7' } }, axisLabel: { color: '#7A8CA6', fontSize: 11.5 } },
      yAxis: {
        type: 'category', data: data.map(function (d) { return d.merchant.name; }),
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: '#43526B', fontSize: 12 }
      },
      series: [{
        type: 'bar', barWidth: 14, data: data.map(function (d) { return d.current; }),
        itemStyle: { borderRadius: [0, 7, 7, 0], color: '#1890FF' },
        label: { show: true, position: 'right', formatter: '{c} 人', fontSize: 11.5, color: '#7A8CA6' }
      }]
    }), true);
  }

  function resize(el) {
    if (el && el.__chart) el.__chart.resize();
  }
  function dispose(el) {
    if (el && el.__chart) { el.__chart.dispose(); el.__chart = null; }
  }

  global.MallCharts = { trafficFlow: trafficFlow, floorBar: floorBar, categoryPie: categoryPie, topBar: topBar, resize: resize, dispose: dispose, BRAND: BRAND, PALETTE: PALETTE };
})(window);
