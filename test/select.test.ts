import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Page } from "playwright-core";
import { selectTool } from "../src/browser/tools/interaction.js";
import { getPage, closeBrowser } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = {
  headless: true,
  timeoutMs: 10_000,
};

describe("selectTool - 组件库下拉框兼容性", () => {
  let page: Page;

  beforeAll(async () => {
    page = await getPage(config);
  });

  afterAll(async () => {
    await closeBrowser();
  });

  it("支持原生 <select>", async () => {
    await page.setContent(`
      <select id="native-sel">
        <option value="1">苹果</option>
        <option value="2">香蕉</option>
      </select>
    `);
    const res = await selectTool(config, { selector: "#native-sel", option: "香蕉" });
    expect(res.selected).toBe("香蕉");
    const val = await page.$eval("#native-sel", (el: HTMLSelectElement) => el.value);
    expect(val).toBe("2");
  });

  it("支持 Ant Design 风格下拉(通过 inner input id 定位并展开选择)", async () => {
    await page.setContent(`
      <div class="ant-select" id="container">
        <div class="ant-select-selector" onclick="
          const dd = document.getElementById('rc_select_1_list');
          dd.classList.toggle('ant-select-dropdown-hidden');
          const expanded = !dd.classList.contains('ant-select-dropdown-hidden');
          document.getElementById('rc_select_1').setAttribute('aria-expanded', expanded);
        ">
          <input id="rc_select_1" role="combobox" aria-expanded="false" aria-controls="rc_select_1_list" readonly />
        </div>
      </div>
      <div id="rc_select_1_list" class="ant-select-dropdown ant-select-dropdown-hidden">
        <div role="listbox">
          <div role="option" id="rc_select_1_list_0" class="ant-select-item ant-select-item-option" onclick="window.__chosen = 'LTE'">LTE</div>
          <div role="option" id="rc_select_1_list_1" class="ant-select-item ant-select-item-option" onclick="window.__chosen = 'NR'">NR</div>
        </div>
      </div>
    `);

    const res = await selectTool(config, { selector: "#rc_select_1", option: "LTE" });
    expect(res.selected).toBe("LTE");
    const chosen = await page.evaluate(() => (window as any).__chosen);
    expect(chosen).toBe("LTE");
  });

  it("已处于展开状态的下拉框(aria-expanded=true),不会被重复点击误收起", async () => {
    await page.setContent(`
      <div class="ant-select ant-select-open">
        <div class="ant-select-selector" onclick="window.__toggled = (window.__toggled || 0) + 1">
          <input id="rc_select_2" role="combobox" aria-expanded="true" aria-controls="rc_select_2_list" />
        </div>
      </div>
      <div id="rc_select_2_list" class="ant-select-dropdown">
        <div role="listbox">
          <div role="option" id="rc_select_2_list_0" onclick="window.__chosen = '5G'">5G</div>
        </div>
      </div>
    `);

    const res = await selectTool(config, { selector: "#rc_select_2", option: "5G" });
    expect(res.selected).toBe("5G");
    // 展开状态下不应再次点击触发框触发 toggle
    const toggled = await page.evaluate(() => (window as any).__toggled);
    expect(toggled).toBeUndefined();
    const chosen = await page.evaluate(() => (window as any).__chosen);
    expect(chosen).toBe("5G");
  });

  it("选项存在 CSS 遮挡或虚拟滚动特殊状态时,能通过降级策略成功触发点击", async () => {
    await page.setContent(`
      <div class="ant-select ant-select-open">
        <div class="ant-select-selector">
          <input id="rc_select_3" role="combobox" aria-expanded="true" aria-controls="rc_select_3_list" />
        </div>
      </div>
      <div id="rc_select_3_list" class="ant-select-dropdown" style="position: relative;">
        <!-- 覆盖层制造 actionability 遮挡判定 -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></div>
        <div role="listbox">
          <div role="option" id="rc_select_3_list_0" onclick="window.__chosen = 'Special'">Special</div>
        </div>
      </div>
    `);

    const res = await selectTool(config, { selector: "#rc_select_3", option: "Special" });
    expect(res.selected).toBe("Special");
    const chosen = await page.evaluate(() => (window as any).__chosen);
    expect(chosen).toBe("Special");
  });

  it("当页面存在上一个遗留展开的下拉框时，能精准定位目标 selector 的下拉，避免误中旧浮层", async () => {
    // 模拟场景：上一个下拉（区县）还开着，正在尝试选择下一个下拉（节能类型）
    await page.setContent(`
      <!-- 第一个下拉（残留展开）: 区县 -->
      <div class="ant-select ant-select-open" id="form_item_district">
        <div class="ant-select-selector">
          <input id="district_input" role="combobox" aria-expanded="true" aria-controls="district_list" />
        </div>
      </div>
      <div id="district_list" class="ant-select-dropdown">
        <div role="listbox">
          <div role="option" class="ant-select-item-option" onclick="window.__chosen = '西湖区'">西湖区</div>
          <div role="option" class="ant-select-item-option" onclick="window.__chosen = '拱墅区'">拱墅区</div>
        </div>
      </div>

      <!-- 第二个下拉: 节能类型 -->
      <div class="ant-select" id="form_item_energyType">
        <div class="ant-select-selector" onclick="
          const dd = document.getElementById('energy_list');
          dd.classList.remove('ant-select-dropdown-hidden');
          document.getElementById('energy_input').setAttribute('aria-expanded', 'true');
        ">
          <input id="energy_input" role="combobox" aria-expanded="false" aria-controls="energy_list" />
        </div>
      </div>
      <div id="energy_list" class="ant-select-dropdown ant-select-dropdown-hidden">
        <div role="listbox">
          <div role="option" class="ant-select-item-option" onclick="window.__chosen = 'XSDU'">XSDU</div>
          <div role="option" class="ant-select-item-option" onclick="window.__chosen = 'AUTO'">AUTO</div>
        </div>
      </div>
    `);

    // 对第二个下拉选择 XSDU
    const res = await selectTool(config, { selector: "#form_item_energyType", option: "XSDU" });
    expect(res.selected).toBe("XSDU");
    const chosen = await page.evaluate(() => (window as any).__chosen);
    expect(chosen).toBe("XSDU");
  });
});
