# dsh-browser

DSH 插件:共享 Playwright 浏览器自动化 + 原生界面实时画面面板。一次安装,两件事:

| 模块 | 做什么 |
| --- | --- |
| 🧭 **浏览器自动化** | 共享 Playwright 浏览器:多标签、多 profile、下载/上传、Cookie、表单回放,22 个 `browser_*` 工具 |
| 🖥️ **实时画面** | 注入 DSH 界面右下角悬浮面板:浏览器状态 + 实时缩略图,点开大屏模态框(2 秒轮询画面 + 访问历史) |

设计原则:能做的一次性操作交给 agent 用 bash 完成,插件只做 bash 做不到的常驻浏览器自动化。唯一第三方运行时依赖是 `playwright-core`(复用系统已装的 Edge/Chrome,无需下载 Chromium),不依赖任何 `@deepseek-ai` 运行时包。

## 安装

```sh
dsh plugin --profile web add dsh-browser
```

重启 DSH 生效。不需要时在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里删除 `browser` 行或加 `config: { enabled: false }`。

## 配置(全在 cordis.patch.yml)

```yaml
- insert:
    - id: browser
      name: 'dsh-browser'
      config:
        channel: auto        # auto | msedge | chrome | chromium | ""(playwright 默认)
        executablePath: ""   # 显式指定浏览器可执行文件(优先于 channel)
        headless: false      # 默认有头(本机调试/人工登录);服务器场景可改 true
        userDataDir: ""      # 设置后登录态跨 DSH 重启保留
        profiles: {}         # { work: { userDataDir, channel, headless }, ... }
        screenshotDir: .dsh-browser/screenshots
        downloadDir: .dsh-browser/downloads
        screenshotMaxAgeDays: 7   # 截图保留天数(0 = 不按时间清理)
        screenshotMaxCount: 200   # 截图保留数量上限(0 = 不按数量清理)
        basePath: /browser        # 面板嵌入 + 实时画面 API 基路径(重启生效)
        maxTextChars: 20000
        maxLinks: 50
        timeoutMs: 30000
```

## 浏览器工具

| 工具 | 说明 |
| --- | --- |
| `browser_open` | 打开 URL |
| `browser_tabs` | 标签管理:list / new / switch / close(按 id 或 index) |
| `browser_snapshot` | 读取页面文本/链接/输入框(纯文本模型"看"网页的核心) |
| `browser_elements` | 可交互元素结构化清单(input/button/select/链接 + 现成 CSS 选择器) |
| `browser_click` / `browser_type` / `browser_press` | 点击 / 输入(可清空、可回车提交)/ 按键 |
| `browser_eval` | 在页面上下文执行 JS(结果自动净化成 lossless JSON) |
| `browser_screenshot` | 截图存为 PNG(自动清理,见下) |
| `browser_wait` / `browser_back` / `browser_reload` | 等待 / 后退 / 刷新 |
| `browser_wait_for_login` | 等待人工登录完成(配 `headless: false` 使用,见下) |
| `browser_wait_for` | 通用显式等待(元素状态 / URL / 文本 / 数量 / eval,超时抛错) |
| `browser_assert` | 结构化断言(失败自动截图存证据目录并报错) |
| `browser_network` | 接口记录查询:list / failed(4xx/5xx)/ wait / clear,含请求/响应体(截断) |
| `browser_record` | 操作录制:start / stop / save / list / delete |
| `browser_replay` | 回放录制或步骤序列(回归测试,遇错可停) |
| `browser_status` / `browser_close` | 状态 / 关闭会话 |
| `browser_download` / `browser_upload` | 下载(保存到工作区)/ 上传本地文件 |
| `browser_cookies` | Cookie 管理(list / set / clear,登录态处理) |
| `browser_form` / `browser_form_save` / `browser_forms` | 批量填表 / 保存回放 / 管理已存表单 |
| `browser_profile` | 多配置文件:work/personal 等独立会话与登录态(userDataDir 持久化) |

**截图自动清理**:`browser_screenshot` 保存的 `.png` 自动修剪——每次截图后即时清理 + 每小时定时清扫;默认保留最近 7 天、最多 200 张(`screenshotMaxAgeDays` / `screenshotMaxCount`,设为 0 关闭对应规则),只清理截图目录直属文件。

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

**条件格式**(`browser_wait_for` / `browser_assert` 共用,五选一):

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `selector` | `{ selector: "#btn", state: "visible" }` | 元素状态:visible / hidden / attached / detached |
| `url` | `{ url: "https://.*\\.example\\.com" }` | 当前 URL 正则匹配 |
| `text` | `{ text: "保存成功" }` | 页面可见文本包含 |
| `count` | `{ count: { selector: ".row", op: "gte", value: 10 } }` | 元素数量比较(eq/gt/gte/lt/lte) |
| `eval` | `{ eval: "location.hash === '#done'" }` | 任意 JS 表达式求值 truthy |

`browser_assert` 失败时自动截图(`assert-fail-*.png`,存截图目录,受清理策略约束)并抛错,错误消息含原因与截图路径。

**回归测试**:agent 跑通一轮流程后 `browser_record save <name>`,以后用 `browser_replay { name }` 一键回放(默认遇错即停,`failFast: false` 可继续);也可直接传 `steps` 数组。已保存录制写入 `$DSH_HOME/.dsh-browser/recordings/<name>.json`(原子替换,名字自动安全化防路径穿越),重启 DSH 后自动加载,可跨会话复用;`browser_record list / delete` 管理。**录制管理界面**:DSH 设置弹窗 → 左侧导航「浏览器」页,可查看列表、展开步骤详情、删除录制。所有工具调用自动记录操作轨迹(面板显示最近 8 条,`/browser/log` 可取全量)。

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
- **实时缩略图**:浏览器打开时显示,点击弹出大屏模态框——2 秒轮询实时画面,下方列出**访问历史**(最近 50 条,点击可在新标签打开)。

## 开发

```sh
pnpm install
pnpm verify   # typecheck + test + build
```

## License

MIT
