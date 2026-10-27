// 活动弹窗 z-index 仲裁测试(真实浏览器):验证 walker pickTopDialog 页内逻辑的
// 分层选择器、可见性过滤、z 排序与「同 z 最外层优先」规则——ant DOM 下不再把
// footer/close 等子节点误选为顶层弹窗。模式照抄 test/select.test.ts(裸静态 DOM)。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Page } from "playwright-core";
import {
  getActiveDialog,
  DIALOG_PRECISE_SELECTORS,
  DIALOG_FUZZY_SELECTORS,
} from "../src/browser/primitives/index.js";
import { pickTopDialog } from "../src/browser/walker.js";
import { getPage, closeBrowser } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = { headless: true, timeoutMs: 10_000 };
const LAYERS = { precise: DIALOG_PRECISE_SELECTORS, fuzzy: DIALOG_FUZZY_SELECTORS };

describe("活动弹窗 z-index 顶层仲裁(真实浏览器)", () => {
  let page: Page;

  beforeAll(async () => {
    page = await getPage(config);
  });

  afterAll(async () => {
    await closeBrowser();
  });

  it("antd 风格 DOM:选容器而非文档序最后的 footer/close 子节点(系统性误选回归)", async () => {
    await page.setContent(`
      <div class="ant-modal-root">
        <div class="ant-modal-mask"></div>
        <div class="ant-modal-wrap" style="position: fixed; z-index: 1000">
          <div class="ant-modal" id="modal-a">
            <div class="ant-modal-content" role="dialog">
              <div class="ant-modal-header"><span>标题</span></div>
              <div class="ant-modal-body"><input id="in-modal" /></div>
              <div class="ant-modal-footer"><button>确定</button></div>
              <span class="ant-modal-close">×</span>
            </div>
          </div>
        </div>
      </div>
    `);
    const res = (await getActiveDialog(page))!;
    expect(res.via).toBe("zIndex");
    expect(res.z).toBe(1000);
    // 最外层候选(.ant-modal)胜出,而不是同 z 但被包含的 .ant-modal-content,
    // 更不是文档序最后的 footer/close(旧 last() 行为的病灶)
    expect(await res.locator.getAttribute("id")).toBe("modal-a");
  });

  it("双弹窗并存:z-index 高者胜(即使它在 DOM 序更早)", async () => {
    await page.setContent(`
      <div class="ant-modal-wrap" style="position: fixed; z-index: 2000">
        <div class="ant-modal" id="modal-top"><div class="ant-modal-content" role="dialog">高层弹窗</div></div>
      </div>
      <div class="ant-modal-wrap" style="position: fixed; z-index: 100">
        <div class="ant-modal" id="modal-bottom"><div class="ant-modal-content" role="dialog">低层弹窗</div></div>
      </div>
    `);
    const res = (await getActiveDialog(page))!;
    expect(res.via).toBe("zIndex");
    expect(await res.locator.getAttribute("id")).toBe("modal-top");
  });

  it("同 z 兄弟弹窗:DOM 序后者胜(与 antd 后挂载者在上层一致)", async () => {
    await page.setContent(`
      <div class="ant-modal" id="first-modal" style="position: fixed; z-index: 500; top: 0; left: 0; width: 100px; height: 50px"></div>
      <div class="ant-modal" id="second-modal" style="position: fixed; z-index: 500; top: 0; left: 0; width: 100px; height: 50px"></div>
    `);
    const pick = await page.evaluate(pickTopDialog, LAYERS);
    expect(pick).not.toBeNull();
    const res = (await getActiveDialog(page))!;
    expect(await res.locator.getAttribute("id")).toBe("second-modal");
  });

  it("display:none 的关闭中弹窗被可见性过滤,不参与仲裁", async () => {
    await page.setContent(`
      <div class="ant-modal" id="closing-modal" style="position: fixed; z-index: 3000; display: none; width: 100px; height: 50px">关闭中</div>
      <div class="ant-modal" id="live-modal" style="position: fixed; z-index: 100; top: 0; width: 100px; height: 50px">存活</div>
    `);
    const res = (await getActiveDialog(page))!;
    expect(await res.locator.getAttribute("id")).toBe("live-modal");
  });

  it("非标自定义弹窗:精确层全空时模糊层兜底,且排除 header/footer 子节点", async () => {
    await page.setContent(`
      <div class="weird-modal-box" id="weird-modal" style="position: fixed; z-index: 400; top: 0; width: 200px">
        <div class="weird-modal-header">头部</div>
        <div class="weird-modal-body"><input id="in-weird" /></div>
      </div>
    `);
    const pick = await page.evaluate(pickTopDialog, LAYERS);
    expect(pick?.tier).toBe("fuzzy");
    expect(pick?.z).toBe(400);
    const res = (await getActiveDialog(page))!;
    expect(await res.locator.getAttribute("id")).toBe("weird-modal");
  });

  it("无弹窗页面:并集快探零命中直接返回 null(零 evaluate 热路径)", async () => {
    await page.setContent(`<div><button id="plain">普通按钮</button></div>`);
    const pick = await page.evaluate(pickTopDialog, LAYERS);
    expect(pick).toBeNull();
    const res = (await getActiveDialog(page))!;
    expect(res).toBeNull(); // 调用方按 null 跳过,与旧「空 locator + count 0」等价
  });
});
