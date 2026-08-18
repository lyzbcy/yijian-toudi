// 各招聘站预设城市映射表。
// 背景：各家招聘站的「期望工作城市」只接受预设列表（如腾讯没有「苏州」），app 里的自由文本城市
// 需要映射到各家最接近的预设城市。此表是字段映射层，不是岗位筛选层。
//
// 数据来源：playwright 实测各家招聘站的城市下拉选项（2026-07-27）。
// 格式：PRESET_CITIES[companyId] = ['北京','上海',...]；CITY_FALLBACK[appCity] = '招聘站最接近的预设城市'

// 各家招聘站的预设城市列表（实测腾讯，其余为飞书 ATS 同源/待实测标注）
const PRESET_CITIES = {
  tencent: ['北京', '上海', '广州', '深圳', '成都', '杭州', '中国香港', '中国台北', '中国澳门', '武汉', '长沙', '重庆', '南京', '西安', '厦门', '苏州', '天津', '青岛', '大连', '海外'],
  bytedance: ['北京', '上海', '深圳', '杭州', '成都', '广州', '武汉', '南京', '长沙', '厦门', '重庆', '西安', '苏州', '天津', '青岛', '海外'], // 飞书 ATS，待实测补全
  xiaomi: ['北京', '上海', '深圳', '杭州', '成都', '广州', '武汉', '南京', '苏州', '海外'], // 飞书 ATS，待实测补全
  jd: ['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '南京', '苏州', '天津'], // 待实测补全
  meituan: ['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '南京', '苏州', '厦门'], // 待实测补全
  baidu: ['北京', '上海', '深圳', '广州', '成都', '杭州', '武汉', '南京', '苏州'] // 反爬，无法实测，按通用推测
};

// app 城市 → 招聘站预设城市的回退映射（app 城市不在预设时，找最近的）。
// 这里只列「app 常见但部分招聘站没有」的城市，其余城市名相同则直接用。
const CITY_FALLBACK = {
  '苏州': '上海', // 苏州不在字节等预设里时，退到上海（最近的一线）
  '无锡': '上海',
  '宁波': '杭州',
  '佛山': '广州',
  '东莞': '深圳',
  '珠海': '深圳',
  '昆山': '上海'
};

// 把 app 的期望城市列表映射到某家招聘站的预设城市。
// 输入：appCities=['苏州','上海','杭州']，companyId='tencent'
// 输出：['苏州','上海','杭州']（腾讯有苏州）或 ['上海','杭州']（字节没苏州，苏州退上海去重）
function mapToPresetCities(appCities, companyId) {
  const preset = PRESET_CITIES[companyId] || [];
  const result = [];
  const seen = new Set();
  for (const city of appCities) {
    const trimmed = String(city || '').trim();
    if (!trimmed) continue;
    // 优先用原名（如果在预设里）
    const used = preset.includes(trimmed) ? trimmed : (CITY_FALLBACK[trimmed] || null);
    if (used && !seen.has(used)) {
      seen.add(used);
      result.push(used);
    }
  }
  return result;
}

module.exports = { PRESET_CITIES, CITY_FALLBACK, mapToPresetCities };
