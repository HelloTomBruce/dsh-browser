// F3 增量快照历史版本(环形缓存)纯逻辑测试:
// pushSnapshotVersion 淘汰/版本单调、snapshotVersionEntry 窗口查询、
// 5+ 次快照后首版本仍可 diff、超窗回落 stale 语义、轮询抓取 token 降幅。
import { describe, it, expect } from "vitest";
import {
  pushSnapshotVersion, snapshotVersionEntry, snapshotCapacity,
  type SnapshotCache,
} from "../src/browser/session.js";
import { diffLines } from "../src/browser/tools.js";

function push(cache: SnapshotCache | undefined, text: string, k = 5) {
  return pushSnapshotVersion(cache, { text, aria: "" }, k);
}

describe("snapshotCapacity(容量钳制)", () => {
  it("默认 5;钳制到 [1,20];非法值回落 5", () => {
    expect(snapshotCapacity(undefined)).toBe(5);
    expect(snapshotCapacity(1)).toBe(1);
    expect(snapshotCapacity(20)).toBe(20);
    expect(snapshotCapacity(99)).toBe(20);
    expect(snapshotCapacity(0)).toBe(1);
    expect(snapshotCapacity(-3)).toBe(1);
    expect(snapshotCapacity("abc")).toBe(5);
    expect(snapshotCapacity(8)).toBe(8);
  });
});

describe("pushSnapshotVersion(环形追加)", () => {
  it("从 undefined 开始版本号从 1 起,历史按版本升序", () => {
    const c = push(push(undefined, "a"), "b");
    expect(c.version).toBe(2);
    expect(c.history.map((e) => [e.version, e.text])).toEqual([[1, "a"], [2, "b"]]);
  });

  it("超过 K 淘汰最旧版本,窗口始终 ≤ K;version 单调递增不回退", () => {
    let c: SnapshotCache | undefined;
    for (let i = 1; i <= 7; i++) c = push(c, `v${i}`);
    expect(c!.version).toBe(7);
    expect(c!.history.length).toBe(5);
    expect(c!.history.map((e) => e.version)).toEqual([3, 4, 5, 6, 7]);
    expect(c!.history.map((e) => e.text)).toEqual(["v3", "v4", "v5", "v6", "v7"]);
  });

  it("K=1 时只保留最新一版(窗口退化,行为仍确定)", () => {
    let c: SnapshotCache | undefined;
    for (let i = 1; i <= 3; i++) c = push(c, `v${i}`, 1);
    expect(c!.history.map((e) => e.version)).toEqual([3]);
  });
});

describe("snapshotVersionEntry(窗口查询)", () => {
  it("窗口内任意版本可查;窗口外/未知版本返回 undefined(→ 回落全量标 stale)", () => {
    let c: SnapshotCache | undefined;
    for (let i = 1; i <= 6; i++) c = push(c, `v${i}`); // K=5 → 保留 v2..v6
    expect(snapshotVersionEntry(c, 6)!.text).toBe("v6");
    expect(snapshotVersionEntry(c, 2)!.text).toBe("v2"); // 窗口下界
    expect(snapshotVersionEntry(c, 1)).toBeUndefined(); // 已淘汰 → stale
    expect(snapshotVersionEntry(c, 99)).toBeUndefined(); // 未来版本
    expect(snapshotVersionEntry(undefined, 1)).toBeUndefined(); // 无缓存
  });
});

describe("增量语义(验收场景)", () => {
  it("连续 5 次快照后 since=首版本仍能 diff(diffLines 掐前后缀语义不变)", () => {
    const pages = [
      "标题\n表头\n行1 A\n行2 B\n共 2 条",
      "标题\n表头\n行1 A\n行2 B\n行3 C\n共 3 条",
      "标题\n表头\n行1 A\n行2 B\n行3 C\n行4 D\n共 4 条",
      "标题\n表头\n行1 A2\n行2 B\n行3 C\n行4 D\n共 4 条",
      "标题\n表头\n行1 A2\n行2 B\n行3 C\n行4 D\n行5 E\n共 5 条",
    ];
    let c: SnapshotCache | undefined;
    for (const p of pages) c = push(c, p);
    expect(c!.version).toBe(5);
    const first = snapshotVersionEntry(c, 1)!;
    const latest = snapshotVersionEntry(c, 5)!;
    const d = diffLines(first.text, latest.text);
    expect(d.unchanged).toBe(false);
    expect(d.changedFrom).toBe(3);
    expect(d.lines).toEqual(["行1 A2", "行2 B", "行3 C", "行4 D", "行5 E", "共 5 条"]);
  });

  it("轮询抓取场景:增量重读相对全量重读 token 降幅 ≥60%(以字符数计)", () => {
    // 模拟:每 3 秒快照一次的轮询列表页(44 行),每次在页脚前追加 1 行新数据,
    // 既有行内容不变 —— 轮询抓取的典型形态(新数据入列,旧行稳定)。
    const head = ["标题", "筛选: 全部 | 未处理", "表头1 表头2 表头3"].join("\n");
    const row = (i: number) => `行${i + 1} 数据${i % 97} 状态${i % 3} 处理人${i % 7}`;
    const makePage = (rows: number) => [head, ...Array.from({ length: rows }, (_, i) => row(i)), `共 ${rows} 条`].join("\n");

    let c: SnapshotCache | undefined;
    let fullCost = 0; // 全量重读基线:每次都返回整页
    let incCost = 0; // 增量:首次全量,之后 only diff 行
    for (let n = 0; n < 20; n++) {
      const page = makePage(44 + n); // 每次多 1 行
      fullCost += page.length;
      const base = c === undefined ? undefined : c.history[c.history.length - 1];
      if (base === undefined) {
        incCost += page.length; // 首次全量
      } else {
        const d = diffLines(base.text, page);
        incCost += d.unchanged ? 0 : (d.lines ?? []).join("\n").length;
      }
      c = push(c, page);
    }
    const reduction = 1 - incCost / fullCost;
    expect(reduction).toBeGreaterThanOrEqual(0.6);
    // 环形窗口在 20 次快照后仍在(K=5),最新与窗口下界都可查
    expect(c!.version).toBe(20);
    expect(snapshotVersionEntry(c, 16)!.text.length).toBeGreaterThan(0);
  });
});
