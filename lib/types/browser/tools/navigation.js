import { getPage, activePage, tabList, closeBrowser, stateOf, currentProfile, setCurrentProfile, profileStates, launchProfile, namedContextsOf, registerTabPage, newPage, pageIdentity, attachPage, profileConfig, getProfileState, } from "../session.js";
export async function openTool(configOrArgs, maybeArgs) {
    const isSingleArg = maybeArgs === undefined;
    const config = (isSingleArg && typeof configOrArgs?.url === "string" ? {} : configOrArgs);
    const args = (isSingleArg ? configOrArgs : maybeArgs);
    const page = await getPage(config ?? {});
    await page.goto(String(args.url), {
        waitUntil: args.waitUntil ?? "domcontentloaded",
        timeout: args.timeoutMs ?? config?.timeoutMs,
    });
    return {
        url: page.url(),
        title: await page.title(),
        status: "ok",
    };
}
export async function backTool(config) {
    const page = await getPage(config);
    await page.goBack().catch(() => { });
    return { ...(await pageIdentity(page)) };
}
export async function reloadTool(config) {
    const page = await getPage(config);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => { });
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
export async function contextTool(config, args) {
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
        if (contexts.has(name))
            throw new Error(`context "${name}" 已存在;如需重建先 browser_context { action: "close", name }`);
        if (state.browser === null && state.context === null)
            await launchProfile(currentProfile, config);
        if (state.browser === null) {
            throw new Error("持久模式(userDataDir)的浏览器只有单一 context,不支持多 context;需要多账号隔离请配置 profiles 多套 userDataDir");
        }
        const context = await state.browser.newContext();
        const page = await context.newPage();
        attachPage(page, profileConfig(config, currentProfile));
        const id = registerTabPage(state, page);
        const entry = { context, pageIds: new Set([id]), createdAt: Date.now() };
        contexts.set(name, entry);
        page.on("close", () => {
            entry.pageIds.delete(id);
        });
        let navigated;
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
        if (!name)
            throw new Error('switch 需要 name(用 list 查看已有 context)');
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
        if (!name)
            throw new Error('close 需要 name');
        const entry = contexts.get(name);
        if (entry === undefined)
            throw new Error(`context "${name}" 不存在`);
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
        }
        catch {
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
export async function tabsTool(config, args) {
    const action = args.action ?? "list";
    const state = stateOf();
    if (state.browser === null && state.context === null && action !== "list")
        await launchProfile(currentProfile, config);
    if (state.browser === null && state.context === null)
        return { action, tabs: [], activeId: -1 };
    switch (action) {
        case "list": {
            return { action, tabs: await tabList(), activeId: state.activeId ?? -1 };
        }
        case "new": {
            const page = await newPage(config);
            const id = state.counter++;
            state.pages.set(id, page);
            state.activeId = id;
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
            if (!state.pages.has(id))
                throw new Error(`no tab with id ${id}`);
            state.activeId = id;
            return { action, activeId: state.activeId, tabs: await tabList() };
        }
        case "close": {
            const id = resolveTabId(args);
            const page = state.pages.get(id);
            if (page === undefined)
                throw new Error(`no tab with id ${id}`);
            await page.close().catch(() => { });
            state.pages.delete(id);
            if (state.activeId === id) {
                const next = state.pages.keys().next().value;
                state.activeId = next === undefined ? null : next;
            }
            return { action, activeId: state.activeId ?? -1, tabs: await tabList() };
        }
        default:
            throw new Error(`unknown tabs action: ${action}`);
    }
}
function resolveTabId(args) {
    const state = stateOf();
    if (args.id !== undefined)
        return Number(args.id);
    if (args.index !== undefined) {
        const ids = [...state.pages.keys()];
        const idx = Number(args.index);
        if (idx < 0 || idx >= ids.length)
            throw new Error(`tab index ${idx} out of range`);
        return ids[idx];
    }
    if (state.activeId !== null)
        return state.activeId;
    throw new Error("no tab id/index given and no active tab");
}
export async function profileTool(config, args) {
    const action = args.action ?? "list";
    const available = Object.keys(config.profiles ?? {});
    // 与 outputSchema 保持一致:profiles 永远是对象数组,不随动作变化。
    const describe = (name) => {
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
//# sourceMappingURL=navigation.js.map