// eval 执行包装三态测试:表达式通道(多行对象/顶层 await)、语句自动 return、
// 词法扫描 fail-safe。buildEvalScript 是纯函数(只编译不执行),产出的包装串可在
// Node 内直接求值验证真实语义,无需真实浏览器;evalTool 集成走手写 page stub
// (模式照抄 test/effect-verify.test.ts)。
import { describe, expect, it, vi } from "vitest";
import { buildEvalScript, type EvalWrapMode } from "../src/browser/tools/common.js";

/** 用包装串实际求值,验证三态包装的真实语义(间接 eval,全局作用域)。 */
async function runWrap(script: string): Promise<unknown> {
  const { code } = buildEvalScript(script);
  return await (0, eval)(code);
}

function modeOf(script: string): EvalWrapMode {
  return buildEvalScript(script).mode;
}

// ---------------------------------------------------------------------------
// ① 表达式通道(回归:多行对象字面量/箭头 IIFE 曾静默返回 null)
// ---------------------------------------------------------------------------
describe("buildEvalScript · 表达式通道", () => {
  it("单行字符串拼接走表达式通道", async () => {
    expect(modeOf("'answer=' + 42")).toBe("expression");
    expect(await runWrap("'answer=' + 42")).toBe("answer=42");
  });

  it("多行对象字面量直接返回对象(用户反馈最高频场景)", async () => {
    const script = "({\n  answer: 42,\n  nested: { list: [1, 2] }\n})";
    expect(modeOf(script)).toBe("expression");
    expect(await runWrap(script)).toEqual({ answer: 42, nested: { list: [1, 2] } });
  });

  it("多行箭头 IIFE 返回对象(用户原案例)", async () => {
    const script = "(() => ({\n  code: 0,\n  data: { items: [] }\n}))()";
    expect(modeOf(script)).toBe("expression");
    expect(await runWrap(script)).toEqual({ code: 0, data: { items: [] } });
  });

  it("多行数组字面量", async () => {
    const script = "[\n  'a',\n  'b'\n].join('-')";
    expect(modeOf(script)).toBe("expression");
    expect(await runWrap(script)).toBe("a-b");
  });

  it("尾部行注释不破坏括号闭合(括号内侧垫换行)", async () => {
    const script = "42 // the answer";
    expect(modeOf(script)).toBe("expression");
    expect(await runWrap(script)).toBe(42);
  });

  it("裸对象字面量(无括号包裹)也按表达式直取值", async () => {
    const script = "{\n  a: 1\n}";
    expect(modeOf(script)).toBe("expression");
    expect(await runWrap(script)).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// ① 顶层 await(回归:单行 await 曾报 Unexpected identifier)
// ---------------------------------------------------------------------------
describe("buildEvalScript · 顶层 await", () => {
  it("await Promise 直接取值", async () => {
    const script = "await Promise.resolve({ ok: true })";
    expect(modeOf(script)).toBe("expression");
    expect(await runWrap(script)).toEqual({ ok: true });
  });

  it("await 后链式取属性", async () => {
    const script = "(await (async () => 'bridge-ready')()).toUpperCase()";
    expect(await runWrap(script)).toBe("BRIDGE-READY");
  });

  it("语句体里的 await 同样可用(自动 return 通道)", async () => {
    const script = "const m = await (async () => ({ code: 0 }))(); m.code";
    expect(modeOf(script)).toBe("statements-auto-return");
    expect(await runWrap(script)).toBe(0);
  });

  it("语句体 + 显式 return + await(异步 IIFE 通道)", async () => {
    const script = "const m = await (async () => 21)();\nreturn m * 2";
    expect(modeOf(script)).toBe("statements");
    expect(await runWrap(script)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// ② 语句自动 return(控制台语义)与保守回退
// ---------------------------------------------------------------------------
describe("buildEvalScript · 语句自动 return", () => {
  it("最后一个顶层表达式自动回值", async () => {
    expect(await runWrap("const a = 40; a + 2")).toBe(42);
  });

  it("切分只发生在最后一个顶层显式分号,前段语句全部保留", async () => {
    const script = "const a = 1; const b = 2; a + b";
    expect(modeOf(script)).toBe("statements-auto-return");
    expect(await runWrap(script)).toBe(3);
  });

  it("无顶层分号的 ASI 脚本保守回退 statements(不猜换行边界)", async () => {
    const script = "const a = 1\na + 1";
    expect(modeOf(script)).toBe("statements");
    expect(await runWrap(script)).toBeUndefined();
  });

  it("显式顶层 return 时绝不自动改写", async () => {
    const script = "const a = 1; return a * 2";
    expect(modeOf(script)).toBe("statements");
    expect(await runWrap(script)).toBe(2);
  });

  it("尾部纯分号(副作用脚本)回退 statements", async () => {
    const script = "var held = 1; held = 2;";
    expect(modeOf(script)).toBe("statements");
    expect(await runWrap(script)).toBeUndefined();
  });

  it("尾语句是声明(非表达式)时回退 statements", () => {
    expect(modeOf("let a = 1; let b = 2")).toBe("statements");
  });

  it("对象键名 return 不误判为顶层 return", async () => {
    const script = "const o = { return: 1 }; o.return";
    expect(modeOf(script)).toBe("statements-auto-return");
    expect(await runWrap(script)).toBe(1);
  });

  it("属性访问 obj.return 不误判为顶层 return", async () => {
    const script = "const obj = {}; obj.return = 7; obj.return";
    expect(await runWrap(script)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 词法扫描:字符串/模板/正则/注释里的分号与 return 不干扰切分
// ---------------------------------------------------------------------------
describe("buildEvalScript · 词法扫描", () => {
  it("字符串字面量里的分号与 return 不干扰", async () => {
    expect(await runWrap('const s = "a;return b"; s.length')).toBe(10);
  });

  it("正则字面量里的分号不干扰", async () => {
    expect(await runWrap("const re = /;/; 'a;b'.split(re)")).toEqual(["a", "b"]);
  });

  it("除号与正则并存不误扫", async () => {
    expect(await runWrap("const half = 10 / 2; half + 1")).toBe(6);
  });

  it("模板字符串里的分号不干扰", async () => {
    expect(await runWrap("const t = `a;b`; t.length")).toBe(3);
  });

  it("模板插值内箭头体的分号不干扰且值正确", async () => {
    const script = "const t = `${(() => { const x = ';'; return x })()}`; t";
    expect(modeOf(script)).toBe("statements-auto-return");
    expect(await runWrap(script)).toBe(";");
  });

  it("行注释/块注释里的分号与 return 不干扰", async () => {
    expect(await runWrap("const a = 1; /* ; return 9 */ a + 1 // ; return 8")).toBe(2);
  });

  it("if 块内的分号不算顶层(切分候选不合法时 fail-safe 回退)", async () => {
    const script = "let x = 0; if (true) { x = 1; }";
    expect(modeOf(script)).toBe("statements");
    expect(await runWrap(script)).toBeUndefined();
  });

  it("for 头部的分号不算顶层", () => {
    const script = "let s = 0; for (const v of [1, 2]) { s += v }";
    expect(modeOf(script)).toBe("statements");
  });
});

// ---------------------------------------------------------------------------
// 语法错误与通道确定性
// ---------------------------------------------------------------------------
describe("buildEvalScript · 语法错误与确定性", () => {
  it("非法脚本抛出带引擎消息的错误(Node 侧预检提前暴露)", () => {
    expect(() => buildEvalScript("const =")).toThrow(/eval 脚本语法错误/);
  });

  it("同样逻辑:对象形式与字符串形式都一轮成功(原痛点复现对照)", async () => {
    const objForm = await runWrap("(() => ({\n  code: 0\n}))()");
    const strForm = await runWrap("'code=' + 0");
    expect(objForm).toEqual({ code: 0 });
    expect(strForm).toBe("code=0");
  });
});

// ---------------------------------------------------------------------------
// evalTool 集成:包装串交给 page.evaluate,结果净化与 mode/scriptUnwrapped 透出
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => {
  const fn = (impl?: (...a: any[]) => any) => {
    let current = impl;
    const f: any = (...args: any[]) => current?.(...args);
    f.mockImplementation = (i: any) => {
      current = i;
      return f;
    };
    return f;
  };
  return {
    getPage: fn(),
    capturedCode: "" as string,
  };
});

vi.mock("../src/browser/session.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, ...mockState };
});

describe("evalTool 集成(page stub)", () => {
  it("三态包装串交给 page.evaluate 并透出 mode", async () => {
    const { evalTool } = await import("../src/browser/tools/interaction.js");
    mockState.getPage.mockImplementation(async () => ({
      evaluate: async (code: string) => {
        mockState.capturedCode = code;
        return { answer: 42 };
      },
    }));
    const out = await evalTool({} as any, { script: "(() => ({ answer: 42 }))()" });
    expect(out.mode).toBe("expression");
    expect(out.result).toEqual({ answer: 42 });
    expect(mockState.capturedCode).toContain("async");
  });

  it("undefined 结果净化为 null,statements 模式如实标注", async () => {
    const { evalTool } = await import("../src/browser/tools/interaction.js");
    mockState.getPage.mockImplementation(async () => ({
      evaluate: async (_code: string) => undefined,
    }));
    const out = await evalTool({} as any, { script: "var held = 1; held = 2;" });
    expect(out.mode).toBe("statements");
    expect(out.result).toBeNull();
  });

  it("双重编码脚本自动解包并标注 scriptUnwrapped", async () => {
    const { evalTool } = await import("../src/browser/tools/interaction.js");
    mockState.getPage.mockImplementation(async () => ({
      evaluate: async (code: string) => {
        mockState.capturedCode = code;
        return 2;
      },
    }));
    const doubleEncoded = JSON.stringify("const a = 1;\na + 1");
    const out = await evalTool({} as any, { script: doubleEncoded });
    expect(out.scriptUnwrapped).toBe(true);
    expect(out.mode).toBe("statements-auto-return");
    expect(mockState.capturedCode).toContain("const a = 1;");
  });
});
