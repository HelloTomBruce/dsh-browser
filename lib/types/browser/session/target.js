import { extractElementLabel, getActiveDialog } from "../adapters/dom.js";
import { pageRef } from "./cache.js";
import { withTimeout } from "../tools/common.js";
/**
 * 统一解析目标元素：
 * 自动识别 selector 或 ref；若 ref 标记位于子 Frame，自动绑定到对应子 Frame 上下文。
 * 具备路径防漂移校验与 getByRole 自愈降级能力。
 */
export async function resolveTargetLocator(page, args) {
    if (args.ref !== undefined && args.ref !== "") {
        const ref = String(args.ref);
        const entry = pageRef(page, ref);
        if (entry === undefined) {
            throw new Error(`未知 ref: ${ref}(页面导航或重新快照后旧 ref 失效;请先 browser_snapshot { mode: "aria" })`);
        }
        // 判断目标容器：主页面或子 Frame
        let container = page;
        let isIFrame = false;
        if (typeof entry.frameIndex === "number" && entry.frameIndex > 0) {
            const frames = page.frames();
            const targetFrame = frames[entry.frameIndex];
            if (!targetFrame) {
                throw new Error(`引用元素所在的子 Frame (index=${entry.frameIndex}) 已失效或销毁`);
            }
            container = targetFrame;
            isIFrame = true;
        }
        const byPath = container.locator(entry.selector).first();
        const count = await withTimeout(byPath.count(), 3_000, "解析 ref 路径").catch(() => 0);
        if (count > 0) {
            const ok = await withTimeout(byPath.evaluate((el, { role, name, labelScript }) => {
                const tag = el.tagName.toLowerCase();
                const type = (el.getAttribute("type") ?? "").toLowerCase();
                const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
                const roleOk = role === "" ||
                    roleAttr === role ||
                    (role === "link" && tag === "a") ||
                    (role === "button" &&
                        (tag === "button" ||
                            tag === "summary" ||
                            (tag === "input" && ["button", "submit", "reset", "image"].includes(type)))) ||
                    (["textbox", "searchbox"].includes(role) &&
                        (tag === "textarea" ||
                            (tag === "input" && !["hidden", "checkbox", "radio"].includes(type)))) ||
                    (role === "combobox" && tag === "select") ||
                    (role === "checkbox" && tag === "input" && type === "checkbox") ||
                    (role === "radio" && tag === "input" && type === "radio");
                const aria = el.getAttribute("aria-label") ?? "";
                const ph = el.getAttribute("placeholder") ?? "";
                const title = el.getAttribute("title") ?? "";
                const text = (el.innerText || el.textContent || "")
                    .trim()
                    .replace(/\s+/g, " ");
                let labelText = "";
                try {
                    const labelFn = new Function("el", `return (${labelScript})(el);`);
                    labelText = String(labelFn(el) || "");
                }
                catch {
                    /* ignore */
                }
                const nameOk = name === "" ||
                    aria.includes(name) ||
                    ph.includes(name) ||
                    title.includes(name) ||
                    text.includes(name) ||
                    labelText.includes(name);
                return roleOk && nameOk;
            }, {
                role: entry.role,
                name: entry.name,
                labelScript: extractElementLabel.toString(),
            }), 3_000, "校验 ref 元素").catch(() => false);
            if (ok) {
                return { locator: byPath, container, entry, isIFrame };
            }
        }
        // 降级 1: 若在主页面且有激活的 Modal 弹窗，优先在弹窗容器内检索防穿透
        if (!isIFrame) {
            try {
                const activeDialog = getActiveDialog(page);
                if (activeDialog && typeof activeDialog.getByRole === "function") {
                    const inDialog = entry.name !== ""
                        ? activeDialog.getByRole(entry.role, { name: entry.name }).first()
                        : activeDialog.getByRole(entry.role).first();
                    if ((await withTimeout(inDialog.count(), 1_000, "弹窗内 role 查找").catch(() => 0)) > 0) {
                        return { locator: inDialog, container, entry, isIFrame: false };
                    }
                }
            }
            catch {
                /* ignore */
            }
        }
        // 降级 2: role + name
        const byRole = entry.name !== ""
            ? container.getByRole(entry.role, { name: entry.name }).first()
            : container.getByRole(entry.role).first();
        if ((await withTimeout(byRole.count(), 3_000, "解析 ref role 降级").catch(() => 0)) > 0) {
            return { locator: byRole, container, entry, isIFrame };
        }
        throw new Error(`ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`);
    }
    if (args.selector === undefined) {
        throw new Error("需要 selector 或 ref 之一");
    }
    return {
        locator: page.locator(String(args.selector)).first(),
        container: page,
        isIFrame: false,
    };
}
/** 兼容旧版签名的目标定位快捷方式 */
export async function targetLocator(page, args) {
    const res = await resolveTargetLocator(page, args);
    return res.locator;
}
//# sourceMappingURL=target.js.map