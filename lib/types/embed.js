// dsh-browser · 原生 Web UI 嵌入(基路径/embed.js)
//
// 通过 webServer.tapIndex 把脚本注入 DSH index.html,在原生界面上渲染右下角
// 浮动面板:浏览器状态行 + 实时画面缩略图;点缩略图弹出大屏模态框
// (2 秒轮询实时画面 + 访问历史)。全部 fixed 定位、只读官方 CSS 变量
// (--dsw-alias-*),不依赖官方 DOM 结构,自动适配亮/暗主题。
import { sendText } from "./lib/http.js";
/** 面板嵌入 + 实时画面 API 共用基路径。 */
function embedJs(base) {
    return `(function () {
  "use strict";
  var B = ${JSON.stringify(base)};

  // —— 挂载(等 body 就绪) ——
  var root = null, btn = null, panel = null, open = false, shot = null;
  var modal = null, mTitle = null, mShot = null, mHistory = null, mEmpty = null, modalOpen = false;
  var opsBox = null;

  function css() {
    var s = document.createElement("style");
    s.textContent = [
      "#dsh-browser-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:40px;height:40px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 16px var(--dsw-alias-bg-mask-2);transition:background .15s ease}",
      "#dsh-browser-fab:hover{background:var(--dsw-alias-button-floating-hover)}",
      "#dsh-browser-panel,#dsh-browser-panel *,.dsh-browser-modal-box,.dsh-browser-modal-box *{box-sizing:border-box}",
      "#dsh-browser-panel{position:fixed;right:16px;bottom:64px;z-index:2147483000;width:320px;max-height:70vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;display:none;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:0 8px 32px var(--dsw-alias-bg-mask-2);padding:12px}",
      "#dsh-browser-panel::-webkit-scrollbar{display:none}",
      "#dsh-browser-panel.open{display:flex}",
      ".dsh-browser-row{display:flex;align-items:center;gap:8px;padding:6px 0}",
      ".dsh-browser-dot{width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-label-dimmed);flex:none}",
      ".dsh-browser-dot.ok{background:var(--dsw-alias-state-success-primary)}",
      ".dsh-browser-dot.bad{background:var(--dsw-alias-state-error-primary)}",
      ".dsh-browser-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-browser-value{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}",
      ".dsh-browser-shot{width:100%;display:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}",
      ".dsh-browser-shot.on{display:block}",
      ".dsh-browser-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;display:none}",
      ".dsh-browser-hint.on{display:block}",
      ".dsh-browser-modal{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-2)}",
      ".dsh-browser-modal.open{display:flex}",
      ".dsh-browser-modal-box{width:min(1200px,100%);max-height:90vh;display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu);padding:12px;box-shadow:0 16px 64px var(--dsw-alias-bg-mask-2)}",
      ".dsh-browser-modal-head{display:flex;align-items:center;gap:8px}",
      ".dsh-browser-modal-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}",
      ".dsh-browser-modal-close{width:28px;height:28px;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1}",
      ".dsh-browser-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-modal-shot{width:100%;max-height:58vh;object-fit:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}",
      ".dsh-browser-modal-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;padding:24px 0}",
      ".dsh-browser-history{display:none;flex-direction:column;gap:2px;max-height:24vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}",
      ".dsh-browser-history::-webkit-scrollbar{display:none}",
      ".dsh-browser-history.on{display:flex}",
      ".dsh-browser-history-title{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin-bottom:4px}",
      ".dsh-browser-history a{display:flex;gap:8px;align-items:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;text-decoration:none;border-radius:8px;padding:6px 8px;white-space:nowrap;overflow:hidden}",
      ".dsh-browser-history a:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-history .t{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px}",
      ".dsh-browser-history .u{overflow:hidden;text-overflow:ellipsis}",
      ".dsh-browser-ops{display:none;flex-direction:column;gap:2px;max-height:20vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px;margin-top:2px}",
      ".dsh-browser-ops::-webkit-scrollbar{display:none}",
      ".dsh-browser-ops.on{display:flex}",
      ".dsh-browser-ops-title{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin-bottom:2px}",
      ".dsh-browser-op{display:flex;gap:6px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 4px}",
      ".dsh-browser-op .ok{color:var(--dsw-alias-state-success-primary);flex:none}",
      ".dsh-browser-op .fail{color:var(--dsw-alias-state-error-primary);flex:none}",
      ".dsh-browser-op .t{color:var(--dsw-alias-label-tertiary);flex:none}",
      ".dsh-browser-op .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}",
    ].join("\\n");
    document.head.appendChild(s);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function probe(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r : null; })
      .catch(function () { return null; });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }
  // —— 大屏模态框:点面板缩略图打开,2 秒轮询实时画面 + 访问历史 ——
  function renderHistory(list) {
    mHistory.innerHTML = "";
    if (!list || list.length === 0) { mHistory.className = "dsh-browser-history"; return; }
    mHistory.className = "dsh-browser-history on";
    mHistory.appendChild(el("div", "dsh-browser-history-title", "访问历史(" + list.length + " 条,点击在新标签打开)"));
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var a = document.createElement("a");
      a.href = e.url; a.target = "_blank"; a.rel = "noopener";
      if (e.title) a.title = e.title;
      a.appendChild(el("span", "t", fmtTime(e.ts)));
      a.appendChild(el("span", "u", (e.title || e.url).slice(0, 100)));
      mHistory.appendChild(a);
    }
  }
  function modalRefresh() {
    if (!modalOpen) return;
    probe(B + "/status").then(function (r) {
      if (r === null) {
        mEmpty.style.display = "block"; mEmpty.textContent = "连接失败";
        mShot.style.display = "none"; mTitle.textContent = "浏览器实时画面";
        return;
      }
      return r.json().then(function (s) {
        if (!s.open) {
          mEmpty.style.display = "block"; mEmpty.textContent = "浏览器尚未打开。让 agent 调用 browser_open。";
          mShot.style.display = "none"; mTitle.textContent = "浏览器实时画面";
        } else {
          mEmpty.style.display = "none"; mShot.style.display = "block";
          mTitle.textContent = (s.url || "(空白页)") + " — " + (s.title || "");
          mShot.src = B + "/screenshot?v=" + Date.now();
        }
      });
    }).catch(function () {});
    probe(B + "/history").then(function (r) {
      if (r !== null) r.json().then(function (h) { renderHistory(h.history || []); }).catch(function () {});
    }).catch(function () {});
    setTimeout(modalRefresh, 2000);
  }
  function openModal() {
    if (modal === null) return;
    modalOpen = true;
    modal.className = "dsh-browser-modal open";
    modalRefresh();
  }
  function closeModal() {
    modalOpen = false;
    if (modal !== null) modal.className = "dsh-browser-modal";
  }
  function buildModal() {
    modal = el("div", "dsh-browser-modal");
    var box = el("div", "dsh-browser-modal-box");
    var head = el("div", "dsh-browser-modal-head");
    mTitle = el("span", "dsh-browser-modal-title", "浏览器实时画面");
    head.appendChild(mTitle);
    var close = el("button", "dsh-browser-modal-close", "✕");
    close.addEventListener("click", closeModal);
    head.appendChild(close);
    mEmpty = el("div", "dsh-browser-modal-empty", "浏览器尚未打开");
    mShot = el("img", "dsh-browser-modal-shot"); mShot.alt = "browser"; mShot.style.display = "none";
    mHistory = el("div", "dsh-browser-history");
    box.appendChild(head); box.appendChild(mEmpty); box.appendChild(mShot); box.appendChild(mHistory);
    modal.appendChild(box);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) closeModal(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeModal(); });
    root.appendChild(modal);
  }
  function mount() {
    if (root !== null) return;
    css();
    btn = el("button", null); btn.id = "dsh-browser-fab"; btn.title = "dsh-browser";
    btn.textContent = "🌐";
    panel = el("div", null); panel.id = "dsh-browser-panel";
    function row(id) { var r = el("div", "dsh-browser-row"); var d = el("span", "dsh-browser-dot"); r.appendChild(d); var l = el("span", "dsh-browser-label", id); r.appendChild(l); var v = el("span", "dsh-browser-value", "—"); r.appendChild(v); return { row: r, dot: d, value: v }; }
    var rB = row("浏览器");
    shot = el("img", "dsh-browser-shot"); shot.alt = "browser";
    shot.addEventListener("click", openModal); // 点缩略图 → 大屏模态框
    var hint = el("div", "dsh-browser-hint", "点缩略图看实时画面与访问历史;agent 用 browser_* 工具操作浏览器。");
    opsBox = el("div", "dsh-browser-ops");
    panel.appendChild(rB.row);
    panel.appendChild(shot);
    panel.appendChild(opsBox);
    panel.appendChild(hint);
    btn.addEventListener("click", function () { open = !open; panel.className = open ? "open" : ""; panel.id = "dsh-browser-panel"; });
    root = document.createElement("div");
    root.appendChild(btn); root.appendChild(panel);
    document.body.appendChild(root);
    buildModal();
    function refresh() {
      probe(B + "/status").then(function (r) {
        if (r === null) { rB.dot.className = "dsh-browser-dot bad"; rB.value.textContent = "未启用"; return; }
        r.json().then(function (s) {
          rB.dot.className = "dsh-browser-dot " + (s.open ? "ok" : "bad");
          rB.value.textContent = s.open ? (s.tabs + " 标签 · " + (s.url || "").slice(0, 24)) : "未打开";
          if (open) {
            if (s.open) { shot.className = "dsh-browser-shot on"; shot.src = B + "/screenshot?v=" + Date.now(); hint.className = "dsh-browser-hint"; }
            else { shot.className = "dsh-browser-shot"; hint.className = "dsh-browser-hint on"; }
          }
        }).catch(function () {});
      }).catch(function () {});
      probe(B + "/log").then(function (r) {
        if (r !== null) r.json().then(function (d) { renderOps(d.calls || []); }).catch(function () {});
      }).catch(function () {});
    }
    refresh();
    setInterval(refresh, 5000);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();`;
}
/** 原生 UI 注入:exact 路由提供 embed.js + tapIndex 注入 script 标签。 */
function registerEmbed(webServer, base) {
    const embedPath = `${base}/embed.js`;
    const script = embedJs(base);
    const disposeRoute = webServer.register({
        kind: "exact",
        path: embedPath,
        handler: (req, res) => {
            if ((req.method ?? "GET") !== "GET") {
                sendText(res, 405, "method not allowed");
                return;
            }
            res.writeHead(200, {
                "content-type": "text/javascript; charset=utf-8",
                "cache-control": "no-store",
                "content-length": Buffer.byteLength(script),
            });
            res.end(script);
        },
    });
    const scriptTag = `<script src="${embedPath}" defer></script>`;
    const disposeTap = webServer.tapIndex((html) => {
        if (html.includes("dsh-browser"))
            return html; // 已注入
        const idx = html.lastIndexOf("</head>");
        if (idx === -1)
            return html;
        return `${html.slice(0, idx)}${scriptTag}${html.slice(idx)}`;
    });
    return () => {
        try {
            disposeRoute();
            disposeTap();
        }
        catch {
            /* ignore */
        }
    };
}
export function applyEmbed(ctx, webServer, base) {
    const dispose = registerEmbed(webServer, base);
    ctx.effect(() => () => {
        try {
            dispose();
        }
        catch {
            /* ignore */
        }
    });
    const port = webServer.port;
    if (typeof port === "number") {
        ctx.logger?.info?.(`dsh-browser: native UI widget injected (${base}/embed.js)`);
    }
    return dispose;
}
//# sourceMappingURL=embed.js.map