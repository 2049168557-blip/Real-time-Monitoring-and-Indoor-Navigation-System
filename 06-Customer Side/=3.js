/* =========================================================
 * 顾客端 · 等距三维视图（纯 SVG，不依赖 WebGL）
 * 依据 FR-03-03：WebGL 不可用时的降级展示，功能与真三维一致
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  var Iso3D = {
    name: 'Iso3D',
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      var svgRef = Vue.ref(null);
      var L = store.data.layout;
      var W = L.width, D = L.depth;

      var VW = 820, VH = 660;                 // SVG viewBox
      var A = 4.85, B = 2.8;                  // 等距投影系数（≈cos30°/sin30° × 尺度）
      var GAP = 42;                           // 层间垂直间距（px）
      var HV = 2.6;                           // 每米层内高度的屏幕像素
      var offsetX = D * A + 34;

      /* 楼层按标高从低到高编号，0 为最底层 */
      var floors = store.data.floors.slice().sort(function (a, b) { return a.no - b.no; });
      var idxOf = {};
      floors.forEach(function (f, i) { idxOf[f.no] = i; });
      var baseY = 30 + (floors.length - 1) * GAP;

      function ip(x, z, floorNo, h) {
        var i = idxOf[floorNo] || 0;
        return [(x - z) * A + offsetX, (x + z) * B - i * GAP - (h || 0) * HV + baseY];
      }
      function poly(points) {
        return points.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      }
      function shade(hex, k) {
        var n = parseInt(hex.slice(1), 16);
        var r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
        var g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
        var b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
      }
      function statusColor(m) {
        var st = store.judgeStatus(m);
        return { open: '#52C41A', closing: '#FAAD14', closed: '#BFBFBF', rest: '#BFBFBF', unknown: '#8C8C8C' }[st] || '#8C8C8C';
      }
      /* 估算字符串宽度（em）：ASCII ≈0.68em，中文/全角 ≈1em（用于选中胶囊定宽） */
      function textEm(t) {
        var w = 0;
        for (var i = 0; i < t.length; i++) w += (t.charCodeAt(i) < 128 ? 0.68 : 1);
        return w;
      }

      /* 只看当前楼层时，等距视图同样只保留当前楼层的板面/店铺/设施 */
      function visibleFloors() {
        return state.soloFloor ? floors.filter(function (f) { return f.no === state.currentFloor; }) : floors;
      }

      function floorFaces() {
        return visibleFloors().map(function (f) {
          return {
            no: f.no, name: f.name,
            slab: poly([ip(0, 0, f.no, 0), ip(W, 0, f.no, 0), ip(W, D, f.no, 0), ip(0, D, f.no, 0)]),
            label: ip(-8, D * 0.5, f.no, 0)
          };
        });
      }

      /* 店铺体块：顶面 + 两个可见侧面；同层按 (x+z) 排序保证遮挡关系正确 */
      function shopBoxes() {
        var out = [];
        visibleFloors().forEach(function (f) {
          var ms = store.data.merchants.filter(function (m) { return m.floorNo === f.no; })
            .sort(function (a, b) { return (a.x + a.z) - (b.x + b.z); });
          var boxes = ms.map(function (m) {
            var w1 = Math.min(m.w * 0.95, m.w - 0.3), d1 = Math.min(m.d * 0.95, m.d - 0.3);
            var x1 = m.x - w1 / 2, x2 = m.x + w1 / 2, z1 = m.z - d1 / 2, z2 = m.z + d1 / 2;
            var h = 2.4, base = statusColor(m);
            var st = store.judgeStatus(m);
            // 非营业状态：块面中央加一个状态小标签，避免"颜色不一样却不知为何"
            var tagTxt = { closed: '已打烊', rest: '休息', closing: '即将打烊' }[st] || '';
            var tagW = tagTxt ? Math.max(30, textEm(tagTxt) * 11 + 12) : 0;
            return {
              id: m.id, name: m.name, floorNo: f.no, status: st, tagTxt: tagTxt, tagW: tagW,
              top: poly([ip(x1, z1, f.no, h), ip(x2, z1, f.no, h), ip(x2, z2, f.no, h), ip(x1, z2, f.no, h)]),
              right: poly([ip(x2, z1, f.no, h), ip(x2, z2, f.no, h), ip(x2, z2, f.no, 0), ip(x2, z1, f.no, 0)]),
              front: poly([ip(x1, z2, f.no, h), ip(x2, z2, f.no, h), ip(x2, z2, f.no, 0), ip(x1, z2, f.no, 0)]),
              cTop: shade(base, 1), cRight: shade(base, 0.78), cFront: shade(base, 0.58),
              labelAt: ip(m.x, m.z, f.no, h + 1.8),
              // 状态标签贴在顶面正中（略低于中心，避免压住顶面上缘）
              tagAt: ip(m.x, m.z, f.no, h - 0.5)
            };
          });
          out.push({ floorNo: f.no, boxes: boxes });
        });
        return out;
      }
      /* 选中态表达：不再用"粗深蓝描边压在顶面上"（小尺寸下会和绿色混成墨绿/teal，
       * 看起来像换了颜色），改为「白色外环 + 细蓝内环」的双线光环 + 名称胶囊。
       * 这样体块顶面始终是自身状态色，选中只由"环 + 胶囊"表达。 */
      function selectedBox() {
        if (state.selectedKind !== 'merchant') return null;
        var found = null;
        shopBoxes().forEach(function (g) {
          g.boxes.forEach(function (b) { if (b.id === state.selectedId) found = b; });
        });
        if (!found) return null;
        var pts = found.top.split(' ').map(function (t) { return t.split(',').map(Number); });
        var cx = 0, cy = 0;
        pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pts.length; cy /= pts.length;
        // 光环：顶面各点沿"中心→角点"方向外扩 3.4 单位
        var halo = pts.map(function (p) {
          var dx = p[0] - cx, dy = p[1] - cy, len = Math.sqrt(dx * dx + dy * dy) || 1;
          return (p[0] + dx / len * 3.4).toFixed(1) + ',' + (p[1] + dy / len * 3.4).toFixed(1);
        }).join(' ');
        // 名称胶囊：紧贴光环上沿（不遮挡顶面），并夹在画布内
        var haloTop = Math.min.apply(null, pts.map(function (p) { return p[1]; })) - 3.4;
        var name = found.name;
        var wpx = Math.max(46, textEm(name) * 15 + 16);
        var capH = 21;
        var capY = Math.max(2, haloTop - capH - 7);
        return Object.assign({}, found, {
          halo: halo,
          capX: Math.max(2, Math.min(VW - wpx - 2, cx - wpx / 2)),
          capY: capY, capW: wpx, capH: capH
        });
      }
      function routeLines() {
        if (!state.route) return [];
        return state.route.segments
          .filter(function (s) { return !state.soloFloor || s.floorNo === state.currentFloor; })
          .map(function (s) {
            return { floorNo: s.floorNo, pts: poly(s.points.map(function (p) { return ip(p.x, p.z, s.floorNo, 0.4); })) };
          });
      }
      function trailLines() {
        var out = [], cur = null;
        state.trail.forEach(function (p, i) {
          var prev = state.trail[i - 1];
          if (!prev || prev.floorNo !== p.floorNo) {
            if (cur && cur.pts.length > 1) out.push(cur);
            cur = { floorNo: p.floorNo, pts: [ip(p.x, p.z, p.floorNo, 0.4)] };
          } else cur.pts.push(ip(p.x, p.z, p.floorNo, 0.4));
        });
        if (cur && cur.pts.length > 1) out.push(cur);
        return out.filter(function (s) { return !state.soloFloor || s.floorNo === state.currentFloor; })
          .map(function (s) {
            return { floorNo: s.floorNo, pts: poly(s.pts) };
          });
      }
      function userDot() {
        if (!state.userPos) return null;
        if (state.soloFloor && state.userPos.floorNo !== state.currentFloor) return null;
        var p = ip(state.userPos.x, state.userPos.z, state.userPos.floorNo, 0.6);
        return { x: p[0], y: p[1] };
      }
      function navDot() {
        if (!state.route) return null;
        var p = store.routePointAt(state.nav.progress);
        if (!p) return null;
        var q = ip(p.x, p.z, p.floorNo, 0.6);
        return { x: q[0], y: q[1] };
      }
      function facilityDots() {
        return visibleFloors().map(function (f) {
          var fs = store.data.facilities.filter(function (x) {
            return x.floorNo === f.no && (x.type === 'elevator' || x.type === 'escalator' || x.type === 'service');
          });
          return {
            floorNo: f.no, dots: fs.map(function (x) {
              var p = ip(x.x, x.z, f.no, 0.6);
              return {
                id: x.id, x: p[0], y: p[1],
                color: x.type === 'elevator' ? '#F2A33C' : (x.type === 'escalator' ? '#2EA8A0' : '#9B5DE5')
              };
            })
          };
        });
      }
      function isDim(floorNo) {
        return state.currentFloor !== floorNo;
      }
      function amenityColor(sub) {
        return { water: '#3FA7FF', charging: '#FFB020', rest: '#36C2A6', atm: '#7C6CFF' }[sub] || '#7A8DFF';
      }
      /* 便民设施点位（直饮水 / 充电桩 / 休息区 / ATM），同样遵循“只看当前楼层” */
      function amenityDots() {
        return visibleFloors().map(function (f) {
          var fs = store.data.facilities.filter(function (x) {
            return x.floorNo === f.no && x.type === 'amenity';
          });
          return {
            floorNo: f.no, dots: fs.map(function (x) {
              var p = ip(x.x, x.z, f.no, 0.6);
              return {
                id: x.id, x: p[0], y: p[1], name: store.facilityShort(x),
                icon: store.facilityIcon(x), color: amenityColor(x.subtype)
              };
            })
          };
        });
      }

      /* 点击拾取：等距投影是仿射变换，可精确反算 (x, z) */
      function svgClick(e) {
        var svg = svgRef.value;
        if (!svg || !svg.getScreenCTM) return;
        var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        var loc = pt.matrixTransform(svg.getScreenCTM().inverse());
        // 先试当前聚焦楼层（可见性最好），再自上层向下层尝试，保证点击结果可预期
        var order = floors.slice().reverse();
        var cur = state.currentFloor;
        order.sort(function (a, b) {
          if (a.no === cur) return -1;
          if (b.no === cur) return 1;
          return (idxOf[b.no] || 0) - (idxOf[a.no] || 0);
        });
        for (var k = 0; k < order.length; k++) {
          var f = order[k];
          var sx = loc.x - offsetX, sy = loc.y - baseY + (idxOf[f.no] || 0) * GAP;
          var u = sx / A, v = sy / B;
          var x = (u + v) / 2, z = (v - u) / 2;
          if (x < -2 || x > W + 2 || z < -2 || z > D + 2) continue;
          var hit = null;
          store.data.merchants.forEach(function (m) {
            if (m.floorNo !== f.no) return;
            if (x >= m.rect.x && x <= m.rect.x + m.w && z >= m.rect.z && z <= m.rect.z + m.d) hit = m;
          });
          if (hit) { store.select({ kind: 'merchant', id: hit.id }); return; }
          if (f.no !== cur) continue;           // 空地只在当前楼层触发楼层切换
          var fac = null;
          store.data.facilities.forEach(function (fc) {
            if (fc.floorNo !== f.no) return;
            if (Math.abs(fc.x - x) < 2.4 && Math.abs(fc.z - z) < 2.4) fac = fc;
          });
          if (fac) { store.select({ kind: 'facility', id: fac.id }); return; }
          return;
        }
      }

      return {
        store: store, state: state, svgRef: svgRef, floors: floors,
        floorFaces: floorFaces, shopBoxes: shopBoxes, selectedBox: selectedBox, textEm: textEm,
        routeLines: routeLines, trailLines: trailLines, userDot: userDot, navDot: navDot,
        facilityDots: facilityDots, amenityDots: amenityDots, isDim: isDim, amenityColor: amenityColor, svgClick: svgClick, VW: VW, VH: VH
      };
    },
    template: `
    <div class="iso3d">
      <svg ref="svgRef" class="iso-svg" :viewBox="'0 0 '+VW+' '+VH" preserveAspectRatio="xMidYMid meet" @click="svgClick">
        <g v-for="f in floorFaces()" :key="'f'+f.no" :opacity="isDim(f.no) ? 0.4 : 1">
          <polygon :points="f.slab" fill="#F4F7FB" stroke="#1F4E79" stroke-width="0.7" :stroke-opacity="isDim(f.no)?0.35:0.6"/>
          <text :x="f.label[0]" :y="f.label[1]" font-size="15" fill="#1F4E79" opacity="0.8">{{ f.name }}</text>
        </g>

        <g v-for="g in shopBoxes()" :key="'g'+g.floorNo" :opacity="isDim(g.floorNo) ? 0.32 : 1">
          <g v-for="b in g.boxes" :key="b.id">
            <polygon :points="b.front" :fill="b.cFront"/>
            <polygon :points="b.right" :fill="b.cRight"/>
            <polygon :points="b.top" :fill="b.cTop" stroke="#2B3E56" stroke-opacity="0.2" stroke-width="0.4"/>
          </g>
        </g>

        <g v-for="fd in facilityDots()" :key="'fd'+fd.floorNo" :opacity="isDim(fd.floorNo) ? 0.45 : 1">
          <circle v-for="d in fd.dots" :key="d.id" :cx="d.x" :cy="d.y" r="3.2" :fill="d.color" stroke="#fff" stroke-width="0.9"/>
        </g>

        <!-- 便民设施图层（直饮水 / 充电桩 / 休息区 / ATM） -->
        <g v-for="ad in amenityDots()" :key="'am'+ad.floorNo" :opacity="isDim(ad.floorNo) ? 0.45 : 1">
          <g v-for="d in ad.dots" :key="d.id">
            <circle :cx="d.x" :cy="d.y" r="8" fill="#FFFFFF" :stroke="d.color" stroke-width="1.5"/>
            <text :x="d.x" :y="d.y" text-anchor="middle" dominant-baseline="central" font-size="10" style="pointer-events:none">{{ d.icon }}</text>
            <text v-if="store.state.layers.label" :x="d.x" :y="d.y-12" text-anchor="middle" font-size="13" :fill="d.color" style="pointer-events:none">{{ d.name }}</text>
          </g>
        </g>

        <g>
          <polyline v-for="(t,i) in trailLines()" :key="'tr'+i" :points="t.pts" fill="none" stroke="#7A8DFF"
                    stroke-width="1.6" stroke-dasharray="5 3" :opacity="isDim(t.floorNo)?0.4:0.95"/>
          <polyline v-for="(r,i) in routeLines()" :key="'rt'+i" :points="r.pts" fill="none" stroke="#1890FF"
                    stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" :opacity="isDim(r.floorNo)?0.45:1"/>
        </g>

        <circle v-if="userDot()" :cx="userDot().x" :cy="userDot().y" r="4.4" fill="#FF4D4F" stroke="#fff" stroke-width="1.2"/>
        <circle v-if="navDot()" :cx="navDot().x" :cy="navDot().y" r="4.2" fill="#FF4D4F" stroke="#fff" stroke-width="1.2"/>

        <!-- 非营业状态标签：直接标在块面上，不必对照图例才知道这块为什么不同色 -->
        <g v-for="g in shopBoxes()" :key="'tg'+g.floorNo" :opacity="isDim(g.floorNo) ? 0.32 : 1" style="pointer-events:none">
          <g v-for="b in g.boxes" :key="'t'+b.id" v-show="b.tagTxt">
            <rect :x="b.tagAt[0] - b.tagW / 2" :y="b.tagAt[1] - 8" :width="b.tagW" height="16" rx="4"
                  fill="#FFFFFF" fill-opacity="0.94" :stroke="b.cFront" stroke-width="0.9"/>
            <text :x="b.tagAt[0]" :y="b.tagAt[1] + 4" text-anchor="middle" font-size="11.5"
                  font-weight="600" :fill="b.cFront">{{ b.tagTxt }}</text>
          </g>
        </g>

        <g v-if="selectedBox()">
          <polygon :points="selectedBox().halo" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"/>
          <polygon :points="selectedBox().halo" fill="none" stroke="#1F4E79" stroke-width="1.6" stroke-linejoin="round"/>
          <rect :x="selectedBox().capX" :y="selectedBox().capY" :width="selectedBox().capW" :height="selectedBox().capH"
                rx="6" fill="#FFFFFF" fill-opacity="0.96" stroke="#1F4E79" stroke-width="1"/>
          <text :x="selectedBox().capX + selectedBox().capW / 2" :y="selectedBox().capY + 15"
                text-anchor="middle" font-size="15" font-weight="600" fill="#1F4E79">{{ selectedBox().name }}</text>
        </g>
      </svg>
      <div class="iso-hint">等距三维视图（不依赖 WebGL 的降级展示）· 点击店铺查看详情，点击空地切换楼层</div>
    </div>`
  };

  U.Iso3D = Iso3D;
})(window);
