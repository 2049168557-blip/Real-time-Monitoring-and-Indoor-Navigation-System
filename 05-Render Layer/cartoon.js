/* =========================================================
 * 三维可视化：Three.js 立体框架图 + CatmullRom 路径动画
 * 依据《需求规格说明书》附录 C：
 *   半透明楼层框线（透明度 0.15-0.3）、店铺色块按营业状态着色、
 *   Raycaster 点击拾取、路径 0x1890FF、当前位置红色球体 + 脉冲动画
 * ========================================================= */
(function (global) {
  'use strict';

  var COLOR = {
    open: 0x52C41A,        // 营业中
    closing: 0xFAAD14,     // 即将打烊
    closed: 0xBFBFBF,      // 已打烊 / 休息中
    unknown: 0x8C8C8C,
    selected: 0x1F4E79,
    route: 0x1890FF,
    user: 0xFF4D4F,
    slab: 0xDCE6F2,
    line: 0x1F4E79,
    corridor: 0xF2F6FB
  };

  function create(container, data, opts) {
    opts = opts || {};
    var THREE = global.THREE;
    if (!THREE || !container) throw new Error('Three.js 未加载');

    var W = data.layout.width, D = data.layout.depth, FH = data.layout.floorHeight;
    var CENTER = new THREE.Vector3(W / 2, FH * 0.9, D / 2);

    var BG = [247, 249, 252];
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    renderer.setClearColor(0xF7F9FC, 1);
    container.appendChild(renderer.domElement);

    /* 画面自检：部分浏览器（如未开启硬件加速的 Edge）能创建 WebGL 上下文却画不出内容，
       这里回读若干像素，若全部为背景色则判定三维画面未真正渲染，由上层降级为等距视图 */
    function probeBlank() {
      try {
        var gl = renderer.getContext();
        if (!gl || gl.isContextLost && gl.isContextLost()) return true;
        var w = renderer.domElement.width, h = renderer.domElement.height;
        if (!w || !h) return true;
        var buf = new Uint8Array(4), hits = 0;
        for (var i = 1; i <= 6; i++) {
          for (var j = 1; j <= 6; j++) {
            var x = Math.floor(w * i / 7), y = Math.floor(h * j / 7);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            if (Math.abs(buf[0] - BG[0]) > 6 || Math.abs(buf[1] - BG[1]) > 6 || Math.abs(buf[2] - BG[2]) > 6) hits++;
          }
        }
        return hits === 0;
      } catch (e) { return false; }
    }

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF7F9FC);
    scene.fog = new THREE.Fog(0xF7F9FC, 220, 420);

    var camera = new THREE.PerspectiveCamera(45, (container.clientWidth || 800) / (container.clientHeight || 600), 0.5, 1200);

    /* ---------- 灯光：环境光打底 + 平行光营造体积感 ---------- */
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    var dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(60, 120, 80);
    scene.add(dir);
    var dir2 = new THREE.DirectionalLight(0xbfd4ea, 0.28);
    dir2.position.set(-70, 60, -60);
    scene.add(dir2);

    /* 地面参考网格 */
    var grid = new THREE.GridHelper(240, 24, 0xD6DFEA, 0xE7EDF5);
    grid.position.set(W / 2, -FH - 0.6, D / 2);
    scene.add(grid);

    /* ---------- 自定义轨道控制器 ---------- */
    var ctrl = {
      theta: Math.PI * 0.85, phi: Math.PI * 0.26, radius: 168,
      tTheta: Math.PI * 0.85, tPhi: Math.PI * 0.26, tRadius: 168,
      target: CENTER.clone(), tTarget: CENTER.clone(),
      autoRotate: false, enabled: true
    };
    var drag = null;
    var el = renderer.domElement;
    el.style.display = 'block';
    el.style.touchAction = 'none';

    function pointerDown(e) {
      if (!ctrl.enabled) return;
      drag = { x: e.clientX, y: e.clientY, button: e.button, moved: 0 };
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    }
    function pointerMove(e) {
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.button === 2 || drag.shiftKey) {
          var s = ctrl.radius * 0.0016;
          ctrl.tTarget.x -= dx * s * Math.sin(ctrl.theta) * -1;
          ctrl.tTarget.z -= dx * s * Math.cos(ctrl.theta);
          ctrl.tTarget.y += dy * s;
        } else {
          ctrl.tTheta -= dx * 0.006;
          ctrl.tPhi = Math.max(0.12, Math.min(Math.PI * 0.49, ctrl.tPhi - dy * 0.005));
        }
        drag.x = e.clientX; drag.y = e.clientY;
      } else {
        hoverTest(e);
      }
    }
    function pointerUp(e) {
      if (drag && drag.moved < 6) clickTest(e);
      drag = null;
    }
    el.addEventListener('pointerdown', pointerDown);
    el.addEventListener('pointermove', pointerMove);
    el.addEventListener('pointerup', pointerUp);
    el.addEventListener('pointerleave', function () { drag = null; clearHover(); });
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      ctrl.tRadius = Math.max(35, Math.min(320, ctrl.tRadius * (1 + (e.deltaY > 0 ? 0.12 : -0.12))));
    }, { passive: false });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    function updateCamera(dt) {
      if (ctrl.autoRotate) ctrl.tTheta += dt * 0.12;
      var k = 0.18;
      ctrl.theta += (ctrl.tTheta - ctrl.theta) * k;
      ctrl.phi += (ctrl.tPhi - ctrl.phi) * k;
      ctrl.radius += (ctrl.tRadius - ctrl.radius) * k;
      ctrl.target.lerp(ctrl.tTarget, k);
      var r = ctrl.radius;
      camera.position.set(
        ctrl.target.x + r * Math.cos(ctrl.phi) * Math.sin(ctrl.theta),
        ctrl.target.y + r * Math.sin(ctrl.phi),
        ctrl.target.z + r * Math.cos(ctrl.phi) * Math.cos(ctrl.theta)
      );
      camera.lookAt(ctrl.target);
    }

    /* ---------- 标签精灵 ---------- */
    function makeLabel(text, opts2) {
      opts2 = opts2 || {};
      var fs = opts2.fontSize || 34;
      var padX = 18, padY = 10;
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      ctx.font = '600 ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
      var tw = Math.ceil(ctx.measureText(text).width);
      canvas.width = Math.min(1024, tw + padX * 2);
      canvas.height = fs + padY * 2;
      var c2 = canvas.getContext('2d');
      c2.clearRect(0, 0, canvas.width, canvas.height);
      if (opts2.bg) {
        c2.fillStyle = opts2.bg;
        roundRect(c2, 0, 0, canvas.width, canvas.height, 12);
        c2.fill();
      }
      c2.font = '600 ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
      c2.fillStyle = opts2.color || '#1F4E79';
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
      var tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: opts2.depthTest !== false });
      var sprite = new THREE.Sprite(mat);
      var scale = opts2.scale || 0.055;
      sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
      return sprite;
    }
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    /* ---------- 楼层组 ---------- */
    var floorGroups = {}, shopMeshes = [], pickables = [], facilityMeshes = [];
    var shopIndex = {};     // merchantId -> {mesh, label, baseY}

    function floorY(no) { return global.MallData.floorBaseY(no); }

    /* 楼层展开（分解视图）：拉大层间距，使各层框架与店铺互不遮挡 */
    var explodeK = 1.45;
    var lastUserPos = null;
    function dispY(no) { return floorY(no) * explodeK; }
    function applyExplode() {
      data.floors.forEach(function (fl) {
        floorGroups[fl.no].position.y = floorY(fl.no) * (explodeK - 1);
      });
      if (routeState) drawRoute(routeState.route);
      if (lastUserPos) positionUser(lastUserPos);
    }

    /* 剖面 / 分解动画：展开(1.45) 与 合并(1.0) 之间做 ~0.6s 缓动过渡（论文 3.4 模型切割/分层展示） */
    var explodeTarget = explodeK, explodeRAF = null;
    function animateExplode(target) {
      explodeTarget = target;
      if (explodeRAF) cancelAnimationFrame(explodeRAF);
      var start = explodeK, t0 = performance.now(), dur = 620;
      function frame(now) {
        var p = Math.min(1, (now - t0) / dur);
        var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
        explodeK = start + (explodeTarget - start) * e;
        applyExplode();
        if (p < 1) { explodeRAF = requestAnimationFrame(frame); }
        else { explodeK = explodeTarget; applyExplode(); explodeRAF = null; }
      }
      explodeRAF = requestAnimationFrame(frame);
    }

    function buildSlab(g, no) {
      var y = floorY(no);
      var mat = new THREE.MeshStandardMaterial({
        color: COLOR.slab, transparent: true, opacity: 0.26,
        roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide
      });
      var slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.32, D), mat);
      slab.position.set(W / 2, y - 0.16, D / 2);
      g.add(slab);

      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.32, D)),
        new THREE.LineBasicMaterial({ color: COLOR.line, transparent: true, opacity: 0.55 })
      );
      edges.position.copy(slab.position);
      g.add(edges);

      // 楼层 framework 立柱
      var postMat = new THREE.LineBasicMaterial({ color: COLOR.line, transparent: true, opacity: 0.35 });
      [[0, 0], [W, 0], [0, D], [W, D]].forEach(function (p) {
        var geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(p[0], y, p[1]),
          new THREE.Vector3(p[0], y + FH, p[1])
        ]);
        g.add(new THREE.Line(geo, postMat));
      });

      // 楼层名称标签常显，便于识别层次
      var flDef = null;
      data.floors.forEach(function (f) { if (f.no === no) flDef = f; });
      var lb = makeLabel(flDef ? flDef.name : String(no), { bg: 'rgba(31,78,121,0.92)', color: '#FFFFFF', scale: 0.088 });
      lb.position.set(-6, y + FH * 0.5, D / 2);
      lb.userData.isFloorLabel = true;
      g.add(lb);
    }

    function buildCorridors(g, no) {
      var y = floorY(no) + 0.03;
      var mat = new THREE.MeshBasicMaterial({ color: COLOR.corridor, transparent: true, opacity: 0.85 });
      var L = data.layout;
      L.vLines.forEach(function (vx) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(L.corridorHalf * 2, 0.02, D), mat);
        m.position.set(vx, y, D / 2);
        g.add(m);
      });
      L.hLines.forEach(function (hz) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, L.corridorHalf * 2), mat);
        m.position.set(W / 2, y, hz);
        g.add(m);
      });
    }

    function buildShops(g, no) {
      data.merchants.forEach(function (m) {
        if (m.floorNo !== no) return;
        var y = floorY(no);
        var h = 2.3;
        var grp = new THREE.Group();
        grp.position.set(m.x, y, m.z);

        var mat = new THREE.MeshStandardMaterial({
          color: COLOR.open, roughness: 0.62, metalness: 0.05,
          transparent: true, opacity: 0.92
        });
        var box = new THREE.Mesh(new THREE.BoxGeometry(m.w * 0.94, h, m.d * 0.94), mat);
        box.position.y = h / 2;
        box.userData = { merchantId: m.id, kind: 'shop' };
        grp.add(box);

        var edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(m.w * 0.94, h, m.d * 0.94)),
          new THREE.LineBasicMaterial({ color: 0x2B3E56, transparent: true, opacity: 0.22 })
        );
        edge.position.y = h / 2;
        grp.add(edge);

        // 门址标记（面向走廊一侧的入口）
        var doorMat = new THREE.MeshBasicMaterial({ color: 0x1F4E79, transparent: true, opacity: 0.55 });
        var door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 1.6), doorMat);
        var dx = m.door.x - m.x, dz = m.door.z - m.z;
        door.position.set(dx * 0.82, 0.06, dz * 0.82);
        grp.add(door);

        var label = makeLabel(m.name, { bg: 'rgba(255,255,255,0.9)', color: '#23324D', scale: 0.051 });
        label.position.set(0, h + 1.0, 0);
        grp.add(label);

        g.add(grp);
        shopMeshes.push(box);
        pickables.push(box);
        shopIndex[m.id] = { mesh: box, label: label, group: grp, floorNo: no, merchant: m };
      });
    }

    var FACILITY_STYLE = {
      elevator: { color: 0xF2A33C, h: 2.6 },
      escalator: { color: 0x2EA8A0, h: 1.6 },
      wc: { color: 0x7A8DFF, h: 1.2 },
      service: { color: 0x9B5DE5, h: 1.2 },
      entrance: { color: 0x4CAF7D, h: 1.0 }
    };
    var AMENITY_STYLE = {
      water: { color: 0x3FA7FF, h: 1.0 },
      charging: { color: 0xFFB020, h: 1.0 },
      rest: { color: 0x36C2A6, h: 1.0 },
      atm: { color: 0x7C6CFF, h: 1.0 }
    };
    var FACILITY_ICON = { male: '♂', female: '♀', baby: '🍼', accessible: '♿', water: '水', charging: '电', rest: '休', atm: '¥' };

    function buildFacilities(g, no) {
      data.facilities.forEach(function (f) {
        if (f.floorNo !== no) return;
        var st = f.type === 'amenity'
          ? (AMENITY_STYLE[f.subtype] || { color: 0x7A8DFF, h: 1.0 })
          : (FACILITY_STYLE[f.type] || FACILITY_STYLE.service);
        var y = floorY(no);
        var geo, mesh;
        if (f.type === 'service' || f.type === 'wc') {
          geo = new THREE.CylinderGeometry(0.9, 0.9, st.h, 14);
        } else if (f.type === 'escalator') {
          geo = new THREE.BoxGeometry(2.6, st.h, 5.4);
        } else if (f.type === 'entrance') {
          geo = new THREE.TorusGeometry(1.2, 0.32, 8, 18);
        } else {
          geo = new THREE.BoxGeometry(2.4, st.h, 2.4);
        }
        var mat = new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.5, emissive: st.color, emissiveIntensity: 0.22 });
        mesh = new THREE.Mesh(geo, mat);
        var yy = y + st.h / 2 + (f.type === 'entrance' ? 1.1 : 0);
        if (f.type === 'entrance') mesh.rotation.x = Math.PI / 2;
        mesh.position.set(f.x, yy, f.z);
        mesh.userData = { facilityId: f.id, kind: 'facility', floorNo: no };
        g.add(mesh);
        pickables.push(mesh);
        facilityMeshes.push(mesh);

        if (f.type === 'wc' || true) {
          var label = makeLabel(FACILITY_ICON[f.subtype] ? FACILITY_ICON[f.subtype] + ' ' + f.name : f.name,
            { bg: 'rgba(255,255,255,0.9)', color: '#33445C', scale: 0.053 });
          label.position.set(f.x, yy + 1.6, f.z);
          label.visible = false;
          g.add(label);
          mesh.userData.labelSprite = label;
        }
      });
    }

    data.floors.forEach(function (fl) {
      var g = new THREE.Group();
      g.name = 'floor_' + fl.no;
      buildSlab(g, fl.no);
      buildCorridors(g, fl.no);
      buildShops(g, fl.no);
      buildFacilities(g, fl.no);
      scene.add(g);
      floorGroups[fl.no] = g;
    });
    applyExplode();

    /* ---------- 用户当前位置（红色脉冲球） ---------- */
    var userGroup = new THREE.Group();
    var userSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 20, 20),
      new THREE.MeshStandardMaterial({ color: COLOR.user, emissive: COLOR.user, emissiveIntensity: 0.5 })
    );
    userGroup.add(userSphere);
    var ringGeo = new THREE.RingGeometry(1.4, 2.0, 28);
    var ringMat = new THREE.MeshBasicMaterial({ color: COLOR.user, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    var userRing = new THREE.Mesh(ringGeo, ringMat);
    userRing.rotation.x = -Math.PI / 2;
    userGroup.add(userRing);
    var userLabel = makeLabel('我的位置', { bg: 'rgba(255,77,79,0.92)', color: '#fff', scale: 0.058 });
    userLabel.position.y = 3.2;
    userGroup.add(userLabel);
    userGroup.visible = false;
    scene.add(userGroup);

    /* ---------- 路径 ---------- */
    var routeGroup = new THREE.Group();
    scene.add(routeGroup);
    var routeState = null;

    function clearRoute() {
      while (routeGroup.children.length) {
        var c = routeGroup.children.pop();
        if (c.geometry) c.geometry.dispose();
        if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
      }
      routeState = null;
    }

    function routePoints(route) {
      var pts = [];
      route.segments.forEach(function (s) {
        s.points.forEach(function (p) {
          pts.push(new THREE.Vector3(p.x, dispY(s.floorNo) + 0.35, p.z));
        });
      });
      return pts;
    }

    function drawRoute(route) {
      clearRoute();
      var pts = routePoints(route);
      if (pts.length < 2) return null;
      var curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25);
      var tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.min(600, pts.length * 12), 0.34, 8, false),
        new THREE.MeshStandardMaterial({ color: COLOR.route, emissive: COLOR.route, emissiveIntensity: 0.45, roughness: 0.4 })
      );
      routeGroup.add(tube);

      // 起点 / 终点
      [0, 1].forEach(function (t) {
        var p = curve.getPointAt(t);
        var m = new THREE.Mesh(
          new THREE.SphereGeometry(0.9, 18, 18),
          new THREE.MeshBasicMaterial({ color: t === 0 ? 0x52C41A : 0xFF4D4F })
        );
        m.position.copy(p);
        routeGroup.add(m);
      });

      var marker = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 22, 22),
        new THREE.MeshStandardMaterial({ color: COLOR.user, emissive: COLOR.user, emissiveIntensity: 0.6 })
      );
      var halo = new THREE.Mesh(
        new THREE.SphereGeometry(2.0, 18, 18),
        new THREE.MeshBasicMaterial({ color: COLOR.user, transparent: true, opacity: 0.18 })
      );
      marker.add(halo);
      routeGroup.add(marker);

      routeState = {
        curve: curve, marker: marker, playing: false, paused: false,
        t: 0, speed: 1, route: route, follow: false, done: false
      };
      return routeState;
    }

    /* ---------- 移动轨迹（FR-05-02 轨迹回放，可选功能） ---------- */
    var trailGroup = new THREE.Group();
    scene.add(trailGroup);
    var trailMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0x7A8DFF, emissive: 0x7A8DFF, emissiveIntensity: 0.45 })
    );
    trailMarker.visible = false;
    scene.add(trailMarker);

    function clearTrail() {
      while (trailGroup.children.length) {
        var c = trailGroup.children.pop();
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
      trailMarker.visible = false;
    }

    /* 按楼层分段绘制历史轨迹，跨楼层处断开 */
    function drawTrail(points) {
      clearTrail();
      if (!points || points.length < 2) return;
      var cur = [];
      var flush = function () {
        if (cur.length < 2) { cur = []; return; }
        var geo = new THREE.BufferGeometry().setFromPoints(cur.map(function (p) {
          return new THREE.Vector3(p.x, dispY(p.floorNo) + 0.6, p.z);
        }));
        var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7A8DFF, transparent: true, opacity: 0.9 }));
        line.renderOrder = 3;
        trailGroup.add(line);
        cur = [];
      };
      points.forEach(function (p, i) {
        var prev = points[i - 1];
        if (prev && prev.floorNo !== p.floorNo) { cur.push(p); flush(); cur = [p]; return; }
        cur.push(p);
      });
      flush();
    }

    function setTrailMarker(pos) {
      if (!pos) { trailMarker.visible = false; return; }
      trailMarker.visible = true;
      trailMarker.position.set(pos.x, dispY(pos.floorNo) + 1.1, pos.z);
    }

    /* ---------- 选择与悬停 ---------- */
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var hovered = null;
    var callbacks = { select: null, hover: null, arrive: null, frame: null };

    function ndc(e) {
      var rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      return mouse;
    }
    // Three.js 的 Raycaster 只判断对象自身的 visible，不判断父级分组是否隐藏。
    // “只看当前楼层”时非聚焦楼层是把整组 floorGroups[no].visible 置为 false 的，
    // 组内网格自身的 visible 仍为 true，于是会被误拾取（表现为：只看 B1 时鼠标上移
    // 却弹出 1F/2F/3F 店铺的提示框）。这里沿父链回溯，只要任一级不可见即跳过。
    function isVisibleChain(obj) {
      var o = obj;
      while (o) {
        if (o.visible === false) return false;
        o = o.parent;
      }
      return true;
    }
    function hitTest(e) {
      raycaster.setFromCamera(ndc(e), camera);
      var list = raycaster.intersectObjects(pickables, false);
      for (var i = 0; i < list.length; i++) {
        if (isVisibleChain(list[i].object)) return list[i].object;
      }
      return null;
    }
    function hoverTest(e) {
      var obj = hitTest(e);
      if (obj !== hovered) {
        if (hovered && callbacks.hover) callbacks.hover(null, null);
        hovered = obj;
        el.style.cursor = obj ? 'pointer' : 'grab';
        if (obj && callbacks.hover) {
          var info = describe(obj, e);
          callbacks.hover(info, { x: e.clientX, y: e.clientY });
        }
      } else if (obj && callbacks.hover) {
        callbacks.hover(describe(obj, e), { x: e.clientX, y: e.clientY });
      }
    }
    function clearHover() {
      if (hovered && callbacks.hover) callbacks.hover(null, null);
      hovered = null;
    }
    /* 交给上层的拾取结果。kind 必须用 store 的契约（merchant / facility）：
     * 早期此处返回 'shop'，导致三维点击店铺后 store.selectedKind='shop'，
     * 左栏详情卡（判断 selectedKind==='merchant'）与场景高亮均无法识别，
     * 表现为"三维里点击店铺左栏不显示商家，而等距三维/二维正常"。 */
    function describe(obj) {
      if (obj.userData.kind === 'shop') return { kind: 'merchant', id: obj.userData.merchantId };
      return { kind: 'facility', id: obj.userData.facilityId };
    }
    function clickTest(e) {
      var obj = hitTest(e);
      if (!obj) return;
      callbacks.select && callbacks.select(describe(obj));
    }

    /* ---------- 状态渲染 ---------- */
    var statusMap = {};      // merchantId -> 'open'|'closing'|'closed'
    var selectedId = null;

    function setStatus(map) { statusMap = map || {}; }
    function setSelected(id) { selectedId = id; }
    function statusColor(v) {
      return v === 'open' ? COLOR.open : (v === 'closing' ? COLOR.closing : COLOR.closed);
    }

    function applyStatus() {
      Object.keys(shopIndex).forEach(function (id) {
        var it = shopIndex[id];
        var st = statusMap[id] || 'unknown';
        var target = statusColor(st);
        if (!it._color) it._color = new THREE.Color(target);
        it._color.setHex(target);
        var isSel = String(selectedId) === String(id);
        var active = (focusFloor === null) || (it.floorNo === focusFloor);
        it.mesh.material.color.lerp(it._color, 0.3);
        it.mesh.material.emissive.setHex(isSel ? COLOR.selected : 0x000000);
        it.mesh.material.emissiveIntensity = isSel ? 0.45 : 0;
        // 非聚焦楼层的店铺半透明压暗，形成“楼层剖分”的层次，同时保留框架可读性
        it.mesh.material.opacity = isSel ? 1 : (active ? (st === 'closed' ? 0.6 : 0.9) : 0.14);
        it.label.material.opacity = st === 'closed' ? 0.6 : 1;
      });
    }

    /* ---------- 标签避让（屏幕空间贪心排布） ----------
     * 需求：正面视角下 72 个 Sprite 标签互相压盖。做法与 2D 标签一致——
     * 每帧把标签投影到屏幕，按优先级排序后贪心放置，与已放置标签相交的就隐藏。
     * 优先级：选中 > 悬停 > 当前楼层 > 离相机近（视觉上更重要）。
     * 关键点：Sprite 的屏幕尺寸 = 世界尺寸 × (viewportH / (2·tan(fov/2))) / 相机距离，
     * 不按这个算就会用错尺度导致"该藏的没藏"。 */
    var labelMode = 'declutter';   // declutter | all | selected | off
    var PAD0 = 2;                  // 标签间最小间隙（px）
    var _lp = new THREE.Vector3();
    var _ls = new THREE.Vector3();

    function labelScreenRect(sprite) {
      sprite.getWorldPosition(_lp);
      _lp.project(camera);
      if (_lp.z > 1) return null;                      // 相机背后
      var dist = camera.position.distanceTo(sprite.getWorldPosition(_ls));
      if (dist < 0.001) return null;
      var vh = renderer.domElement.clientHeight || 600;
      var k = vh / (2 * Math.tan(camera.fov * Math.PI / 360));
      var w = sprite.scale.x * k / dist, h = sprite.scale.y * k / dist;
      return {
        x: (_lp.x * 0.5 + 0.5) * (renderer.domElement.clientWidth || 800) - w / 2,
        y: (-_lp.y * 0.5 + 0.5) * vh - h / 2,
        w: w, h: h
      };
    }

    function declutterLabels() {
      var ids = Object.keys(shopIndex);
      var cand = [];
      ids.forEach(function (id) {
        var it = shopIndex[id];
        var isSel = String(selectedId) === String(id);
        var isHov = hovered && String(hovered.userData.merchantId) === String(id);
        var active = (focusFloor === null) || (it.floorNo === focusFloor);
        // 基础可见性（沿用 applyStatus 的规则）
        it._wantVisible = isSel || active;
        it._force = isSel || isHov;                     // 选中/悬停永不隐藏
        if (!it._wantVisible) { it.label.visible = false; return; }
        if (labelMode === 'off') { it.label.visible = isSel || isHov; return; }
        if (labelMode === 'selected') { it.label.visible = isSel || isHov; return; }
        if (labelMode === 'all') { it.label.visible = true; return; }   // 明确要求"全显"，不避让
        // declutter：进入排序队列
        var r = labelScreenRect(it.label);
        if (!r) { it.label.visible = false; return; }
        cand.push({ id: id, it: it, r: r, force: isSel || isHov,
                    prio: (isSel ? 0 : (isHov ? 1 : 2)) * 1e6 + (active ? 0 : 5e5) });
      });
      if (labelMode !== 'declutter') {
        // 其它模式：设施标签按模式处理；selected 模式下设施名之间仍需避让
        if (labelMode === 'off') {
          facilityMeshes.forEach(function (fm) { if (fm.userData.labelSprite) fm.userData.labelSprite.visible = false; });
          return;
        }
        if (labelMode === 'all') {
          facilityMeshes.forEach(function (fm) {
            var lb = fm.userData.labelSprite;
            if (!lb) return;
            lb.visible = (focusFloor === null) || (fm.userData.floorNo === focusFloor);
          });
          return;
        }
        // selected：设施标签走简化避让
        var fPlaced = [];
        var fCand = [];
        facilityMeshes.forEach(function (fm) {
          var lb = fm.userData.labelSprite;
          if (!lb) return;
          var act = (focusFloor === null) || (fm.userData.floorNo === focusFloor);
          if (!act) { lb.visible = false; return; }
          var r = labelScreenRect(lb);
          if (!r) { lb.visible = false; return; }
          lb.getWorldPosition(_ls);
          fCand.push({ lb: lb, r: r, d: camera.position.distanceTo(_ls) });
        });
        fCand.sort(function (x, y) { return x.d - y.d; });
        fCand.forEach(function (c) {
          var hit = false;
          for (var i = 0; i < fPlaced.length; i++) {
            var p = fPlaced[i], r = c.r;
            if (Math.min(p.x + p.w + PAD0, r.x + r.w + PAD0) - Math.max(p.x - PAD0, r.x - PAD0) > 0 &&
                Math.min(p.y + p.h + PAD0, r.y + r.h + PAD0) - Math.max(p.y - PAD0, r.y - PAD0) > 0) { hit = true; break; }
          }
          if (hit) c.lb.visible = false; else { c.lb.visible = true; fPlaced.push(c.r); }
        });
        return;
      }

      // 相机越近的块视觉上越大 → 越重要（同优先级内用距离再排）
      cand.forEach(function (c) {
        c.it.label.getWorldPosition(_ls);
        c.prio += camera.position.distanceTo(_ls) * 10;
      });
      cand.sort(function (a, b) { return a.prio - b.prio; });

      // 设施标签并入同一队列：设施优先级略低于店铺（店铺名更重要）
      if (labelMode === 'declutter') {
        facilityMeshes.forEach(function (fm) {
          var lb = fm.userData.labelSprite;
          if (!lb) return;
          var act = (focusFloor === null) || (fm.userData.floorNo === focusFloor);
          if (!act) { lb.visible = false; return; }
          var r = labelScreenRect(lb);
          if (!r) { lb.visible = false; return; }
          lb.getWorldPosition(_ls);
          cand.push({ it: { label: lb }, r: r, force: false, prio: 3e6 + camera.position.distanceTo(_ls) * 10 });
        });
        cand.sort(function (a2, b2) { return a2.prio - b2.prio; });
      }

      var placed = [];
      var PAD = PAD0;
      cand.forEach(function (c) {
        if (c.force) { c.it.label.visible = true; placed.push(c.r); return; }
        var hit = false;
        for (var i = 0; i < placed.length; i++) {
          var p = placed[i], r = c.r;
          var ovX = Math.min(p.x + p.w + PAD, r.x + r.w + PAD) - Math.max(p.x - PAD, r.x - PAD);
          var ovY = Math.min(p.y + p.h + PAD, r.y + r.h + PAD) - Math.max(p.y - PAD, r.y - PAD);
          if (ovX > 0 && ovY > 0) { hit = true; break; }
        }
        if (hit) c.it.label.visible = false;
        else { c.it.label.visible = true; placed.push(c.r); }
      });
    }

    /* ---------- 楼层聚焦 ---------- */
    var focusFloor = null, soloMode = false, overviewMode = false;

    function setFloorFocus(no, solo) {
      focusFloor = no; soloMode = !!solo;
      data.floors.forEach(function (fl) {
        var g = floorGroups[fl.no];
        var active = focusFloor === null || fl.no === focusFloor;
        g.visible = soloMode ? active : true;
      });
      // 垂直交通等设施：非聚焦楼层半透明，保留立体框架的层次感
      facilityMeshes.forEach(function (fm) {
        var act = (focusFloor === null) || (fm.userData.floorNo === focusFloor);
        fm.material.transparent = !act;
        fm.material.opacity = act ? 1 : 0.22;
      });
      // 只看当前楼层时隐藏地面参考网格（避免被误认为是其他楼层的板面）
      grid.visible = !soloMode;
      // 独层模式下若用户定位在其他楼层，则隐藏其标记
      if (soloMode && lastUserPos && lastUserPos.floorNo !== focusFloor) userGroup.visible = false;
      else if (lastUserPos) userGroup.visible = true;
    }

    /* ---------- 用户位置 ---------- */
    function positionUser(pos) {
      userGroup.position.set(pos.x, dispY(pos.floorNo) + 1.2, pos.z);
    }
    function setUserPosition(pos) {
      if (!pos) { userGroup.visible = false; lastUserPos = null; return; }
      lastUserPos = pos;
      userGroup.visible = true;
      positionUser(pos);
    }

    /* ---------- 动画循环 ---------- */
    var clock = new THREE.Clock();
    var frames = 0, fpsTime = 0, fps = 60, running = true;

    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);
      var dt = Math.min(0.05, clock.getDelta());

      // 用户位置脉冲
      if (userGroup.visible) {
        var s = 1 + Math.sin(performance.now() * 0.004) * 0.22;
        userRing.scale.set(s, s, 1);
        userRing.material.opacity = 0.55 - Math.sin(performance.now() * 0.004) * 0.28;
      }

      // 视距较远时进入概览模式：隐藏店铺与设施标签，避免文字互相遮挡
      overviewMode = false;   // 概览模式交给标签避让统一处理

      // 路径动画
      if (routeState && routeState.playing && !routeState.paused) {
        var dur = (routeState.route.totalSeconds || routeState.route.walkSeconds || 20) * 1000 / routeState.speed;
        routeState.t += (dt * 1000) / dur;
        if (routeState.t >= 1) {
          routeState.t = 1;
          routeState.playing = false;
          routeState.done = true;
          callbacks.arrive && callbacks.arrive(routeState.route);
        }
        var p = routeState.curve.getPointAt(Math.min(1, Math.max(0, routeState.t)));
        routeState.marker.position.copy(p);
        routeState.marker.position.y += 0.9;
        if (routeState.follow) {
          ctrl.tTarget.set(p.x, p.y + 2, p.z);
        }
      }

      applyStatus();
      updateCamera(dt);
      declutterLabels();
      renderer.render(scene, camera);

      frames++;
      fpsTime += dt;
      if (fpsTime >= 1) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; callbacks.frame && callbacks.frame(fps); }
    }
    animate();

    /* ---------- 尺寸自适应 ---------- */
    var ro = global.ResizeObserver ? new ResizeObserver(function () { resize(); }) : null;
    if (ro) ro.observe(container);
    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    global.addEventListener('resize', resize);

    /* ---------- 对外 API ---------- */
    return {
      el: el,
      on: function (name, fn) { callbacks[name] = fn; return this; },
      setStatus: setStatus,
      setSelected: function (id) { selectedId = id; },
      setLabelMode: function (m) { labelMode = m || 'declutter'; },
      getLabelMode: function () { return labelMode; },
      /* 调试/自检用：返回所有标签的屏幕矩形与可见性（供 CDP 脚本量重叠） */
      __labelRects: function () {
        var out = [];
        function push(it, text) {
          var r = labelScreenRect(it.label);
          out.push({ text: text, visible: !!it.label.visible, floorNo: it.floorNo,
                     x: r ? Math.round(r.x * 10) / 10 : 0, y: r ? Math.round(r.y * 10) / 10 : 0,
                     w: r ? Math.round(r.w * 10) / 10 : 0, h: r ? Math.round(r.h * 10) / 10 : 0 });
        }
        Object.keys(shopIndex).forEach(function (id) { push(shopIndex[id], shopIndex[id].merchant.name); });
        facilityMeshes.forEach(function (fm) {
          if (!fm.userData.labelSprite) return;
          var lb = fm.userData.labelSprite;
          var r = labelScreenRect(lb);
          out.push({ text: (fm.userData.name || '设施'), visible: !!lb.visible, floorNo: fm.userData.floorNo,
                     x: r ? Math.round(r.x * 10) / 10 : 0, y: r ? Math.round(r.y * 10) / 10 : 0,
                     w: r ? Math.round(r.w * 10) / 10 : 0, h: r ? Math.round(r.h * 10) / 10 : 0 });
        });
        return out;
      },
      setUserPosition: setUserPosition,
      setFloorFocus: setFloorFocus,
      drawRoute: drawRoute,
      clearRoute: clearRoute,
      drawTrail: drawTrail,
      clearTrail: clearTrail,
      setTrailMarker: setTrailMarker,
      getFps: function () { return fps; },
      probeBlank: probeBlank,
      setExplode: function (k) {
        animateExplode(k);
      },
      getExplode: function () { return explodeK; },
      /* 调试用：返回聚焦状态与可见标签所属楼层，便于自检楼层剖分是否正确 */
      debugState: function () {
        var floors = {};
        Object.keys(shopIndex).forEach(function (id) {
          if (shopIndex[id].label.visible) {
            var f = shopIndex[id].floorNo;
            floors[f] = (floors[f] || 0) + 1;
          }
        });
        var ops = [];
        Object.keys(shopIndex).slice(0, 4).forEach(function (id) {
          ops.push(shopIndex[id].floorNo + ':' + shopIndex[id].mesh.material.opacity.toFixed(2));
        });
        var fv = {};
        Object.keys(floorGroups).forEach(function (k) { fv[k] = floorGroups[k].visible; });
        return { focusFloor: focusFloor, solo: soloMode, explode: explodeK, selected: selectedId, visibleLabelFloors: floors, floorVisible: fv, samples: ops };
      },
      toggleExplode: function () {
        var target = explodeK > 1.05 ? 1 : 1.45;
        animateExplode(target);
        return target;
      },
      setAutoRotate: function (v) { ctrl.autoRotate = v; },
      isAutoRotate: function () { return ctrl.autoRotate; },
      resetCamera: function () {
        ctrl.tTheta = Math.PI * 0.85; ctrl.tPhi = Math.PI * 0.26; ctrl.tRadius = 168;
        ctrl.tTarget.copy(CENTER);
      },
      focusOn: function (x, floorNo, z, radius) {
        ctrl.tTarget.set(x, dispY(floorNo) + 2, z);
        if (radius) ctrl.tRadius = radius;
      },
      /* 自检/调试用：直接设定相机（不经过缓动），用于复现特定视角 */
      __setCamera: function (theta, phi, radius) {
        ctrl.tTheta = theta; ctrl.tPhi = phi; ctrl.tRadius = radius;
        ctrl.theta = theta; ctrl.phi = phi; ctrl.radius = radius;
        ctrl.tTarget.copy(CENTER); ctrl.target.copy(CENTER);
        updateCamera(1);
      },
      setTopView: function () {
        ctrl.tPhi = Math.PI * 0.49; ctrl.tTheta = Math.PI * 0.0; ctrl.tRadius = 130;
        ctrl.tTarget.copy(CENTER);
      },
      /* 播放控制 */
      play: function (speed) {
        if (!routeState) return;
        if (routeState.done) routeState.t = 0;
        routeState.speed = speed || routeState.speed || 1;
        routeState.playing = true; routeState.paused = false; routeState.done = false;
      },
      pause: function () { if (routeState) routeState.paused = true; },
      resume: function () { if (routeState) { routeState.paused = false; } },
      stop: function () {
        if (!routeState) return;
        routeState.playing = false; routeState.paused = false; routeState.t = 0;
        routeState.marker.position.copy(routeState.curve.getPointAt(0));
      },
      setFollow: function (v) { if (routeState) routeState.follow = v; },
      seek: function (t) {
        if (!routeState) return;
        routeState.t = Math.max(0, Math.min(1, t));
        var p = routeState.curve.getPointAt(routeState.t);
        routeState.marker.position.copy(p);
        routeState.marker.position.y += 0.9;
      },
      getProgress: function () { return routeState ? routeState.t : 0; },
      isRoutePlaying: function () { return !!(routeState && routeState.playing && !routeState.paused); },
      dispose: function () {
        running = false;
        if (ro) ro.disconnect();
        try { renderer.dispose(); } catch (e) { }
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  global.Scene3D = { create: create, COLOR: COLOR };
})(window);
