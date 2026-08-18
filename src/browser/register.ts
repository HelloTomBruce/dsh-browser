// dsh-browser · 浏览器 — 工具注册(definePlainTool × 22)
import type { ReefContext, PlainToolDefinition, ToolRunContext } from "../lib/types.js";
import type { BrowserConfig } from "./types.js";
import { definePlainTool, genericCard } from "../lib/tools.js";
import { recordCall } from "./session.js";
import {
  openTool, snapshotTool, clickTool, typeTool, pressTool, evalTool,
  screenshotTool, waitTool, backTool, reloadTool, statusTool, closeTool,
  tabsTool, downloadTool, uploadTool, cookiesTool, formTool, formSaveTool,
  formsTool, profileTool, elementsTool, waitForLoginTool,
  waitForTool, assertTool, networkTool, recordTool, replayTool,
} from "./tools.js";

export function registerTools(ctx: ReefContext, config: BrowserConfig) {
  const tools = ctx.get<{ register(definition: PlainToolDefinition): unknown }>("tools");
  if (tools === undefined) return;
  const timeout = (ms?: number) => ms ?? config.timeoutMs;

  /** 参数净化:大字段(script/fields 等)截断,避免操作日志膨胀。 */
  function sanitizeArgs(args: any): any {
    if (typeof args !== "object" || args === null) return args;
    const out: any = {};
    for (const [k, v] of Object.entries(args)) {
      const s = JSON.stringify(v);
      out[k] = s && s.length > 300 ? `${s.slice(0, 300)}…(截断)` : v;
    }
    return out;
  }

  /** 打点包装:每次工具调用记录操作轨迹(测试报告 / 录制数据源)。 */
  function register(def: PlainToolDefinition) {
    const original = def.execute;
    def.execute = async (args: any, exec: ToolRunContext) => {
      const t0 = Date.now();
      const sanitized = sanitizeArgs(args);
      try {
        const value = await original(args, exec);
        recordCall({ tool: def.name, args: sanitized, ok: true, ms: Date.now() - t0, ts: Date.now() });
        return value;
      } catch (error) {
        recordCall({
          tool: def.name,
          args: sanitized,
          ok: false,
          ms: Date.now() - t0,
          ts: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };
    tools!.register(def);
  }

  /** 回放步骤 → 工具实现映射(config 闭包)。 */
  const stepImpls: Record<string, (args: any) => Promise<unknown>> = {
    browser_open: (a) => openTool(config, a),
    browser_snapshot: (a) => snapshotTool(config, a),
    browser_click: (a) => clickTool(config, a),
    browser_type: (a) => typeTool(config, a),
    browser_press: (a) => pressTool(config, a),
    browser_eval: (a) => evalTool(config, a),
    browser_screenshot: (a) => screenshotTool(config, a),
    browser_wait: (a) => waitTool(config, a),
    browser_back: () => backTool(config),
    browser_reload: () => reloadTool(config),
    browser_status: () => statusTool(),
    browser_close: () => closeTool(),
    browser_tabs: (a) => tabsTool(config, a),
    browser_download: (a) => downloadTool(config, a),
    browser_upload: (a) => uploadTool(config, a),
    browser_cookies: (a) => cookiesTool(config, a),
    browser_form: (a) => formTool(config, a),
    browser_form_save: (a) => formSaveTool(a),
    browser_forms: (a) => formsTool(a),
    browser_profile: (a) => profileTool(config, a),
    browser_elements: (a) => elementsTool(config, a),
    browser_wait_for_login: (a) => waitForLoginTool(config, a),
    browser_wait_for: (a) => waitForTool(config, a),
    browser_assert: (a) => assertTool(config, a, undefined as any),
    browser_network: (a) => networkTool(a),
    browser_record: (a) => recordTool(a),
    browser_replay: (a) => replayTool(a, stepImpls),
  };

  register(
    definePlainTool({
      name: "browser_open",
      description:
        "在共享浏览器中打开一个 URL。之后可用 browser_snapshot 读取页面内容,用 browser_click / browser_type / browser_eval 操作页面,用 browser_screenshot 截图。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要打开的完整 URL(含协议)。" },
          waitUntil: {
            type: "string",
            enum: ["load", "domcontentloaded", "commit"],
            description: "等待策略,默认 domcontentloaded。",
          },
          timeoutMs: { type: "integer", description: "等待超时(毫秒)。" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
        },
        required: ["url", "title", "status"],
      },
      render: (_args, value) => `Opened ${value.url}\nTitle: ${value.title}`,
      presentCall: (args) => genericCard("browser", String(args.url), String(args.url)),
      timeoutMs: timeout(),
      execute: (args) => openTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_snapshot",
      description:
        "读取当前页面的可访问文本、链接清单与输入框数量(不截图)。maxTextChars 默认 20000。链接列表用于构造点击选择器。",
      parameters: {
        type: "object",
        properties: {
          maxTextChars: { type: "integer", description: "文本截断上限。" },
          maxLinks: { type: "integer", description: "链接数量上限。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
          truncated: { type: "boolean" },
          links: { type: "array", items: { type: "object" } },
          inputs: { type: "integer" },
        },
        required: ["url", "title", "text", "truncated", "links", "inputs"],
      },
      render: (_args, value) =>
        `URL: ${value.url}\nTitle: ${value.title}\nInputs: ${value.inputs}\n--- text ---\n${value.text}`,
      timeoutMs: timeout(),
      execute: (args) => snapshotTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_click",
      description: "点击页面上匹配 CSS 选择器的元素(来自 browser_snapshot 的链接/表单分析)。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器。" },
          timeoutMs: { type: "integer" },
        },
        required: ["selector"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          clicked: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["clicked", "url", "title"],
      },
      render: (_args, value) => `Clicked ${value.clicked}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => clickTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_type",
      description:
        "向 CSS 选择器指向的输入框输入文本。clear=true 时先清空再输入(推荐用于表单);submit=true 时输入后按回车。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
          clear: { type: "boolean" },
          submit: { type: "boolean" },
          delayMs: { type: "integer" },
          timeoutMs: { type: "integer" },
        },
        required: ["selector", "text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          typed: { type: "boolean" },
          selector: { type: "string" },
          submit: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["typed", "selector", "submit", "url", "title"],
      },
      render: (_args, value) =>
        `Typed into ${value.selector}${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => typeTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_press",
      description:
        "按键:有 selector 时先聚焦该元素再按键(如 'Enter'、'Tab'、'Escape'、'Control+a'),否则在页面级按键。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "按键名(Playwright 键盘键名)。" },
          selector: { type: "string" },
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
        },
        required: ["pressed", "url", "title"],
      },
      render: (_args, value) => `Pressed ${value.pressed}`,
      timeoutMs: timeout(),
      execute: (args) => pressTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_eval",
      description:
        "在页面上下文执行一段 JavaScript。表达式直接求值(如 'document.title');含换行/分号的语句会被包进 async IIFE,可用 return 返回。结果必须是可 JSON 序列化的值。",
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
        },
        required: ["result"],
      },
      render: (_args, value) => `Result: ${JSON.stringify(value.result)}`,
      timeoutMs: timeout(),
      execute: (args) => evalTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_screenshot",
      description:
        "把当前页面截图保存为 PNG 文件(默认存到工作区 .dsh-browser/screenshots/),返回文件路径。纯文本模型看不到图,但用户可以在实时画面面板查看。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "文件名(不含扩展名也会自动补 .png)。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          bytes: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
        },
        required: ["path", "bytes", "width", "height"],
      },
      render: (args, value) => `Saved ${value.bytes} bytes → ${value.path}`,
      timeoutMs: timeout(),
      execute: (args, exec) => screenshotTool(config, args, exec),
    }),
  );

  register(
    definePlainTool({
      name: "browser_wait",
      description: "等待指定毫秒数(上限 60000),常用于等待页面渲染或请求完成。",
      parameters: {
        type: "object",
        properties: {
          ms: { type: "integer", description: "等待毫秒数,默认 1000。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          waitedMs: { type: "integer" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["waitedMs", "url", "title"],
      },
      render: (_args, value) => `Waited ${value.waitedMs}ms`,
      timeoutMs: timeout(),
      execute: (args) => waitTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_back",
      description: "返回上一页(如无历史则无操作)。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { url: { type: "string" }, title: { type: "string" } },
        required: ["url", "title"],
      },
      render: (_args, value) => `Back to: ${value.url}`,
      timeoutMs: timeout(),
      execute: () => backTool(config),
    }),
  );

  register(
    definePlainTool({
      name: "browser_reload",
      description: "重新加载当前页面。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { url: { type: "string" }, title: { type: "string" } },
        required: ["url", "title"],
      },
      render: (_args, value) => `Reloaded: ${value.url}`,
      timeoutMs: timeout(),
      execute: () => reloadTool(config),
    }),
  );

  register(
    definePlainTool({
      name: "browser_status",
      description: "查看浏览器会话是否打开、当前 URL 与标题。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          open: { type: "boolean" },
          profile: { type: "string" },
          channel: { type: "string" },
          tabs: { type: "integer" },
          profiles: { type: "array", items: { type: "object" } },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["open", "profile", "channel", "tabs", "profiles"],
      },
      render: (_args, value) =>
        value.open ? `Open (${value.channel}): ${value.url} — ${value.title}` : "Not open",
      timeoutMs: timeout(),
      execute: () => statusTool(),
    }),
  );

  register(
    definePlainTool({
      name: "browser_close",
      description: "关闭浏览器会话并释放资源;下次使用工具时会自动重新打开。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { closed: { type: "boolean" } },
        required: ["closed"],
      },
      render: () => "Browser closed",
      execute: () => closeTool(),
    }),
  );

  register(
    definePlainTool({
      name: "browser_tabs",
      description:
        "管理浏览器多标签页:list 列出所有标签,new 新建(可选带 url),switch 按 id 或 index 切换,close 关闭指定标签。id 来自 list 结果。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "new", "switch", "close"] },
          url: { type: "string", description: "new 时打开的新标签 URL。" },
          id: { type: "integer", description: "目标标签 id(list 返回)。" },
          index: { type: "integer", description: "目标标签序号(0 起)。" },
          waitUntil: { type: "string", enum: ["load", "domcontentloaded", "commit"] },
          timeoutMs: { type: "integer" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string" },
          tab: { type: "object" },
          tabs: { type: "array", items: { type: "object" } },
          activeId: { type: "integer" },
        },
        required: ["action", "tabs", "activeId"],
      },
      render: (args, value) => {
        const lines = value.tabs.map(
          (t: any) => `${t.id === value.activeId ? "▶" : " "} #${t.id} ${t.url}${t.title ? ` — ${t.title}` : ""}`,
        );
        return `tabs ${value.action}: ${lines.join("\n") || "(none)"}`;
      },
      timeoutMs: timeout(),
      execute: (args) => tabsTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_download",
      description:
        "获取页面上最近触发的下载(如点击下载链接后),保存到工作区 .dsh-browser/downloads/ 并返回路径。index 可选,默认最近一次;浏览器会话关闭后下载记录丢失。",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "下载记录序号(0 起,默认最近)。" },
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
  );

  register(
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
  );

  register(
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
  );

  register(
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
  );

  register(
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
  );

  register(
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
  );

  register(
    definePlainTool({
      name: "browser_profile",
      description:
        "多浏览器配置文件:list 列出配置的 profiles(work/personal…)与当前会话状态,use <name> 切换当前 profile(后续浏览器工具作用于该 profile)。每个 profile 可配置独立 userDataDir(登录态隔离)。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "use"] },
          name: { type: "string", description: "use 时的 profile 名(default 或配置的)。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          current: { type: "string" },
          profiles: { type: "array", items: { type: "object" } },
        },
        required: ["current", "profiles"],
      },
      render: (args, value) => {
        if (args.action === "use") return `Switched to profile "${value.current}"`;
        return value.profiles
          .map((p: any) => `${p.name === value.current ? "▶" : " "} ${p.name}${p.open ? ` (open, ${p.tabs} tabs${p.persistent ? ", persistent" : ""})` : " (closed)"}${p.userDataDir ? ` → ${p.userDataDir}` : ""}`)
          .join("\n") || "(no profiles configured)";
      },
      timeoutMs: timeout(),
      execute: (args) => profileTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_wait_for_login",
      description:
        "等待人工登录完成。agent 在登录页调用本工具后,提示用户在浏览器窗口中完成登录(有头模式 headless:false 时用户可直接操作;配 userDataDir 登录态会持久化)。成功条件三选一:successSelector(登录后出现的元素,如 '#avatar')或 successUrl(登录后 URL 正则,如 'https://\\\\.app\\\\.example\\\\.com')都不给则 URL 发生变化即视为完成。轮询间隔 2 秒,超时返回 loggedIn:false。",
      parameters: {
        type: "object",
        properties: {
          timeoutMs: { type: "integer", description: "等待上限(毫秒,默认 120000,上限 600000)。" },
          successSelector: { type: "string", description: "登录成功后应出现的 CSS 选择器。" },
          successUrl: { type: "string", description: "登录成功后 URL 应匹配的正则。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          loggedIn: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["loggedIn", "url", "title"],
      },
      render: (_args, value) =>
        value.loggedIn ? `登录完成: ${value.url}` : `等待登录超时,仍在: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => waitForLoginTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_elements",
      description:
        "列出当前页面可交互元素(input/textarea/select/button/链接)的结构化清单:类型、name/id、placeholder、可见文本、可直接用于 browser_click/browser_type 的 CSS 选择器。比 browser_snapshot 更适合定位表单。",
      parameters: {
        type: "object",
        properties: {
          max: { type: "integer", description: "最多返回多少元素,默认 60。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "integer" },
          elements: { type: "array", items: { type: "object" } },
        },
        required: ["count", "elements"],
      },
      render: (_args, value) =>
        (value.elements ?? [])
          .map(
            (e: any) =>
              `<${e.tag}${e.type ? ` type=${e.type}` : ""}>${e.name ? ` name=${e.name}` : ""}${e.id ? ` id=${e.id}` : ""}${e.placeholder ? ` ph="${e.placeholder}"` : ""}${e.text ? ` "${e.text.slice(0, 40)}"` : ""}${e.selector ? ` → ${e.selector}` : ""}`,
          )
          .join("\n") || "(no interactive elements)",
      timeoutMs: timeout(),
      execute: (args) => elementsTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_wait_for",
      description:
        "通用显式等待(测试同步原语):轮询直到条件成立或超时抛错。condition 四类:1) {selector:'#btn', state:'visible|hidden|attached|detached'} 元素状态(默认 visible);2) {url:'正则字符串'} 当前 URL 匹配;3) {text:'子串'} 页面可见文本包含;4) {count:{selector,op:'eq|gt|gte|lt|lte',value}} 元素数量比较;5) {eval:'JS 表达式'} 求值 truthy。用于等页面渲染、等请求完成、等元素出现。",
      parameters: {
        type: "object",
        properties: {
          condition: {
            type: "object",
            description: "等待条件(见描述,五选一)。",
          },
          timeoutMs: { type: "integer", description: "超时毫秒,默认 10000,上限 120000。" },
          intervalMs: { type: "integer", description: "轮询间隔毫秒,默认 500。" },
        },
        required: ["condition"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          met: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["met", "url", "title"],
      },
      render: (_args, value) => `等待条件满足: ${value.url}`,  
      timeoutMs: timeout(),
      execute: (args) => waitForTool(config, args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_assert",
      description:
        "结构化断言(测试核心):condition 在 timeoutMs 内成立则通过(条件格式同 browser_wait_for)。失败时自动截图存证据目录(assert-fail-*.png)并抛错,错误消息含原因与截图路径。适合断言登录成功、关键元素出现、接口返回、文本正确。",
      parameters: {
        type: "object",
        properties: {
          condition: { type: "object", description: "断言条件(五选一,同 browser_wait_for)。" },
          timeoutMs: { type: "integer", description: "断言超时毫秒,默认 5000,上限 60000。" },
          intervalMs: { type: "integer", description: "轮询间隔毫秒,默认 300。" },
        },
        required: ["condition"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          passed: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["passed", "url", "title"],
      },
      render: (_args, value) => `断言通过: ${value.url}`,  
      timeoutMs: timeout(),
      execute: (args, exec) => assertTool(config, args, exec),
    }),
  );

  register(
    definePlainTool({
      name: "browser_network",
      description:
        "网络记录查询(自动记录页面 XHR/fetch 接口请求,含请求/响应体截断存储,每 profile 上限 500 条)。action:list 列出(可按 urlSubstr/method/status 过滤,limit 默认 50);failed 只列失败/4xx5xx;wait 等待某个 url 正则匹配的接口出现(带 timeoutMs);clear 清空记录。适合断言接口出入参、排查 4xx/5xx。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "failed", "wait", "clear"], description: "默认 list。" },
          urlSubstr: { type: "string", description: "URL 子串过滤(list/failed)。" },
          method: { type: "string", description: "HTTP 方法过滤(list/failed)。" },
          status: { type: "integer", description: "状态码过滤(list/failed)。" },
          limit: { type: "integer", description: "返回条数上限,默认 50。" },
          url: { type: "string", description: "wait 时的 URL 正则。" },
          timeoutMs: { type: "integer", description: "wait 超时毫秒,默认 10000。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          entries: { type: "array", items: { type: "object" } },
          failed: { type: "array", items: { type: "object" } },
          matched: { type: "object" },
          cleared: { type: "boolean" },
        },
        required: [],
      },
      render: (_args, value) => {
        const list = value.entries ?? value.failed ?? (value.matched ? [value.matched] : []);
        if (value.cleared) return "网络记录已清空";
        return (list as any[])
          .map((e: any) => {
            const head = `${e.method} ${e.url} → ${e.failed ? "FAILED" : (e.ok ? e.status : e.status + " !")}${e.durationMs !== undefined ? ` ${e.durationMs}ms` : ""}`;
            const reqBody = e.postData ? `\n  req: ${String(e.postData).slice(0, 160)}` : "";
            const resBody = e.body ? `\n  res: ${String(e.body).slice(0, 240)}` : "";
            return head + reqBody + resBody;
          })
          .join("\n") || "(无记录)";
      },
      timeoutMs: timeout(),
      execute: (args) => networkTool(args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_record",
      description:
        "操作录制(回归测试数据源):start 开始录制(后续浏览器工具调用自动记录),stop 结束并返回步数,save <name> 保存最近 100 次调用为命名录制,list/delete 管理。配合 browser_replay 一键回放。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "stop", "save", "list", "delete"], description: "默认 start。" },
          name: { type: "string", description: "save/delete 时的录制名。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          recording: { type: "boolean" },
          steps: { type: "integer" },
          saved: { type: "string" },
          recordings: { type: "array", items: { type: "object" } },
          deleted: { type: "boolean" },
          name: { type: "string" },
          hint: { type: "string" },
        },
        required: [],
      },
      render: (args, value) => {
        if (args.action === "start") return "开始录制(后续浏览器调用将记录)";
        if (args.action === "stop") return `录制结束,共 ${value.steps} 步(browser_record save <name> 保存)`;
        if (args.action === "save") return `已保存录制 "${value.saved}"(${value.steps} 步)`;
        if (args.action === "delete") return value.deleted ? `已删除 "${value.name}"` : `无此录制 "${value.name}"`;
        return (value.recordings ?? []).map((r: any) => `"${r.name}"(${r.steps} 步): ${r.preview}`).join("\n") || "(无录制)";
      },
      timeoutMs: timeout(),
      execute: (args) => recordTool(args),
    }),
  );

  register(
    definePlainTool({
      name: "browser_replay",
      description:
        "回放录制或步骤序列(回归测试):name 指定已保存录制(browser_record save),或直接传 steps 数组(每步 {tool, args})。failFast 默认 true(遇错停止);返回每步结果与汇总。回放中的调用会记入操作轨迹。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "已保存录制名(与 steps 二选一)。" },
          steps: { type: "array", items: { type: "object" }, description: "步骤数组 [{tool, args}]。" },
          failFast: { type: "boolean", description: "遇错即停,默认 true。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string" },
          total: { type: "integer" },
          passed: { type: "integer" },
          failed: { type: "integer" },
          stoppedAt: { type: "integer" },
          results: { type: "array", items: { type: "object" } },
          summary: { type: "string" },
        },
        required: ["source", "total", "passed", "failed", "results", "summary"],
      },
      render: (_args, value) => `${value.summary}\n${(value.results ?? []).map((r: any) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`,
      timeoutMs: timeout(),
      execute: (args) => replayTool(args, stepImpls),
    }),
  );
}
