/* =========================================================
 * 顾客端 · 商户列表面板
 * 关键词搜索、业态/状态筛选、人气与排队排序、一键导航
 * ========================================================= */
(function (global) {
  'use strict';
  var Vue = global.Vue;
  var ref = Vue.ref, computed = Vue.computed, watch = Vue.watch, onMounted = Vue.onMounted, nextTick = Vue.nextTick;
  var U = global.MallUI;
  var toast = U.toast, fmtTime = U.fmtTime;

  var MerchantPanel = {
    name: 'MerchantPanel',
    props: ['store'],
    setup(props) {
      var store = props.store, state = store.state;
      var list = computed(function () { return store.filteredMerchants(); });
      function navigate(m) {
        store.select({ kind: 'merchant', id: m.id });
        store.navigateTo('merchant', m.id);
        if (state.route) toast('已规划前往「' + m.name + '」的最优路径');
        else if (state.routeError) toast(state.routeError, 'warn');
      }
      return { store: store, state: store.state, list: list, navigate: navigate };
    },
    template: `
    <aside class="panel left">
      <div class="search-box">
        <span class="ico">🔍</span>
        <input v-model="state.keyword" placeholder="搜索商户 / 招牌菜品…" />
        <button v-if="state.keyword" class="clear" @click="state.keyword=''">×</button>
      </div>
      <div class="filters">
        <div class="chips">
          <button class="chip" :class="{active: state.categoryFilter==='全部'}" @click="state.categoryFilter='全部'">全部业态</button>
          <button v-for="c in store.data.categories" :key="c" class="chip" :class="{active: state.categoryFilter===c}" @click="state.categoryFilter=c">{{ c }}</button>
        </div>
        <div class="chips sub">
          <button class="chip sm" :class="{active: state.statusFilter==='全部'}" @click="state.statusFilter='全部'">全部状态</button>
          <button class="chip sm" :class="{active: state.statusFilter==='open'}" @click="state.statusFilter='open'">营业中</button>
          <button class="chip sm" :class="{active: state.statusFilter==='closing'}" @click="state.statusFilter='closing'">即将打烊</button>
          <button class="chip sm" :class="{active: state.statusFilter==='closed'}" @click="state.statusFilter='closed'">已打烊</button>
        </div>
        <div class="filter-row">
          <select v-model="state.floorFilter" class="mini-select">
            <option value="全部">全部楼层</option>
            <option v-for="f in store.data.floors" :key="f.no" :value="String(f.no)">{{ f.name }}</option>
          </select>
          <select v-model="state.sortBy" class="mini-select">
            <option value="default">默认排序</option>
            <option value="heat">按人气</option>
            <option value="wait">按排队</option>
            <option value="price">按人均</option>
          </select>
          <span class="count">{{ list.length }} 家</span>
        </div>
      </div>

      <div class="merchant-list">
        <div v-for="m in list" :key="m.id" class="merchant-item" :class="{sel: state.selectedId===m.id && state.selectedKind==='merchant'}"
             @click="store.select({kind:'merchant', id:m.id})">
          <div class="mi-head">
            <span class="mi-name">{{ m.name }}</span>
            <span v-if="store.realtimeOf(m).abnormal" class="badge st-unknown" title="超过 5 分钟未收到更新">数据异常</span>
            <span v-else class="badge" :class="store.STATUS_META[store.judgeStatus(m)].cls">{{ store.STATUS_META[store.judgeStatus(m)].text }}</span>
          </div>
          <div class="mi-meta">
            <span>{{ store.floorsOf(m.floorNo).label }} · {{ m.areaCode }}</span>
            <span class="sep">|</span><span>{{ m.category }}</span>
            <span class="sep">|</span><span>人均 ¥{{ m.avgPrice }}</span>
          </div>
          <div class="mi-rt">
            <span class="rt-num"><i class="dot blue"></i>{{ store.realtimeOf(m).currentCount }}<em>人</em></span>
            <span class="rt-num warn"><i class="dot orange"></i>{{ store.realtimeOf(m).queueCount }}<em>人排队</em></span>
            <span class="rt-num">{{ store.realtimeOf(m).waitMinutes }}<em>分钟</em></span>
            <button class="btn btn-primary btn-xs" @click.stop="navigate(m)">导航</button>
          </div>
        </div>
        <div v-if="!list.length" class="empty">没有符合条件的商户，试试调整筛选条件</div>
      </div>
    </aside>`
  };

  U.MerchantPanel = MerchantPanel;
})(window);
