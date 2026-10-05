/* =========================================================
 * 全局状态中枢：营业状态判定 / 筛选 / 导航调度 / 实时数据订阅
 * （对应系统设计中由 Pinia 承担的“三维与二维视图共享选中状态”职责）
 * ========================================================= */
(function (global) {
  'use strict';

  var RUNTIME = { scene: null, plan2d: null };   // 非响应式：避免 Vue 代理 Three.js 对象
  var LS_KEY = 'mall-navigator-overrides-v1';

  function loadOverrides() {
    try {
      var raw = global.localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function create(data, sim, router) {
    var Vue = global.Vue;
    var overrides = loadOverrides() || {};

    // 应用持久化覆盖
    (overrides.merchants || []).forEach(function (om) {
      data.merchants.forEach(function (m) {
        if (m.id === om.id) Object.keys(om).forEach(function (k) { m[k] = om[k]; });
      });
    });
    if (overrides.params) Object.keys(overrides.params).forEach(function (k) { sim.params[k] = overrides.params[k]; });

    var state = Vue.reactive({
      /* 视图切换 */
      tab: 'guide',                 // guide | dashboard | admin
      viewMode: '3d',               // 3d | 2d
      soloFloor: false,             // 是否只看当前楼层
      currentFloor: 1,

      /* 筛选 */
      keyword: '',
      categoryFilter: '全部',
      floorFilter: '全部',
      statusFilter: '全部',
      sortBy: 'default',            // default | heat | price | wait

      /* 选中与悬停 */
      selectedId: null,
      selectedKind: 'merchant',     // merchant | facility
      hoverId: null,

      /* 图层 */
      layers: { base: true, shop: true, user: true, transport: true, facility: true, route: true, label: true, plan: true },

      /* 楼层平面图（管理端上传，论文 3.2.4 / 需求 FR-03-02）
       * { [floorNo]: { dataUrl, name, opacity, w, h, uploadedAt } } */
      floorPlans: {},
      /* 绘制区域版本号：data.merchants 不是响应式对象，
       * 管理端保存/清除区域后自增此值，触发顾客端视图重算 */
      regionRev: 0,

      /* 定位 */
      userPos: null,                // {floorNo,x,z,accuracy,type}
      locateOpen: false,           // 定位弹窗是否打开
      locateMode: false,           // 地图拾取模式：在二维平面图上点击确定位置

      /* 路径记录（论文 3.3.3 表 3.24 path_history） */
      pathHistory: [],

      /* 移动轨迹（规范 FR-05-02 轨迹回放，标记为可选功能） */
      trail: [],                    // [{floorNo, x, z, minutes}]
      trailRecording: true,
      replay: { playing: false, paused: false, t: 0 },

      /* 导航 */
      route: null,
      routeTargetId: null,
      routeTargetKind: 'merchant',
      nav: { playing: false, paused: false, speed: 1, progress: 0, follow: false, arrived: false },
      routeError: '',
      routeTimeout: false,          // 路径计算是否超时（论文 4.2：超 1 秒提示失败并允许重试）
      routeCostMs: 0,               // 最近一次路径计算耗时（毫秒）

      /* 实时 */
      realtime: {},
      netStatus: 'connecting',
      lastUpdate: Date.now(),
      offlineDemo: false,
      staleCount: 0,                    // 数据异常（超过 5 分钟未更新）的商户数

      /* 演示时钟 */
      clockMinutes: sim.params.clockMinutes,
      clockAuto: true,
      dateLabel: todayLabel(),

      /* 数据来源 */
      dataSource: sim.params.dataSource,
      showSourceModal: false
    });

    /* 应用持久化的楼层平面图与店铺区域（管理端上传/绘制后保存） */
    if (overrides.floorPlans) Object.keys(overrides.floorPlans).forEach(function (k) {
      state.floorPlans[k] = overrides.floorPlans[k];
    });
    if (overrides.regions) Object.keys(overrides.regions).forEach(function (mid) {
      data.merchants.forEach(function (m) { if (String(m.id) === String(mid)) m.region = overrides.regions[mid]; });
    });

    /* ---------- 产品索引 ---------- */
    var productMap = Vue.reactive({});
    data.products.forEach(function (p) {
      if (!productMap[p.merchantId]) productMap[p.merchantId] = [];
      productMap[p.merchantId].push(p);
    });

    /* ---------- 营业状态判定 ---------- */
    function toMin(hhmm) {
      var p = String(hhmm || '').split(':');
      return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
    }
    function todayLabel() {
      var d = new Date();
      var wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' 周' + wk;
    }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    /* 今日 MM-DD */
    function todayMD() {
      var d = new Date();
      return (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }

    /* 营业状态判定（论文 3.2.1 表 3.1 + 表 3.2）
     * 优先级：特殊日期 special_dates > 周末时段 weekend > 每周休息日 rest_days > 常规时段 */
    function judgeStatus(m) {
      if (!m.openTime || !m.closeTime) return 'unknown';
      var now = state.clockMinutes;
      var special = null;
      if (m.specialDates && m.specialDates.length) {
        var md = todayMD();
        m.specialDates.forEach(function (s) { if (s.date === md) special = s; });
      }
      var day = new Date().getDay();              // 0 = 周日
      var isWeekend = day === 0 || day === 6;
      var useWeekend = isWeekend && m.weekend && m.weekend.open;
      var o, c;
      if (special) { o = toMin(special.open || m.openTime); c = toMin(special.close || m.closeTime); }
      else if (useWeekend) { o = toMin(m.weekend.open); c = toMin(m.weekend.close || m.closeTime); }
      else { o = toMin(m.openTime); c = toMin(m.closeTime); }
      if (!special && !useWeekend && m.restDays && m.restDays.length && m.restDays.indexOf(day) >= 0) return 'rest';
      var openNow = c > o ? (now >= o && now < c) : (now >= o || now < c);
      if (!openNow) return 'closed';
      var toClose = c > now ? (c - now) : (1440 - now + c);
      return toClose <= 30 ? 'closing' : 'open';
    }

    /* 当前生效的营业时段（含特殊日期与周末），供详情卡展示 */
    function activeHours(m) {
      var md = todayMD(), day = new Date().getDay(), special = null;
      if (m.specialDates && m.specialDates.length) {
        m.specialDates.forEach(function (s) { if (s.date === md) special = s; });
      }
      if (special) return { open: special.open || m.openTime, close: special.close || m.closeTime, tag: special.note || '特殊日期' };
      if ((day === 0 || day === 6) && m.weekend && m.weekend.open) {
        return { open: m.weekend.open, close: m.weekend.close || m.closeTime, tag: '周末时段' };
      }
      return { open: m.openTime, close: m.closeTime, tag: '' };
    }

    var STATUS_META = {
      open: { text: '营业中', cls: 'st-open', color: '#52C41A' },
      closing: { text: '即将打烊', cls: 'st-closing', color: '#FAAD14' },
      closed: { text: '已打烊', cls: 'st-closed', color: '#BFBFBF' },
      rest: { text: '休息中', cls: 'st-closed', color: '#BFBFBF' },
      unknown: { text: '状态未知', cls: 'st-unknown', color: '#8C8C8C' }
    };

    /* ---------- 派生数据 ---------- */
    function statusMap3D() {
      var out = {};
      data.merchants.forEach(function (m) {
        var s = judgeStatus(m);
        out[m.id] = s === 'rest' || s === 'unknown' ? 'closed' : s;
      });
      return out;
    }

    function allMerchants() { return data.merchants; }

    function filteredMerchants() {
      var kw = state.keyword.trim().toLowerCase();
      var list = data.merchants.filter(function (m) {
        if (state.floorFilter !== '全部' && String(m.floorNo) !== String(state.floorFilter)) return false;
        if (state.categoryFilter !== '全部' && m.category !== state.categoryFilter) return false;
        if (state.statusFilter !== '全部') {
          var st = judgeStatus(m);
          var grp = st === 'rest' || st === 'unknown' ? 'closed' : st;
          if (grp !== state.statusFilter) return false;
        }
        if (kw) {
          var hit = m.name.toLowerCase().indexOf(kw) >= 0 || m.category.indexOf(kw) >= 0 ||
            (m.areaCode || '').indexOf(kw) >= 0;
          if (!hit) {
            var ps = productMap[m.id] || [];
            for (var i = 0; i < ps.length; i++) {
              if (ps[i].productName.toLowerCase().indexOf(kw) >= 0) { hit = true; break; }
            }
          }
          if (!hit) return false;
        }
        return true;
      });
      if (state.sortBy === 'heat') {
        list.sort(function (a, b) {
          var sa = realtimeOf(b), sb = realtimeOf(a);
          return (sb.currentCount + sb.queueCount) - (sa.currentCount + sa.queueCount);
        });
      } else if (state.sortBy === 'price') {
        list.sort(function (a, b) { return b.avgPrice - a.avgPrice; });
      } else if (state.sortBy === 'wait') {
        list.sort(function (a, b) { return realtimeOf(b).queueCount - realtimeOf(a).queueCount; });
      } else {
        // 默认排序：当前楼层优先，同层按在场人数（含排队）降序
        list.sort(function (a, b) {
          var fa = a.floorNo === state.currentFloor ? 0 : 1;
          var fb = b.floorNo === state.currentFloor ? 0 : 1;
          if (fa !== fb) return fa - fb;
          var ra = realtimeOf(a), rb = realtimeOf(b);
          return (rb.currentCount + rb.queueCount) - (ra.currentCount + ra.queueCount);
        });
      }
      return list;
    }

    function realtimeOf(m) {
      return state.realtime[m.id] || { currentCount: 0, queueCount: 0, waitMinutes: 0, capacity: m.capacity, full: false, dataSource: state.dataSource, lastUpdate: 0 };
    }

    function selectedMerchant() {
      if (state.selectedKind !== 'merchant' || !state.selectedId) return null;
      var r = null;
      data.merchants.forEach(function (m) { if (m.id === state.selectedId) r = m; });
      return r;
    }
    function selectedFacility() {
      if (state.selectedKind !== 'facility' || !state.selectedId) return null;
      var r = null;
      data.facilities.forEach(function (f) { if (f.id === state.selectedId) r = f; });
      return r;
    }
    function productsOf(id) {
      return productMap[id] || [];
    }
    function floorsOf(no) {
      var r = null;
      data.floors.forEach(function (f) { if (f.no === no) r = f; });
      return r;
    }
    /* 图上用的设施简称：默认展示短标签，避免长名称互相压盖（完整名称仍在详情卡/管理端） */
    function facilityShort(f) {
      if (!f) return '';
      var n = f.name || '';
      if (f.type === 'wc') return { male: '男卫', female: '女卫', baby: '母婴室', accessible: '无障碍' }[f.subtype] || '卫生间';
      if (f.type === 'amenity') return { water: '直饮水', charging: '充电桩', rest: '休息区', atm: 'ATM' }[f.subtype] || n.slice(0, 4);
      n = n.replace(/（[^）]*）/g, '').replace(/\s+/g, '');
      n = n.replace('自动扶梯', '扶梯').replace('无障碍卫生间', '无障碍');
      if (n.indexOf('服务台') >= 0) return '服务台';
      return n;
    }
    function facilityIcon(f) {
      if (f.type === 'wc') {
        return { male: '🚹', female: '🚺', baby: '🍼', accessible: '♿' }[f.subtype] || '🚻';
      }
      if (f.type === 'amenity') {
        return { water: '💧', charging: '🔌', rest: '🛋️', atm: '🏧' }[f.subtype] || '📍';
      }
      return { elevator: '🛗', escalator: '🛗', service: '💁', entrance: '🚪' }[f.type] || '📍';
    }

    /* ---------- 就近设施检索（规范 4.5.3 公共设施标注需求） ---------- */
    /* 就近设施的基准：优先“当前选中商户”（面板正在看这家店），否则用当前定位 */
    function facilityBase() {
      var m = selectedMerchant();
      if (m) return { x: m.x, z: m.z, floorNo: m.floorNo, from: 'merchant' };
      if (state.userPos) return { x: state.userPos.x, z: state.userPos.z, floorNo: state.userPos.floorNo, from: 'user' };
      return null;
    }
    /* 以当前位置（或选中商户）为基准，按类型返回最近公共设施；跨楼层按每层折算 12 米代价 */
    function nearestFacility(type, subtype) {
      var base = facilityBase();
      if (!base) return null;
      var best = null, bd = Infinity;
      data.facilities.forEach(function (f) {
        if (f.type !== type) return;
        if (subtype && f.subtype !== subtype) return;
        var d = Math.sqrt(Math.pow(f.x - base.x, 2) + Math.pow(f.z - base.z, 2)) + Math.abs(f.floorNo - base.floorNo) * 12;
        if (d < bd) { bd = d; best = f; }
      });
      if (!best) return null;
      return {
        facility: best,
        distance: Math.round(Math.sqrt(Math.pow(best.x - base.x, 2) + Math.pow(best.z - base.z, 2)) * 10) / 10,
        cross: best.floorNo !== base.floorNo
      };
    }
    function facilityShortcuts() {
      var defs = [
        { type: 'wc', label: '卫生间', icon: '🚻' },
        { type: 'wc', subtype: 'baby', label: '母婴室', icon: '🍼' },
        { type: 'wc', subtype: 'accessible', label: '无障碍', icon: '♿' },
        { type: 'elevator', label: '客梯', icon: '⇅' },
        { type: 'escalator', label: '扶梯', icon: '⇱' },
        { type: 'service', label: '服务台', icon: '💁' },
        { type: 'entrance', label: '出入口', icon: '🚪' },
        { type: 'amenity', subtype: 'water', label: '直饮水', icon: '💧' },
        { type: 'amenity', subtype: 'rest', label: '休息区', icon: '🛋️' },
        { type: 'amenity', subtype: 'atm', label: 'ATM', icon: '🏧' },
        { type: 'amenity', subtype: 'charging', label: '充电桩', icon: '🔌' }
      ];
      var base = facilityBase();
      return defs.map(function (d) {
        return { label: d.label, icon: d.icon, hit: nearestFacility(d.type, d.subtype) };
      }).filter(function (x) { return !!x.hit; })
        .map(function (x) { x.base = base && base.from; return x; });
    }
    function navigateToFacility(f) {
      state.selectedKind = 'facility';
      state.selectedId = f.id;
      return navigateTo('facility', f.id);
    }

    /* ---------- 选中 / 视图联动 ---------- */
    function select(entity) {
      state.selectedId = entity.id;
      state.selectedKind = entity.kind;
      if (entity.kind === 'merchant') {
        var m = selectedMerchant();
        if (m) {
          state.currentFloor = m.floorNo;
          if (state.floorFilter !== '全部' && String(state.floorFilter) !== String(m.floorNo)) state.floorFilter = '全部';
        }
      } else {
        var f = selectedFacility();
        if (f) state.currentFloor = f.floorNo;
      }
      syncScene();
    }

    function clearSelection() {
      state.selectedId = null;
      syncScene();
    }

    function setFloor(no) { state.currentFloor = no; syncScene(); }

    function syncScene() {
      if (RUNTIME.scene) {
        RUNTIME.scene.setSelected(state.selectedKind === 'merchant' ? state.selectedId : null);
        RUNTIME.scene.setFloorFocus(state.currentFloor, state.soloFloor);
      }
    }

    /* ---------- 移动轨迹（FR-05-02 轨迹回放） ---------- */
    /* 按进度取路径上的当前坐标，供轨迹记录与二维标记使用 */
    function routePointAt(t) {
      if (!state.route) return null;
      var total = 0, segs = [];
      state.route.segments.forEach(function (s) {
        for (var i = 1; i < s.points.length; i++) {
          var a = s.points[i - 1], b = s.points[i];
          var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
          total += d;
          segs.push({ f: s.floorNo, a: a, b: b, d: d, acc: total });
        }
      });
      if (!segs.length) return null;
      var target = Math.max(0, Math.min(1, t)) * total;
      for (var i = 0; i < segs.length; i++) {
        if (target <= segs[i].acc) {
          var k = (target - (segs[i].acc - segs[i].d)) / (segs[i].d || 1);
          return { floorNo: segs[i].f, x: segs[i].a.x + (segs[i].b.x - segs[i].a.x) * k, z: segs[i].a.z + (segs[i].b.z - segs[i].a.z) * k };
        }
      }
      var last = segs[segs.length - 1];
      return { floorNo: last.f, x: last.b.x, z: last.b.z };
    }
    function recordTrail(p) {
      if (!p) return;
      var last = state.trail[state.trail.length - 1];
      if (last) {
        var near = last.floorNo === p.floorNo && Math.sqrt(Math.pow(last.x - p.x, 2) + Math.pow(last.z - p.z, 2)) < 1.2;
        if (near) return;                     // 位移过小不重复记录
      }
      state.trail.push({ floorNo: p.floorNo, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, minutes: state.clockMinutes });
      if (state.trail.length > 400) state.trail.shift();
      if (RUNTIME.scene) RUNTIME.scene.drawTrail(state.trail);
    }
    function clearTrail() {
      state.trail = [];
      if (RUNTIME.scene) RUNTIME.scene.clearTrail();
    }
    function toggleTrailRecord() {
      state.trailRecording = !state.trailRecording;
      return state.trailRecording;
    }
    /* 回放：沿已记录轨迹按比例取点 */
    function trailPointAt(t) {
      var n = state.trail.length;
      if (!n) return null;
      if (n === 1) return state.trail[0];
      var idx = Math.max(0, Math.min(1, t)) * (n - 1);
      var i0 = Math.floor(idx), i1 = Math.min(n - 1, i0 + 1), k = idx - i0;
      var a = state.trail[i0], b = state.trail[i1];
      return { floorNo: a.floorNo === b.floorNo ? a.floorNo : b.floorNo, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    function playReplay() {
      if (state.trail.length < 2) return false;
      state.replay = { playing: true, paused: false, t: state.replay.t >= 1 ? 0 : state.replay.t };
      return true;
    }
    function pauseReplay() { state.replay.paused = true; }
    function resumeReplay() { state.replay.paused = false; }
    function stopReplay() {
      state.replay = { playing: false, paused: false, t: 0 };
      if (RUNTIME.scene) RUNTIME.scene.setTrailMarker(null);
    }

    /* ---------- 定位 ---------- */
    function locateAt(floorNo, x, z, type) {
      var acc = type === 'qrcode' ? '±1 米' : '±5-10 米';
      state.userPos = { floorNo: floorNo, x: x, z: z, accuracy: acc, type: type || 'manual', nodeCode: nearestCode(floorNo, x, z) };
      state.currentFloor = floorNo;
      state.locateOpen = false;
      state.locateMode = false;
      if (RUNTIME.scene) RUNTIME.scene.setUserPosition(state.userPos);
      if (state.route) navigateTo(state.routeTargetKind, state.routeTargetId, true);
    }
    /* 进入地图拾取模式：关闭弹窗 + 切到二维平面图，等待用户点击 */
    function startLocatePick() {
      state.locateOpen = false;
      state.locateMode = true;
      state.viewMode = '2d';
    }
    function cancelLocatePick() { state.locateMode = false; }

    function nearestCode(floorNo, x, z) {
      var n = router.snap(floorNo, x, z);
      return n ? n.code : null;
    }

    /* ---------- 导航 ---------- */
    function navigateTo(kind, id, silent) {
      state.routeTargetKind = kind; state.routeTargetId = id;
      if (!state.userPos) {
        state.routeError = '请先完成定位（手动选点或扫码），再发起导航';
        state.locateOpen = true;
        state.route = null;
        return null;
      }
      if (kind === 'merchant') {
        var m = selectedMerchantById(id);
        if (m) state.currentFloor = m.floorNo;
      }
      var endCode = endCodeOf(kind, id);
      if (!endCode) {
        state.routeError = '该店铺暂不支持导航，请联系一层总服务台';
        state.route = null;
        return null;
      }
      var startCode = state.userPos.nodeCode || (router.snap(state.userPos.floorNo, state.userPos.x, state.userPos.z) || {}).code;
      if (!startCode) { state.routeError = '起点附近没有可用拓扑节点'; state.route = null; return null; }
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var res = router.astar(startCode, endCode);
      var costMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      state.routeCostMs = Math.round(costMs);
      // 论文 4.2：路径计算超过 1 秒即判定失败，提示并允许重试
      if (costMs > 1000) {
        state.routeError = '路径计算超时（' + Math.round(costMs) + ' ms，超过 1000 ms 上限），请重试';
        state.routeTimeout = true;
        state.route = null;
        if (RUNTIME.scene) RUNTIME.scene.clearRoute();
        return null;
      }
      state.routeTimeout = false;
      if (!res.ok) {
        state.routeError = res.reason;
        state.route = null;
        if (RUNTIME.scene) RUNTIME.scene.clearRoute();
        return null;
      }
      state.routeError = '';
      state.route = res;
      state.nav = { playing: false, paused: false, speed: state.nav.speed || 1, progress: 0, follow: state.nav.follow, arrived: false };
      // 轨迹起点：便于回放时看到完整的出行过程
      if (state.trailRecording) recordTrail({ floorNo: state.userPos.floorNo, x: state.userPos.x, z: state.userPos.z });
      // 写入路径记录（path_history）
      state.pathHistory.unshift({
        id: Date.now(),
        userTag: '匿名会话 demo-user',
        startNode: startCode, endNode: endCode,
        startLabel: floorsOf(state.userPos.floorNo).label + '（' + state.userPos.x + ', ' + state.userPos.z + '）',
        endLabel: targetLabel(kind, id),
        targetKind: kind, targetId: id,
        distance: res.distance, seconds: res.totalSeconds,
        verticalFloors: res.verticalFloors, nodes: res.path.length,
        createdAt: Date.now()
      });
      if (state.pathHistory.length > 30) state.pathHistory.pop();
      if (RUNTIME.scene) {
        RUNTIME.scene.drawRoute(res);
        RUNTIME.scene.setFloorFocus(null, false);   // 导航时展示全部楼层
      }
      return res;
    }
    function targetLabel(kind, id) {
      if (kind === 'merchant') {
        var m = selectedMerchantById(id);
        return m ? m.name : ('商户 #' + id);
      }
      var f = null;
      data.facilities.forEach(function (x) { if (x.id === id) f = x; });
      return f ? f.name : ('设施 #' + id);
    }
    /* 依据历史记录重新规划（path_history 回放） */
    function replayHistory(h) {
      return navigateTo(h.targetKind, h.targetId);
    }
    function clearHistory() { state.pathHistory = []; }

    function endCodeOf(kind, id) {
      if (kind === 'merchant') {
        var n = router.nodeOfMerchant(id);
        return n ? n.code : null;
      }
      var f = null;
      data.facilities.forEach(function (x) { if (x.id === id) f = x; });
      return f ? (data.nodeMap[f.nodeCode] ? f.nodeCode : null) : null;
    }
    function selectedMerchantById(id) {
      var r = null;
      data.merchants.forEach(function (m) { if (m.id === id) r = m; });
      return r;
    }
    function clearRoute() {
      state.route = null;
      state.routeTimeout = false;
      state.nav = { playing: false, paused: false, speed: 1, progress: 0, follow: false, arrived: false };
      if (RUNTIME.scene) RUNTIME.scene.clearRoute();
    }
    /* 路径计算超时后的重试（论文 4.2） */
    function retryRoute() {
      state.routeTimeout = false;
      if (state.routeTargetKind && state.routeTargetId != null) {
        return navigateTo(state.routeTargetKind, state.routeTargetId);
      }
      return null;
    }
    function playRoute() {
      if (!state.route || !RUNTIME.scene) return;
      state.nav.playing = true; state.nav.paused = false; state.nav.arrived = false;
      RUNTIME.scene.setFollow(state.nav.follow);
      RUNTIME.scene.play(state.nav.speed);
    }
    function pauseRoute() {
      state.nav.paused = true;
      if (RUNTIME.scene) RUNTIME.scene.pause();
    }
    function resumeRoute() {
      state.nav.paused = false;
      if (RUNTIME.scene) RUNTIME.scene.resume();
    }
    function setSpeed(v) {
      state.nav.speed = v;
      if (RUNTIME.scene) RUNTIME.scene.play(v);
    }
    function toggleFollow() {
      state.nav.follow = !state.nav.follow;
      if (RUNTIME.scene) RUNTIME.scene.setFollow(state.nav.follow);
    }
    function onArrive() {
      state.nav.playing = false; state.nav.arrived = true; state.nav.progress = 1;
      // 轨迹终点
      if (state.trailRecording) recordTrail(routePointAt(1));
    }

    /* ---------- 实时数据订阅 ---------- */
    sim.on(function (msg) {
      if (msg.type === 'connect') state.netStatus = 'open';
      else if (msg.type === 'disconnect') state.netStatus = 'closed';
      else if (msg.type === 'reconnecting') state.netStatus = 'reconnecting';
      else if (msg.type === 'realtime.update') applyRealtime(msg.data);
      else if (msg.type === 'sim.ready') applyFullRealtime();
    });
    function applyRealtime(payload) {
      if (!payload || !payload.list) return;
      payload.list.forEach(function (it) { state.realtime[it.merchantId] = it; });
      state.lastUpdate = Date.now();
      // 演示时钟随仿真推进同步（顶栏时钟与时序图横轴保持一致）
      if (sim.params.clockAuto) state.clockMinutes = Math.round(sim.params.clockMinutes);
    }
    /* 数据异常判定（论文 3.2.2 表 3.4）：连续 5 分钟未收到更新 → 标记“数据异常”并置灰 */
    var STALE_MS = 5 * 60 * 1000;
    function checkStale() {
      var now = Date.now(), cnt = 0;
      Object.keys(state.realtime).forEach(function (id) {
        var rt = state.realtime[id];
        if (!rt) return;
        var stale = rt.lastUpdate ? (now - rt.lastUpdate > STALE_MS) : (now - state.lastUpdate > STALE_MS);
        if (stale !== !!rt.abnormal) {
          rt.abnormal = stale;
          state.realtime[id] = Object.assign({}, rt);
        }
        if (stale) cnt++;
      });
      state.staleCount = cnt;
    }
    setInterval(checkStale, 15000);

    function applyFullRealtime() {
      Object.keys(sim.state).forEach(function (id) {
        state.realtime[id] = {
          currentCount: sim.state[id].currentCount,
          queueCount: sim.state[id].queueCount,
          waitMinutes: sim.state[id].waitMinutes,
          capacity: sim.state[id].capacity,
          full: sim.state[id].full,
          dataSource: sim.state[id].dataSource,
          lastUpdate: sim.state[id].lastUpdate
        };
      });
      state.lastUpdate = Date.now();
      state.clockMinutes = Math.round(sim.params.clockMinutes);
    }

    function setClock(minutes) {
      state.clockMinutes = ((minutes % 1440) + 1440) % 1440;
      sim.params.clockMinutes = state.clockMinutes;
      sim.params.clockAuto = false;
      state.clockAuto = false;
      sim.restart();
    }
    function resumeAutoClock() {
      state.clockAuto = true;
      sim.params.clockAuto = true;
      state.lastUpdate = Date.now();
    }
    function setClockAuto(v) {
      state.clockAuto = !!v;
      sim.params.clockAuto = !!v;
    }
    function syncRealTime() {
      var d = new Date();
      setClock(d.getHours() * 60 + d.getMinutes());
    }
    function setDataSource(src) {
      state.dataSource = src;
      sim.setSource(src);
      // 立即刷新本地实时缓存的数据来源标识，避免等待下一次推送
      Object.keys(state.realtime).forEach(function (id) {
        if (state.realtime[id]) state.realtime[id] = Object.assign({}, state.realtime[id], { dataSource: src });
      });
    }
    function toggleNet() {
      if (state.offlineDemo) {
        state.offlineDemo = false;
        sim.restoreNet();
      } else {
        state.offlineDemo = true;
        sim.breakNet();
      }
    }

    /* ---------- 管理后台：保存与发布 ---------- */
    function persist() {
      try {
        var regions = {};
        data.merchants.forEach(function (m) { if (m.region && m.region.length >= 3) regions[m.id] = m.region; });
        overrides.regions = regions;
        var ov = {
          merchants: overrides.merchants || [],
          regions: regions,
          floorPlans: state.floorPlans || {},
          params: {
            intervalSec: sim.params.intervalSec,
            timeScale: sim.params.timeScale,
            lambdaNormal: sim.params.lambdaNormal,
            lambdaLunch: sim.params.lambdaLunch,
            lambdaDinner: sim.params.lambdaDinner,
            heatScale: sim.params.heatScale,
            dataSource: sim.params.dataSource
          }
        };
        global.localStorage.setItem(LS_KEY, JSON.stringify(ov));
      } catch (e) { /* file:// 环境可能禁用存储，忽略 */ }
    }

    /* ---------- 楼层平面图上传（论文 3.2.4 / 需求 FR-03-02） ---------- */
    function floorPlanOf(floorNo) { return state.floorPlans[floorNo] || null; }
    function setFloorPlan(floorNo, payload) {
      state.floorPlans[floorNo] = {
        dataUrl: payload.dataUrl,
        name: payload.name || '楼层平面图',
        w: payload.w || 0,
        h: payload.h || 0,
        opacity: payload.opacity == null ? 0.6 : payload.opacity,
        uploadedAt: Date.now()
      };
      state.regionRev++;
      persist();
      return true;
    }
    function clearFloorPlan(floorNo) {
      delete state.floorPlans[floorNo];
      state.regionRev++;
      persist();
      return true;
    }
    function setPlanOpacity(floorNo, v) {
      var p = state.floorPlans[floorNo];
      if (!p) return false;
      p.opacity = Math.max(0, Math.min(1, Number(v)));
      persist();
      return true;
    }
    function planStats() {
      var uploaded = data.floors.filter(function (f) { return !!state.floorPlans[f.no]; }).length;
      var drawn = data.merchants.filter(function (m) { return m.region && m.region.length >= 3; }).length;
      return { uploaded: uploaded, total: data.floors.length, drawn: drawn, merchants: data.merchants.length };
    }

    /* ---------- 店铺区域绘制（多边形，坐标单位：米，与 layout.width/depth 同系） ---------- */
    function regionOf(merchantId) {
      var m = null;
      data.merchants.forEach(function (x) { if (String(x.id) === String(merchantId)) m = x; });
      return (m && m.region && m.region.length >= 3) ? m.region : null;
    }
    function saveRegion(merchantId, points) {
      if (!points || points.length < 3) return { ok: false, reason: '区域至少需要 3 个顶点' };
      var L = data.layout;
      var bad = points.some(function (p) { return p.x < -2 || p.x > L.width + 2 || p.z < -2 || p.z > L.depth + 2; });
      if (bad) return { ok: false, reason: '存在超出图幅范围的顶点，请重新绘制' };
      var clean = points.map(function (p) { return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }; });
      data.merchants.forEach(function (m) { if (String(m.id) === String(merchantId)) m.region = clean; });
      state.regionRev++;
      persist();
      return { ok: true, points: clean.length };
    }
    function clearRegion(merchantId) {
      data.merchants.forEach(function (m) { if (String(m.id) === String(merchantId)) delete m.region; });
      state.regionRev++;
      persist();
      return true;
    }
    /* 点是否落在多边形区域内（射线法；顾客端二维点击拾取用） */
    function pointInRegion(region, x, z) {
      var inside = false;
      for (var i = 0, j = region.length - 1; i < region.length; j = i++) {
        var xi = region[i].x, zi = region[i].z, xj = region[j].x, zj = region[j].z;
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
      }
      return inside;
    }
    /* 多边形面积（鞋带公式，单位 ㎡），用于发布前校验 */
    function regionArea(region) {
      var a = 0;
      for (var i = 0, j = region.length - 1; i < region.length; j = i++) {
        a += (region[j].x + region[i].x) * (region[j].z - region[i].z);
      }
      return Math.abs(a / 2);
    }
    function upsertMerchant(m, adminAction) {
      if (m.id) {
        data.merchants.forEach(function (x, i) { if (x.id === m.id) data.merchants.splice(i, 1, m); });
        if (!overrides.merchants) overrides.merchants = [];
        var idx = -1;
        overrides.merchants.forEach(function (x, i) { if (x.id === m.id) idx = i; });
        if (idx >= 0) overrides.merchants[idx] = m; else overrides.merchants.push(m);
      } else {
        m.id = Math.max.apply(null, data.merchants.map(function (x) { return x.id; })) + 1;
        m.door = { x: m.x, z: m.z };
        m.crossMidnight = !!m.crossMidnight;
        if (!m.capacity) m.capacity = 80;
        if (!m.serviceRate) m.serviceRate = 60;
        m.heat = m.heat || 1;
        data.merchants.push(m);
        if (!overrides.merchants) overrides.merchants = [];
        overrides.merchants.push(m);
      }
      persist();
      return true;
    }
    function saveProduct(p) {
      var arr = productMap[p.merchantId] || (productMap[p.merchantId] = []);
      if (p.id) {
        arr.forEach(function (x, i) { if (x.id === p.id) arr.splice(i, 1, p); });
      } else {
        p.id = Math.max.apply(null, data.products.map(function (x) { return x.id; })) + 1;
        arr.push(p);
        data.products.push(p);
      }
      return true;
    }
    function removeProduct(id, merchantId) {
      var arr = productMap[merchantId] || [];
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { arr.splice(i, 1); break; }
    }
    function publish() {
      // 校验营业时间与因数配置完整性
      var errors = [];
      data.merchants.forEach(function (m) {
        if (!m.openTime || !m.closeTime) errors.push(m.name + '：营业时间未配置');
        if (!m.capacity) errors.push(m.name + '：容量上限未配置');
      });
      if (sim.params.lambdaLunch <= 0 || sim.params.lambdaDinner <= 0) errors.push('仿真参数：到达率必须为正数');
      // 店铺区域校验：中心点必须落在绘制区域内，且面积不能过小（否则顾客点击店铺无法准确定位）
      data.merchants.forEach(function (m) {
        if (m.region && m.region.length >= 3) {
          if (!pointInRegion(m.region, m.x, m.z)) errors.push(m.name + '：商户中心点不在绘制的店铺区域内');
          else if (regionArea(m.region) < 4) errors.push(m.name + '：绘制区域面积过小（小于 4 ㎡）');
        }
      });
      persist();
      if (state.dataSource !== sim.params.dataSource) state.dataSource = sim.params.dataSource;
      sim.restart();
      applyFullRealtime();
      return { ok: errors.length === 0, errors: errors };
    }
    function updateSimParam(k, v) { sim.params[k] = v; }

    /* ---------- 手工录入 / 设备采集演示 ---------- */
    function manualInput(id, current, queue) { sim.setManual(id, current, queue); applyFullRealtime(); }

    /* ---------- 导出 CSV ---------- */
    function exportCsv() {
      var summary2 = sim.summary();
      var rows = [['商户名称', '楼层', '区域', '业态', '营业时段', '人均消费', '消费档次', '当前人数', '排队人数', '预计等位(分钟)', '容量', '状态', '数据来源']];
      data.merchants.forEach(function (m) {
        var rt = realtimeOf(m);
        rows.push([m.name, floorsOf(m.floorNo).label, m.areaCode, m.category, m.openTime + '-' + m.closeTime, m.avgPrice, m.priceTier, rt.currentCount, rt.queueCount, rt.waitMinutes, rt.capacity, STATUS_META[judgeStatus(m)].text, sourceLabel(rt.dataSource)]);
      });
      var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c) + '"'; }).join(','); }).join('\r\n');
      var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '商场实时客流报表_' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return true;
    }

    function sourceLabel(src) {
      return { simulation: '仿真数据', device: '设备统计', manual: '人工录入' }[src] || '仿真数据';
    }

    return {
      state: state,
      data: data,
      sim: sim,
      router: router,
      runtime: RUNTIME,
      STATUS_META: STATUS_META,
      judgeStatus: judgeStatus,
      activeHours: activeHours,
      statusMap3D: statusMap3D,
      replayHistory: replayHistory,
      clearHistory: clearHistory,
      checkStale: checkStale,
      filteredMerchants: filteredMerchants,
      realtimeOf: realtimeOf,
      selectedMerchant: selectedMerchant,
      selectedFacility: selectedFacility,
      productsOf: productsOf,
      select: select,
      clearSelection: clearSelection,
      setFloor: setFloor,
      locateAt: locateAt,
      startLocatePick: startLocatePick,
      cancelLocatePick: cancelLocatePick,
      navigateTo: navigateTo,
      retryRoute: retryRoute,
      clearRoute: clearRoute,
      playRoute: playRoute,
      pauseRoute: pauseRoute,
      resumeRoute: resumeRoute,
      setSpeed: setSpeed,
      toggleFollow: toggleFollow,
      onArrive: onArrive,
      setClock: setClock,
      resumeAutoClock: resumeAutoClock,
      setClockAuto: setClockAuto,
      syncRealTime: syncRealTime,
      setDataSource: setDataSource,
      toggleNet: toggleNet,
      persist: persist,
      upsertMerchant: upsertMerchant,
      floorPlanOf: floorPlanOf,
      setFloorPlan: setFloorPlan,
      clearFloorPlan: clearFloorPlan,
      setPlanOpacity: setPlanOpacity,
      planStats: planStats,
      regionOf: regionOf,
      saveRegion: saveRegion,
      clearRegion: clearRegion,
      pointInRegion: pointInRegion,
      regionArea: regionArea,
      saveProduct: saveProduct,
      removeProduct: removeProduct,
      publish: publish,
      updateSimParam: updateSimParam,
      manualInput: manualInput,
      exportCsv: exportCsv,
      sourceLabel: sourceLabel,
      floorsOf: floorsOf,
      facilityIcon: facilityIcon,
      facilityShort: facilityShort,
      nearestFacility: nearestFacility,
      facilityShortcuts: facilityShortcuts,
      navigateToFacility: navigateToFacility,
      routePointAt: routePointAt,
      recordTrail: recordTrail,
      clearTrail: clearTrail,
      toggleTrailRecord: toggleTrailRecord,
      trailPointAt: trailPointAt,
      playReplay: playReplay,
      pauseReplay: pauseReplay,
      resumeReplay: resumeReplay,
      stopReplay: stopReplay,
      endCodeOf: endCodeOf,
      selectedMerchantById: selectedMerchantById,
      summary: function () { return sim.summary(); }
    };
  }

  global.MallStore = { create: create, runtime: RUNTIME };
})(window);
