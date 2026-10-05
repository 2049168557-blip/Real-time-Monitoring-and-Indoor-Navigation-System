/* =========================================================
 * 商场实时监测与室内导航系统 —— 基础数据与室内拓扑图构建
 * 坐标系依据《需求规格说明书》附录 C：
 *   原点位于商场一层平面图西南角；X 轴向东、Z 轴向北（单位：米）
 *   Y 轴为楼层高度方向，层高 4.5 米
 * 数据来源：商户 / 产品为“手工录入”仿真基础数据，实时客流为“仿真数据”
 * ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 1. 建筑与楼层的几何参数 ---------- */
  var LAYOUT = {
    width: 96,        // 东西向长度 (X)
    depth: 64,        // 南北向深度 (Z)
    floorHeight: 4.5, // 层高
    wallThickness: 0.4,
    corridorHalf: 3,
    vLines: [24, 48, 72], // 纵向（南北）走廊中心线 X
    hLines: [21, 42],     // 横向（东西）走廊中心线 Z
    // 纵向走廊之间的店铺街区（列）
    colRanges: [[0, 21], [27, 45], [51, 69], [75, 96]],
    // 横向走廊之间的店铺街区（行）
    rowRanges: [[0, 18], [24, 39], [45, 64]]
  };

  /* 每个楼层的分区 ../ंड blocks 切分数（合计均为 18 间，四层共 72 家商户） */
  var FLOOR_SPLITS = {
    '-1': [2, 1, 2, 1, 2, 2, 1, 2, 1, 2, 1, 1],
    '1': [1, 2, 2, 2, 1, 2, 2, 1, 1, 1, 2, 1],
    '2': [2, 2, 1, 1, 1, 2, 2, 2, 1, 1, 1, 2],
    '3': [1, 1, 2, 2, 2, 1, 1, 1, 2, 2, 2, 1]
  };

  var FLOORS = [
    { no: -1, name: 'B1 地下一层', label: 'B1', title: '超市 · 快餐 · 生活服务' },
    { no: 1, name: '1F 一层', label: '1F', title: '国际名品 · 美妆 · 数码' },
    { no: 2, name: '2F 二层', label: '2F', title: '服饰 · 鞋包 · 运动' },
    { no: 3, name: '3F 三层', label: '3F', title: '餐饮 · 娱乐 · 儿童' }
  ];

  var AREA_CODE = ['A 区', 'B 区', 'C 区', 'D 区'];

  /* ---------- 2. 商户名录（按楼层归属，含业态、人均、招牌） ---------- */
  // cat: 业态分类；avg: 人均消费（元）；hot: 客流热度系数；dishes: 招牌
  var DIRECTORY = {
    '-1': [
      { name: '永辉超市 Bravo', cat: '零售', avg: 85, hot: 1.5, cap: 160, dishes: ['进口零食礼包', '当日鲜奶', '有机蔬菜组合'] },
      { name: '便利蜂', cat: '零售', avg: 22, hot: 1.2, cap: 60, dishes: ['关东煮套餐', '现磨咖啡', '饭团 combo'] },
      { name: '屈臣氏', cat: '美妆', avg: 95, hot: 1.0, cap: 70, dishes: ['补水面膜套装', '氨基酸洁面', '防晒喷雾'] },
      { name: '大参林药房', cat: '服务', avg: 68, hot: 0.7, cap: 40, dishes: ['感冒常备包', '维生素 C 咀嚼片', '医用外科口罩'] },
      { name: '花点时间花店', cat: '服务', avg: 128, hot: 0.5, cap: 30, dishes: ['春日混搭花束', '永生花礼盒', '周花订阅'] },
      { name: '衣贝洁干洗', cat: '服务', avg: 48, hot: 0.6, cap: 30, dishes: ['羽绒服清洗', '西装熨烫', '皮具护理'] },
      { name: '星宇手机快修', cat: '数码', avg: 186, hot: 0.6, cap: 30, dishes: ['更换原装电池', '屏幕总成换新', '整机清灰保养'] },
      { name: '大食代美食广场', cat: '餐饮', avg: 45, hot: 1.6, cap: 180, dishes: ['石锅拌饭', '港式烧腊饭', '现榨甘蔗汁'] },
      { name: '蜜雪冰城', cat: '餐饮', avg: 12, hot: 1.4, cap: 50, dishes: ['冰鲜柠檬水', '摇摇奶昔', '圣代'] },
      { name: '正新鸡排', cat: '餐饮', avg: 18, hot: 1.1, cap: 40, dishes: ['大鸡排', '盐酥鸡', '地瓜条'] },
      { name: '杨国福麻辣烫', cat: '餐饮', avg: 36, hot: 1.3, cap: 70, dishes: ['番茄浓汤麻辣烫', '麻酱小面', '炸串拼盘'] },
      { name: '瑞幸咖啡', cat: '餐饮', avg: 22, hot: 1.3, cap: 40, dishes: ['生椰拿铁', '丝绒拿铁', '芝士啵啵茶'] },
      { name: '绝味鸭脖', cat: '餐饮', avg: 32, hot: 0.9, cap: 30, dishes: ['招牌鸭脖', '藕片', '卤鸭锁骨'] },
      { name: '面包新语', cat: '餐饮', avg: 30, hot: 0.9, cap: 40, dishes: ['松松面包', '草莓奶油蛋糕', '菠萝包'] },
      { name: '张亮麻辣烫', cat: '餐饮', avg: 35, hot: 1.1, cap: 60, dishes: ['骨汤麻辣烫', '宽粉套餐', '虎皮凤爪'] },
      { name: '华莱士·全鸡汉堡', cat: '餐饮', avg: 25, hot: 1.0, cap: 50, dishes: ['全鸡汉堡套餐', '辣翅买一送一', '蜜汁手扒鸡'] },
      { name: '一点点奶茶', cat: '餐饮', avg: 15, hot: 1.1, cap: 35, dishes: ['四季奶青', '红茶玛奇朵', '波霸奶茶'] },
      { name: '老乡鸡', cat: '餐饮', avg: 28, hot: 1.2, cap: 80, dishes: ['肥西老母鸡汤', '梅干菜蒸肉', '竹笋蒸鸡翅'] }
    ],
    '1': [
      { name: 'ZARA', cat: '服饰', avg: 460, hot: 1.3, cap: 120, dishes: ['春季风衣', '阔腿西装裤', '真皮托特包'] },
      { name: 'UNIQLO 优衣库', cat: '服饰', avg: 285, hot: 1.6, cap: 150, dishes: ['AIRISM 圆领 T', '摇粒绒外套', '宽松直筒牛仔'] },
      { name: 'H&M', cat: '服饰', avg: 300, hot: 1.1, cap: 110, dishes: ['针织开衫', '缎面连衣裙', 'logo 卫衣'] },
      { name: 'URBAN REVIVO', cat: '服饰', avg: 520, hot: 1.0, cap: 90, dishes: ['醋酸缎面衬衫', '廓形西装', '法式连衣裙'] },
      { name: '丝芙兰 SEPHORA', cat: '美妆', avg: 480, hot: 1.0, cap: 70, dishes: ['口红礼盒', '精华水', '卸妆油'] },
      { name: '周大福', cat: '美妆', avg: 3200, hot: 0.5, cap: 40, dishes: ['传承古法手镯', '婚嫁金镯', '钻石项链'] },
      { name: '兰蔻专柜', cat: '美妆', avg: 920, hot: 0.6, cap: 40, dishes: ['小黑瓶精华', '菁纯面霜', '持妆粉底液'] },
      { name: '华为智能生活馆', cat: '数码', avg: 2600, hot: 1.2, cap: 80, dishes: ['Mate 系列旗舰', 'MateBook 笔记本', '智慧屏'] },
      { name: '小米之家', cat: '数码', avg: 1500, hot: 1.2, cap: 80, dishes: ['小米手机', '米家扫地机器人', '智能手表'] },
      { name: 'Apple 授权体验店', cat: '数码', avg: 4200, hot: 1.0, cap: 60, dishes: ['iPhone', 'MacBook Air', 'AirPods Pro'] },
      { name: 'NIKE 耐克', cat: '运动', avg: 620, hot: 1.2, cap: 90, dishes: ['Air Force 1', 'Pegasus 跑鞋', 'Dri-FIT 速干 T'] },
      { name: 'adidas 阿迪达斯', cat: '运动', avg: 550, hot: 1.1, cap: 90, dishes: ['Ultraboost', '三叶草卫衣', 'Samba 经典款'] },
      { name: '星巴克 Starbucks', cat: '餐饮', avg: 45, hot: 1.6, cap: 90, dishes: ['太妃榛果拿铁', '燕麦拿铁', '提拉米苏'] },
      { name: '喜茶 HEYTEA', cat: '餐饮', avg: 32, hot: 1.5, cap: 60, dishes: ['多肉葡萄', '芝芝芒芒', '烤黑糖波波牛乳'] },
      { name: '奈雪的茶', cat: '餐饮', avg: 38, hot: 1.2, cap: 60, dishes: ['霸气芝士草莓', '杨枝甘露', '软欧包'] },
      { name: '肯德基 KFC', cat: '餐饮', avg: 40, hot: 1.4, cap: 120, dishes: ['原味鸡', '香辣鸡腿堡', '蛋挞'] },
      { name: '海马体照相馆', cat: '服务', avg: 320, hot: 0.6, cap: 40, dishes: ['证件照精修', '结婚登记照', '职业形象照'] },
      { name: '施华洛世奇', cat: '美妆', avg: 1180, hot: 0.5, cap: 40, dishes: ['恶魔之眼项链', '天鹅手链', '水晶耳饰'] }
    ],
    '2': [
      { name: 'ONLY', cat: '服饰', avg: 480, hot: 1.0, cap: 80, dishes: ['高腰阔腿裤', '真丝衬衫', '风衣外套'] },
      { name: 'VERO MODA', cat: '服饰', avg: 520, hot: 0.9, cap: 80, dishes: ['法式针织裙', '通勤西装套装', '羊毛大衣'] },
      { name: '太平鸟女装', cat: '服饰', avg: 560, hot: 0.9, cap: 80, dishes: ['廓形西装', '碎花连衣裙', '短款羽绒服'] },
      { name: 'GXG', cat: '服饰', avg: 620, hot: 0.8, cap: 70, dishes: ['休闲西装外套', '质感针织衫', '直筒休闲裤'] },
      { name: '海澜之家', cat: '服饰', avg: 420, hot: 1.0, cap: 90, dishes: ['免烫衬衫', '羽绒服', '商务西裤'] },
      { name: '热风 hotwind', cat: '服饰', avg: 265, hot: 1.1, cap: 80, dishes: ['厚底乐福鞋', '通勤单鞋', '编织托特包'] },
      { name: '百丽 Belle', cat: '服饰', avg: 680, hot: 0.8, cap: 60, dishes: ['软皮短靴', '尖头高跟鞋', '水桶包'] },
      { name: 'ECCO 爱步', cat: '服饰', avg: 1080, hot: 0.6, cap: 50, dishes: ['BIOM 健步鞋', '软牛皮休闲鞋', '高尔夫鞋'] },
      { name: '安踏 ANTA', cat: '运动', avg: 380, hot: 1.1, cap: 90, dishes: ['C37 跑鞋', '冰丝速干套装', '氢科技羽绒服'] },
      { name: '李宁 LINING', cat: '运动', avg: 460, hot: 1.1, cap: 90, dishes: ['䨻科技跑鞋', '中国李宁卫衣', '羽毛球拍'] },
      { name: 'FILA 斐乐', cat: '运动', avg: 720, hot: 1.0, cap: 80, dishes: ['Fusion 系列外套', '老爹鞋', '撞色卫衣'] },
      { name: '迪卡侬 DECATHLON', cat: '运动', avg: 350, hot: 1.0, cap: 120, dishes: ['登山冲锋衣', '露营折叠椅', '跳绳 amp 哑铃'] },
      { name: '名创优品', cat: '零售', avg: 48, hot: 1.3, cap: 90, dishes: ['香薰系列', 'we bare bears 联名', '收纳好物'] },
      { name: '泡泡玛特 POP MART', cat: '零售', avg: 128, hot: 1.1, cap: 60, dishes: ['MOLLY 盲盒', 'SKULLPANDA', 'MEGA 珍藏系列'] },
      { name: '完美日记', cat: '美妆', avg: 180, hot: 0.8, cap: 50, dishes: ['名片唇釉', '动物眼影盘', '卸妆水'] },
      { name: '木九十眼镜', cat: '服务', avg: 520, hot: 0.5, cap: 40, dishes: ['钛架近视镜', '防蓝光镜片', '太阳镜'] },
      { name: '播 broadcast', cat: '服饰', avg: 480, hot: 0.7, cap: 60, dishes: ['复古印花裙', '水墨感外套', '飘带衬衫'] },
      { name: 'JNBY 江南布衣', cat: '服饰', avg: 780, hot: 0.6, cap: 60, dishes: ['廓形长外套', '不对称连衣裙', '羊毛围巾'] }
    ],
    '3': [
      { name: '海底捞火锅', cat: '餐饮', avg: 138, hot: 1.8, cap: 200, dishes: ['番茄锅底', '捞派滑牛肉', '捞面表演套餐'] },
      { name: '探鱼', cat: '餐饮', avg: 95, hot: 1.3, cap: 130, dishes: ['重庆豆花烤鱼', '香辣味清江鱼', '口水鸡'] },
      { name: '西贝莜面村', cat: '餐饮', avg: 122, hot: 1.2, cap: 140, dishes: ['莜面鱼鱼', '烤羊排', '黄米凉糕'] },
      { name: '太二酸菜鱼', cat: '餐饮', avg: 88, hot: 1.6, cap: 120, dishes: ['老坛子酸菜鱼', '芥末虾虾虾', '小酥肉'] },
      { name: '和府捞面', cat: '餐饮', avg: 56, hot: 1.2, cap: 90, dishes: ['草本猪软骨汤面', '麻辣牛肉拌面', '蟹黄小笼包'] },
      { name: '蛙来哒', cat: '餐饮', avg: 92, hot: 1.1, cap: 100, dishes: ['紫苏牛蛙锅', '双味牛蛙', '手打柠檬茶'] },
      { name: '九毛九山西面馆', cat: '餐饮', avg: 72, hot: 1.0, cap: 100, dishes: ['太钢牛肉面', '油泼扯面', '山西过油肉'] },
      { name: '汉舍川菜', cat: '餐饮', avg: 152, hot: 0.9, cap: 90, dishes: ['水煮牛肉', '辣子鸡', '开水白菜'] },
      { name: '绿茶餐厅', cat: '餐饮', avg: 82, hot: 1.2, cap: 120, dishes: ['绿茶烤肉', '面包诱惑', '火焰虾'] },
      { name: '漫咖啡', cat: '餐饮', avg: 62, hot: 0.8, cap: 80, dishes: ['生奶油汽车松饼', '冰滴咖啡', '水果松饼'] },
      { name: '满记甜品', cat: '餐饮', avg: 42, hot: 0.9, cap: 60, dishes: ['杨枝甘露', '榴莲忘返', '双皮奶'] },
      { name: '万达影城', cat: '娱乐', avg: 68, hot: 1.4, cap: 220, dishes: ['IMAX 情侣座', '爆米花双人套餐', '4D 厅特效票'] },
      { name: '大玩家电玩城', cat: '娱乐', avg: 82, hot: 1.1, cap: 140, dishes: ['100 币畅玩套餐', '抓娃娃专柜', '赛车模拟器'] },
      { name: '唱吧麦颂 KTV', cat: '娱乐', avg: 126, hot: 0.9, cap: 120, dishes: ['下午场欢唱套餐', '中包夜场', '果盘 + 酒水套餐'] },
      { name: '孩子王', cat: '儿童', avg: 205, hot: 1.0, cap: 110, dishes: ['奶粉专区', '纸尿裤组合', '儿童安全座椅'] },
      { name: '玩具反斗城', cat: '儿童', avg: 268, hot: 0.9, cap: 100, dishes: ['乐高城市系列', '变形金刚', '芭比梦幻屋'] },
      { name: '卡通尼乐园', cat: '儿童', avg: 152, hot: 1.1, cap: 120, dishes: ['旋转木马单次票', '全天畅玩票', '亲子套票'] },
      { name: '西西弗书店', cat: '零售', avg: 92, hot: 0.8, cap: 70, dishes: ['矢量咖啡', '文学类新书', '手账专区'] }
    ]
  };

  var CATEGORY_LIST = ['餐饮', '服饰', '美妆', '数码', '运动', '儿童', '娱乐', '服务', '零售'];

  /* M/M/c 排队模型中的服务率参数：单位容量每小时的顾客周转次数
     —— 餐饮翻台率低（每座每小时约 0.8 客），零售业态顾客进出快，几乎不产生排队 */
  var TURNOVER_BY_CATEGORY = {
    '餐饮': 1.1, '服饰': 3.0, '美妆': 3.0, '数码': 2.5, '运动': 2.8,
    '儿童': 1.0, '娱乐': 1.8, '服务': 1.8, '零售': 3.0
  };

  /* 服务业态的默认下午茶/服务项目模板（用于未单独配置招牌的商户） */
  var GENERIC_PRODUCTS = {
    '餐饮': [['主食', '招牌主菜'], ['主食', '主厨推荐套餐'], ['饮品', '自制饮品'], ['小吃', '开胃小食']],
    '服饰': [['其他', '当季主推款'], ['其他', '经典基础款'], ['其他', '设计师联名']],
    '美妆': [['其他', '明星单品'], ['其他', '套装礼盒'], ['其他', '专柜新品']],
    '数码': [['其他', '旗舰机型'], ['其他', '智能生态单品'], ['其他', '延保服务']],
    '运动': [['其他', '主推鞋款'], ['其他', '功能运动服'], ['其他', '训练装备']],
    '儿童': [['其他', '益智玩具套装'], ['其他', '亲子体验课'], ['其他', '会员储值卡']],
    '娱乐': [['其他', '畅玩套餐'], ['其他', '情侣套票'], ['其他', '会员充值']],
    '服务': [['其他', '标准服务'], ['其他', '尊享服务'], ['其他', '会员储值']],
    '零售': [['其他', '热销组合装'], ['其他', '会员专享价'], ['其他', '新品首发']]
  };

  /* ---------- 3. 工具函数 ---------- */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function floorBaseY(no) { return no >= 1 ? (no - 1) * LAYOUT.floorHeight : LAYOUT.floorHeight * -1; }
  function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ---------- 4. 生成店铺矩形、门址坐标 ---------- */
  var PAT_WALL = 0.5; // 分户墙厚度

  function buildUnits(floorNo) {
    var splits = FLOOR_SPLITS[String(floorNo)];
    var units = [];
    for (var c = 0; c < LAYOUT.colRanges.length; c++) {
      for (var r = 0; r < LAYOUT.rowRanges.length; r++) {
        var b = c * LAYOUT.rowRanges.length + r;
        var n = splits[b];
        var x0 = LAYOUT.colRanges[c][0], x1 = LAYOUT.colRanges[c][1];
        var z0 = LAYOUT.rowRanges[r][0], z1 = LAYOUT.rowRanges[r][1];
        var longEdge = (x1 - x0) >= (z1 - z0) ? 'x' : 'z';
        for (var i = 0; i < n; i++) {
          var rect, first = (i === 0), last = (i === n - 1);
          if (n === 1) {
            rect = { x: x0, z: z0, w: x1 - x0, d: z1 - z0 };
          } else if (longEdge === 'x') {
            var uw = (x1 - x0 - PAT_WALL * (n - 1)) / n;
            rect = { x: x0 + i * (uw + PAT_WALL), z: z0, w: uw, d: z1 - z0 };
          } else {
            var ud = (z1 - z0 - PAT_WALL * (n - 1)) / n;
            rect = { x: x0, z: z0 + i * (ud + PAT_WALL), w: x1 - x0, d: ud };
          }
          units.push({ block: b, col: c, row: r, index: i, total: n, first: first, last: last, axis: n === 1 ? longEdge : longEdge, rect: rect });
        }
      }
    }
    return units;
  }

  /* 计算店铺门址：优先选择紧邻走廊的一侧（符合双排式商铺的实际动线） */
  function doorOf(unit) {
    var rect = unit.rect, c = unit.col, r = unit.row;
    var cx = round2(rect.x + rect.w / 2), cz = round2(rect.z + rect.d / 2);
    // 街区四边是否紧邻走廊（由楼层格局推导）
    var bLeft = LAYOUT.colRanges[c][0] > 0.01;
    var bRight = LAYOUT.colRanges[c][1] < LAYOUT.width - 0.01;
    var bTop = LAYOUT.rowRanges[r][0] > 0.01;
    var bBottom = LAYOUT.rowRanges[r][1] < LAYOUT.depth - 0.01;
    // 沿 X 切分的铺位左右两侧只有首/末单元临街；沿 Z 切分的铺位左右两侧全部临街
    var vOk = (unit.axis === 'z') || unit.first || unit.last;
    var hOk = (unit.axis === 'x') || unit.first || unit.last;

    if (vOk && bLeft) return { x: round2(rect.x), z: cz };
    if (vOk && bRight) return { x: round2(rect.x + rect.w), z: cz };
    if (hOk && bTop) return { x: cx, z: round2(rect.z) };
    if (hOk && bBottom) return { x: cx, z: round2(rect.z + rect.d) };
    if (bTop) return { x: cx, z: round2(rect.z) };
    if (bBottom) return { x: cx, z: round2(rect.z + rect.d) };
    return { x: cx, z: cz };
  }

  /* ---------- 5. 生成商户与产品 ---------- */
  function buildMerchants() {
    var merchants = [], products = [], mid = 1000, pid = 5000;
    FLOORS.forEach(function (fl) {
      var units = buildUnits(fl.no);
      var dir = DIRECTORY[String(fl.no)].slice();
      dir.sort(function (a, b) { return b.cap - a.cap; }); // 大面积铺位优先给主力店
      units.sort(function (a, b) {
        return (b.rect.w * b.rect.d) - (a.rect.w * a.rect.d);
      });
      var rnd = mulberry32(fl.no * 977 + 13);
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        var tpl = dir[i % dir.length];
        var id = mid++;
        var rect = u.rect;
        var door = doorOf(u);
        var area = round2(rect.w * rect.d);
        var openSeed = rnd();
        var openTime = openSeed > 0.82 ? '10:30' : (openSeed > 0.68 ? '10:00' : '09:00');
        var lateShop = tpl.cat === '娱乐' || tpl.name.indexOf('KTV') >= 0;
        var closeTime = lateShop ? '24:00' : (openSeed > 0.9 ? '21:30' : '22:00');
        var tier = tpl.avg < 80 ? '经济型' : (tpl.avg <= 200 ? '中档' : '高端');
        // M/M/c：服务台数 c 按营业面积（约 50 座 / 服务台）推算；总服务率 μ = 容量 × 业态周转系数
        var channels = Math.max(1, Math.round(tpl.cap / 50));
        var serviceRate = Math.max(10, Math.round(tpl.cap * (TURNOVER_BY_CATEGORY[tpl.cat] || 1.5)));
        var m = {
          id: id,
          name: tpl.name,
          floorNo: fl.no,
          floorLabel: fl.label,
          areaCode: AREA_CODE[u.col],
          category: tpl.cat,
          rect: rect,
          x: round2(rect.x + rect.w / 2),
          z: round2(rect.z + rect.d / 2),
          w: round2(rect.w),
          d: round2(rect.d),
          area: area,
          door: { x: round2(door.x), z: round2(door.z) },
          openTime: openTime,
          closeTime: closeTime,
          crossMidnight: false,
          restDays: rnd() > 0.93 ? [Math.floor(rnd() * 7)] : [],
          // 周末独立营业时间（weekend_open / weekend_close，可选配置）
          weekend: rnd() > 0.62 ? { open: openSeed > 0.82 ? '10:00' : '09:30', close: lateShop ? '24:00' : '22:30' } : null,
          // 特殊日期营业时间（special_dates，如节假日调整），优先于常规与周末时间
          specialDates: rnd() > 0.84 ? [{
            date: todayMD(), open: '10:00', close: lateShop ? '24:00' : '23:00', note: '示例节假日延长营业'
          }] : [],
          avgPrice: tpl.avg,
          minPrice: round2(tpl.avg * 0.6),
          maxPrice: round2(tpl.avg * 1.6),
          priceTier: tier,
          priceNote: tpl.cat === '餐饮' ? '不含酒水与服务费' : '参考价，以门店实际标价为准',
          capacity: tpl.cap,
          channels: channels,
          serviceRate: serviceRate,
          heat: tpl.hot,
          rating: round2(4.2 + rnd() * 0.7),
          hotWords: [],
          desc: tpl.name + '位于' + fl.name + AREA_CODE[u.col] + '，营业面积约 ' + Math.round(area) + ' ㎡。'
        };
        merchants.push(m);

        // 特色产品
        var list = [];
        var src = (tpl.dishes && tpl.dishes.length ? tpl.dishes.map(function (n) {
          var cat = guessProductCat(n, tpl.cat);
          return [cat, n];
        }) : GENERIC_PRODUCTS[tpl.cat]);
        // 餐饮商户补充一款饮品，使"按分类筛选"有实际效果（论文 3.2.1 要求按分类筛选）
        if (tpl.cat === '餐饮') src.push(['饮品', DRINKS[id % DRINKS.length]]);
        for (var k = 0; k < src.length; k++) {
          var pcat = src[k][0], pname = src[k][1];
          var price = round2(Math.max(6, tpl.avg * (0.28 + rnd() * 0.5)));
          var orig = rnd() > 0.62 ? round2(price * (1.15 + rnd() * 0.35)) : null;
          list.push({
            id: pid++,
            merchantId: id,
            productName: pname,
            price: price,
            originalPrice: orig,
            isDiscounted: !!orig,
            isSignature: k < 2,
            category: pcat,
            imageUrl: productImage(pname, pcat),
            hotWords: k === 0 ? '招牌必点' : (k === 1 ? '人气推荐' : '')
          });
        }
        products.push.apply(products, list);
      }
    });
    return { merchants: merchants, products: products };
  }

  /* 当前日期 MM-DD，用于特殊日期营业时间的判定与演示数据生成 */
  function todayMD() {
    var d = new Date();
    return (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  /* 产品图片：教学演示场景无真实图片资源，按业态生成程序化占位示意图（SVG Data URI） */
  var PRODUCT_BG = { '主食': '#FFF3E0', '饮品': '#E8F5E9', '甜点': '#FCE4EC', '小吃': '#FFF8E1', '其他': '#EEF5FB' };
  function productImage(name, cat) {
    var bg = PRODUCT_BG[cat] || '#EEF5FB';
    var first = String(name).replace(/[^一-龥A-Za-z0-9]/g, '').slice(0, 1) || '荐';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="' + bg + '"/></linearGradient></defs>'
      + '<rect width="320" height="240" fill="url(#g)"/>'
      + '<circle cx="160" cy="104" r="54" fill="#FFFFFF" opacity="0.92"/>'
      + '<text x="160" y="120" font-size="46" text-anchor="middle" fill="#1F4E79" font-family="Microsoft YaHei,sans-serif">' + first + '</text>'
      + '<text x="160" y="196" font-size="20" text-anchor="middle" fill="#5A6B85" font-family="Microsoft YaHei,sans-serif">'
      + String(name).slice(0, 12) + '</text>'
      + '<text x="160" y="222" font-size="14" text-anchor="middle" fill="#9AA9BE" font-family="Microsoft YaHei,sans-serif">'
      + '示意图 · ' + cat + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  var DRINKS = ['鲜榨橙汁', '冰镇柠檬茶', '现磨豆浆', '桂花酸梅汤', '气泡水'];

  function guessProductCat(name, cat) {
    if (name.indexOf('饮') >= 0 || name.indexOf('茶') >= 0 || name.indexOf('咖啡') >= 0 || name.indexOf('水') >= 0 || name.indexOf('奶昔') >= 0) return '饮品';
    if (name.indexOf('蛋糕') >= 0 || name.indexOf('圣代') >= 0 || name.indexOf('甜') >= 0 || name.indexOf('松饼') >= 0 || name.indexOf('榴莲') >= 0) return '甜点';
    if (name.indexOf('小吃') >= 0 || name.indexOf('鸡排') >= 0 || name.indexOf('串') >= 0 || name.indexOf('鸭') >= 0 || name.indexOf('条') >= 0) return '小吃';
    if (cat === '餐饮') return '主食';
    return '其他';
  }

  /* ---------- 6. 室内拓扑图 ---------- */
  /* 走廊网格节点（每层 16 个交叉/端点节点） */
  function corridorNodes(floorNo) {
    var nodes = [], seen = {};
    function add(x, z) {
      var code = 'cross_' + floorNo + '_' + x + '_' + z;
      if (seen[code]) return;
      seen[code] = 1;
      nodes.push({ code: code, type: 'cross', floorNo: floorNo, x: x, z: z, link: [] });
    }
    var zs = [2, 21, 42, 62], xs = [2, 24, 48, 72, 94];
    LAYOUT.vLines.forEach(function (vx) { zs.forEach(function (z) { add(vx, z); }); });
    LAYOUT.hLines.forEach(function (hz) { xs.forEach(function (x) { add(x, hz); }); });
    return nodes;
  }

  function linkBi(nodeMap, a, b) {
    var A = nodeMap[a], B = nodeMap[b];
    if (!A || !B || a === b) return;
    if (A.link.indexOf(b) < 0) A.link.push(b);
    if (B.link.indexOf(a) < 0) B.link.push(a);
  }

  function buildTopology(merchants, facilities) {
    var nodeMap = {}, nodes = [];
    function put(n) { nodes.push(n); nodeMap[n.code] = n; return n; }

    FLOORS.forEach(function (fl) {
      corridorNodes(fl.no).forEach(put);
    });

    // 走廊内部连通（同层）
    FLOORS.forEach(function (fl) {
      var zs = [2, 21, 42, 62], xs = [2, 24, 48, 72, 94];
      LAYOUT.vLines.forEach(function (vx) {
        for (var i = 0; i < zs.length - 1; i++) {
          linkBi(nodeMap, 'cross_' + fl.no + '_' + vx + '_' + zs[i], 'cross_' + fl.no + '_' + vx + '_' + zs[i + 1]);
        }
      });
      LAYOUT.hLines.forEach(function (hz) {
        for (var i = 0; i < xs.length - 1; i++) {
          linkBi(nodeMap, 'cross_' + fl.no + '_' + xs[i] + '_' + hz, 'cross_' + fl.no + '_' + xs[i + 1] + '_' + hz);
        }
      });
    });

    // 店铺门节点 → 最近走廊节点
    merchants.forEach(function (m) {
      put({ code: 'shop_' + m.id, type: 'shop', floorNo: m.floorNo, x: m.door.x, z: m.door.z, merchantId: m.id, link: [] });
      var best = null, bd = 1e9;
      nodes.forEach(function (n) {
        if (n.type !== 'cross' || n.floorNo !== m.floorNo) return;
        var dd = (n.x - m.door.x) * (n.x - m.door.x) + (n.z - m.door.z) * (n.z - m.door.z);
        if (dd < bd) { bd = dd; best = n; }
      });
      if (best) linkBi(nodeMap, 'shop_' + m.id, best.code);
    });

    // 设施节点
    facilities.forEach(function (f) {
      var n = put({
        code: f.nodeCode, type: f.type, floorNo: f.floorNo, x: f.x, z: f.z,
        facilityId: f.id, link: []
      });
      var best = null, bd = 1e9;
      nodes.forEach(function (c) {
        if (c.type !== 'cross' || c.floorNo !== f.floorNo) return;
        var dd = (c.x - f.x) * (c.x - f.x) + (c.z - f.z) * (c.z - f.z);
        if (dd < bd) { bd = dd; best = c; }
      });
      if (best) linkBi(nodeMap, n.code, best.code);
    });

    // 垂直交通：同一电梯 / 扶梯在相邻楼层节点之间建立双向链路
    ['elevator', 'escalator'].forEach(function (type) {
      facilities.filter(function (f) { return f.type === type; }).forEach(function (f) {
        for (var i = 0; i < FLOORS.length - 1; i++) {
          var low = FLOORS[i].no, high = FLOORS[i + 1].no;
          var a = type + '_' + low + '_' + f.seq;
          var b = type + '_' + high + '_' + f.seq;
          if (nodeMap[a] && nodeMap[b]) linkBi(nodeMap, a, b);
        }
      });
    });

    return { nodes: nodes, map: nodeMap };
  }

  /* ---------- 7. 公共设施 ---------- */
  function buildFacilities() {
    var list = [], fid = 7000;
    var defs = {
      elevator: [{ x: 48, z: 21 }, { x: 48, z: 42 }],
      escalator: [{ x: 24, z: 21 }, { x: 72, z: 42 }],
      wc: [{ x: 5.5, z: 21 }, { x: 90.5, z: 42 }],
      service: [{ x: 48, z: 2 }],
      entrance: [{ x: 24, z: 2 }, { x: 94, z: 21 }, { x: 2, z: 42 }]
    };
    FLOORS.forEach(function (fl) {
      ['elevator', 'escalator', 'service', 'entrance'].forEach(function (type) {
      defs[type].forEach(function (p, idx) {
        var meta = facilityMeta(type, idx, fl);
        if (!meta) return;
        list.push({
          id: fid++, type: type, subtype: meta.subtype, name: meta.name,
          floorNo: fl.no, x: p.x, z: p.z, seq: idx + 1,
          nodeCode: type + '_' + fl.no + '_' + (idx + 1),
          // 运行方向：客梯双向，扶梯区分上行 / 下行 / 双向（论文 3.2.5 要求）
          direction: meta.direction || null,
          desc: meta.desc
        });
      });
      });
      // 卫生间细化：男 / 女 / 母婴室 / 无障碍
      defs.wc.forEach(function (p, idx) {
        var idxBase = idx === 0 ? 0 : 2;
        var group = idx === 0
          ? [['male', '男卫生间', -2.2, 1], ['female', '女卫生间', 2.2, 1]]
          : [['female', '女卫生间', -2.2, 1], ['accessible', '无障碍卫生间', 2.2, 1]];
        var baby = idx === 0 ? null : ['baby', '母婴室', -7.5, 1];
        group.forEach(function (g, k) {
          list.push({
            id: fid++, type: 'wc', subtype: g[0], name: g[1], floorNo: fl.no,
            x: round2(p.x + g[2]), z: round2(p.z + g[3]),
            nodeCode: 'wc_' + fl.no + '_' + (idxBase + k + 1),
            desc: idx === 0 ? 'A 区横向走廊西端，含独立母婴护理台' : 'D 区横向走廊东端，含无障碍厕位'
          });
        });
        if (baby) {
          list.push({
            id: fid++, type: 'wc', subtype: baby[0], name: baby[1], floorNo: fl.no,
            x: round2(p.x + baby[2]), z: round2(p.z + baby[3]),
            nodeCode: 'wc_' + fl.no + '_' + (idxBase + 3),
            desc: '含独立哺乳室、婴儿护理台与温奶器'
          });
        }
      });
      // 便民设施（论文 3.2.4 公共设施标注）：直饮水 / 休息区 / ATM 每层设置，
      // 新能源充电桩仅地下 B1 停车场配置
      var amenityDefs = [
        { sub: 'water', name: '直饮水处', desc: '提供常温/温水直饮水，配备一次性纸杯与儿童低位水龙头' },
        { sub: 'rest', name: '公共休息区', desc: '设休闲座椅与手机充电插座，供顾客小憩与临时办公' },
        { sub: 'atm', name: 'ATM 自助银行', desc: '含多家银行 ATM 与自助缴费、充值终端' }
      ];
      if (fl.no === -1) amenityDefs.push({ sub: 'charging', name: '新能源充电桩', desc: '地下停车场快充桩，扫码启动，支持主流充电卡与 App 预约' });
      var amenityPos = { water: [12, 22], rest: [36, 43], atm: [60, 43], charging: [84, 22] };
      amenityDefs.forEach(function (a) {
        var pp = amenityPos[a.sub];
        list.push({
          id: fid++, type: 'amenity', subtype: a.sub, name: a.name, floorNo: fl.no,
          x: pp[0], z: pp[1], nodeCode: 'amenity_' + fl.no + '_' + a.sub,
          desc: a.desc
        });
      });
    });
    return list;
  }

  function facilityMeta(type, idx, fl) {
    if (type === 'elevator') {
      return {
        subtype: '客梯', name: '客梯 ' + (idx + 1) + ' 号', direction: '双向',
        desc: '上下行双向运行，可直达 B1 至 3F，轿厢额定载客 13 人；跨楼层导航默认优先选择'
      };
    }
    if (type === 'escalator') {
      // 扶梯成对布置：1 号上行、2 号下行
      var dir = idx === 0 ? '上行' : '下行';
      return {
        subtype: dir + '扶梯', name: '自动扶梯 ' + (idx + 1) + ' 号', direction: dir,
        desc: '运行方向：' + dir + '（相邻扶梯反向运行）；位于中庭两侧，高峰时段客流较大'
      };
    }
    if (type === 'service') {
      return fl.no === 1
        ? { subtype: '总服务台', name: '一层总服务台', desc: '提供会员办理、失物招领、轮椅借用、发票开具服务' }
        : { subtype: '楼层服务台', name: fl.label + ' 楼层服务台', desc: '提供问询、寻人广播、应急药品与充电宝租借' };
    }
    if (type === 'entrance') {
      var names = [
        { n: '南主入口（地铁 A 口方向）', d: '接驳地铁 2 号线 A 出口，步行约 120 米' },
        { n: '东入口（地面停车场方向）', d: '紧邻东侧地面停车场，设出租车落客区' },
        { n: '西入口（公交枢纽方向）', d: '近公交站「中心广场」站，途经 6 条公交线路' }
      ];
      if (fl.no !== 1) {
        var garage = [
          { n: fl.label + ' 车库连廊（B 区）', d: '连接地下停车场 B 区，设反向寻车终端' },
          { n: fl.label + ' 车库连廊（C 区）', d: '连接地下停车场 C 区，含无障碍电梯厅' },
          { n: fl.label + ' 卸货通道', d: '商户专用货运通道，非营业时段开放' }
        ];
        return { subtype: '车库通道', name: garage[idx].n, desc: garage[idx].d };
      }
      return { subtype: '出入口', name: names[idx].n, desc: names[idx].d };
    }
    return null;
  }

  /* ---------- 8. 组装输出 ---------- */
  function build() {
    var mp = buildMerchants();
    var facilities = buildFacilities();
    var topo = buildTopology(mp.merchants, facilities);
    return {
      layout: LAYOUT,
      floors: FLOORS,
      categories: CATEGORY_LIST,
      merchants: mp.merchants,
      products: mp.products,
      facilities: facilities,
      nodes: topo.nodes,
      nodeMap: topo.map
    };
  }

  global.MallData = { build: build, layout: LAYOUT, floors: FLOORS, floorBaseY: floorBaseY, categories: CATEGORY_LIST, mulberry32: mulberry32 };
})(window);
