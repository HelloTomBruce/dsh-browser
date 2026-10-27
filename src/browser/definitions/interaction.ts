// dsh-browser · 浏览器工具定义 — interaction
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import {
  clickTool, typeTool, pressTool, selectTool, evalTool,
  downloadTool, uploadTool, cookiesTool, formTool, formSaveTool, formsTool, formFillTool,
  dragTool,
} from "../tools.js";

export function getInteractionTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_click",
      description: "点击页面元素:selector(CSS)、ref(来自 browser_snapshot mode:'aria')、what(意图描述,如 '登录'/'提交订单',页内打分匹配并自动注册 ref)或 mark(SoM 标徽编号,看图定位)四选一——同时传多个会直接报参数错误;容器内语义定位用 what + scope。也可通过 row(如 'TASK-1002') 与 action(如 '编辑') 直接定位表格中某行操作按钮(row 可组合 selector 限定行内目标)。what 零命中时报错并附最相近候选与 SoM 标徽截图。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器(与 ref/mark/what 互斥)。" },
          ref: { type: "string", description: "aria 快照的 ref(如 'e3');导航后失效。与 selector/mark/what 互斥。" },
          what: { type: "string", description: "意图描述(元素名称/文本,如 '登录'):页内打分语义定位,免快照直达;零命中返回最相近候选。与 selector/ref/mark 互斥;容器内定位配合 scope。" },
          scope: { type: "string", description: "配合 what 限定扫描范围的容器选择器。" },
          mark: { type: "integer", description: "SoM 标徽编号(browser_screenshot { som: true } 返回 somMarks 的 id);多模态看图定位的落点,导航后失效。与 selector/ref/what 互斥。" },
          row: { type: "string", description: "表格行文本标识，如 'TASK-1002'，用于行级定向操作(可组合 selector 限定行内目标,不与 what/ref/mark 同用)。" },
          action: { type: "string", description: "行内操作按钮文本，如 '编辑'、'删除'、'详情'。" },
          force: { type: "boolean", description: "跳过可点击性检查强制点击(不触发拟人化轨迹)。" },
          humanize: { type: "boolean", description: "使用拟人化贝塞尔轨迹点击。" },
          effect: { type: "boolean", description: "点击效果验证:收集点击后的 DOM 变化摘要/URL 变化/新增网络请求;what 多候选首击无动静时自动换次候选。" },
          strict: { type: "boolean", description: "多命中即抛错(对齐 Playwright strict),要求定位唯一;默认 false 操作第 1 个并在返回中提示命中数。" },
          timeoutMs: { type: "integer" },
          expectUrl: { type: "string", description: "页面预期校验(opt-in):正则(非法时按子串);定位前当前 URL 不匹配直接报错,把「页面被切换/回退」从诡异失败变为一句话可诊断的错误。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          clicked: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
          effect: { type: "object" },
          effectHint: { type: "string" },
          matchedCount: { type: "integer", description: "选择器命中的元素总数(多命中歧义可见化)。" },
          visibleCount: { type: "integer", description: "命中元素中的可见数量。" },
          hint: { type: "string", description: "matchedCount>1 时的消歧指引。" },
          viaBridge: { type: "boolean", description: "what 未命中时经页面 __DSH_BRIDGE__(vite-plugin-dsh-bridge)兜底命中。" },
          warning: { type: "string", description: "执行过程中检测到的环境异常提示(如非工具触发的页面导航)。" },
        },
        required: ["clicked", "url", "title"],
      },
      render: (_args, value) => `Clicked ${value.clicked}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args, exec) => clickTool(config, args, exec),
    }),
    definePlainTool({
      name: "browser_type",
      description:
        "向输入框输入文本:selector(CSS)、ref 或 what(意图描述,如 '用户名'/'搜索')三选一定位目标(同时传多个会报参数错误;容器内定位用 what + scope)。clear=true 时先清空再输入(推荐用于表单);submit=true 时输入后按回车;editor=true 时适配 Monaco/CodeMirror/富文本编辑器。定位与点击均失败时做焦点归属校验:焦点不在目标内(含子元素)则中止输入并附当前焦点线索,不会盲打到错误输入框;返回 typedVia 标明实际输入通道。expectUrl 传入时先校验当前页面 URL,不符直接报错(防页面被切换后打错位置)。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器(与 ref/what 互斥)。" },
          ref: { type: "string", description: "aria 快照的 ref(如 'e2')。与 selector/what 互斥。" },
          what: { type: "string", description: "意图描述(元素名称/label/placeholder,如 '用户名'):页内打分语义定位。与 selector/ref 互斥;容器内定位配合 scope。" },
          scope: { type: "string", description: "配合 what 限定扫描范围的容器选择器。" },
          text: { type: "string" },
          clear: { type: "boolean" },
          submit: { type: "boolean" },
          editor: { type: "boolean", description: "按代码/富文本编辑器适配输入(Monaco/CodeMirror/contenteditable)。" },
          humanize: { type: "boolean", description: "使用高斯间隔拟人化逐字输入。" },
          strict: { type: "boolean", description: "多命中即抛错(对齐 Playwright strict);多命中或 strict 时不再 force 降级点击,遮罩拦截会直接暴露。" },
          delayMs: { type: "integer" },
          timeoutMs: { type: "integer" },
          expectUrl: { type: "string", description: "页面预期校验(opt-in):正则(非法时按子串);定位前当前 URL 不匹配直接报错,把「页面被切换/回退」从诡异失败变为一句话可诊断的错误。" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          typed: { type: "boolean" },
          typedVia: { type: "string", enum: ["fill", "clicked", "focus-kept", "editor"], description: "实际输入通道:fill=clear 清空重填;clicked=点击获得焦点;focus-kept=点击超时但焦点已在目标内续打;editor=编辑器适配。" },
          focusedElement: { type: "string", description: "focus-kept 通道下当前焦点元素 outerHTML 片段(调试线索)。" },
          selector: { type: "string" },
          submit: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
          matchedCount: { type: "integer", description: "选择器命中的元素总数(多命中歧义可见化)。" },
          visibleCount: { type: "integer", description: "命中元素中的可见数量。" },
          hint: { type: "string", description: "matchedCount>1 时的消歧指引。" },
          warning: { type: "string", description: "执行过程中检测到的环境异常提示(如非工具触发的页面导航)。" },
        },
        required: ["typed", "selector", "submit", "url", "title"],
      },
      render: (_args, value) =>
        `Typed into ${value.selector}${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => typeTool(config, args),
    }),
    definePlainTool({
      name: "browser_press",
      description:
        "按键:有 selector、ref 或 what(三选一,互斥)时先聚焦该元素再按键(如 'Enter'、'Tab'、'Escape'、'Control+a'),否则在页面级按键。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "按键名(Playwright 键盘键名)。" },
          selector: { type: "string", description: "CSS 选择器(与 ref/what 互斥)。" },
          ref: { type: "string", description: "aria 快照的 ref。与 selector/what 互斥。" },
          what: { type: "string", description: "意图描述:先聚焦该元素再按键(页内打分语义定位)。与 selector/ref 互斥。" },
          strict: { type: "boolean", description: "多命中即抛错(对齐 Playwright strict)。" },
          timeoutMs: { type: "integer" },
        },
        required: ["key"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pressed: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
          warning: { type: "string" },
          matchedCount: { type: "integer", description: "选择器命中的元素总数(多命中歧义可见化)。" },
          visibleCount: { type: "integer", description: "命中元素中的可见数量。" },
          hint: { type: "string", description: "matchedCount>1 时的消歧指引。" },
        },
        required: ["pressed", "url", "title"],
      },
      render: (_args, value) => `Pressed ${value.pressed}`,
      timeoutMs: timeout(),
      execute: (args) => pressTool(config, args),
    }),
    definePlainTool({
      name: "browser_select",
      description:
        "下拉选择原语:原生 <select> 与组件库下拉(antd / element-plus / ARIA listbox)通用。selector、ref 或 what(三选一,互斥)指向下拉触发框,option 为选项文本(默认包含匹配,exact=true 精确)。多选下拉传 clear:true 可在选择前先清空旧标签实现替换语义。找不到选项时报错并列出可见选项,无需再 browser_eval 探查。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "下拉触发框的 CSS 选择器(如 #rc_select_1);与 ref/what 互斥。" },
          ref: { type: "string", description: "aria 快照的 ref。与 selector/what 互斥。" },
          what: { type: "string", description: "意图描述(下拉的 label/名称,如 '所属部门'):页内打分语义定位触发框。与 selector/ref 互斥;容器内定位配合 scope。" },
          scope: { type: "string", description: "配合 what 限定扫描范围的容器选择器。" },
          option: { type: "string", description: "要选择的选项文本。" },
          exact: { type: "boolean", description: "精确匹配,默认 false(包含匹配)。" },
          clear: { type: "boolean", description: "是否在选择前先清空已有选中项(对于多选下拉，替换而非叠加旧选项)。" },
          strict: { type: "boolean", description: "多命中即抛错(对齐 Playwright strict)。" },
          timeoutMs: { type: "integer" },
          expectUrl: { type: "string", description: "页面预期校验(opt-in):正则(非法时按子串);定位前当前 URL 不匹配直接报错,把「页面被切换/回退」从诡异失败变为一句话可诊断的错误。" },
        },
        required: ["option"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          selected: { type: "string" },
          selector: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
          matchedCount: { type: "integer", description: "选择器命中的元素总数(多命中歧义可见化)。" },
          visibleCount: { type: "integer", description: "命中元素中的可见数量。" },
          hint: { type: "string", description: "matchedCount>1 时的消歧指引。" },
          warning: { type: "string", description: "执行过程中检测到的环境异常提示(如非工具触发的页面导航)。" },
        },
        required: ["selected", "selector", "url", "title"],
      },
      render: (_args, value) => `Selected "${value.selected}" in ${value.selector}`,
      timeoutMs: timeout(),
      execute: (args) => selectTool(config, args),
    }),
    definePlainTool({
      name: "browser_drag",
      description:
        "把源元素拖到目标元素上(拖拽/拖放):源与目标各自定位——source(CSS)/sourceRef(aria ref)/sourceWhat(意图语义,+sourceScope)/sourceMark(SoM 标徽)四选一,target/targetRef/targetWhat(+targetScope)/targetMark 同理。优先 Playwright dragTo(覆盖 HTML5 原生拖放),失败或跨 Frame 时自动降级为物理鼠标序列(覆盖看板卡片、滑块等鼠标拖动类控件),返回 via 标明实际通道。注意:dragged=true 表示拖拽序列已执行,不保证业务侧生效(drop 区拒绝、控件无响应仍为 true),需要验证请配合 browser_assert。源/目标不可见或零命中时抛错并附诊断。",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "源元素 CSS 选择器;与 sourceRef/sourceWhat/sourceMark 互斥。" },
          sourceRef: { type: "string", description: "源元素 aria 快照 ref(如 'e3');与 source/sourceWhat/sourceMark 互斥。" },
          sourceWhat: { type: "string", description: "源元素意图描述(如 '任务卡片 A'):页内打分语义定位;与 source/sourceRef/sourceMark 互斥;配合 sourceScope。" },
          sourceMark: { type: "integer", description: "源元素 SoM 标徽编号(browser_screenshot { som: true });与 source/sourceRef/sourceWhat 互斥。" },
          sourceScope: { type: "string", description: "配合 sourceWhat 限定扫描范围的容器选择器。" },
          target: { type: "string", description: "目标元素 CSS 选择器;与 targetRef/targetWhat/targetMark 互斥。" },
          targetRef: { type: "string", description: "目标元素 aria 快照 ref;与 target/targetWhat/targetMark 互斥。" },
          targetWhat: { type: "string", description: "目标元素意图描述(如 '待办列'):页内打分语义定位;与 target/targetRef/targetMark 互斥;配合 targetScope。" },
          targetMark: { type: "integer", description: "目标元素 SoM 标徽编号;与 target/targetRef/targetWhat 互斥。" },
          targetScope: { type: "string", description: "配合 targetWhat 限定扫描范围的容器选择器。" },
          timeoutMs: { type: "integer" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          dragged: { type: "boolean", description: "拖拽序列已执行(true 不保证业务侧生效,drop 被拒绝也为 true)。" },
          via: { type: "string", description: "实际执行通道:'dragTo'(HTML5/组件库)或 'mouse'(物理鼠标,含跨 Frame 与降级)。" },
          source: { type: "string", description: "实际使用的源定位描述(what:/ref:/mark:/selector)。" },
          target: { type: "string", description: "实际使用的目标定位描述。" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["dragged", "via", "source", "target", "url", "title"],
      },
      render: (_args, value) => `Dragged ${value.source} → ${value.target} (via ${value.via})`,
      timeoutMs: timeout(),
      execute: (args) => dragTool(config, args),
    }),
    definePlainTool({
      name: "browser_eval",
      description:
        "在页面上下文执行一段 JavaScript。表达式(含多行对象字面量/箭头函数 IIFE/顶层 await)直接返回值;语句脚本自动 return 最后一个顶层表达式的值,也可显式 return。结果必须是可 JSON 序列化的值,返回 mode 标明实际执行形态。",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "要执行的 JavaScript。" },
        },
        required: ["script"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          result: {},
          mode: {
            type: "string",
            enum: ["expression", "statements-auto-return", "statements"],
            description:
              "实际执行形态:expression=表达式直取值(支持顶层 await 与多行对象字面量);statements-auto-return=语句体自动 return 最后一个顶层表达式;statements=语句体(显式 return 或纯副作用,无返回值时 result 为 null)。",
          },
          scriptUnwrapped: { type: "boolean", description: "入参 script 疑似被 JSON 双重序列化(以引号包裹且含 \\n 字面量),已自动解码一层。" },
        },
        required: ["result"],
      },
      render: (_args, value) => `Result: ${JSON.stringify(value.result)}`,
      timeoutMs: timeout(),
      execute: (args) => evalTool(config, args),
    }),
    definePlainTool({
      name: "browser_download",
      description:
        "获取页面上最近触发的下载(如点击下载链接后),保存到工作区 .dsh-browser/downloads/ 并返回路径。index 可选,默认最近一次;wait=true 时先轮询等待新下载出现(以调用时刻为基线,默认等 10 秒),避免 browser_wait 盲等;浏览器会话关闭后下载记录丢失。",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "下载记录序号(0 起,默认最近)。" },
          wait: { type: "boolean", description: "等待新下载出现再取,默认 false。" },
          timeoutMs: { type: "integer", description: "wait 超时毫秒,默认 10000,上限 60000。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          filename: { type: "string" },
          url: { type: "string" },
          bytes: { type: "integer" },
        },
        required: ["path", "filename", "url", "bytes"],
      },
      render: (_args, value) => `Downloaded ${value.filename} (${value.bytes} bytes) → ${value.path}`,
      timeoutMs: timeout(),
      execute: (args, exec) => downloadTool(config, args, exec),
    }),
    definePlainTool({
      name: "browser_upload",
      description:
        "把本地文件上传到页面的文件输入框(selector 指向 input[type=file])。path 可以是绝对路径或相对工作区的路径。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "文件输入框的 CSS 选择器。" },
          path: { type: "string", description: "要上传的文件路径。" },
          timeoutMs: { type: "integer" },
        },
        required: ["selector", "path"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          uploaded: { type: "string" },
          bytes: { type: "integer" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["uploaded", "bytes", "url", "title"],
      },
      render: (args, value) => `Uploaded ${value.uploaded} (${value.bytes} bytes) to ${args.selector}`,
      timeoutMs: timeout(),
      execute: (args, exec) => uploadTool(config, args, exec),
    }),
    definePlainTool({
      name: "browser_cookies",
      description:
        "管理浏览器 Cookie:list 列出当前页面域名的 Cookie(默认隐藏值,showValues=true 显示),set 设置一个 Cookie(可指定 url,默认当前页面),clear 清空全部。用于处理登录态。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "set", "clear"] },
          url: { type: "string", description: "list 的过滤域名或 set 的归属 URL。" },
          name: { type: "string", description: "set 时的 Cookie 名。" },
          value: { type: "string", description: "set 时的 Cookie 值。" },
          showValues: { type: "boolean" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cookies: { type: "array", items: { type: "object" } },
          set: { type: "boolean" },
          cleared: { type: "boolean" },
          name: { type: "string" },
          url: { type: "string" },
        },
        required: [],
      },
      render: (_args, value) => {
        if (value.cleared) return "All cookies cleared";
        if (value.set) return `Cookie ${value.name} set for ${value.url}`;
        return (value.cookies ?? [])
          .map((c: any) => `${c.name}=${c.value} (${c.domain}${c.path}, httpOnly=${c.httpOnly})`)
          .join("\n") || "(no cookies)";
      },
      timeoutMs: timeout(),
      execute: (args) => cookiesTool(config, args),
    }),
    definePlainTool({
      name: "browser_form",
      description:
        "批量填充表单:fields 数组,每项给 selector(CSS)或 label(可见文本)与 value;submit=true 时填完按回车提交。也可 from=<已保存表单名> 回放(browser_form_save 保存)。先 browser_elements 或 browser_snapshot 了解表单结构。",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                selector: { type: "string" },
                label: { type: "string" },
                value: { type: "string" },
              },
            },
            description: "要填充的字段列表(from 回放时省略)。",
          },
          from: { type: "string", description: "回放已保存表单的名称。" },
          submit: { type: "boolean" },
          timeoutMs: { type: "integer" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filled: { type: "array", items: { type: "object" } },
          submit: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["filled", "submit", "url", "title"],
      },
      render: (args, value) =>
        `Filled ${value.filled.length} field(s)${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => formTool(config, args),
    }),
    definePlainTool({
      name: "browser_form_save",
      description:
        "把最近一次 browser_form 填充的字段保存为命名表单(或直接传 fields),之后 browser_form 用 from=<name> 一键回放。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "表单名(回放时用)。" },
          fields: { type: "array", items: { type: "object" }, description: "可选,不传则用最近一次填充。" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          saved: { type: "string" },
          fields: { type: "integer" },
        },
        required: ["saved", "fields"],
      },
      render: (_args, value) => `Saved form "${value.saved}" with ${value.fields} field(s)`,
      timeoutMs: timeout(),
      execute: (args) => formSaveTool(args),
    }),
    definePlainTool({
      name: "browser_forms",
      description: "管理已保存的表单回放:list 列出,delete 删除指定表单。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "delete"] },
          name: { type: "string", description: "delete 时的表单名。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          forms: { type: "array", items: { type: "object" } },
          deleted: { type: "boolean" },
          name: { type: "string" },
        },
        required: [],
      },
      render: (args, value) => {
        if (args.action === "delete") return value.deleted ? `Deleted "${value.name}"` : `No form "${value.name}"`;
        return (value.forms ?? [])
          .map((f: any) => `"${f.name}" (${f.fields} fields): ${f.preview}`)
          .join("\n") || "(no saved forms)";
      },
      timeoutMs: timeout(),
      execute: (args) => formsTool(args),
    }),
    definePlainTool({
      name: "browser_form_fill",
      description: "智能批量表单填写: 一次调用自动识别并填充多个表单控件, 结合 UI 适配器自动处理输入/选择与弹层。",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            description: "表单键值对映射(键支持 label/placeholder/selector, 值为待填内容)",
          },
          scope: {
            type: "string",
            description: "可选容器选择器, 限制填充范围",
          },
          submitButton: {
            type: "string",
            description: "可选, 填写完成后自动点击的提交按钮名称或选择器",
          },
          timeoutMs: { type: "integer" },
        },
        required: ["fields"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filled: { type: "array", items: { type: "string" } },
          skipped: { type: "array", items: { type: "string" } },
          errors: { type: "object" },
          submitted: { type: "boolean" },
        },
        required: ["filled", "skipped", "errors"],
      },
      render: (_args, value) =>
        `Filled ${value.filled.length} fields: ${value.filled.join(", ")}${value.skipped.length > 0 ? ` (skipped: ${value.skipped.join(", ")})` : ""}${value.submitted ? " [Submitted]" : ""}`,
      timeoutMs: timeout(),
      execute: (args) => formFillTool(config, args),
    }),
  ];
}
