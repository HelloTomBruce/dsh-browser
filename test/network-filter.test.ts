// browser_network 过滤语义测试:urlSubstr 大小写不敏感(camelCase 接口名防扑空)
// 与零命中 suggestions 相近 URL 候选(把"子串写错"与"接口没调"区分开)。
import { describe, it, expect, beforeEach } from "vitest";
import { networkTool } from "../src/browser/tools.js";
import { addNetworkEntry, clearNetwork, currentProfile } from "../src/browser/session.js";

function seed(url: string, method = "POST", status = 200) {
  addNetworkEntry(currentProfile, { url, method, resourceType: "xhr", status, ok: true, startedAt: Date.now() });
}

beforeEach(() => {
  clearNetwork(currentProfile);
});

describe("urlSubstr 大小写不敏感", () => {
  it("小写子串命中 camelCase 接口名", async () => {
    seed("https://api.example.com/energy/baseStationEffRule/saveOrUpdate");
    const r = (await networkTool({ action: "list", urlSubstr: "basestationeffrule" })) as any;
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].url).toContain("baseStationEffRule");
  });

  it("混合大小写子串同样命中", async () => {
    seed("https://api.example.com/baseStationEffRule");
    const r = (await networkTool({ action: "list", urlSubstr: "BaseStation" })) as any;
    expect(r.entries.length).toBe(1);
  });

  it("method/status 过滤语义不变", async () => {
    seed("https://api.example.com/a/saveOrUpdate", "POST", 200);
    seed("https://api.example.com/b/saveOrUpdate", "GET", 500);
    const r = (await networkTool({ action: "list", urlSubstr: "saveOrUpdate", method: "get" })) as any;
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].status).toBe(500);
    const r2 = (await networkTool({ action: "list", status: 200 })) as any;
    expect(r2.entries.every((e: any) => e.status === 200)).toBe(true);
  });
});

describe("零命中 suggestions 候选", () => {
  it("子串写错(baseline vs baseStationEffRule)→ 附相近 URL 候选", async () => {
    seed("https://api.example.com/energy/baseStationEffRule/saveOrUpdate");
    seed("https://api.example.com/energy/station/list");
    const r = (await networkTool({ action: "list", urlSubstr: "baseline" })) as any;
    expect(r.entries).toEqual([]);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions[0]).toContain("baseStationEffRule");
  });

  it("failed 动作零命中同样附候选", async () => {
    seed("https://api.example.com/energy/baseStationEffRule", "DELETE", 200); // 非失败记录,failed 视图为空
    const r = (await networkTool({ action: "failed", urlSubstr: "baseline" })) as any;
    expect(r.failed).toEqual([]);
    expect(r.suggestions[0]).toContain("baseStationEffRule");
  });

  it("有命中时不附 suggestions;无 urlSubstr 的零命中也不附", async () => {
    seed("https://api.example.com/baseStationEffRule");
    const hit = (await networkTool({ action: "list", urlSubstr: "baseStation" })) as any;
    expect(hit.suggestions).toBeUndefined();
    const noFilter = (await networkTool({ action: "list", urlSubstr: "zzzz" })) as any;
    expect(noFilter.entries).toEqual([]);
    expect(noFilter.suggestions).toBeUndefined();
  });

  it("完全无相近候选时不附 suggestions 字段", async () => {
    seed("https://cdn.example.com/logo.png".replace("logo.png", "static-assets"), "GET", 200);
    const r = (await networkTool({ action: "list", urlSubstr: "xyzq" })) as any;
    expect(r.entries).toEqual([]);
    if (r.suggestions !== undefined) expect(r.suggestions).toEqual([]);
  });
});
