/* =========================================================
 * 管理端 · 数据管理后台视图
 * 商户与产品维护、CSV 批量导入导出、楼层拓扑、楼层平面图上传与店铺区域绘制、数据源与仿真参数
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch;

  /* ================= 管理后台 ================= */
  var AdminView = {
    name: 'AdminView',
    props: ['store'],
    setup(props) {
      var store = props.store;
      var state = store.state;
      var sub = Vue.ref('merchant');
      var subs = [
        { key: 'merchant', name: '商户管理', icon: '🏬' },
        { key: 'product', name: '产品管理', icon: '🍜' },
        { key: 'import', name: '批量导入导出', icon: '⇅' },
        { key: 'topo', name: '楼层拓扑', icon: '🕸' },
        { key: 'plan', name: '楼层平面图', icon: '🗺' },
        { key: 'sim', name: '数据源与仿真', icon: '📡' },
        { key: 'note', name: '数据来源说明', icon: '📑' }
      ];

      /* --- 商户 --- */
      var kw = Vue.ref('');
      var editing = Vue.ref(null);
      var editOpen = Vue.ref(false);
      var flush = Vue.ref(0);
      var result = Vue.ref('');

      var merchantRows = computed(function () {
        flush.value;
        return store.data.merchants.filter(function (m) {
          return !kw.value || m.name.indexOf(kw.value) >= 0 || String(m.floorNo).indexOf(kw.value) >= 0;
        }).slice(0, 60);
      });

      function newMerchant() {
        editing.value = {
          name: '', floorNo: 1, areaCode: 'A 区', category: '餐饮', x: 48, z: 32, w: 12, d: 10,
          openTime: '10:00', closeTime: '22:00', restDays: '', avgPrice: 80, priceTier: '中档',
          capacity: 80, serviceRate: 60, heat: 1,
          weekendOpen: '', weekendClose: '', specialDate: '', specialOpen: '', specialClose: '', specialNote: ''
        };
        editOpen.value = true;
      }
      function editMerchant(m) {
        var sp = (m.specialDates && m.specialDates[0]) || {};
        editing.value = Object.assign({}, m, {
          restDays: (m.restDays || []).join(','),
          weekendOpen: m.weekend ? m.weekend.open : '',
          weekendClose: m.weekend ? m.weekend.close : '',
          specialDate: sp.date || '', specialOpen: sp.open || '', specialClose: sp.close || '', specialNote: sp.note || ''
        });
        editOpen.value = true;
      }
      function saveMerchant() {
        var m = editing.value;
        if (!m.name) { notify('商户名称不能为空'); return; }
        m.restDays = String(m.restDays || '').split(',').filter(function (s) { return s !== ''; }).map(function (s) { return parseInt(s, 10); });
        m.floorNo = parseInt(m.floorNo, 10);
        m.avgPrice = Number(m.avgPrice);
        m.capacity = Number(m.capacity);
        m.priceTier = m.avgPrice < 80 ? '经济型' : (m.avgPrice <= 200 ? '中档' : '高端');
        // 周末独立营业时间（weekend_open / weekend_close）与特殊日期（special_dates）
        m.weekend = m.weekendOpen ? { open: m.weekendOpen, close: m.weekendClose || m.closeTime } : null;
        m.specialDates = m.specialDate
          ? [{ date: m.specialDate, open: m.specialOpen || m.openTime, close: m.specialClose || m.closeTime, note: m.specialNote || '特殊日期调整' }]
          : [];
        store.upsertMerchant(m);
        editOpen.value = false;
        flush.value++;
        notify('商户「' + m.name + '」已保存（待发布生效）');
      }

      /* --- 产品 --- */
      var pMerchantId = Vue.ref(store.data.merchants[0] ? store.data.merchants[0].id : null);
      var pEditing = Vue.ref(null);
      var pOpen = Vue.ref(false);
      var productRows = computed(function () {
        flush.value; refreshProducts.value;
        return store.productsOf(pMerchantId.value) || [];
      });
      var refreshProducts = Vue.ref(0);
      function newProduct() {
        pEditing.value = { merchantId: pMerchantId.value, productName: '', price: 38, originalPrice: null, isDiscounted: false, isSignature: true, category: '主食' };
        pOpen.value = true;
      }
      function editProduct(p) { pEditing.value = Object.assign({}, p); pOpen.value = true; }
      function saveProduct() {
        var p = pEditing.value;
        if (!p.productName) { notify('产品名称不能为空'); return; }
        p.price = Number(p.price);
        p.isDiscounted = !!(p.originalPrice && Number(p.originalPrice) > p.price);
        store.saveProduct(p);
        pOpen.value = false;
        refreshProducts.value++;
        notify('产品「' + p.productName + '」已保存');
      }
      function delProduct(p) {
        store.removeProduct(p.id, pMerchantId.value);
        refreshProducts.value++;
        notify('产品已删除');
      }

      /* --- 批量导入 / 导出（规范 4.6 数据导入导出） --- */
      var impType = Vue.ref('merchant');
      var impPreview = Vue.ref([]);
      var impMsg = Vue.ref('');
      var impFile = Vue.ref('');

      var TPL = {
        merchant: {
          name: '商户导入模板.csv',
          head: ['商户名称', '楼层', '区域', '业态', '营业时间', '打烊时间', '人均消费', '容量上限', '服务率', '热度系数', 'X 坐标', 'Z 坐标', '休息日',
            '周末营业', '周末打烊', '特殊日期', '特殊日期营业', '特殊日期打烊', '特殊日期说明'],
          sample: ['示例茶饮铺', '1', 'A 区', '餐饮', '10:00', '22:00', '30', '60', '66', '1.1', '48', '21', '',
            '09:30', '22:30', '10-01', '10:00', '23:00', '国庆节延长营业']
        },
        product: {
          name: '产品导入模板.csv',
          head: ['商户名称', '产品名称', '产品分类', '现价', '原价', '招牌', '折扣'],
          sample: ['星巴克 Starbucks', '太妃榛果拿铁', '饮品', '38', '45', '1', '1']
        }
      };

      /* 轻量 CSV 解析：支持引号包裹与字段内逗号 */
      function parseCsv(text) {
        text = String(text).replace(/^﻿/, '');
        var rows = [], row = [], cur = '', q = false;
        for (var i = 0; i < text.length; i++) {
          var c = text[i];
          if (q) {
            if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
            else cur += c;
          } else if (c === '"') q = true;
          else if (c === ',') { row.push(cur); cur = ''; }
          else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
          else if (c === '\r') { }
          else cur += c;
        }
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
        return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
      }

      function downloadTemplate() {
        var t = TPL[impType.value];
        var csv = [t.head.join(',')].concat([t.sample.join(',')]).join('\r\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = t.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        notify('模板已下载：' + t.name + '（Excel 可直接打开另存）');
      }

      var COLS = {
        merchant: ['商户名称', '楼层', '区域', '业态', '营业时间', '打烊时间', '人均消费', '容量上限', '服务率', '热度系数', 'X 坐标', 'Z 坐标', '休息日',
          '周末营业', '周末打烊', '特殊日期', '特殊日期营业', '特殊日期打烊', '特殊日期说明'],
        product: ['商户名称', '产品名称', '产品分类', '现价', '原价', '招牌', '折扣']
      };

      function onFile(e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        impFile.value = f.name;
        var reader = new FileReader();
        reader.onload = function () {
          var rows = parseCsv(reader.result);
          if (!rows.length) { notify('文件为空或无法解析'); return; }
          var head = rows[0].map(function (h) { return String(h).trim(); });
          var cols = COLS[impType.value];
          var idx = cols.map(function (c) { return head.indexOf(c); });
          if (idx[0] < 0) {
            notify('表头不匹配，请先下载模板并按模板列名填写（首列应为「' + cols[0] + '」）');
            return;
          }
          impPreview.value = rows.slice(1).map(function (r) { return buildRow(r, idx); });
          var bad = impPreview.value.filter(function (x) { return !x.ok; }).length;
          notify('解析完成：共 ' + impPreview.value.length + ' 行，其中 ' + bad + ' 行需要修正');
        };
        reader.readAsText(f, 'utf-8');
      }

      function buildRow(r, idx) {
        function cell(i) { var k = idx[i]; return k >= 0 ? String(r[k] || '').trim() : ''; }
        var errors = [], data;
        if (impType.value === 'merchant') {
          var floorNos = store.data.floors.map(function (f) { return String(f.no); });
          var name = cell(0);
          if (!name) errors.push('商户名称为空');
          var floorNo = parseInt(cell(1), 10);
          if (floorNos.indexOf(String(floorNo)) < 0) errors.push('楼层需为 ' + floorNos.join('/'));
          var avg = Number(cell(6)); if (!isFinite(avg) || avg <= 0) errors.push('人均消费需为正数');
          var cap = Number(cell(7)) || 80;
          var mu = Number(cell(8)) || Math.round(cap * 1.1);
          var heat = Number(cell(9)) || 1;
          var x = Number(cell(10)), z = Number(cell(11));
          if (!isFinite(x) || !isFinite(z)) errors.push('坐标需为数字');
          var cat = cell(3) || '餐饮';
          if (store.data.categories.indexOf(cat) < 0) errors.push('业态不在配置范围内');
          data = {
            name: name, floorNo: floorNo, areaCode: cell(2) || 'A 区', category: cat,
            openTime: cell(4) || '10:00', closeTime: cell(5) || '22:00',
            avgPrice: avg, capacity: cap, serviceRate: mu, heat: heat,
            x: x, z: z, w: 8, d: 8,
            restDays: cell(12) ? cell(12).split(',').map(function (s) { return parseInt(s, 10); }).filter(function (n) { return !isNaN(n); }) : [],
            weekend: cell(13) ? { open: cell(13), close: cell(14) || cell(5) || '22:00' } : null,
            specialDates: cell(15) ? [{ date: cell(15), open: cell(16) || cell(4) || '10:00', close: cell(17) || cell(5) || '22:00', note: cell(18) || '特殊日期调整' }] : [],
            rating: 4.5
          };
        } else {
          var mname = cell(0), pname = cell(1);
          var m = null;
          store.data.merchants.forEach(function (x) { if (x.name === mname) m = x; });
          if (!m) errors.push('未找到商户「' + mname + '」');
          var price = Number(cell(3));
          if (!isFinite(price) || price <= 0) errors.push('现价需为正数');
          data = {
            merchantId: m ? m.id : 0, merchantName: mname, productName: pname,
            category: cell(2) || '其他', price: price, originalPrice: cell(4) ? Number(cell(4)) : null,
            isSignature: cell(5) === '1', isDiscounted: cell(6) === '1', hotWords: ''
          };
        }
        return { ok: errors.length === 0, errors: errors, data: data };
      }

      function doImport() {
        var ok = impPreview.value.filter(function (r) { return r.ok; });
        if (!ok.length) { notify('没有可导入的有效数据行'); return; }
        ok.forEach(function (r) {
          if (impType.value === 'merchant') {
            var d = Object.assign({}, r.data);
            var exist = null;
            store.data.merchants.forEach(function (m) { if (m.name === d.name) exist = m; });
            if (exist) {
              d.id = exist.id; d.rect = exist.rect; d.door = exist.door; d.area = exist.area; d.floorLabel = exist.floorLabel;
            } else {
              d.rect = { x: Math.max(0, d.x - d.w / 2), z: Math.max(0, d.z - d.d / 2), w: d.w, d: d.d };
              d.area = d.w * d.d;
              d.door = { x: d.x, z: d.z };
            }
            d.priceTier = d.avgPrice < 80 ? '经济型' : (d.avgPrice <= 200 ? '中档' : '高端');
            d.minPrice = Math.round(d.avgPrice * 0.6 * 100) / 100;
            d.maxPrice = Math.round(d.avgPrice * 1.6 * 100) / 100;
            d.priceNote = d.category === '餐饮' ? '不含酒水与服务费' : '参考价，以门店实际标价为准';
            d.channels = Math.max(1, Math.round(d.capacity / 50));
            d.desc = d.name + '位于' + store.floorsOf(d.floorNo).name + d.areaCode + '，营业面积约 ' + Math.round(d.area) + ' ㎡。';
            store.upsertMerchant(d);
          } else {
            store.saveProduct(r.data);
          }
        });
        flush.value++;
        notify('导入成功：写入 ' + ok.length + ' 条' + (impType.value === 'merchant' ? '商户' : '产品') + '数据，请点击「校验并发布配置」使其生效');
        impPreview.value = [];
        impFile.value = '';
      }

      function exportProducts() {
        var rows = [['商户名称', '楼层', '产品名称', '产品分类', '现价', '原价', '招牌', '折扣']];
        store.data.products.forEach(function (p) {
          var m = null;
          store.data.merchants.forEach(function (x) { if (x.id === p.merchantId) m = x; });
          if (!m) return;
          rows.push([m.name, store.floorsOf(m.floorNo).label, p.productName, p.category, p.price, p.originalPrice || '', p.isSignature ? '是' : '否', p.isDiscounted ? '是' : '否']);
        });
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c) + '"'; }).join(','); }).join('\r\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = '商场产品清单_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        notify('产品清单已导出（' + (rows.length - 1) + ' 条）');
      }

      /* --- 拓扑 --- */
      var topoFloor = Vue.ref(1);
      var topoRows = computed(function () {
        return store.data.nodes.filter(function (n) { return n.floorNo === topoFloor.value; });
      });
      var facilityRows = computed(function () {
        return store.data.facilities.filter(function (f) { return f.floorNo === topoFloor.value; });
      });
      function typeLabel(t) {
        return { shop: '店铺门址', cross: '走廊交叉点', elevator: '客梯', escalator: '扶梯', wc: '卫生间', service: '服务台', entrance: '出入口', amenity: '便民设施' }[t] || t;
      }

      /* --- 仿真 --- */
      var manualMid = Vue.ref(store.data.merchants[0] ? store.data.merchants[0].id : null);
      var manualCur = Vue.ref(30);
      var manualQueue = Vue.ref(4);
      function applyManual() {
        store.manualInput(manualMid.value, Number(manualCur.value), Number(manualQueue.value));
        notify('已按手工录入更新该商户实时数据');
      }
      var simParams = Vue.ref({
        lambdaNormal: store.sim.params.lambdaNormal,
        lambdaLunch: store.sim.params.lambdaLunch,
        lambdaDinner: store.sim.params.lambdaDinner,
        heatScale: store.sim.params.heatScale,
        intervalSec: store.sim.params.intervalSec,
        timeScale: store.sim.params.timeScale
      });
      function applyParams() {
        Object.keys(simParams.value).forEach(function (k) { store.updateSimParam(k, Number(simParams.value[k])); });
        notify('仿真参数已更新，下一次推送生效');
      }
      function publish() {
        var r = store.publish();
        if (r.ok) notify('配置发布成功，前端缓存已刷新');
        else notify('发布未通过校验：' + r.errors.slice(0, 3).join('；'));
        result.value = r;
        flush.value++;
      }
      function setSource(src) {
        store.setDataSource(src);
        notify('数据来源已切换为：' + store.sourceLabel(src));
      }
      function notify(msg) {
        result.value = { msg: msg };
        setTimeout(function () { result.value = null; }, 2600);
      }

      /* --- 楼层平面图上传与店铺区域绘制（论文 3.2.4 / 需求 FR-03-02） --- */
      var planLayout = store.data.layout;
      var planFloor = Vue.ref(1);
      var planSvg = Vue.ref(null);
      var planMsg = Vue.ref(null);
      var planDraw = Vue.ref(false);          // 是否处于绘制状态
      var planDraft = Vue.ref([]);            // 正在绘制的顶点 [{x,z}]，单位米
      var planMerchantId = Vue.ref(null);     // 当前目标商户
      var planOpacity = Vue.ref(0.6);

      function planViewBox() {
        var L = planLayout;
        return '-3 -3 ' + (L.width + 6) + ' ' + (L.depth + 6);
      }
      function vy(z) { return planLayout.depth - z; }
      function planFloorMerchants() {
        flush.value;
        return store.data.merchants.filter(function (m) { return m.floorNo === planFloor.value; });
      }
      function curPlan() { flush.value; return store.floorPlanOf(planFloor.value); }
      function planStat() { flush.value; return store.planStats(); }
      function planDrawnRows() {
        return planFloorMerchants().filter(function (m) { return m.region && m.region.length >= 3; });
      }
      function regionPoints(list) {
        return list.map(function (p) { return p.x + ',' + vy(p.z).toFixed(2); }).join(' ');
      }
      function planRectPoints(m) {
        var r = m.rect;
        return [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]]
          .map(function (p) { return p[0] + ',' + vy(p[1]).toFixed(2); }).join(' ');
      }
      /* 屏幕坐标 → 图幅坐标（米） */
      function toPlanMall(e) {
        var svg = planSvg.value;
        if (!svg || !svg.getScreenCTM) return null;
        var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        var loc = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: Math.round(loc.x * 10) / 10, z: Math.round(vy(loc.y) * 10) / 10 };
      }
      function onPlanClick(e) {
        if (!planDraw.value) return;
        var p = toPlanMall(e);
        if (!p) return;
        if (p.x < -2 || p.x > planLayout.width + 2 || p.z < -2 || p.z > planLayout.depth + 2) return;
        planDraft.value = planDraft.value.concat([p]);
      }
      function startDraw() {
        if (!planMerchantId.value) { planMsg.value = { type: 'warn', text: '请先选择要绘制的商户' }; return; }
        planDraft.value = [];
        planDraw.value = true;
        planMsg.value = { type: 'info', text: '绘制中：在左侧平面图上依次点击顶点，至少 3 个点后点击「完成并保存」' };
      }
      function draftFromRect() {
        var m = null;
        planFloorMerchants().forEach(function (x) { if (String(x.id) === String(planMerchantId.value)) m = x; });
        if (!m) { planMsg.value = { type: 'warn', text: '请先选择要绘制的商户' }; return; }
        var r = m.rect;
        planDraft.value = [{ x: r.x, z: r.z }, { x: r.x + r.w, z: r.z }, { x: r.x + r.w, z: r.z + r.d }, { x: r.x, z: r.z + r.d }];
        planDraw.value = true;
        planMsg.value = { type: 'info', text: '已按铺位矩形预置 4 个顶点，可继续在图上点击增补顶点后保存' };
      }
      function undoPoint() { planDraft.value = planDraft.value.slice(0, -1); }
      function finishRegion() {
        var r = store.saveRegion(planMerchantId.value, planDraft.value.slice());
        if (r.ok) {
          planDraw.value = false; planDraft.value = [];
          planMsg.value = { type: 'ok', text: '区域已保存（' + r.points + ' 个顶点）。到「数据源与仿真」发布配置后顾客端生效。' };
        } else planMsg.value = { type: 'warn', text: r.reason };
        flush.value++;
      }
      function cancelDraw() { planDraw.value = false; planDraft.value = []; planMsg.value = null; }
      function clearRegionOf(m) {
        store.clearRegion(m.id);
        planMsg.value = { type: 'info', text: '已清除「' + m.name + '」的绘制区域，恢复为铺位矩形' };
        flush.value++;
      }
      function onPlanFile(e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) { planMsg.value = { type: 'warn', text: '请选择图片文件（PNG / JPG / SVG 等）' }; return; }
        var fr = new FileReader();
        fr.onload = function () {
          var img = new Image();
          img.onload = function () {
            // 最长边压到 1600px 再存（localStorage 容量有限，原图易超限）
            var MAX = 1600, sc = Math.min(1, MAX / Math.max(img.width, img.height));
            var w = Math.round(img.width * sc), h = Math.round(img.height * sc);
            var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            var cx = cv.getContext('2d');
            cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
            cx.drawImage(img, 0, 0, w, h);
            var dataUrl;
            try { dataUrl = cv.toDataURL('image/jpeg', 0.82); } catch (err) { dataUrl = fr.result; }
            store.setFloorPlan(planFloor.value, { dataUrl: dataUrl, name: f.name, w: w, h: h, opacity: planOpacity.value });
            planMsg.value = { type: 'ok', text: '平面图已上传：' + f.name + '（' + img.width + '×' + img.height + ' → 压缩为 ' + w + '×' + h + '）' };
            flush.value++;
          };
          img.onerror = function () { planMsg.value = { type: 'warn', text: '图片解析失败，请换一张重试' }; };
          img.src = fr.result;
        };
        fr.onerror = function () { planMsg.value = { type: 'warn', text: '文件读取失败（file:// 下部分浏览器会限制读取本地文件，请改用本地服务器方式打开）' }; };
        fr.readAsDataURL(f);
        e.target.value = '';
      }
      function removePlan() {
        store.clearFloorPlan(planFloor.value);
        planMsg.value = { type: 'info', text: '已移除该楼层平面图' };
        flush.value++;
      }
      function applyOpacity(v) {
        planOpacity.value = Number(v);
        store.setPlanOpacity(planFloor.value, planOpacity.value);
      }
      Vue.watch(planFloor, function () {
        var p = curPlan();
        planOpacity.value = p ? p.opacity : 0.6;
        planDraw.value = false; planDraft.value = []; planMerchantId.value = null; planMsg.value = null;
      });
      Vue.watch(curPlan, function (p) { if (p) planOpacity.value = p.opacity; });

      return {
        state: state, store: store, sub: sub, subs: subs, kw: kw, rows: merchantRows,
        editing: editing, editOpen: editOpen, newMerchant: newMerchant, editMerchant: editMerchant, saveMerchant: saveMerchant,
        pMerchantId: pMerchantId, productRows: productRows, pEditing: pEditing, pOpen: pOpen,
        newProduct: newProduct, editProduct: editProduct, saveProduct: saveProduct, delProduct: delProduct,
        topoFloor: topoFloor, topoRows: topoRows, facilityRows: facilityRows, typeLabel: typeLabel,
        impType: impType, impPreview: impPreview, impFile: impFile, impMsg: impMsg,
        downloadTemplate: downloadTemplate, onFile: onFile, doImport: doImport, exportProducts: exportProducts,
        manualMid: manualMid, manualCur: manualCur, manualQueue: manualQueue, applyManual: applyManual,
        simParams: simParams, applyParams: applyParams, publish: publish, setSource: setSource, result: result,
        sourceLabel: store.sourceLabel, categories: store.data.categories,
        /* 楼层平面图 */
        planLayout: planLayout, planFloor: planFloor, planSvg: planSvg, planMsg: planMsg, planDraw: planDraw,
        planDraft: planDraft, planMerchantId: planMerchantId, planOpacity: planOpacity,
        planViewBox: planViewBox, vy: vy, curPlan: curPlan, planStat: planStat, planFloorMerchants: planFloorMerchants,
        planDrawnRows: planDrawnRows, regionPoints: regionPoints, planRectPoints: planRectPoints,
        onPlanClick: onPlanClick, startDraw: startDraw, draftFromRect: draftFromRect, undoPoint: undoPoint,
        finishRegion: finishRegion, cancelDraw: cancelDraw, clearRegionOf: clearRegionOf,
        onPlanFile: onPlanFile, removePlan: removePlan, applyOpacity: applyOpacity
      };
    },
    template: `
    <div class="admin">
      <div class="admin-nav">
        <button v-for="s in subs" :key="s.key" class="admin-nav-item" :class="{active: sub===s.key}" @click="sub=s.key">
          <span class="ai">{{ s.icon }}</span>{{ s.name }}
        </button>
      </div>

      <div class="admin-body">
        <!-- 商户管理 -->
        <section v-if="sub==='merchant'">
          <div class="admin-bar">
            <input v-model="kw" class="input" placeholder="搜索商户名称 / 楼层…" />
            <span class="hint">共 {{ rows.length }} 条</span>
            <div class="spacer"></div>
            <button class="btn btn-primary btn-sm" @click="newMerchant">+ 新增商户</button>
          </div>
          <div class="table-wrap">
            <table class="grid">
              <thead><tr><th>ID</th><th>商户名称</th><th>楼层</th><th>区域</th><th>业态</th><th>营业时段</th><th>人均</th><th>档次</th><th>容量</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="m in rows" :key="m.id">
                  <td class="idx">{{ m.id }}</td>
                  <td class="strong">{{ m.name }}</td>
                  <td>{{ store.floorsOf(m.floorNo).label }}</td>
                  <td>{{ m.areaCode }}</td>
                  <td>{{ m.category }}</td>
                  <td>{{ m.openTime }} - {{ m.closeTime }}</td>
                  <td>¥{{ m.avgPrice }}</td>
                  <td>{{ m.priceTier }}</td>
                  <td>{{ m.capacity }}</td>
                  <td><button class="link" @click="editMerchant(m)">编辑</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 产品管理 -->
        <section v-if="sub==='product'">
          <div class="admin-bar">
            <label class="mini-label">所属商户</label>
            <select v-model="pMerchantId" class="mini-select wide">
              <option v-for="m in store.data.merchants" :key="m.id" :value="m.id">{{ store.floorsOf(m.floorNo).label }} · {{ m.name }}</option>
            </select>
            <div class="spacer"></div>
            <button class="btn btn-primary btn-sm" @click="newProduct">+ 新增产品</button>
          </div>
          <div class="table-wrap">
            <table class="grid">
              <thead><tr><th>产品名称</th><th>分类</th><th>现价</th><th>原价</th><th>折扣</th><th>招牌</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="p in productRows" :key="p.id">
                  <td class="strong">{{ p.productName }} <span v-if="p.hotWords" class="tag tag-hot">{{ p.hotWords }}</span></td>
                  <td>{{ p.category }}</td>
                  <td>¥{{ p.price }}</td>
                  <td>{{ p.originalPrice ? '¥'+p.originalPrice : '—' }}</td>
                  <td><span v-if="p.isDiscounted" class="tag tag-sale">打折</span><span v-else>—</span></td>
                  <td><span v-if="p.isSignature" class="tag tag-sig">招牌</span><span v-else>—</span></td>
                  <td><button class="link" @click="editProduct(p)">编辑</button><button class="link danger" @click="delProduct(p)">删除</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 批量导入导出 -->
        <section v-if="sub==='import'">
          <div class="admin-bar">
            <div class="seg-group">
              <button class="seg" :class="{active: impType==='merchant'}" @click="impType='merchant'; impPreview=[]">商户数据</button>
              <button class="seg" :class="{active: impType==='product'}" @click="impType='product'; impPreview=[]">产品数据</button>
            </div>
            <div class="spacer"></div>
            <button class="btn btn-ghost btn-sm" @click="downloadTemplate">下载 CSV 模板</button>
            <button class="btn btn-ghost btn-sm" @click="exportProducts">导出产品清单</button>
            <button class="btn btn-ghost btn-sm" @click="store.exportCsv()">导出客流报表</button>
          </div>
          <div class="card">
            <div class="card-head"><h4>批量导入</h4><span class="hint">支持 Excel 另存为 CSV（UTF-8）后上传</span></div>
            <div class="uploader">
              <input type="file" accept=".csv,.txt" @change="onFile" />
              <span class="hint">{{ impFile ? '已选择：' + impFile : '未选择文件（列名需与模板一致，含中文表头）' }}</span>
            </div>
            <p class="hint block">
              商户模板列：商户名称 / 楼层 / 区域 / 业态 / 营业时间 / 打烊时间 / 人均消费 / 容量上限 / 服务率 / 热度系数 / X 坐标 / Z 坐标 / 休息日；
              产品模板列：商户名称 / 产品名称 / 产品分类 / 现价 / 原价 / 招牌 / 折扣。同名商户将覆盖更新，其余按新增处理；导入后需发布配置方可对前端生效。
            </p>
            <div class="table-wrap" v-if="impPreview.length">
              <table class="grid">
                <thead><tr><th>#</th><th>名称</th><th>解析结果</th><th>校验</th></tr></thead>
                <tbody>
                  <tr v-for="(r,i) in impPreview.slice(0,20)" :key="i" :class="{rowfull:!r.ok}">
                    <td class="idx">{{ i+1 }}</td>
                    <td class="strong">{{ r.data.name || r.data.productName }}</td>
                    <td class="mono">{{ r.data.merchantName ? r.data.merchantName + ' · ' : '' }}{{ r.data.category }} {{ r.data.price ? '¥'+r.data.price : '' }}</td>
                    <td><span v-if="r.ok" class="tag tag-algo">通过</span><span v-else class="tag tag-sale">{{ r.errors.join('；') }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" :disabled="!impPreview.length" @click="doImport">
                导入有效数据（{{ impPreview.filter(r=>r.ok).length }} 行）
              </button>
            </div>
          </div>
        </section>

        <!-- 楼层拓扑 -->
        <section v-if="sub==='topo'">
          <div class="admin-bar">
            <label class="mini-label">楼层</label>
            <select v-model="topoFloor" class="mini-select">
              <option v-for="f in store.data.floors" :key="f.no" :value="f.no">{{ f.name }}</option>
            </select>
            <span class="hint">当前楼层拓扑节点 {{ topoRows.length }} 个，公共设施 {{ facilityRows.length }} 处；全楼节点共 {{ store.data.nodes.length }} 个</span>
          </div>
          <div class="table-wrap two">
            <table class="grid">
              <thead><tr><th>节点编码</th><th>类型</th><th>X</th><th>Z</th><th>关联商户</th><th>邻接节点数</th></tr></thead>
              <tbody>
                <tr v-for="n in topoRows" :key="n.code">
                  <td class="mono">{{ n.code }}</td>
                  <td>{{ typeLabel(n.type) }}</td>
                  <td>{{ n.x }}</td><td>{{ n.z }}</td>
                  <td>{{ n.merchantId ? (store.selectedMerchantById(n.merchantId)||{}).name : '—' }}</td>
                  <td>{{ (n.link||[]).length }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-wrap two">
            <table class="grid">
              <thead><tr><th>设施</th><th>类型</th><th>运行方向</th><th>坐标</th><th>拓扑节点</th><th>服务说明</th></tr></thead>
              <tbody>
                <tr v-for="f in facilityRows" :key="f.id">
                  <td class="strong">{{ store.facilityIcon(f) }} {{ f.name }}</td>
                  <td>{{ f.subtype }}</td>
                  <td>{{ f.direction || '—' }}</td>
                  <td class="mono">({{ f.x }}, {{ f.z }})</td>
                  <td class="mono">{{ f.nodeCode }}</td>
                  <td class="dim">{{ f.desc }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card">
            <div class="card-head"><h4>路径记录 path_history</h4><span class="hint">导航一次后自动写入，对应论文表 3.24</span></div>
            <div class="table-wrap two">
              <table class="grid">
                <thead><tr><th>时间</th><th>起点节点</th><th>终点节点</th><th>终点名称</th><th>距离</th><th>预计</th><th>跨层</th><th>节点数</th></tr></thead>
                <tbody>
                  <tr v-for="h in store.state.pathHistory" :key="h.id">
                    <td class="mono">{{ new Date(h.createdAt).toLocaleTimeString() }}</td>
                    <td class="mono">{{ h.startNode }}</td>
                    <td class="mono">{{ h.endNode }}</td>
                    <td>{{ h.endLabel }}</td>
                    <td>{{ h.distance }} 米</td>
                    <td>{{ Math.ceil(h.seconds/60) }} 分</td>
                    <td>{{ h.verticalFloors }} 层</td>
                    <td>{{ h.nodes }}</td>
                  </tr>
                  <tr v-if="!store.state.pathHistory.length"><td colspan="8" class="dim">暂无记录：请在顾客端发起一次导航</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- 楼层平面图上传与店铺区域绘制（论文 3.2.4） -->
        <section v-if="sub==='plan'">
          <div class="admin-bar">
            <label class="mini-label">楼层</label>
            <select v-model="planFloor" class="mini-select">
              <option v-for="f in store.data.floors" :key="f.no" :value="f.no">{{ f.name }}</option>
            </select>
            <label class="mini-label">平面图</label>
            <input type="file" accept="image/*" class="file-input" @change="onPlanFile" />
            <span v-if="curPlan()" class="chip sm on">已上传：{{ curPlan().name }}</span>
            <span v-else class="chip sm">该楼层未上传</span>
            <template v-if="curPlan()">
              <label class="mini-label">透明度</label>
              <input type="range" min="0.15" max="1" step="0.05" :value="planOpacity" @input="applyOpacity($event.target.value)" class="range aplan-range" />
              <button class="mini-btn" @click="removePlan">移除平面图</button>
            </template>
            <span class="hint" style="margin-left:auto">已上传 {{ planStat().uploaded }}/{{ planStat().total }} 层 · 已绘制区域 {{ planStat().drawn }}/{{ planStat().merchants }} 家</span>
          </div>

          <div class="aplan-wrap">
            <div class="aplan-side">
              <div class="card">
                <div class="card-head"><h4>绘制店铺区域</h4><span class="hint">多边形，单位米</span></div>
                <label class="mini-label aplan-first">目标商户（本层 {{ planFloorMerchants().length }} 家）</label>
                <select v-model="planMerchantId" class="mini-select wide">
                  <option :value="null">— 请选择商户 —</option>
                  <option v-for="m in planFloorMerchants()" :key="m.id" :value="m.id">{{ m.name }} · {{ m.areaCode }}</option>
                </select>
                <div class="aplan-ops">
                  <button class="mini-btn primary" @click="startDraw">开始绘制</button>
                  <button class="mini-btn" @click="draftFromRect">按铺位矩形预置</button>
                  <button class="mini-btn" :disabled="!planDraft.length" @click="undoPoint">撤销上一点</button>
                  <button class="mini-btn primary" :disabled="planDraft.length<3" @click="finishRegion">完成并保存</button>
                  <button class="mini-btn" @click="cancelDraw">取消</button>
                </div>
                <p class="hint aplan-steps">① 上传该层平面图作为描摹底图（可选）→ ② 选择商户 → ③ 在右侧图上依次点击顶点 → ④ 完成并保存 → ⑤ 到「数据源与仿真」发布配置，顾客端二维平面图即按新区域显示。</p>
                <p class="hint">当前草稿顶点：<b>{{ planDraft.length }}</b> 个<span v-if="planDraw">（绘制中，请在图上点击）</span></p>
                <p v-if="planMsg" class="aplan-msg" :class="planMsg.type">{{ planMsg.text }}</p>
              </div>

              <div class="card">
                <div class="card-head"><h4>本层已绘制区域</h4><span class="hint">{{ planDrawnRows().length }} 家</span></div>
                <div class="table-wrap two">
                  <table class="grid">
                    <thead><tr><th>商户</th><th>区域</th><th>顶点数</th><th>面积</th><th>操作</th></tr></thead>
                    <tbody>
                      <tr v-for="m in planDrawnRows()" :key="m.id">
                        <td class="strong">{{ m.name }}</td>
                        <td class="mono">{{ m.areaCode }}</td>
                        <td>{{ m.region.length }}</td>
                        <td>{{ store.regionArea(m.region).toFixed(0) }} ㎡</td>
                        <td><button class="mini-btn" @click="clearRegionOf(m)">清除</button></td>
                      </tr>
                      <tr v-if="!planDrawnRows().length"><td colspan="5" class="dim">该楼层暂无已绘制区域，商店仍按铺位矩形显示</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="aplan-stage">
              <svg ref="planSvg" class="aplan-canvas" :class="{drawing: planDraw}" :viewBox="planViewBox()" preserveAspectRatio="xMidYMid meet" @click="onPlanClick">
                <image v-if="curPlan() && state.layers.plan" x="0" y="0" :width="planLayout.width" :height="planLayout.depth"
                       :href="curPlan().dataUrl" :opacity="planOpacity" preserveAspectRatio="none" />
                <rect x="0" y="0" :width="planLayout.width" :height="planLayout.depth" fill="none" stroke="#1F4E79" stroke-width="0.45" />
                <g stroke="#DCE7F1" stroke-width="0.15">
                  <line v-for="vx in planLayout.vLines" :key="'pv'+vx" :x1="vx" y1="0" :x2="vx" :y2="planLayout.depth" />
                  <line v-for="hz in planLayout.hLines" :key="'ph'+hz" x1="0" :y1="vy(hz)" :x2="planLayout.width" :y2="vy(hz)" />
                </g>
                <g v-for="m in planFloorMerchants()" :key="m.id">
                  <polygon v-if="m.region && m.region.length>=3" :points="regionPoints(m.region)"
                           fill="rgba(24,144,255,0.20)" stroke="#1890FF" stroke-width="0.5" />
                  <polygon :points="planRectPoints(m)" fill="rgba(31,78,121,0.05)" stroke="#B7C7D8" stroke-width="0.25" />
                  <text :x="m.x" :y="vy(m.z)+0.9" text-anchor="middle" font-size="1.8" fill="#5A6B85" style="pointer-events:none">{{ m.name.length>6?m.name.slice(0,6)+'…':m.name }}</text>
                </g>
                <g v-if="planDraft.length">
                  <polygon :points="regionPoints(planDraft)" fill="rgba(255,77,79,0.14)" stroke="#FF4D4F"
                           stroke-width="0.55" stroke-dasharray="1.3 0.9" />
                  <circle v-for="(p,i) in planDraft" :key="'pd'+i" :cx="p.x" :cy="vy(p.z)" r="1" fill="#FF4D4F" />
                </g>
              </svg>
              <div class="aplan-foot">
                图幅 {{ planLayout.width }} × {{ planLayout.depth }} 米 · 图片左上角对齐图幅西北角（北在上）· 蓝框为已绘制区域，灰框为铺位矩形
                <span v-if="planDraw"> · <b class="drawing">绘制中：点击添加顶点</b></span>
              </div>
            </div>
          </div>
        </section>

        <!-- 数据源与仿真 -->
        <section v-if="sub==='sim'">
          <div class="sim-grid">
            <div class="card">
              <div class="card-head"><h4>数据来源（三种可选方式）</h4></div>
              <div class="source-opts">
                <button class="source-opt" :class="{active: state.dataSource==='simulation'}" @click="setSource('simulation')">
                  <strong>方式一 · 仿真数据</strong>
                  <p>泊松过程 + M/M/c 排队模型生成，界面标注“仿真数据”。毕业设计推荐方案。</p>
                </button>
                <button class="source-opt" :class="{active: state.dataSource==='device'}" @click="setSource('device')">
                  <strong>方式二 · 设备采集</strong>
                  <p>接入 WiFi 探针 / 摄像头人数统计，界面标注“数据来源：设备统计”。</p>
                </button>
                <button class="source-opt" :class="{active: state.dataSource==='manual'}" @click="setSource('manual')">
                  <strong>方式三 · 手工录入</strong>
                  <p>运营人员在下方录入当前人数与排队情况，界面标注“数据来源：人工录入”。</p>
                </button>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><h4>仿真参数</h4><span class="hint">存储于 sys_config 表，支持动态调整</span></div>
              <div class="form-row"><label>到达率 λ（平峰，人/小时）</label><input type="number" v-model.number="simParams.lambdaNormal" class="input sm" /></div>
              <div class="form-row"><label>到达率 λ（午高峰 11:30-13:30）</label><input type="number" v-model.number="simParams.lambdaLunch" class="input sm" /></div>
              <div class="form-row"><label>到达率 λ（晚高峰 17:30-20:00）</label><input type="number" v-model.number="simParams.lambdaDinner" class="input sm" /></div>
              <div class="form-row"><label>全局客流热度系数（λ 缩放）</label><input type="number" step="0.1" v-model.number="simParams.heatScale" class="input sm" /></div>
              <div class="form-row"><label>推送间隔（真实秒，规范 5-30 秒）</label><input type="number" v-model.number="simParams.intervalSec" class="input sm" /></div>
              <div class="form-row"><label>演示时间倍速（1 真实秒 = N 仿真秒）</label><input type="number" v-model.number="simParams.timeScale" class="input sm" /></div>
              <div class="form-actions"><button class="btn btn-ghost btn-sm" @click="applyParams">应用参数</button></div>
            </div>

            <div class="card">
              <div class="card-head"><h4>手工录入（方式三）</h4></div>
              <div class="form-row"><label>选择商户</label>
                <select v-model="manualMid" class="input sm wide">
                  <option v-for="m in store.data.merchants" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
              </div>
              <div class="form-row"><label>当前店内人数</label><input type="number" v-model.number="manualCur" class="input sm" /></div>
              <div class="form-row"><label>当前排队人数</label><input type="number" v-model.number="manualQueue" class="input sm" /></div>
              <div class="form-actions"><button class="btn btn-ghost btn-sm" @click="applyManual">写入实时状态</button></div>
            </div>

            <div class="card">
              <div class="card-head"><h4>配置发布</h4></div>
              <p class="hint block">发布前对营业时间、容量上限与仿真参数做完整性校验；校验通过后写入 realtime_status 并通知在线客户端刷新缓存。</p>
              <div class="form-actions">
                <button class="btn btn-primary btn-sm" @click="publish">校验并发布配置</button>
                <button class="btn btn-ghost btn-sm" @click="store.toggleNet()">{{ state.offlineDemo ? '恢复网络连接' : '模拟网络中断' }}</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 数据来源说明 -->
        <section v-if="sub==='note'" class="note-page">
          <div class="card">
            <div class="card-head"><h4>数据来源标注说明</h4></div>
            <p>依据需求规格说明书 3.3 核心业务规则第 9 条，所有非真实采集的数据必须在界面明确标注来源，避免误导用户。本系统在以下位置标注：</p>
            <ul>
              <li>商户详情卡实时数据区：标注「仿真数据」/「数据来源：设备统计」/「数据来源：人工录入」；</li>
              <li>运营数据看板图表标题右侧与报表导出字段；</li>
              <li>状态提示区显示最近一次推送时间与网络状态。</li>
            </ul>
            <h4 class="mt">等位时长计算公式</h4>
            <div class="formula">W<sub>q</sub> = L<sub>q</sub> / λ ≈ 排队人数 ÷ 服务率 μ × 60（分钟）</div>
            <p class="hint">顾客到达服从参数为 λ 的泊松过程，服务时间服从参数为 μ 的指数分布；稳态下满足 Little 公式 L = λW。例如当排队 6 人、服务率 12 人/小时时，等位时长 ≈ 6 ÷ 12 × 60 = 30 分钟（对应测试用例 TC-05）。</p>
            <h4 class="mt">室内坐标系</h4>
            <p>原点位于一层平面图西南角，X 轴向东、Z 轴向北，层高 4.5 米；店铺与设施坐标由管理员在二维平面图上拾取后写入 topology_node 与 facility 表，二维视图取 X-Z 平面投影，与三维视图坐标严格一致。</p>
          </div>
        </section>

        <div v-if="result && result.msg" class="toast-float">{{ result.msg }}</div>
        <div v-if="result && result.errors && result.errors.length" class="toast-float error">
          校验未通过（{{ result.errors.length }} 项）：{{ result.errors.slice(0,2).join('；') }}
        </div>
      </div>

      <!-- 商户编辑弹窗 -->
      <div class="modal-mask" v-if="editOpen" @click.self="editOpen=false">
        <div class="modal">
          <div class="modal-head"><h4>{{ editing.id ? '编辑商户' : '新增商户' }}</h4><button class="x" @click="editOpen=false">×</button></div>
          <div class="modal-body form-grid">
            <div class="form-row"><label>商户名称</label><input v-model="editing.name" class="input" /></div>
            <div class="form-row"><label>所在楼层</label>
              <select v-model.number="editing.floorNo" class="input">
                <option v-for="f in store.data.floors" :key="f.no" :value="f.no">{{ f.name }}</option>
              </select>
            </div>
            <div class="form-row"><label>区域编码</label>
              <select v-model="editing.areaCode" class="input">
                <option>A 区</option><option>B 区</option><option>C 区</option><option>D 区</option>
              </select>
            </div>
            <div class="form-row"><label>业态分类</label>
              <select v-model="editing.category" class="input"><option v-for="c in categories" :key="c">{{ c }}</option></select>
            </div>
            <div class="form-row"><label>营业时间</label><input v-model="editing.openTime" class="input" placeholder="09:00" /></div>
            <div class="form-row"><label>打烊时间</label><input v-model="editing.closeTime" class="input" placeholder="22:00" /></div>
            <div class="form-row"><label>每周休息日（0=周日，逗号分隔）</label><input v-model="editing.restDays" class="input" placeholder="如 3" /></div>
            <div class="form-row"><label>人均消费（元）</label><input type="number" v-model.number="editing.avgPrice" class="input" /></div>
            <div class="form-row"><label>容量上限（人）</label><input type="number" v-model.number="editing.capacity" class="input" /></div>
            <div class="form-row"><label>服务率 μ（人/小时）</label><input type="number" v-model.number="editing.serviceRate" class="input" /></div>
            <div class="form-row"><label>客流热度系数</label><input type="number" step="0.1" v-model.number="editing.heat" class="input" /></div>
            <div class="form-row"><label>X 坐标（米）</label><input type="number" v-model.number="editing.x" class="input" /></div>
            <div class="form-row"><label>Z 坐标（米）</label><input type="number" v-model.number="editing.z" class="input" /></div>
            <div class="form-row"><label>周末营业（weekend_open）</label><input v-model="editing.weekendOpen" class="input" placeholder="留空表示同平日" /></div>
            <div class="form-row"><label>周末打烊（weekend_close）</label><input v-model="editing.weekendClose" class="input" placeholder="如 22:30" /></div>
            <div class="form-row span2"><label>特殊日期（special_dates）</label>
              <span class="inline-fields">
                <input v-model="editing.specialDate" class="input xs" placeholder="MM-DD" />
                <input v-model="editing.specialOpen" class="input xs" placeholder="营业" />
                <input v-model="editing.specialClose" class="input xs" placeholder="打烊" />
                <input v-model="editing.specialNote" class="input xs wide2" placeholder="说明，如国庆节延长营业" />
              </span>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost btn-sm" @click="editOpen=false">取消</button>
            <button class="btn btn-primary btn-sm" @click="saveMerchant">保存（待发布）</button>
          </div>
        </div>
      </div>

      <!-- 产品编辑弹窗 -->
      <div class="modal-mask" v-if="pOpen" @click.self="pOpen=false">
        <div class="modal narrow">
          <div class="modal-head"><h4>{{ pEditing.id ? '编辑产品' : '新增产品' }}</h4><button class="x" @click="pOpen=false">×</button></div>
          <div class="modal-body form-grid">
            <div class="form-row span2"><label>产品名称</label><input v-model="pEditing.productName" class="input" /></div>
            <div class="form-row"><label>产品分类</label>
              <select v-model="pEditing.category" class="input"><option>主食</option><option>饮品</option><option>甜点</option><option>小吃</option><option>其他</option></select>
            </div>
            <div class="form-row"><label>现价（元）</label><input type="number" v-model.number="pEditing.price" class="input" /></div>
            <div class="form-row"><label>原价（可空）</label><input type="number" v-model.number="pEditing.originalPrice" class="input" /></div>
            <div class="form-row"><label>招牌 / 折扣</label>
              <div class="switch-row">
                <label class="sw"><input type="checkbox" v-model="pEditing.isSignature" /> 招牌产品</label>
                <label class="sw"><input type="checkbox" v-model="pEditing.isDiscounted" /> 折扣标识</label>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost btn-sm" @click="pOpen=false">取消</button>
            <button class="btn btn-primary btn-sm" @click="saveProduct">保存</button>
          </div>
        </div>
      </div>
    </div>`
  };

  global.MallViews = global.MallViews || {};
  global.MallViews.AdminView = AdminView;
})(window);
