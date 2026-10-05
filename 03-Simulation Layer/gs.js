/* =========================================================
 * 实时客流仿真引擎
 * 依据《需求规格说明书》附录 E：顾客到达服从泊松过程（Knuth 算法生成），
 * 服务台数 c 由 λ/(μ·ρ) 反推，排队规则 FCFS，等位时长按 Little 公式
 * Wq = Lq / λ ≈ 排队人数 / 服务率 × 60（分钟）换算。
 * 同时提供模拟 WebSocket 传输层（心跳 + 指数退避重连 + 断网降级）
 * ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 泊松随机数（Knuth） ---------- */
  function poisson(lambdaPerHour, deltaSeconds) {
    var expected = lambdaPerHour * deltaSeconds / 3600;
    if (expected <= 0) return 0;
    // expected 较大时（>30）用正态近似，避免循环过深
    if (expected > 30) {
      var u1 = Math.random(), u2 = Math.random();
      var z = Math.sqrt(-2 * Math.log(u1 || 1e-9)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(expected + z * Math.sqrt(expected)));
    }
    var L = Math.exp(-expected), k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  /* ---------- 时段到达率 λ（人/小时） ---------- */
  function lambdaByClock(minutes) {
    if (minutes >= 690 && minutes < 810) return 120;   // 11:30-13:30 午高峰
    if (minutes >= 1050 && minutes < 1200) return 150; // 17:30-20:00 晚高峰
    return 40;                                          // 平峰
  }
  function occupancyByClock(minutes) {
    if (minutes < 540) return 0.05;
    if (minutes < 690) return 0.22;
    if (minutes < 810) return 0.62;
    if (minutes < 1050) return 0.35;
    if (minutes < 1200) return 0.78;
    if (minutes < 1320) return 0.42;
    return 0.12;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtClock(minutes) {
    var m = ((minutes % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  /* ---------- M/M/c 稳态指标（Erlang C 公式 + Little 公式） ----------
   * ρ = λ/(c·μ₀)；Lq = P_wait · ρ/(1-ρ)；Wq = Lq / λ
   * 用于按当前到达率解析求出排队人数与预计等位时长 */
  function erlangC(c, lam, muCh) {
    var a = lam / muCh;               // 到达强度 λ/μ₀
    var rho = a / c;                  // 服务台利用率
    if (rho >= 0.995) rho = 0.995;    // 饱和时按 99.5% 利用率计，等待时间趋于上限
    var sum = 0, term = 1;
    for (var k = 0; k < c; k++) {
      if (k > 0) term = term * a / k;
      sum += term;
    }
    var last = term * a / c;          // (c·ρ)^c / c!
    var pWait = last / (1 - rho) / (sum + last / (1 - rho));
    var Lq = pWait * rho / (1 - rho);
    return { rho: rho, pWait: pWait, Lq: Lq };
  }

  /* 排队人数：稳态队长 Lq；当到达率超过服务能力时（饱和）队列按严重程度估算 */
  function queueOf(m, em, rhoRaw) {
    if (rhoRaw >= 1) {
      var frac = Math.min(0.8, 0.2 + 0.22 * Math.min(2, rhoRaw - 1)) * (0.85 + Math.random() * 0.3);
      return Math.round(m.capacity * frac);
    }
    return Math.round(em.Lq * (0.85 + Math.random() * 0.3));
  }

  /* ---------- 模拟 WebSocket 传输层 ---------- */
  function MockSocket(onMessage) {
    this.onMessage = onMessage;
    this.status = 'connecting';
    this.retry = 0;
    this.seq = 0;
    this.timer = null;
    this.connectTimer = null;
    this.watchdog = null;
    this.lastRecv = Date.now();
    this._open();
  }
  MockSocket.prototype._open = function () {
    var self = this;
    this.status = 'connecting';
    clearTimeout(this.timer);
    var delay = this.retry === 0 ? 260 : Math.min(30000, 1000 * Math.pow(2, this.retry - 1));
    this.timer = setTimeout(function () {
      self.status = 'open';
      self.retry = 0;
      self.lastRecv = Date.now();
      self._emit('connect', {});
      self._startHeartbeat();
    }, delay);
    // 连接 1 秒超时：未在 1 秒内建连则按退避立即重试（论文 3.3 传输可靠性要求）
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(function () {
      if (self.status === 'connecting') { self.retry++; self._open(); }
    }, 1000);
  };
  MockSocket.prototype._startHeartbeat = function () {
    var self = this;
    clearInterval(this.hbTimer);
    this.hbTimer = setInterval(function () {
      if (self.status === 'open') self._emit('heartbeat', { ts: Date.now() });
    }, 30000);
    // 心跳看门狗：连续 32 秒（约一个心跳周期）未收到任何消息则判定连接超时，
    // 自动在 1 秒后触发重连（论文 3.3「断线 1 秒超时重试」）
    clearInterval(this.watchdog);
    this.watchdog = setInterval(function () {
      if (self.status === 'open' && Date.now() - self.lastRecv > 32000) {
        self.retry = (self.retry || 0) + 1;
        self.restore();
      }
    }, 5000);
  };
  MockSocket.prototype._emit = function (type, data) {
    this.lastRecv = Date.now();
    this.onMessage && this.onMessage({ type: type, timestamp: Date.now(), data: data });
  };
  MockSocket.prototype.send = function (payload) { /* 订阅指令：演示环境忽略 */ };
  MockSocket.prototype.push = function (data) {
    if (this.status !== 'open') return;
    this._emit('realtime.update', data);
  };
  MockSocket.prototype.break = function () {
    this.status = 'closed';
    clearInterval(this.hbTimer);
    clearInterval(this.watchdog);
    this._emit('disconnect', {});
    this.retry = this.retry || 1;
    var self = this;
    // 断网后进入指数退避重连（演示：等待用户恢复网络）
    this.timer = setTimeout(function () { self.status = 'reconnecting'; self._emit('reconnecting', {}); }, 1200);
  };
  MockSocket.prototype.restore = function () {
    var self = this;
    if (this.status === 'open') return;
    this.status = 'reconnecting';
    clearTimeout(this.timer);
    // 1 秒后重试建连（论文 3.3 断线重连间隔）
    this.timer = setTimeout(function () { self._open(); }, 1000);
  };

  /* ---------- 仿真主体 ---------- */
  function create(data, options) {
    var opts = options || {};
    var state = {};              // merchantId -> status
    var listeners = [];
    var timer = null;
    var WALK = 1.2;

    var params = {
      enabled: true,
      intervalSec: 30,           // 推送间隔（真实秒），论文 3.3 规定实时数据每 30 秒推送一次
      timeScale: 30,             // 演示加速：1 真实秒 = 30 仿真秒
      lambdaNormal: 40,
      lambdaLunch: 120,
      lambdaDinner: 150,
      heatScale: 1,              // 全局客流热度系数（对 λ 整体缩放，便于演示高峰场景）
      share: 0.45,               // 商户客流占比系数（λ 中分流到单个商户的比例）
      renege: 0.06,              // 排队流失率（每分钟放弃排队的顾客比例）
      dataSource: 'simulation',  // simulation / device / manual
      clockMinutes: 12 * 60,
      clockAuto: true
    };
    Object.keys(opts).forEach(function (k) { if (opts[k] !== undefined) params[k] = opts[k]; });

    var history = [];
    var socket = new MockSocket(function (msg) {
      listeners.forEach(function (cb) { cb(msg); });
    });

    function seed() {
      var occ = occupancyByClock(params.clockMinutes);
      data.merchants.forEach(function (m) {
        var lam = currentLambda(m);
        var muCh = m.serviceRate / (m.channels || 1);
        var em = erlangC(m.channels || 1, lam, muCh);
        var rhoRaw = lam / m.serviceRate;
        var saturated = rhoRaw >= 1;
        var cur = Math.round(m.capacity * Math.min(1, em.rho) * (0.9 + Math.random() * 0.2));
        if (occupancyByClock(params.clockMinutes) > 0) cur = Math.max(cur, Math.round(m.capacity * occ * 0.5));
        cur = Math.max(0, Math.min(m.capacity, cur));
        var q = queueOf(m, em, rhoRaw);
        q = Math.max(0, Math.min(Math.round(m.capacity * 0.9), q));
        state[m.id] = {
          merchantId: m.id,
          currentCount: cur,
          queueCount: q,
          capacity: m.capacity,
          waitMinutes: q > 0 ? Math.max(1, Math.round(q / Math.max(1, m.serviceRate) * 60)) : 0,
          rho: Math.round(rhoRaw * 100) / 100,
          saturated: saturated,
          full: false,
          abnormal: false,
          dataSource: params.dataSource,
          lastUpdate: Date.now()
        };
      });
    }

    function waitOf(queue, mu) {
      return Math.max(0, Math.round(queue / Math.max(mu, 1) * 60));
    }

    function currentLambda(m) {
      var base = lambdaByClock(params.clockMinutes);
      var CategoryFactor = { '餐饮': 1.15, '娱乐': 1.0, '儿童': 0.95, '零售': 0.9, '服务': 0.6, '美妆': 0.65, '数码': 0.7, '运动': 0.8, '服饰': 0.85 };
      // λ_i = λ_商场 × 容量占比 × 业态系数 × 热度系数 × 占比系数
      return base * (m.capacity / 100) * (CategoryFactor[m.category] || 1) * m.heat * params.heatScale * params.share;
    }

    /* 单个仿真步：dtSim 为仿真流逝秒数
     * 店内人数按“向目标占用率缓动 + 泊松扰动”演化，排队与等位时长由 M/M/c 稳态解给出 */
    function step(dtSim) {
      var dtMin = dtSim / 60;
      data.merchants.forEach(function (m) {
        var st = state[m.id];
        if (!st) return;
        var opening = isCounting(m);
        var lam = currentLambda(m);
        var muCh = m.serviceRate / (m.channels || 1);
        if (!opening) {
          // 打烊后清场
          st.currentCount = Math.max(0, Math.round(st.currentCount * Math.max(0, 1 - dtMin / 4) - poisson(Math.max(30, m.serviceRate), dtSim) * 0.2));
          st.queueCount = 0; st.waitMinutes = 0; st.full = false; st.rho = 0;
        } else {
          var em = erlangC(m.channels || 1, lam, muCh);
          var rhoRaw = lam / m.serviceRate;
          var saturated = rhoRaw >= 1;
          // 目标店内人数：未饱和时 ≈ 容量 × 利用率，饱和时即为满员
          var target = m.capacity * Math.min(1, em.rho) * (0.92 + Math.random() * 0.16);
          var alpha = 1 - Math.exp(-dtMin / 4);         // 4 分钟缓动时间常数
          var drift = (target - st.currentCount) * alpha;
          var noise = (Math.random() - 0.5) * Math.max(1, Math.abs(drift) * 0.6 + m.capacity * 0.02);
          st.currentCount = Math.max(0, Math.min(m.capacity, Math.round(st.currentCount + drift + noise)));
          // 排队人数与预计等位时长
          var q = queueOf(m, em, rhoRaw);
          st.queueCount = Math.max(0, Math.min(Math.round(m.capacity * 0.9), q));
          st.waitMinutes = st.queueCount > 0 ? Math.max(1, Math.round(st.queueCount / Math.max(1, m.serviceRate) * 60)) : 0;
          st.rho = Math.round(rhoRaw * 100) / 100;
          st.saturated = saturated;
        }
        st.full = st.currentCount >= m.capacity * 0.95;
        st.dataSource = params.dataSource;
        st.lastUpdate = Date.now();
      });
      pushUpdate();
      sampleHistory();
    }

    function isCounting(m) {
      var now = params.clockMinutes;
      var o = toMinutes(m.openTime), cl = toMinutes(m.closeTime);
      var open = cl > o ? (now >= o && now < cl) : (now >= o || now < cl);
      return open;
    }
    function toMinutes(hhmm) {
      var p = String(hhmm).split(':');
      return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
    }

    function sampleHistory() {
      var total = 0, queue = 0, f = {}, full = 0;
      data.merchants.forEach(function (m) {
        var st = state[m.id]; if (!st) return;
        total += st.currentCount; queue += st.queueCount;
        if (st.full) full++;
        f[m.floorNo] = (f[m.floorNo] || 0) + st.currentCount;
      });
      history.push({
        label: fmtClock(params.clockMinutes),
        total: total, queue: queue, full: full, floors: f, ts: Date.now()
      });
      if (history.length > 120) history.shift();
    }

    function pushUpdate() {
      if (socket.status !== 'open') return;
      var payload = data.merchants.map(function (m) {
        var st = state[m.id];
        return {
          merchantId: m.id, currentCount: st.currentCount, queueCount: st.queueCount,
          waitMinutes: st.waitMinutes, capacity: st.capacity, full: st.full,
          dataSource: st.dataSource, lastUpdate: st.lastUpdate
        };
      });
      socket.push({ list: payload, total: summary().total });
    }

    function summary() {
      var total = 0, queue = 0, full = 0, open = 0, waitSum = 0, waitN = 0, maxWait = 0;
      data.merchants.forEach(function (m) {
        var st = state[m.id]; if (!st) return;
        total += st.currentCount;
        queue += st.queueCount;
        if (st.full) full++;
        if (st.currentCount > 0 || isCounting(m)) open++;
       if (st.waitMinutes > 0) { waitSum += st.waitMinutes; waitN++; }
        if (st.waitMinutes > maxWait) maxWait = st.waitMinutes;
      });
      return {
        total: total, queue: queue, full: full, open: open,
        avgWait: waitN ? Math.round(waitSum / waitN) : 0,
        maxWait: maxWait,
        hottest: hotMerchants(6),
        byFloor: floorSummary(),
        byCategory: categorySummary()
      };
    }

    function hotMerchants(n) {
      var arr = data.merchants.map(function (m) {
        var st = state[m.id];
        return { merchant: m, current: st ? st.currentCount : 0, queue: st ? st.queueCount : 0, wait: st ? st.waitMinutes : 0, full: st ? st.full : false };
      });
      arr.sort(function (a, b) { return (b.current + b.queue) - (a.current + a.queue); });
      return arr.slice(0, n);
    }
    function floorSummary() {
      var out = {};
      data.floors.forEach(function (f) { out[f.no] = 0; });
      data.merchants.forEach(function (m) {
        var st = state[m.id]; if (!st) return;
        out[m.floorNo] += st.currentCount;
      });
      return out;
    }
    function categorySummary() {
      var out = {};
      data.merchants.forEach(function (m) {
        var st = state[m.id]; if (!st) return;
        out[m.category] = (out[m.category] || 0) + st.currentCount;
      });
      return out;
    }

    function tick() {
      if (!params.enabled) return;
      if (params.clockAuto) {
        params.clockMinutes = (params.clockMinutes + params.intervalSec * params.timeScale / 60) % 1440;
      }
      step(params.intervalSec * params.timeScale);
    }

    return {
      state: state,
      params: params,
      history: history,
      socket: socket,
      start: function () {
        var self = this;
        seed();
        sampleHistory();
        clearInterval(timer);
        timer = setInterval(tick, params.intervalSec * 1000);
        tick();
        listeners.forEach(function (cb) { cb({ type: 'sim.ready', data: {} }); });
        return self;
      },
      stop: function () { clearInterval(timer); },
      restart: function () { this.stop(); this.start(); },
      summary: summary,
      hotMerchants: hotMerchants,
      waitOf: waitOf,
      lambdaByClock: lambdaByClock,
      fmtClock: fmtClock,
      setClock: function (min) { params.clockMinutes = ((min % 1440) + 1440) % 1440; },
      get: function (id) { return state[id]; },
      on: function (cb) { listeners.push(cb); },
      /* 管理员手工录入（方式三） */
      setManual: function (id, current, queue) {
        var st = state[id]; if (!st) return;
        st.currentCount = Math.max(0, Math.min(st.capacity, current));
        st.queueCount = Math.max(0, queue);
        st.waitMinutes = waitOf(st.queueCount, findMerchant(id).serviceRate);
        st.dataSource = params.dataSource;
        st.lastUpdate = Date.now();
        pushUpdate();
      },
      /* 设备采集（方式二）：以当前仿真值为真实设备读数 */
      setSource: function (s) {
        params.dataSource = s;
        data.merchants.forEach(function (m) {
          if (state[m.id]) state[m.id].dataSource = s;
        });
        pushUpdate();
      },
      breakNet: function () { socket.break(); },
      restoreNet: function () { socket.restore(); }
    };

    function findMerchant(id) {
      var r = null;
      data.merchants.forEach(function (m) { if (m.id === id) r = m; });
      return r || { serviceRate: 60 };
    }
  }

  global.MallSim = { create: create, poisson: poisson, fmtClock: fmtClock, lambdaByClock: lambdaByClock };
})(window);
