# dsh-browser-view

DSH 插件:共享 Playwright 浏览器自动化 + 原生界面实时画面面板。一次安装,三件事:

| 模块 | 做什么 |
| --- | --- |
| 🧭 **浏览器自动化** | 共享 Playwright 浏览器:多标签、多 profile、下载/上传、Cookie、表单回放,31 个 `browser_*` 工具 |
| 🖥️ **实时画面** | 注入 DSH 界面右下角悬浮面板:浏览器状态 + 实时缩略图,点开大屏模态框(2 秒轮询画面 + 访问历史) |
| ✅ **回归测试闭环** | 录制回放 + 选择器自愈 + 参数化/数据驱动 + 视觉回归 + 运行历史与报告导出 |

设计原则:能做的一次性操作交给 agent 用 bash 完成,插件只做 bash 做不到的常驻浏览器自动化。唯一第三方运行时依赖是 `playwright-core`(复用系统已装的 Edge/Chrome,无需下载 Chromium),不依赖任何 `@deepseek-ai` 运行时包。

## 安装

```sh
dsh plugin --profile web add dsh-browser-view
```

重启 DSH 生效。不需要时在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里删除 `browser` 行或加 `config: { enabled: false }`。

## 配置(全在 cordis.patch.yml)

```yaml
- insert:
    - id: browser
      name: 'dsh-browser-view'
      config:
        channel: auto        # auto | msedge | chrome | chromium | ""(playwright 默认)
        executablePath: ""   # 显式指定浏览器可执行文件(优先于 channel)
        headless: false      # 默认有头(本机调试/人工登录);服务器场景可改 true
        userDataDir: ""      # 设置后登录态跨 DSH 重启保留
        profiles: {}         # { work: { userDataDir, channel, headless }, ... }
        workspaceDir: ""     # 截图/下载/上传的落盘基准目录(默认探测会话 cwd,多工作区/服务器场景可钉死)
        screenshotDir: .dsh-browser/screenshots
        downloadDir: .dsh-browser/downloads
        screenshotMaxAgeDays: 7   # 截图保留天数(0 = 不按时间清理)
        screenshotMaxCount: 200   # 截图保留数量上限(0 = 不按数量清理)
        basePath: /browser        # 面板嵌入 + 实时画面 API 基路径(重启生效)
        maxTextChars: 20000
        maxLinks: 50
        timeoutMs: 30000
        baselineDir: .dsh-browser/baselines  # 视觉回归基线目录(不受截图清理约束)
        selectorHealing: true     # 回放/批处理选择器自愈(默认开;只作用于失败路径)
        healTimeoutMs: 3000       # 自愈时单次尝试的超时
        maxRefs: 200              # ARIA 快照每次分配的 ref 上限
        maxRows: 1000             # browser_extract 单次聚合行数上限
```

## 浏览器工具

| 工具 | 说明 |
| --- | --- |
| `browser_open` | 打开 URL |
| `browser_tabs` | 标签管理:list / new / switch / close(按 id 或 index) |
| `browser_snapshot` | 页面快照:`mode: "text"`(默认)返回压缩后的文本/链接/输入框;`mode: "aria"` 返回可访问性树,可交互元素带 `[ref=eN]` 短引用 |
| `browser_elements` | 可交互元素结构化清单(input/button/select/链接 + 关联 label + 现成 CSS 选择器;有展开下拉时附可见选项) |
| `browser_click` / `browser_type` / `browser_press` | 点击 / 输入(可清空、可回车提交)/ 按键;`selector`(CSS)与 `ref`(aria 快照)二选一 |
| `browser_select` | 下拉选择原语:原生 `<select>` 与 antd / element-plus / ARIA listbox 通用,selector/ref + option 文本一步完成;找不到选项时报错并列出可见选项 |
| `browser_eval` | 在页面上下文执行 JS(结果自动净化成 lossless JSON) |
| `browser_batch` | 动作批处理:一次调用顺序执行多个步骤 `[{tool, args}]`(点击→等待→输入→提交类小序列减少往返;禁止嵌套;可录制可回放) |
| `browser_screenshot` | 截图存为 PNG(自动清理,见下);`baseline: "<名>"` 存为视觉回归基线(不受清理约束) |
| `browser_wait` / `browser_back` / `browser_reload` | 等待 / 后退 / 刷新 |
| `browser_wait_for_login` | 等待人工登录完成(配 `headless: false` 使用,见下) |
| `browser_wait_for` | 通用显式等待(元素状态 / URL / 文本 / 数量 / eval,超时抛错) |
| `browser_assert` | 结构化断言(失败自动截图存证据目录并报错);`visual: { baseline }` 做视觉回归断言(见下) |
| `browser_network` | 接口记录查询:list / failed(4xx/5xx)/ wait(命中返回 waitMs,超时附最近请求摘要)/ stats(按 host 聚合计数/失败数/均耗时/状态码分布)/ clear,含请求/响应体(截断) |
| `browser_extract` | 规则化结构化抽取:fields 定义 CSS 字段(支持嵌套/multiple),`next` 自动翻页聚合,导出 json / csv / jsonl / markdown 落盘工作区 |
| `browser_record` | 操作录制:start / stop / save(list/delete 管理;save 支持 `stripReads` 剔除只读步骤、`vars` 把指定步骤字段抽成 `{{占位符}}`;selector 步骤自动附带元素指纹供回放自愈) |
| `browser_replay` | 回放录制或步骤序列(回归测试,遇错可停);`vars` 注入占位符,`data` / `dataFile`(CSV)逐行数据驱动;选择器失效自动按指纹自愈 |
| `browser_report` | 回归报告:list / show / export(运行历史自动记录,export 聚合为 Markdown / 自包含 HTML 落盘) |
| `browser_status` / `browser_close` | 状态 / 关闭会话 |
| `browser_download` / `browser_upload` | 下载(保存到工作区;`wait: true` 可轮询等待新下载)/ 上传本地文件 |
| `browser_cookies` | Cookie 管理(list / set / clear,登录态处理) |
| `browser_form` / `browser_form_save` / `browser_forms` | 批量填表 / 保存回放 / 管理已存表单 |
| `browser_profile` | 多配置文件:work/personal 等独立会话与登录态(userDataDir 持久化) |

**截图自动清理**:`browser_screenshot` 保存的 `.png` 自动修剪——每次截图后即时清理 + 每小时定时清扫;默认保留最近 7 天、最多 200 张(`screenshotMaxAgeDays` / `screenshotMaxCount`,设为 0 关闭对应规则),只清理截图目录直属文件。视觉回归基线(`baselineDir`)不参与清理。

> 首次调用浏览器工具时自动启动浏览器;启动失败会提示安装 Chromium(`npx playwright install chromium`)或配置 `executablePath`。

## 自动化测试

插件提供完整的测试原语,agent 可以写出「等待 + 断言 + 网络校验 + 回放」的测试流程:

```
# 典型流程
browser_open   打开目标页
browser_wait_for   { selector: "#app", state: "visible" }         # 等页面稳定
browser_assert     { text: "登录成功" }                            # 断言文本
browser_assert     { count: { selector: ".row", op: "gte", value: 10 } }  # 断言数量
browser_network    { action: "failed" }                           # 检查 4xx/5xx
browser_network    { action: "wait", url: "api/orders", status: 200 }  # 等接口返回
browser_screenshot  # 证据
```

**接口出入参**:`browser_network` 自动记录每个 XHR/fetch 的请求体(`postData`)与响应体(`body`,均截断:请求体 2000 字符、响应体 4000 字符;SSE 流与 >500KB 响应跳过;`config.recordBodies: false` 可关闭)。`wait` 匹配到的记录同样带出入参,可直接断言接口返回结构。

**条件格式**(`browser_wait_for` / `browser_assert` 共用):

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `selector` | `{ selector: "#btn", state: "visible" }` | 元素状态:visible / hidden / attached / detached |
| `ref` | `{ ref: "e3", state: "visible" }` | aria 快照 ref 的状态等待 |
| `url` | `{ url: "https://.*\\.example\\.com" }` | 当前 URL 正则匹配 |
| `text` | `{ text: "保存成功" }` | 页面可见文本包含 |
| `count` | `{ count: { selector: ".row", op: "gte", value: 10 } }` | 元素数量比较(eq/gt/gte/lt/lte) |
| `eval` | `{ eval: "location.hash === '#done'" }` | 任意 JS 表达式求值 truthy |

`browser_assert` 失败时自动截图(`assert-fail-*.png`,存截图目录,受清理策略约束)并抛错,错误消息含原因与截图路径。

**ARIA 快照 + ref 引用(推荐的定位方式)**:`browser_snapshot { mode: "aria" }` 返回页面的可访问性树,可交互元素带 `ref=eN` 短引用:

```
- navigation "主导航"
  - link "首页" [ref=e1]
- main
  - textbox "用户名" [ref=e2]
  - button "登录" [ref=e3]
```

后续 `browser_click { ref: "e3" }`、`browser_type { ref: "e2", text }`、`browser_select { ref, option }`、`browser_press { ref, key }` 直接用 ref 代替 CSS 选择器——比手写选择器更稳、比文本快照更省 token。ref 解析时会校验元素的 role/name 仍一致(防漂移误点),不一致自动降级 `getByRole`;页面导航或重新快照后旧 ref 失效(报错提示重取)。读正文仍用默认 `mode: "text"`。

**动作批处理**:固定小序列用 `browser_batch` 一次往返执行:

```
browser_batch { steps: [
  { tool: "browser_type", args: { ref: "e2", text: "user", clear: true } },
  { tool: "browser_type", args: { ref: "e3", text: "pass", clear: true } },
  { tool: "browser_click", args: { ref: "e4" } },
  { tool: "browser_wait_for", args: { condition: { text: "欢迎" } } },
] }
```

步骤内禁止嵌套 batch/replay/record;批整体在操作轨迹与录制里记为单条步骤。

**回归测试**:agent 跑通一轮流程后 `browser_record save <name>`,以后用 `browser_replay { name }` 一键回放(默认遇错即停,`failFast: false` 可继续);也可直接传 `steps` 数组。**save 的数据源**:做过 `browser_record start` → `stop` 的,保存该段录制;从未录制的,保存最近 100 次工具调用(返回值的 `source` 字段会标明 `recording` / `recent-log`)。save 时会检查 `browser_upload` 步骤引用的本地文件,缺失的以 `warnings` 返回(回放将失败,请及时重建或改用稳定路径)。已保存录制写入 `$DSH_HOME/.dsh-browser/recordings/<name>.json`(原子替换,名字自动安全化防路径穿越),重启 DSH 后自动加载,可跨会话复用;`browser_record list / delete` 管理。**录制管理界面**:DSH 设置弹窗 → 左侧导航「浏览器」页,可查看列表、展开步骤详情、删除录制。所有工具调用自动记录操作轨迹(面板显示最近 8 条,`/browser/log` 可取全量)。

**选择器自愈**:录制(save)时每个 selector 步骤自动附带元素指纹(`data-testid` / role+name / 可见文本 / id / 标签)。回放时原选择器失败会按 `testid → role+name → text → id → tag+text` 降级重试(每次尝试限时 `healTimeoutMs`,默认 3s,避免等满全局超时),自愈成功的步骤在结果中标记 `healed: true, via: "role+name", resolved: "<新选择器>"` 并计入 `healedCount`——提示你该修录制里的选择器了,而不是默默吞掉页面漂移。仅作用于 replay/batch 的失败路径,live 工具不受影响;`config.selectorHealing: false` 可整体关闭。录制格式为 formatVersion 2,旧格式录制正常回放(无自愈)。

**参数化与数据驱动**:save 时用 `vars` 把指定步骤的字段抽成占位符:

```
browser_record { action: "save", name: "login",
                 vars: { username: "#1.args.text", password: "#2.args.text" } }  # 步骤号 1 起
browser_replay { name: "login", vars: { username: "a@x.com", password: "***" } } # 单次注入
browser_replay { name: "login", data: [{ username: "a@x.com", password: "1" },
                                       { username: "b@x.com", password: "2" }] }   # 逐行回放
browser_replay { name: "login", dataFile: "testdata/users.csv" }  # CSV 首行为变量名
```

缺失的占位符直接报错(不做空串替换);data 模式每行独立 failFast、失败不中断后续行,返回 `runs` 按行聚合。注意 vars 值会随运行记录写入报告,敏感值请自行管理数据文件。

**视觉回归**:先用 `browser_screenshot { baseline: "login" }` 建立基线(存 `.dsh-browser/baselines/`,不受截图清理约束),之后在断言中比对:

```
browser_assert { visual: { baseline: "login", threshold: 0.1, maxDiffRatio: 0.005,
                           mask: [".timestamp", ".ad-banner"] } }
```

- 逐像素加权亮度差超过 `threshold`(0–1,默认 0.1)计为差异;`diffRatio` 超过 `maxDiffRatio`(默认 0.5%)判失败;
- `mask` 为忽略区域选择器数组(时钟/广告位/随机头像等动态内容),两图同步填白后比对;
- 尺寸不一致直接失败;失败时落盘当前截图与红标 diff 图,路径在错误消息里;
- 超过 1000px 边长的大图会先等比缩放再比对(性能折中,亚像素级差异可能漏检);
- 零额外依赖:像素比对在浏览器内 canvas 完成。

**回归报告**:每次 `browser_replay` / `browser_batch` 自动记入运行历史(`$DSH_HOME/.dsh-browser/reports/runs.jsonl`,上限 1000 条):

```
browser_report { action: "list" }                                  # 最近运行
browser_report { action: "show" }                                  # 最近一条详情
browser_report { action: "export", format: "html", file: "reports/r.html" }
browser_report { action: "export", source: "login" }               # 只聚合某录制
```

报告含运行趋势、失败步骤 Top、自愈步骤清单(建议修复录制选择器)。面板状态行会显示最近一次回归结果。**定时回归**:用 DSH 的 schedule 能力组合即可——定时触发 `browser_replay { name }` + `browser_report { action: "export" }`,早上看报告。

**结构化抽取**:`browser_extract` 做规则化抓取(CSS/属性,不含模型),支持翻页与导出:

```
browser_extract {
  fields: [
    { name: "title", selector: "h1" },
    { name: "rows", selector: "table tbody tr", multiple: true,
      fields: [{ name: "name", selector: "td:nth-of-type(1)" },
               { name: "link", selector: "a", attr: "href" }] },
  ],
  next: ".pagination .next", maxPages: 5,
  format: "csv", file: "output/rows.csv",
}
```

`attr` 缺省取可见文本,可指定 `href` / `src` 等属性;`next` 翻页直到消失/禁用或达 `maxPages`;路径限工作区内。语义化抽取(「总结要点」「按 schema 出 JSON」)不在此工具范围——用 `browser_snapshot` 读文本后交给 `jev_extract` 等模型侧工具,插件负责拿到干净的候选文本。

## 人工登录(验证码 / 扫码 / 双因素)

很多网站需要登录。插件支持"agent 打开登录页 → 人工在浏览器窗口完成登录 → agent 继续"的协作流程:

```yaml
config:
  userDataDir: ~/.dsh-browser/profile-work   # 登录态持久化,重启/切回无头后仍有效
```

> `headless` 默认已是 `false`(有头窗口);服务器等无 GUI 场景请显式覆盖为 `true`。

1. agent 用 `browser_open` 打开登录页(此时弹出真实浏览器窗口);
2. agent 告知用户完成登录,并调用 `browser_wait_for_login`(可选 `successSelector` / `successUrl` 指定完成条件);
3. 用户在窗口中输入账号 / 扫码 / 完成双因素;
4. `browser_wait_for_login` 检测到完成条件(默认 URL 跳转)后返回,agent 继续后续操作。

配置 `userDataDir` 后,登录态(Cookie / localStorage)会保存到该目录,后续即使切回 `headless: true` 或重启 DSH,已登录的网站仍保持登录态。

## 实时画面面板

安装后 DSH 界面右下角出现 🌐 悬浮按钮(跟随 DSH 亮/暗主题):

- **状态行**:浏览器开关、标签数、当前 URL;
- **实时缩略图**:浏览器打开时显示,点击弹出大屏模态框——2 秒轮询实时画面,下方列出**访问历史**(最近 50 条,点击可在新标签打开);
- **最近回归**:面板底部一行显示最近一次 `browser_replay` / `browser_batch` 的结果(通过数 / 自愈数 / 时间)。

## 开发

```sh
pnpm install
pnpm verify   # typecheck + test + build
```

## License

MIT
