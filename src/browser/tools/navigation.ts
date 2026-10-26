// dsh-browser · 浏览器工具 — 导航与会话生命周期
import type { BrowserConfig } from "../types.js";
import {
  getPage, activePage, tabList, closeBrowser, stateOf,
  currentProfile, setCurrentProfile, profileStates, launchProfile,
  namedContextsOf, registerTabPage, newPage, pageIdentity,
  attachPage, profileConfig, getProfileState,
} from "../session.js";

export async function openTool(configOrArgs: BrowserConfig | Record<string, any>, maybeArgs?: Record<string, any>) {
  const isSingleArg = maybeArgs === undefined;
  const config = (isSingleArg && typeof (configOrArgs as any)?.url === "string" ? {} : configOrArgs) as BrowserConfig;
  const args = (isSingleArg ? configOrArgs : maybeArgs) as Record<string, any>;
  const state = stateOf();
  // 僵尸标签自愈:"我要去某个 URL"的意图下换新页无歧义(与 getPage 的报错引导互补)
  let recovered: string | undefined;
  const freshPage = async () => {
    const p = await newPage(config ?? {});
    registerTabPage(state, p);
    recovered = "new-tab";
    return p;
  };
  let page = await getPage(config ?? {}).catch(async (e: any) => {
    if (e?.code === "activeTabClosed") return freshPage();
    throw e;
  });
  if (page.isClosed()) page = await freshPage();
  try {
    await page.goto(String(args.url), {
      waitUntil: args.waitUntil ?? "domcontentloaded",
      timeout: args.timeoutMs ?? config?.timeoutMs,
    });
  } catch (e) {
    // goto 途中目标页被关闭(竞态):换新页重试一次;仍失败则如实抛出
    if (recovered === undefined && /has been closed/.test(String((e as Error)?.message ?? e))) {
      page = await freshPage();
      await page.goto(String(args.url), {
        waitUntil: args.waitUntil ?? "domcontentloaded",
        timeout: args.timeoutMs ?? config?.timeoutMs,
      });
    } else {
      throw e;
    }
  }
  return {
    url: page.url(),
    title: await page.title(),
    status: "ok",
    ...(recovered !== undefined ? { recovered } : {}),
  };
}

export async function backTool(config: BrowserConfig) {
  const page = await getPage(config);
  await page.goBack().catch(() => {});
  return { ...(await pageIdentity(page)) };
}

export async function reloadTool(config: BrowserConfig) {
  const page = await getPage(config);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  return { ...(await pageIdentity(page)) };
}

// ---------------------------------------------------------------------------
// browser_doctor:健康诊断(channel/可执行文件、目录权限、会话状态、面板可达性)
// ---------------------------------------------------------------------------

/**
 * 命名隔离上下文:同一浏览器进程内独立 cookies/storage 的"标签组"。
 * 页注册进 profile 标签表(所有既有工具直接可用),context 只做归属记录:
 * list / new(name?, url?) / switch(激活该组的一页,没有则新开) / close(整组关闭)。
 * 持久模式(userDataDir)浏览器只有单一 context,不支持本工具(用 profiles 替代)。
 */
export async function contextTool(config: BrowserConfig, args: Record<string, any>) {
  const action = args.action ?? "list";
  const state = stateOf();
  const contexts = namedContextsOf();
  if (action === "list") {
    return {
      contexts: Array.from(contexts.entries()).map(([name, c]) => {
        const alive = Array.from(c.pageIds).filter((id) => state.pages.has(id));
        return {
          name,
          pages: alive.length,
          active: state.activeId !== null && c.pageIds.has(state.activeId),
          createdAt: c.createdAt,
        };
      }),
      profile: currentProfile,
    };
  }
  if (action === "new") {
    const name = String(args.name ?? "").trim() || `ctx-${contexts.size + 1}`;
    if (contexts.has(name)) throw new Error(`context "${name}" 已存在;如需重建先 browser_context { action: "close", name }`);
    if (state.browser === null && state.context === null) await launchProfile(currentProfile, config);
    if (state.browser === null) {
      throw new Error(
        "持久模式(userDataDir)的浏览器只有单一 context,不支持多 context;需要多账号隔离请配置 profiles 多套 userDataDir",
      );
    }
    const context = await state.browser.newContext();
    const page = await context.newPage();
    attachPage(page, profileConfig(config, currentProfile));
    const id = registerTabPage(state, page);
    const entry = { context, pageIds: new Set<number>([id]), createdAt: Date.now() };
    contexts.set(name, entry);
    page.on("close", () => {
      entry.pageIds.delete(id);
    });
    let navigated: string | undefined;
    if (typeof args.url === "string" && args.url) {
      await page.goto(args.url, { waitUntil: "domcontentloaded" });
      navigated = page.url();
    }
    return {
      created: name,
      ...(navigated !== undefined ? { navigated } : {}),
      ...(await pageIdentity(page)),
    };
  }
  if (action === "switch") {
    const name = String(args.name ?? "").trim();
    if (!name) throw new Error('switch 需要 name(用 list 查看已有 context)');
    const entry = contexts.get(name);
    if (entry === undefined) {
      throw new Error(`context "${name}" 不存在;已有: ${Array.from(contexts.keys()).join("、") || "(无)"}`);
    }
    for (const id of entry.pageIds) {
      const page = state.pages.get(id);
      if (page !== undefined) {
        state.activeId = id;
        return { switched: name, ...(await pageIdentity(page)) };
      }
    }
    // 组内页全关:在原 context 里新开一页(cookie/storage 仍在)
    const page = await entry.context.newPage();
    attachPage(page, profileConfig(config, currentProfile));
    const id = registerTabPage(state, page);
    entry.pageIds.add(id);
    page.on("close", () => {
      entry.pageIds.delete(id);
    });
    return { switched: name, pages: 1, ...(await pageIdentity(page)) };
  }
  if (action === "close") {
    const name = String(args.name ?? "").trim();
    if (!name) throw new Error('close 需要 name');
    const entry = contexts.get(name);
    if (entry === undefined) throw new Error(`context "${name}" 不存在`);
    for (const id of entry.pageIds) {
      state.pages.delete(id);
      if (state.activeId === id) {
        state.activeId = Array.from(state.pages.keys()).pop() ?? null;
      }
    }
    entry.pageIds.clear();
    contexts.delete(name);
    try {
      await entry.context.close();
    } catch {
      /* already closed */
    }
    return { closed: name, remainingTabs: state.pages.size };
  }
  throw new Error(`未知 action: ${action}(list | new | switch | close)`);
}

// ---------------------------------------------------------------------------
// 面板双向化支撑:操作预告高亮
// ---------------------------------------------------------------------------

export async function statusTool() {
  const page = activePage();
  const state = stateOf();
  const profiles = [];
  for (const [name, s] of profileStates) {
    profiles.push({
      name,
      open: s.browser !== null || s.context !== null,
      tabs: s.pages.size,
      channel: s.channel ?? "",
      persistent: s.persistent,
    });
  }
  if (page === null) {
    return { open: false, profile: currentProfile, channel: state.channel ?? "", tabs: 0, profiles };
  }
  return {
    open: true,
    profile: currentProfile,
    channel: state.channel ?? "",
    tabs: state.pages.size,
    profiles,
    ...(await pageIdentity(page)),
  };
}

export async function tabsTool(config: BrowserConfig, args: Record<string, any>) {
  const action = args.action ?? "list";
  const state = stateOf();
  if (state.browser === null && state.context === null && action !== "list") await launchProfile(currentProfile, config);
  if (state.browser === null && state.context === null) return { action, tabs: [], activeId: -1 };
  switch (action) {
    case "list": {
      return { action, tabs: await tabList(), activeId: state.activeId ?? -1 };
    }
    case "new": {
      const page = await newPage(config);
      const id = registerTabPage(state, page);
      if (args.url) {
        await page.goto(String(args.url), {
          waitUntil: args.waitUntil ?? "domcontentloaded",
          timeout: args.timeoutMs ?? config.timeoutMs,
        });
      }
      return { action, tab: { id, url: page.url(), title: await page.title() }, tabs: await tabList(), activeId: state.activeId };
    }
    case "switch": {
      const id = resolveTabId(args);
      if (!state.pages.has(id)) throw new Error(`no tab with id ${id}`);
      state.activeId = id;
      return { action, activeId: state.activeId, tabs: await tabList() };
    }
    case "close": {
      const id = resolveTabId(args);
      const page = state.pages.get(id);
      if (page === undefined) throw new Error(`no tab with id ${id}`);
      // 先摘注册表再关页:close 事件监听器因 id 已不在而跳过,activeId 语义在此显式确定
      state.pages.delete(id);
      state.tabMeta?.delete(id);
      if (state.activeId === id) state.activeId = null;
      await page.close().catch(() => {});
      return { action, activeId: state.activeId ?? -1, tabs: await tabList() };
    }
    default:
      throw new Error(`unknown tabs action: ${action}`);
  }
}

function resolveTabId(args: Record<string, any>): number {
  const state = stateOf();
  if (args.id !== undefined) return Number(args.id);
  if (args.index !== undefined) {
    const ids = [...state.pages.keys()];
    const idx = Number(args.index);
    if (idx < 0 || idx >= ids.length) throw new Error(`tab index ${idx} out of range`);
    return ids[idx];
  }
  if (state.activeId !== null) return state.activeId;
  throw new Error("no tab id/index given and no active tab");
}

export async function profileTool(config: BrowserConfig, args: Record<string, any>) {
  const action = args.action ?? "list";
  const available = Object.keys(config.profiles ?? {});
  // 与 outputSchema 保持一致:profiles 永远是对象数组,不随动作变化。
  const describe = (name: string) => {
    const state = getProfileState(name);
    return {
      name,
      open: state.browser !== null || state.context !== null,
      tabs: state.pages.size,
      persistent: state.persistent,
      userDataDir: profileConfig(config, name).userDataDir ?? "",
    };
  };
  if (action === "list") {
    return { current: currentProfile, profiles: available.map(describe) };
  }
  if (action === "use") {
    const name = String(args.name ?? "");
    if (name !== "default" && !available.includes(name)) {
      throw new Error(`unknown profile: ${name} (available: ${["default", ...available].join(", ")})`);
    }
    setCurrentProfile(name);
    return { current: currentProfile, profiles: available.map(describe) };
  }
  throw new Error(`unknown profile action: ${action}`);
}

export async function closeTool() {
  await closeBrowser();
  return { closed: true };
}
