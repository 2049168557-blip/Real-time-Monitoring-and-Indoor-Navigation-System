/* =========================================================
 * 室内路径规划：基于拓扑图的 A* 启发式搜索（含跨楼层策略）
 * 依据《需求规格说明书》第 9 章：
 *   f(n) = g(n) + h(n)，h(n) 取欧氏距离（可采纳，保证最优解）
 *   水平通道权重 = 欧氏距离
 *   电梯垂直权重 = 层高 × 0.8，扶梯 = 层高 × 1.0（电梯更优，自然优先选择）
 *   路径结果按楼层分段返回，供前端分层播放动画
 * ========================================================= */
(function (global) {
  'use strict';

  var FLOOR_H = 4.5;          // 层高（米）
  var ELEVATOR_COEF = 0.8;    // 电梯时间系数
  var ESCALATOR_COEF = 1.0;   // 扶梯时间系数
  var WALKING_SPEED = 1.2;    // 步行速度 m/s
  var TRANSFER_COST = 8;      // 垂直交通换乘附加代价（候梯时间折算，单位：等效米）

  function isVerticalType(type) { return type === 'elevator' || type === 'escalator'; }

  function verticalCoef(type) {
    return type === 'elevator' ? ELEVATOR_COEF : ESCALATOR_COEF;
  }

  /* 两楼层之间跨越的楼层数（按标高差计算，正确处理 B1 ↔ 1F 只隔一层的情况） */
  function levelsBetween(a, b) {
    if (global.MallData && global.MallData.floorBaseY) {
      return Math.abs(global.MallData.floorBaseY(a.floorNo) - global.MallData.floorBaseY(b.floorNo)) / FLOOR_H;
    }
    return Math.abs(a.floorNo - b.floorNo);
  }

  /* 边的通行代价（折算为等效距离，单位：米） */
  function edgeCost(a, b) {
    if (a.floorNo === b.floorNo) {
      var dx = a.x - b.x, dz = a.z - b.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      // 进出垂直交通节点计入候梯代价，避免路径在中间楼层做无意义的换梯
      if (isVerticalType(a.type) !== isVerticalType(b.type)) d += TRANSFER_COST;
      return d;
    }
    return levelsBetween(a, b) * FLOOR_H * verticalCoef(a.type === b.type ? a.type : 'escalator');
  }

  /* 启发函数：水平欧氏距离 + 楼层差 × 层高 × 最小系数（不高估，保证最优） */
  function heuristic(a, b) {
    var dx = a.x - b.x, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz) + levelsBetween(a, b) * FLOOR_H * ELEVATOR_COEF;
  }

  function dist2D(a, b) {
    var dx = a.x - b.x, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* 二分堆优先队列（openList） */
  function BinaryHeap(scoreFn) {
    this.content = [];
    this.scoreFn = scoreFn;
  }
  BinaryHeap.prototype = {
    push: function (el) { this.content.push(el); this.bubbleUp(this.content.length - 1); },
    pop: function () {
      var result = this.content[0], end = this.content.pop();
      if (this.content.length > 0) { this.content[0] = end; this.sinkDown(0); }
      return result;
    },
    size: function () { return this.content.length; },
    bubbleUp: function (n) {
      var el = this.content[n], score = this.scoreFn(el);
      while (n > 0) {
        var parentN = ((n + 1) >> 1) - 1, parent = this.content[parentN];
        if (score >= this.scoreFn(parent)) break;
        this.content[parentN] = el; this.content[n] = parent; n = parentN;
      }
    },
    sinkDown: function (n) {
      var length = this.content.length, el = this.content[n], elemScore = this.scoreFn(el);
      for (;;) {
        var child2N = (n + 1) << 1, child1N = child2N - 1, swap = null, child1Score;
        if (child1N < length) {
          var child1 = this.content[child1N];
          child1Score = this.scoreFn(child1);
          if (child1Score < elemScore) swap = child1N;
        }
        if (child2N < length) {
          var child2 = this.content[child2N];
          var child2Score = this.scoreFn(child2);
          if (child2Score < (swap == null ? elemScore : child1Score)) swap = child2N;
        }
        if (swap == null) break;
        this.content[n] = this.content[swap];
        this.content[swap] = el;
        n = swap;
      }
    }
  };

  function createRouter(data) {
    var map = data.nodeMap;

    /* 将任意坐标吸附到最近的走廊节点（用于用户手动选点定位） */
    function snap(floorNo, x, z) {
      var best = null, bd = Infinity;
      data.nodes.forEach(function (n) {
        if (n.type !== 'cross' || n.floorNo !== floorNo) return;
        var d = dist2D(n, { x: x, z: z });
        if (d < bd) { bd = d; best = n; }
      });
      return best;
    }

    function nodeOfMerchant(id) { return map['shop_' + id] || null; }
    function nodeOfFacility(id) {
      var f = null;
      data.facilities.forEach(function (x) { if (x.id === id) f = x; });
      return f ? map[f.nodeCode] : null;
    }

    /* A* 主过程 */
    function astar(startCode, endCode) {
      var t0 = (global.performance && global.performance.now) ? performance.now() : Date.now();
      var start = map[startCode], end = map[endCode];
      if (!start || !end) return { ok: false, reason: '该店铺暂不支持导航，请联系一层总服务台' };
      if (startCode === endCode) return { ok: false, reason: '您已在该店铺附近' };

      var open = new BinaryHeap(function (n) { return n.f; });
      var cameFrom = {}, gScore = {}, closed = {};
      gScore[startCode] = 0;
      start.f = heuristic(start, end);
      start.g = 0;
      open.push({ code: startCode, g: 0, f: start.f });
      var visited = 0;

      while (open.size() > 0) {
        var cur = open.pop();
        if (closed[cur.code]) continue;
        closed[cur.code] = true;
        visited++;
        if (cur.code === endCode) break;
        var node = map[cur.code];
        var neighbors = node.link || [];
        for (var i = 0; i < neighbors.length; i++) {
          var nbCode = neighbors[i], nb = map[nbCode];
          if (!nb || closed[nbCode]) continue;
          var tentative = (gScore[cur.code] || 0) + edgeCost(node, nb);
          if (gScore[nbCode] === undefined || tentative < gScore[nbCode]) {
            gScore[nbCode] = tentative;
            cameFrom[nbCode] = cur.code;
            open.push({ code: nbCode, g: tentative, f: tentative + heuristic(nb, end) });
          }
        }
      }

      if (cameFrom[endCode] === undefined && endCode !== startCode) {
        return { ok: false, reason: '未找到可用路径，该店铺暂不支持导航，请联系服务台' };
      }

      // 回溯路径
      var path = [endCode], p = endCode, guard = 0;
      while (p !== startCode && guard++ < 5000) {
        p = cameFrom[p];
        if (p === undefined) return { ok: false, reason: '路径回溯失败，请联系服务台' };
        path.unshift(p);
      }

      var t1 = (global.performance && global.performance.now) ? performance.now() : Date.now();
      return buildResult(path, gScore[endCode], visited, t1 - t0);
    }

    /* 按楼层分段整理路径结果 */
    function buildResult(path, totalCost, visited, elapsed) {
      var segs = [], horizontal = 0, verticalFloors = 0, extraSeconds = 0;
      var cur = null;
      for (var i = 0; i < path.length; i++) {
        var n = map[path[i]];
        if (!cur) {
          cur = { floorNo: n.floorNo, points: [{ x: n.x, z: n.z, code: n.code, type: n.type }] };
          segs.push(cur);
          continue;
        }
        if (n.floorNo !== cur.floorNo) {
          // 进入垂直交通段
          var prevNode = map[path[i - 1]];
          var vType = n.type;
          var levels = levelsBetween(prevNode, n);
          verticalFloors += levels;
          // 电梯每层约 18 秒（含等候），扶梯约 26 秒
          extraSeconds += levels * (vType === 'elevator' ? 18 : 26);
          // 同一部电梯 / 扶梯连续跨多层时合并为一条换乘步骤
          if (cur.transfer && cur.transfer.type === vType && cur.points.length === 1) {
            cur.floorNo = n.floorNo;
            cur.transfer.to = n.floorNo;
            cur.transfer.floors += levels;
            cur.points[0] = { x: n.x, z: n.z, code: n.code, type: n.type };
          } else {
            cur = {
              floorNo: n.floorNo,
              points: [{ x: n.x, z: n.z, code: n.code, type: n.type }],
              transfer: { type: vType, from: prevNode.floorNo, to: n.floorNo, floors: levels }
            };
            segs.push(cur);
          }
          continue;
        }
        horizontal += dist2D(map[path[i - 1]], n);
        cur.points.push({ x: n.x, z: n.z, code: n.code, type: n.type });
      }

      var distance = round2(horizontal);
      var walkSeconds = distance / WALKING_SPEED;
      var totalSeconds = walkSeconds + extraSeconds;

      return {
        ok: true,
        path: path,
        segments: segs,
        distance: distance,
        totalCost: round2(totalCost),
        walkSeconds: Math.round(walkSeconds),
        totalSeconds: Math.round(totalSeconds),
        verticalFloors: verticalFloors,
        transferSeconds: Math.round(extraSeconds),
        visited: visited,
        elapsed: Math.max(0.1, round2(elapsed)),
        start: map[path[0]],
        end: map[path[path.length - 1]],
        steps: buildSteps(segs)
      };
    }

    function buildSteps(segs) {
      var steps = [];
      segs.forEach(function (s, i) {
        if (s.transfer && s.transfer.floors > 0) {
          var name = s.transfer.type === 'elevator' ? '客梯' : '自动扶梯';
          steps.push({
            icon: s.transfer.type === 'elevator' ? 'fa-elevator' : 'fa-escalator',
            floorNo: s.floorNo,
            text: '乘坐' + name + '由 ' + floorLabel(s.transfer.from) + ' 至 ' + floorLabel(s.transfer.to) + '（' + s.transfer.floors + ' 层）'
          });
        }
        var d = 0;
        for (var k = 1; k < s.points.length; k++) d += dist2D(s.points[k - 1], s.points[k]);
        if (d > 0.4) {
          steps.push({
            icon: 'fa-walk',
            floorNo: s.floorNo,
            text: floorLabel(s.floorNo) + ' 步行 ' + Math.round(d) + ' 米' + (s.transfer ? '（出电梯后继续直行）' : '')
          });
        }
      });
      return steps.filter(function (s) { return s.text; });
    }

    function floorLabel(no) { return no < 0 ? 'B' + Math.abs(no) : no + 'F'; }
    function round2(v) { return Math.round(v * 100) / 100; }

    return {
      astar: astar,
      snap: snap,
      nodeOfMerchant: nodeOfMerchant,
      nodeOfFacility: nodeOfFacility,
      floorLabel: floorLabel,
      edgeCost: edgeCost
    };
  }

  global.IndoorRouter = { create: createRouter, FLOOR_H: FLOOR_H, WALKING_SPEED: WALKING_SPEED };
})(window);
