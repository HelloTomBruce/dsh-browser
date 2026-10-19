# dsh-browser-view 修复/改进方案

> **状态**:全部完成(2026-10-19,52/52 测试通过)。
> Phase 0:三处 schema 修复 + 录制语义修复 + 契约测试;额外抓到并修复第 4 个同类
> bug(`browser_replay` 全通过时 `stoppedAt:null` 与 integer schema 冲突)。
> Phase 1:`browser_select`(第 28 个工具)、elements label/dropdownOptions、
> download wait、save warnings。
> Phase 2:`workspaceDir` 配置 + 解析日志、快照文本压缩(compressText)、
> network wait 超时附最近请求摘要。
> Phase 3:`record save stripReads`、`network stats` 聚合。

> 来源:2026-10-19 对「网络能源管理系统 · 白名单管理」页面的实测。测试过程暴露
> 了插件自身的若干缺陷与低效环节,本方案按 P0(修 bug)→ P1(功能)→ P2(体验)
> → P3(效率)排列,每项给出改动点、接口设计与验收标准。

## 背景:实测中发现的问题清单

| # | 现象 | 根因(源码位置) | 级别 |
| --- | --- | --- | --- |
| 1 | `browser_network {action:"clear"}` 报 `value.entries must be an array` | `networkTool` 返回 `{cleared:true, entries:0}`,与 outputSchema 中 `entries: array` 冲突([tools.ts:639](../src/browser/tools.ts#L639)) | P0 |
| 2 | `browser_network {action:"wait"}` 报 `value.waitMs is not a declared property` | 返回值带未声明字段 `waitMs`,且表达式 `Date.now()+timeoutMs-deadline-(同式)+0` 恒等于 0,是半成品([tools.ts:653](../src/browser/tools.ts#L653)) | P0 |
| 3 | `browser_record {action:"save"}` 报 `value.file is not a declared property` | 返回未声明字段 `file`([tools.ts:684](../src/browser/tools.ts#L684),[register.ts:878](../src/browser/register.ts#L878)) | P0 |
| 4 | `record start/stop` 边界无效:save 忽略录制 buffer,取全局轨迹最后 100 条,把录制前的无关步骤(如其他网站的探查)也存了进去 | `stopRecording()` 的返回值被丢弃([tools.ts:674](../src/browser/tools.ts#L674));save 用 `testLogOf().reverse().slice(-100)`([tools.ts:681](../src/browser/tools.ts#L681)) | P0 |
| 5 | antd Select 选择需 3 步(click → eval 读选项 → click option),是本次测试最低效环节 | 无高层原语;`elementsTool` 不暴露下拉选项([tools.ts:425](../src/browser/tools.ts#L425)) | P1 |
| 6 | `browser_elements` 把 antd Select 识别为 `input[type=search]`,无关联 label,agent 只能猜 `#rc_select_N` 对应哪个筛选项 | 未提取 form-item label / aria-label 关联([tools.ts:431](../src/browser/tools.ts#L431)) | P1 |
| 7 | 等下载只能 `browser_wait(3000)` 盲等 | `browser_download` 无等待能力([tools.ts:249](../src/browser/tools.ts#L249)) | P1 |
| 8 | 回放依赖本地文件(upload path),文件删除后回放必断,save 时无任何提示 | `recordTool` save 不检查外部依赖([tools.ts:677](../src/browser/tools.ts#L677)) | P1 |
| 9 | 截图/下载落到了会话工作区之外(`../.dsh-browser/`),触发文件沙箱拦截 | `workspaceCwd(exec)` 未取到会话 cwd 时回退到 `process.cwd()`([lib/tools.ts:9](../src/lib/tools.ts#L9)) | P2 |
| 10 | `browser_snapshot` 表格页输出大量空行噪音,白耗 token | `innerText` 原样返回,无压缩([tools.ts:31](../src/browser/tools.ts#L31)) | P2 |
| 11 | 网络记录缺聚合视图(按 host/状态码统计)与响应体断言 | 只有 list/failed/wait/clear([tools.ts:634](../src/browser/tools.ts#L634)) | P3 |
| 12 | 录制含大量只读探查步骤(snapshot/eval/elements),回放冗余 | save 不做分类过滤([tools.ts:681](../src/browser/tools.ts#L681)) | P3 |

---

## P0 — Bug 修复(先行,一个 PR)

### P0-1 三处 outputSchema 契约对齐

原则:**以 outputSchema 为准**,实现向 schema 靠拢;个别字段确有价值的,补进 schema。

1. `networkTool` clear 分支:
   ```ts
   // before: return { cleared: true, entries: 0 };
   return { cleared: true, entries: [] };
   ```
2. `networkTool` wait 分支:返回真实耗时并声明字段。
   ```ts
   const startedAt = Date.now();
   // ...命中时:
   return { matched: hit, waitMs: Date.now() - startedAt };
   ```
   `register.ts` 的 `browser_network` outputSchema 增加 `waitMs: { type: "integer" }`。
3. `recordTool` save 分支:`file` 是有用信息(持久化路径),保留并声明。
   `browser_record` outputSchema 增加 `file: { type: "string" }`。

### P0-2 录制语义修复(start/stop/save 闭环)

- `session.ts` 新增 `let lastRecording: TestCall[] | null`:`stopRecording()` 时保存 buffer;
  `startRecording()` 时清空。
- `recordTool` save:优先使用 `lastRecording`(一次完整的 start→stop 会话),否则回退
  到现有的「全局轨迹最后 100 条」行为(保持 README 描述的兼容)。save 成功后不清空
  `lastRecording`(允许重复 save 不同名字),下次 start 时覆盖。
- 返回值增加 `source: "recording" | "recent-log"`(补进 outputSchema),让 agent 知道
  存的是哪份数据。

### P0-3 契约测试(防复发)

新增 `test/output-contract.test.ts`:

- 用 mock `ReefContext` 捕获 `registerTools` 注册的全部工具定义;
- 对**纯逻辑工具**(不依赖真实浏览器)直接 execute 后用 schema 校验返回值:
  `browser_network`(4 个 action)、`browser_record`(save/list/delete)、`browser_forms`、
  `browser_form_save`、`browser_profile`(依赖 config)、`browser_replay`(stub impls);
- 校验器:devDependency 引入 `ajv`(仅测试期,不影响运行时零依赖原则);
- 对依赖浏览器的工具,导出 `__toolSchemas`(name → outputSchema)做**静态快照测试**:
  每个工具的 outputSchema 必须存在、type=object、properties 非空(防止将来新增工具
  忘写 schema);
- 纳入既有 `pnpm verify`(typecheck + test + build)流水线。

**验收**:`browser_network clear/wait`、`browser_record save` 在真实 DSH 会话中不再报
`invalid output`;新增测试在 CI 全绿。

---

## P1 — 功能改进

### P1-1 新工具 `browser_select`(下拉选择原语)

一个工具同时覆盖原生 `<select>` 与组件库下拉(antd / element / 通用 role=listbox):

```ts
browser_select({
  selector: "#rc_select_1",   // 原生 select 或组件库触发框
  option: "杭州市",            // 选项文本(默认包含匹配;exact:true 精确)
  exact: false,
  timeoutMs: 5000
})
// → { selected: "杭州市", selector, url, title }
```

实现要点([tools.ts](../src/browser/tools.ts) 新增 `selectTool`):

1. 若是原生 `<select>`:直接 `page.selectOption({ label })`;
2. 否则按组件库处理:点击触发框 → 等待可见下拉
   (`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option`、
   `.el-select-dropdown__item`、`[role=option]` 三组选择器并集)→ 按文本点击;
3. 找不到选项时抛错并**列出当前可见选项**(直接把 v1 里 agent 手写 eval 的能力内置),
   错误消息即调试信息;
4. 注册进 `stepImpls`(可录制/回放)、systemPrompt、README。

**验收**:白名单页面「地市→杭州市 + 节能类型→深度休眠」从 6 次工具调用缩到 2 次。

### P1-2 `browser_elements` 增强:label 关联 + 展开选项

- 每个元素增加 `label` 字段,按优先级提取:
  `aria-label` → `label[for]` → 祖先 `.ant-form-item` 的 label 文本 →
  祖先 `.el-form-item` 的 label → 前置兄弟文本;
- 当页面存在展开的下拉(同 P1-1 的选择器并集)时,在结果尾部追加
  `{ tag: "option", text, dropdown: true }` 条目,agent 不再需要 eval 读选项;
- render 输出 `label` 字段。

**验收**:白名单页 elements 输出能直接看出 `#rc_select_1` 对应「地市」。

### P1-3 `browser_download` 支持等待

```ts
browser_download({ index: 0, wait: true, timeoutMs: 10000 })
```

- 调用时记录该 profile 当前下载数为基线,轮询直到出现新下载或超时;
- `wait:false`(默认)保持现有行为;
- outputSchema 不变(返回结构相同),README 更新「等下载」用法,消除盲等。

### P1-4 录制外部依赖检查(save 时预警)

`recordTool` save 扫描步骤中 `browser_upload` 的 `args.path`:

- 文件不存在 → 返回值增加 `warnings: ["#41 browser_upload: 文件不存在 test/not-excel.txt,回放将失败"]`
  (outputSchema 增加 `warnings: { type: "array", items: { type: "string" } }`),
  并在 render 中展示;
- (后续 P3 可选)参数 `packAssets:true` 时把上传文件复制到
  `recordings/<name>.assets/`,回放时若原路径缺失则改写为资产路径。

---

## P2 — 体验改进

### P2-1 工作区目录解析修复

- `workspaceCwd`:依次探测 `exec.agent.session.meta.cwd` → `exec.cwd` →
  `process.cwd()`,并在**首次解析时打 debug 日志**(记录实际选用的 cwd 来源),
  便于诊断「文件落错位置」类问题;
- 新增配置 `workspaceDir`(默认空):显式指定后优先于一切探测,服务器/多工作区
  场景可钉死;
- README 配置表补充该字段,并说明相对路径的解析基准。

### P2-2 `browser_snapshot` 文本压缩

- 对 `innerText` 结果做行级后处理:去掉首尾空白行、连续空行折叠为 1 行、
  连续重复行(表格空单元格产生的 `" "` 行)折叠为 `…(重复 N 行)`;
- 压缩在 evaluate 返回前做,`truncated` 语义不变;
- 不改变纯文本页(知乎正文类)的输出。

**验收**:白名单统计表快照的空行噪音从 ~30 行降到 0,正文页不受影响。

### P2-3 报错信息友好化

- `waitForTool` 超时报错已含原因,保持;为 `networkTool wait` 超时附加
  「最近 5 条已见请求」摘要,帮助判断是 URL 正则不匹配还是请求根本没发;
- `uploadTool` 文件不存在时列出传入路径与解析后的绝对路径(现有已部分做到,统一格式)。

---

## P3 — 效率改进

### P3-1 `browser_record save` 支持 `stripReads`

```ts
browser_record({ action: "save", name: "xxx", stripReads: true })
```

- 只读工具集合:`browser_snapshot / browser_elements / browser_eval / browser_network /
  browser_status / browser_cookies(list)`;
- `stripReads:true` 时保存前过滤以上步骤(操作轨迹 testLog 不受影响);
- 注意:`browser_eval` 可能带副作用(如本次测试用它点选项),过滤后回放可能缺步骤,
  因此默认 false,由 agent 判断使用;P1-1 落地后读选项场景被 `browser_select` 吸收,
  stripReads 才变得安全——所以此项排在 P1-1 之后。

### P3-2 `browser_network` 增加 `stats` action

```ts
browser_network({ action: "stats" })
// → { stats: [{ host, total, failed, avgMs, byStatus: { "200": 12, "403": 1 } }] }
```

- 按 host 聚合:总数、失败数、平均耗时、状态码分布;
- 测试收尾时一次调用即可代替人工翻阅 list 输出;
- outputSchema 增加 `stats` 字段,render 输出对齐表格。

---

## 实施计划

| 阶段 | 内容 | 改动文件 | 预估 |
| --- | --- | --- | --- |
| Phase 0 | P0-1/2/3:schema 修复 + 录制语义 + 契约测试 | tools.ts、register.ts、session.ts、test/output-contract.test.ts、package.json(devDeps) | 0.5 天 |
| Phase 1 | P1-1 browser_select、P1-2 elements 增强、P1-3 下载等待、P1-4 save 预警 | tools.ts、register.ts、README.md、test/ | 1 天 |
| Phase 2 | P2-1 目录解析、P2-2 快照压缩、P2-3 报错优化 | lib/tools.ts、tools.ts、index.ts、README.md | 0.5 天 |
| Phase 3 | P3-1 stripReads、P3-2 network stats | tools.ts、register.ts、test/ | 0.5 天 |

每个 Phase 独立 PR、独立 `pnpm verify` 通过,互不阻塞;Phase 0 完成后即可发
0.1.3 patch 版本。

## 兼容性说明

- 所有 outputSchema 变更为**新增可选字段**,不删除/改型已有字段,宿主校验向后兼容;
- `browser_download wait`、`record save stripReads` 等新参数均可选,默认行为不变;
- P0-2 改变 save 的数据源优先级,属于 bug 修复(README 本就描述 start/stop/save 流程),
  无录制 buffer 时行为与现状一致。
