/**
 * 等待页面 DOM 达到稳定状态
 * @param page Playwright Page 实例
 * @param options 等待选项
 * @returns boolean 成功达到稳态返回 true，超时返回 false
 */
export async function waitForDOMQuiescence(page, options = {}) {
    const quietMs = Math.min(Math.max(options.quietMs ?? 80, 20), 1000);
    const maxTimeoutMs = Math.min(Math.max(options.maxTimeoutMs ?? 2500, 200), 15000);
    const scope = options.scope ?? "";
    try {
        const isQuiet = await page.evaluate(`(({ quietMs, maxTimeoutMs, scope }) => {
        return new Promise((resolve) => {
          const root = scope ? document.querySelector(scope) : document.body;
          if (!root) return resolve(true);

          let timer = null;
          let settled = false;

          const finish = (result) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (maxTimer) clearTimeout(maxTimer);
            observer.disconnect();
            resolve(result);
          };

          const resetTimer = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => finish(true), quietMs);
          };

          const observer = new MutationObserver(() => {
            resetTimer();
          });

          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });

          // 初始启动计时器：若页面本身已静止，quietMs 后直接放行
          resetTimer();

          // 最大兜底超时
          const maxTimer = setTimeout(() => finish(false), maxTimeoutMs);
        });
      })`, { quietMs, maxTimeoutMs, scope });
        return Boolean(isQuiet);
    }
    catch {
        // 若页面导航或评估失败，安全降级
        return false;
    }
}
//# sourceMappingURL=quiescence.js.map