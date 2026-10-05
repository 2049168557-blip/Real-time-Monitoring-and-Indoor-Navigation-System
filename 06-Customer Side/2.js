/* =========================================================
 * 顾客端 · 二维平面图视图（SVG）
 * 八图层独立显隐、滚轮缩放、拖拽平移、店铺/设施点击拾取、导航路径与轨迹回放
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  var Plan2D = {
    name: 'Plan2D',
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      // viewBox 已按“米”1:1 映射，默认 k=1 即为整层适配；缩放范围 0.6 ~ 5
      var view = Vue.reactive({ k: 1, tx: 0, ty: 0 });
      var svgRef = Vue.ref(null);
      var dragState = null;
      var hoverShop = Vue.ref(null);

      /* 店铺标签按铺位宽度自适应字号与截断，避免相邻店铺文字互相压盖 */
      function merchantsOnFloor() {
        state.regionRev;   // 依赖区域版本号：管理端保存/清除绘制区域后，顾客端即时刷新
        return store.data.merchants.filter(function (m) { return m.floorNo === state.currentFloor; })
          .map(function (m) {
            // 图内文字与界面正文对齐：平面图 1 单位 ≈ 7 px
            // 自适应策略：先按铺位可用宽度缩字号（1.1–1.75 ≈ 7.7–12.3px），
            // 尽量完整显示店名，只有在窄铺且名称很长时才截断，避免"一片省略号"
            var avail = Math.max(2.6, m.w - 1.0);
            var nameFit = fitLabel(m.name, avail, 1.75, 1.1);
            if (nameFit.label.indexOf('…') >= 0) {
              var alt = preferReadable(m.name);
              if (alt) {
                var altFit = fitLabel(alt, avail, 1.75, 1.1);
                if (altFit.label.indexOf('…') < 0 && altFit.fs >= 1.25) nameFit = altFit;
              }
            }
            var priceFit = fitLabel('¥' + m.avgPrice + ' · ' + m.category, avail, nameFit.fs * 0.88, 0.95);
            return Object.assign({}, m, {
              _fs: nameFit.fs, _label: nameFit.label,
              _pfs: priceFit.fs, _plabel: priceFit.label
            });
          });
      }
      function facilitiesOnFloor() {
        return store.data.facilities.filter(function (f) { return f.floorNo === state.currentFloor; });
      }

      /* 屏幕坐标 → SVG viewBox 坐标（考虑 preserveAspectRatio 的等比缩放与居中） */
      function toViewBox(e) {
        var svg = svgRef.value;
        if (!svg || !svg.getScreenCTM) return null;
        var pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        var loc = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: loc.x, y: loc.y };
      }
      /* 屏幕坐标 → 商场局部坐标（米），已反解图层变换；
         平面图采用“北在上”的惯用朝向，屏幕纵轴 = 深度 - Z */
      function toModel(e) {
        var loc = toViewBox(e);
        if (!loc) return null;
        return { x: (loc.x - view.tx) / view.k, z: store.data.layout.depth - (loc.y - view.ty) / view.k };
      }
      /* Z 坐标 → SVG 纵坐标 */
      function vy(z) { return store.data.layout.depth - z; }
      /* 当前楼层的平面图（管理端上传，论文 3.2.4） */
      function floorPlan() { return store.floorPlanOf(state.currentFloor); }
      /* 已绘制区域 → SVG points 字符串 */
      function regionPoly(list) { return list.map(function (p) { return p.x + ',' + vy(p.z).toFixed(2); }).join(' '); }
      /* 估算字符串宽度（单位 em）：ASCII ≈0.68em（大写拉丁更宽，取保守值），中文/全角 ≈1em */
      function textEm(s) {
        var w = 0;
        for (var i = 0; i < s.length; i++) w += (s.charCodeAt(i) < 128 ? 0.68 : 1);
        return w;
      }
      /* 中英混排店名在窄铺位放不下时，优先保留更可读的一侧：
       * "星巴克 Starbucks" → "星巴克"；"adidas 阿迪达斯" → "adidas" */
      function preferReadable(n) {
        var m = n.match(/^[一-龥·]+/);
        if (m && m[0].length >= 2) return m[0];
        var j = n.search(/[A-Za-z]/), i = n.search(/[一-龥]/);
        if (j === 0 && i > 1) return n.slice(0, i).trim();
        return '';
      }
      /* 先按可用宽度缩字号（可用宽度内尽量完整显示），实在放不下才按 em 预算截断 */
      function fitLabel(text, avail, fsMax, fsMin) {
        var em = Math.max(0.5, textEm(text));
        var fs = Math.min(fsMax, avail / em * 0.96);
        if (fs >= fsMin) return { fs: fs, label: text };
        fs = fsMin;
        var budget = avail / fs - 0.85, acc = 0, out = '';
        for (var i = 0; i < text.length; i++) {
          var u = text.charCodeAt(i) < 128 ? 0.68 : 1;
          if (acc + u > budget) break;
          acc += u; out += text[i];
        }
        return { fs: fs, label: out.length ? out + '…' : text.slice(0, 1) + '…' };
      }

      function onWheel(e) {
        e.preventDefault();
        var loc = toViewBox(e);
        if (!loc) return;
        var before = { x: (loc.x - view.tx) / view.k, z: (loc.y - view.ty) / view.k };
        var nk = Math.max(0.6, Math.min(5, view.k * (e.deltaY > 0 ? 0.88 : 1.14)));
        view.k = nk;
        view.tx = loc.x - before.x * nk;
        view.ty = loc.y - before.z * nk;
      }
      function down(e) {
        dragState = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: 0 };
      }
      function move(e) {
        if (!dragState) return;
        var dx = e.clientX - dragState.x, dy = e.clientY - dragState.y;
        dragState.moved += Math.abs(dx) + Math.abs(dy);
        var svg = svgRef.value;
        var scale = 1;
        if (svg && svg.getScreenCTM) {
          var m = svg.getScreenCTM();
          scale = m.a || 1;             // 屏幕像素 / viewBox 单位
        }
        view.tx = dragState.tx + dx / scale;
        view.ty = dragState.ty + dy / scale;
      }
      function up() { dragState = null; }
      function reset() { view.k = 1; view.tx = 0; view.ty = 0; }
      /* 以视口中心为锚点缩放 */
      function zoomBy(f) {
        var svg = svgRef.value;
        if (!svg) return;
        var r = svg.getBoundingClientRect();
        var loc = toViewBox({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
        if (!loc) return;
        var c = { x: (loc.x - view.tx) / view.k, z: (loc.y - view.ty) / view.k };
        var nk = Math.max(0.6, Math.min(5, view.k * f));
        view.k = nk;
        view.tx = loc.x - c.x * nk;
        view.ty = loc.y - c.z * nk;
      }

      /* 点击拾取（含定位模式下的手动选点） */
      function svgClick(e) {
        var p = toModel(e);
        if (!p) return;
        if (state.locateMode) {
          if (p.x < 0 || p.z < 0 || p.x > store.data.layout.width || p.z > store.data.layout.depth) return;
          store.locateAt(state.currentFloor, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, 'manual');
          toast('已定位到 ' + store.floorsOf(state.currentFloor).label + '（' + p.x.toFixed(1) + ', ' + p.z.toFixed(1) + '）米', 'success');
          return;
        }
        var hit = null;
        merchantsOnFloor().forEach(function (m) {
          if (m.region && m.region.length >= 3) {
            // 已绘制区域的商户：按多边形命中（射线法）
            if (store.pointInRegion(m.region, p.x, p.z)) hit = m;
          } else if (p.x >= m.rect.x && p.x <= m.rect.x + m.w && p.z >= m.rect.z && p.z <= m.rect.z + m.d) hit = m;
        });
        if (hit) { store.select({ kind: 'merchant', id: hit.id }); return; }
        var fac = null;
        facilitiesOnFloor().forEach(function (f) {
          var d = Math.sqrt((f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z));
          if (d < 2.2) fac = f;
        });
        if (fac) store.select({ kind: 'facility', id: fac.id });
      }

      /* 路径在当前楼层的分段折线（已换算为屏幕纵坐标） */
      function routePolyline(floorNo) {
        if (!state.route) return '';
        var pts = [];
        state.route.segments.forEach(function (s) {
          if (s.floorNo !== floorNo) return;
          s.points.forEach(function (p) { pts.push(p.x.toFixed(2) + ',' + vy(p.z).toFixed(2)); });
        });
        return pts.join(' ');
      }

      /* 导航动画当前点（坐标换算为屏幕纵坐标） */
      function routeMarker() {
        var p = store.routePointAt(state.nav.progress);
        return p ? { floorNo: p.floorNo, x: p.x, y: vy(p.z) } : null;
      }

      /* 历史轨迹在当前楼层的折线（跨楼层断开） */
      function trailPolyline() {
        var out = [];
        state.trail.forEach(function (p, i) {
          if (p.floorNo !== state.currentFloor) return;
          var prev = state.trail[i - 1];
          if (!prev || prev.floorNo !== p.floorNo) out.push([p]);
          else out[out.length - 1].push(p);
        });
        return out.filter(function (seg) { return seg.length > 1; })
          .map(function (seg) { return seg.map(function (p) { return p.x + ',' + vy(p.z).toFixed(2); }).join(' '); });
      }
      function replayMarker() {
        if (!state.replay.playing) return null;
        var p = store.trailPointAt(state.replay.t);
        return p ? { floorNo: p.floorNo, x: p.x, y: vy(p.z) } : null;
      }

      function statusFill(m) {
        var st = store.judgeStatus(m);
        return { open: '#E3F5DC', closing: '#FFF3D6', closed: '#EFEFEF', rest: '#EFEFEF', unknown: '#EFEFEF' }[st];
      }
      function statusStroke(m) {
        var st = store.judgeStatus(m);
        return { open: '#52C41A', closing: '#FAAD14', closed: '#BFBFBF', rest: '#BFBFBF', unknown: '#BFBFBF' }[st];
      }
      /* 设施名称标签定位：靠近边界时自动改为贴边对齐（start/end）并上下翻转，
       * 保证标签（连同标记）始终落在建筑轮廓内，不再越出大方框。
       * fontSize: 标签字号（用户单位）；gap: 标签基线与标记中心的距离；preferAbove: 默认放在标记上方 */
      function facLabel(f, fontSize, gap, preferAbove) {
        var L = store.data.layout;
        var halfW = textEm(store.facilityShort(f) || '') * fontSize / 2;
        var x = f.x, anchor = 'middle';
        if (f.x - halfW < 0.5) { anchor = 'start'; x = Math.max(0.2, f.x - 1.7); }
        else if (f.x + halfW > L.width - 0.5) { anchor = 'end'; x = Math.min(L.width - 0.2, f.x + 1.7); }
        var above = !!preferAbove;
        if (!above && f.z - gap < 0.5) above = true;                    // 下方越界 → 翻到标记上方
        else if (above && f.z + gap > L.depth - 0.5) above = false;      // 上方越界 → 翻到下方
        return { x: x, y: vy(f.z) + (above ? -gap : gap), anchor: anchor };
      }

      /* 便民设施配色（直饮水 / 充电桩 / 休息区 / ATM）；与等距三维、真三维保持一致 */
      function amenityColor(sub) {
        return { water: '#3FA7FF', charging: '#FFB020', rest: '#36C2A6', atm: '#7C6CFF' }[sub] || '#7A8DFF';
      }

      return {
        store: store, state: state, view: view, svgRef: svgRef, hoverShop: hoverShop,
        onWheel: onWheel, down: down, move: move, up: up, reset: reset, svgClick: svgClick, zoomBy: zoomBy, vy: vy,
        floorPlan: floorPlan, regionPoly: regionPoly,
        merchantsOnFloor: merchantsOnFloor, facilitiesOnFloor: facilitiesOnFloor,
        routePolyline: routePolyline, routeMarker: routeMarker, statusFill: statusFill, statusStroke: statusStroke,
        amenityColor: amenityColor, facLabel: facLabel,
        trailPolyline: trailPolyline, replayMarker: replayMarker
      };
    },
    template: `
    <div class="plan2d" :class="{locating: state.locateMode}">
      <svg ref="svgRef" class="plan-svg" viewBox="-4 -3 104 70" preserveAspectRatio="xMidYMid meet"
           @wheel="onWheel" @pointerdown="down" @pointermove="move" @pointerup="up" @pointerleave="up"
           @click="svgClick" @dblclick="reset">
        <defs>
          <pattern id="gridPat" width="4" height="4" patternUnits="userSpaceOnUse">
            <path d="M4 0 L0 0 0 4" fill="none" stroke="#E9EFF6" stroke-width="0.15"/>
          </pattern>
          <filter id="soft"><feDropShadow dx="0" dy="0.3" stdDeviation="0.5" flood-color="#1F4E79" flood-opacity="0.18"/></filter>
        </defs>
        <g :transform="'translate('+view.tx+','+view.ty+') scale('+view.k+')'">
          <!-- 楼层平面图：管理端上传的描摹底图（仅当前楼层，图片左上角对齐图幅西北角） -->
          <image v-if="store.state.layers.plan && floorPlan()" x="0" y="0"
                 :width="store.data.layout.width" :height="store.data.layout.depth"
                 :href="floorPlan().dataUrl" :opacity="floorPlan().opacity" preserveAspectRatio="none"/>
          <!-- 底图：建筑轮廓与结构墙体（北在上） -->
          <g v-if="store.state.layers.base">
            <rect x="0" :y="vy(store.data.layout.depth)" :width="store.data.layout.width" :height="store.data.layout.depth" fill="#FFFFFF" stroke="#1F4E79" stroke-width="0.5"/>
            <rect x="0" :y="vy(store.data.layout.depth)" :width="store.data.layout.width" :height="store.data.layout.depth" fill="url(#gridPat)" opacity="0.7"/>
            <g fill="#F2F6FB">
              <rect v-for="vx in store.data.layout.vLines" :key="'v'+vx" :x="vx-store.data.layout.corridorHalf" :y="vy(store.data.layout.depth)"
                    :width="store.data.layout.corridorHalf*2" :height="store.data.layout.depth"/>
              <rect v-for="hz in store.data.layout.hLines" :key="'h'+hz" x="0" :y="vy(hz+store.data.layout.corridorHalf)"
                    :width="store.data.layout.width" :height="store.data.layout.corridorHalf*2"/>
            </g>
            <text x="1.5" :y="vy(store.data.layout.depth)+3" font-size="1.7" fill="#B7C4D4">北 ↑</text>
          </g>

          <!-- 店铺图层 -->
          <g v-if="store.state.layers.shop">
            <g v-for="m in merchantsOnFloor()" :key="m.id" @pointerenter="hoverShop=m.id" @pointerleave="hoverShop=null">
              <!-- 管理端绘制过区域的商户：按多边形显示；否则按铺位矩形 -->
              <polygon v-if="m.region && m.region.length>=3" :points="regionPoly(m.region)" :fill="statusFill(m)" :stroke="statusStroke(m)"
                    stroke-width="0.22" stroke-linejoin="round"
                    :class="{sel: store.state.selectedId===m.id && store.state.selectedKind==='merchant', hovered: hoverShop===m.id}"
                    :opacity="store.judgeStatus(m)==='closed'||store.judgeStatus(m)==='rest' ? 0.75 : 1"/>
              <rect v-else :x="m.rect.x" :y="vy(m.rect.z + m.d)" :width="m.w" :height="m.d" :fill="statusFill(m)" :stroke="statusStroke(m)"
                    stroke-width="0.22" rx="0.4"
                    :class="{sel: store.state.selectedId===m.id && store.state.selectedKind==='merchant', hovered: hoverShop===m.id}"
                    :opacity="store.judgeStatus(m)==='closed'||store.judgeStatus(m)==='rest' ? 0.75 : 1"/>
              <text :x="m.x" :y="vy(m.z) - 0.3" text-anchor="middle" :font-size="m._fs" fill="#23324D"
                    style="pointer-events:none;user-select:none">{{ m._label }}</text>
              <text :x="m.x" :y="vy(m.z) + m._fs + 0.3" text-anchor="middle" :font-size="m._pfs" fill="#7A8CA6"
                    style="pointer-events:none;user-select:none">{{ m._plabel }}</text>
              <circle :cx="m.door.x" :cy="vy(m.door.z)" r="0.35" fill="#1F4E79" opacity="0.5"/>
            </g>
          </g>

          <!-- 电梯 / 扶梯图层 -->
          <g v-if="store.state.layers.transport">
            <g v-for="f in facilitiesOnFloor().filter(f=>f.type==='elevator'||f.type==='escalator')" :key="f.id">
              <rect :x="f.x-1.45" :y="vy(f.z+1.45)" width="2.9" height="2.9" rx="0.4"
                    :fill="f.type==='elevator'?'#FFF1DC':'#DCF5F3'" :stroke="f.type==='elevator'?'#F2A33C':'#2EA8A0'" stroke-width="0.25"/>
              <text :x="f.x" :y="vy(f.z)" text-anchor="middle" dominant-baseline="central" font-size="1.45" style="pointer-events:none">{{ f.type==='elevator'?'⇅':'⇱' }}</text>
              <text v-if="store.state.layers.label" :x="facLabel(f,1.28,2.9,false).x" :y="facLabel(f,1.28,2.5,true).y"
                    :text-anchor="facLabel(f,1.28,2.5,true).anchor" font-size="1.28" fill="#8A6A3A" style="pointer-events:none">{{ store.facilityShort(f) }}</text>
            </g>
          </g>

          <!-- 公共设施图层 -->
          <g v-if="store.state.layers.facility">
            <g v-for="f in facilitiesOnFloor().filter(f=>['wc','service','entrance'].indexOf(f.type)>=0)" :key="f.id"
               @click.stop="store.select({kind:'facility', id:f.id})">
              <circle :cx="f.x" :cy="vy(f.z)" r="1.32" fill="#FFFFFF" :stroke="f.type==='service'?'#9B5DE5':(f.type==='entrance'?'#4CAF7D':'#7A8DFF')" stroke-width="0.25"/>
              <text :x="f.x" :y="vy(f.z)" text-anchor="middle" dominant-baseline="central" font-size="1.35" style="pointer-events:none">{{ store.facilityIcon(f) }}</text>
              <text v-if="store.state.layers.label" :x="facLabel(f,1.28,2.9,false).x" :y="facLabel(f,1.28,2.7,false).y"
                    :text-anchor="facLabel(f,1.28,2.7,false).anchor" font-size="1.28" fill="#5A6B85" style="pointer-events:none">{{ store.facilityShort(f) }}</text>
            </g>
          </g>

          <!-- 便民设施图层（直饮水 / 充电桩 / 休息区 / ATM） -->
          <g v-if="store.state.layers.facility">
            <g v-for="f in facilitiesOnFloor().filter(f=>f.type==='amenity')" :key="f.id"
               @click.stop="store.select({kind:'facility', id:f.id})">
              <rect :x="f.x-1.42" :y="vy(f.z+1.42)" width="2.84" height="2.84" rx="0.5"
                    :fill="amenityColor(f.subtype)" fill-opacity="0.16" :stroke="amenityColor(f.subtype)" stroke-width="0.3"/>
              <text :x="f.x" :y="vy(f.z)" text-anchor="middle" dominant-baseline="central" font-size="1.35" style="pointer-events:none">{{ store.facilityIcon(f) }}</text>
              <text v-if="store.state.layers.label" :x="facLabel(f,1.28,2.9,false).x" :y="facLabel(f,1.28,2.8,false).y"
                    :text-anchor="facLabel(f,1.28,2.8,false).anchor" font-size="1.28" :fill="amenityColor(f.subtype)" style="pointer-events:none">{{ store.facilityShort(f) }}</text>
            </g>
          </g>

          <!-- 路径线图层 -->
          <g v-if="store.state.layers.route && state.route">
            <polyline v-for="f in store.data.floors" :key="'p'+f.no" :points="routePolyline(f.no)" fill="none"
                      stroke="#1890FF" stroke-width="0.55" stroke-linejoin="round" stroke-linecap="round"
                      stroke-dasharray="1.6 0.9" :opacity="f.no===state.currentFloor?0.95:0.22"/>
          </g>

          <!-- 用户位置图层 -->
          <g v-if="store.state.layers.user && store.state.userPos && store.state.userPos.floorNo===state.currentFloor">
            <circle :cx="store.state.userPos.x" :cy="vy(store.state.userPos.z)" r="2.6" fill="#FF4D4F" opacity="0.16">
              <animate attributeName="r" values="1.6;3.4;1.6" dur="1.8s" repeatCount="indefinite"/>
            </circle>
            <circle :cx="store.state.userPos.x" :cy="vy(store.state.userPos.z)" r="1.2" fill="#FF4D4F" stroke="#fff" stroke-width="0.3"/>
            <text :x="store.state.userPos.x" :y="vy(store.state.userPos.z)-2.2" text-anchor="middle" font-size="1.6" fill="#FF4D4F">我的位置</text>
          </g>

          <!-- 历史轨迹图层 -->
          <g v-if="state.layers.route && state.trail.length > 1">
            <polyline v-for="(seg,i) in trailPolyline()" :key="'t'+i" :points="seg" fill="none"
                      stroke="#7A8DFF" stroke-width="0.35" stroke-linejoin="round" stroke-linecap="round"
                      stroke-dasharray="0.9 0.7" opacity="0.85"/>
          </g>

          <!-- 路径动画当前点 -->
          <g v-if="state.route && routeMarker() && routeMarker().floorNo===state.currentFloor">
            <circle :cx="routeMarker().x" :cy="routeMarker().y" r="1.3" fill="#FF4D4F" stroke="#fff" stroke-width="0.3"/>
          </g>

          <!-- 轨迹回放当前点 -->
          <g v-if="replayMarker() && replayMarker().floorNo===state.currentFloor">
            <circle :cx="replayMarker().x" :cy="replayMarker().y" r="3" fill="#7A8DFF" opacity="0.18"/>
            <circle :cx="replayMarker().x" :cy="replayMarker().y" r="1.15" fill="#7A8DFF" stroke="#fff" stroke-width="0.3"/>
          </g>
        </g>
      </svg>

      <div class="plan-hint" v-if="state.locateMode">
        <span>📍 定位模式：在地图上点击你的位置</span>
        <span class="ph-sub">{{ store.floorsOf(state.currentFloor).label }} · 可用顶部楼层切换</span>
        <button class="ph-cancel" @click="store.cancelLocatePick()">取消 (Esc)</button>
      </div>
      <div class="plan-tools">
        <button class="mini-btn" @click="zoomBy(1.3)">＋</button>
        <button class="mini-btn" @click="zoomBy(0.77)">－</button>
        <button class="mini-btn wide" @click="reset">复位（双击图面）</button>
      </div>
    </div>`
  };

  U.Plan2D = Plan2D;
})(window);
