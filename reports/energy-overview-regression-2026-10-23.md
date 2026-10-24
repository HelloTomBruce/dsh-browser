# 节能概览页面回归测试报告

- **日期**: 2026-10-23
- **URL**: http://192.168.0.124:7001/#/WirelessPowerSaving/EnergySavingOverview
- **环境**: 192.168.0.124:7001，账号：超管（手工登录）

## 测试结果总览

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 1 | 页面加载与初始渲染 | ✅ 通过 | 标题/指标卡/图表卡片全部渲染，无空白与报错 |
| 2 | 地市切换（浙江省→杭州市） | ✅ 通过 | 下拉正常，接口带 cityCode=3301 联动，数据刷新正确 |
| 3 | 日期切换（2026-10-22→10-21） | ✅ 通过 | 接口 statDate 参数正确联动，指标刷新 |
| 4 | 网络维度切换（4G能耗→5G能耗） | ✅ 通过 | cityDayDetail netType=NR 正确请求并刷新表格 |
| 5 | 场景节能下拉 | ⚠️ 环境数据缺失 | sceneDay/sceneDaily 返回空数组，下拉无选项，三个场景图表显示"暂无数据"，前端空态处理正确 |
| 6 | 页面板块设置（设 置） | ❌ 缺陷 | 保存接口业务失败，设置不生效（见缺陷1） |
| 7 | 网络异常检查 | ✅ 通过 | 全程无 4xx/5xx 传输层失败请求 |

## 缺陷清单

### 缺陷1（未提交禅道，按用户要求跳过）
- **标题**: 页面板块设置保存失败：POST panelConfig 业务 code=500
- **复现**: 设 置 → 修改布局模式（紧凑→宽松）或取消勾选板块 → 确定
- **现象**: `POST /MAIN_API/wireless/energy/largeScreen/panelConfig` HTTP 200，但业务响应 `{"code":500,"msg":"Transaction synchronization is not active"}`；配置未持久化（GET 仍返回 layoutMode=1），页面板块无变化
- **初步分析**: 后端保存缺事务上下文（@Transactional 未生效），建议后端排查
- **证据截图**: .dsh-browser/screenshots/bug-panelConfig-save-fail.png

## 关键接口验证记录（均 200）

- GET largeScreen/dayTotal、cityDaily、provinceDay、cityDayDetail(LTE/NR)、hourStat、sceneDay、sceneDaily、panelConfig
- POST BI_API/chartData/getData（指标卡数据）

## 结论

页面核心功能（筛选联动、数据加载、图表空态）回归通过；发现 1 个后端保存类缺陷，建议修复后复验板块设置功能。
