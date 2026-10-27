// dsh-browser · 浏览器工具 — 通用工具函数与算法
import { isAbsolute, resolve } from "node:path";

/** 组件库下拉框的可见选项选择器并集 (基于通用 WAI-ARIA 与主流组件库规范)。 */
export const DROPDOWN_OPTION_SELECTOR = [
  "[role='option']",
  "[role='menuitem']",
  "[class*='select'][class*='dropdown'] [class*='option']",
  "[class*='select'][class*='dropdown'] [class*='item']",
  "[role='listbox'] [role='option']",
].join(", ");

/** 读取 PNG 文件头(IHDR)中的宽高,不解码像素(导出供测试)。 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 按缩放比例换算 mask 矩形(导出供测试;与页内比对共用同一套坐标语义)。 */
export function scaleRects(
  rects: { x: number; y: number; width: number; height: number }[],
  scale: number,
): { x: number; y: number; width: number; height: number }[] {
  return rects.map((r) => ({
    x: Math.round(r.x * scale),
    y: Math.round(r.y * scale),
    width: Math.round(r.width * scale),
    height: Math.round(r.height * scale),
  }));
}

/**
 * 快照文本压缩(导出供测试):
 *   - 去掉首尾空白行;
 *   - 连续空白行折叠为 1 行;
 *   - 连续重复的非空行(表格空单元格/占位行产生的噪音)折叠为「首行 + …(重复 N 行)」。
 * 只折叠完全相同的相邻行,不重排、不删改非重复内容。
 */
export function compressText(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      blankRun++;
      if (blankRun === 1 && out.length > 0) out.push("");
      continue;
    }
    blankRun = 0;
    // 统计当前行与后续相同行的重复次数
    let dup = 0;
    while (i + dup + 1 < lines.length && lines[i + dup + 1].trim() === trimmed) dup++;
    out.push(lines[i]);
    if (dup > 0) {
      out.push(`…(重复 ${dup} 行)`);
      i += dup;
    }
  }
  // 去掉尾部空白行
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** 最长公共子串长度(小写比较;零依赖,导出供测试)。 */
export function lcsScore(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === "" || y === "") return 0;
  let best = 0;
  const prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

/** 零命中时按相似度挑 top5 候选(导出供测试)。 */
export function topSuggestions(
  query: string,
  candidates: { role: string; name: string }[],
  count = 5,
): { role: string; name: string; score: number }[] {
  // 阈值:短 query(≤3 字符)要求公共子串 ≥1,长 query 要求 ≥2 —— 宁可多给候选
  // 供 agent 二次定位,也不空手而归;完全无公共子串的一律不给(噪音)。
  const min = query.trim().length <= 3 ? 1 : 2;
  return candidates
    .map((c) => ({ ...c, score: lcsScore(query, c.name) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ role, name, score }) => ({ role, name, score }));
}

/**
 * 行级 diff:掐掉公共前缀/后缀,返回变化区。导出供测试。
 * 全等返回 { unchanged: true };否则 changedFrom 为新文本中变化区首行(1 起)。
 */
export function diffLines(oldText: string, newText: string): {
  unchanged: boolean;
  changedFrom?: number;
  lines?: string[];
  removed?: number;
} {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return { unchanged: true };
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1;
  return {
    unchanged: false,
    changedFrom: i + 1,
    lines: b.slice(i, b.length - j),
    removed: a.length - i - j,
  };
}

/** 给本身无超时的 Playwright 调用(evaluate/allTextContents)加有界保护,防页面主线程忙时无限挂起。 */
export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} 超时(${ms}ms;页面主线程可能正忙)`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 防御性解码 eval 脚本:模型/人工偶发把脚本 JSON.stringify 一次再传
 * (脚本以 \" 开头、换行变字面 \\n),回放/录制链路不纠错会导致语法错误。
 * 识别条件:字符串以引号包裹且含反斜杠转义,且 JSON.parse 结果仍是字符串。
 * 无法解析或语义不变场景原样返回(裸字符串字面量如 "hello" 不含转义,不受影响)。
 */
export function unwrapDoubleEncodedScript(script: string): { script: string; unwrapped: boolean } {
  if (script.length >= 2 && script.startsWith('"') && script.endsWith('"') && script.includes("\\")) {
    try {
      const parsed = JSON.parse(script);
      if (typeof parsed === "string" && parsed !== script) return { script: parsed, unwrapped: true };
    } catch {
      /* 不是合法 JSON 字符串字面量,原样使用 */
    }
  }
  return { script, unwrapped: false };
}

/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
export function workspaceFilePath(cwd: string, file: string): string {
  const p = isAbsolute(file) ? resolve(file) : resolve(cwd, file);
  const root = resolve(cwd);
  if (p !== root && !p.startsWith(root + "/") && !p.startsWith(root + "\\")) {
    throw new Error(`文件路径越出工作区: ${file}`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// eval 执行包装(Node 侧语法预检三态)
//
// 背景(修复前两大高频用户反馈):
//   旧实现用 /[\n;]/ 启发式判定包装形态——脚本只要含换行或分号就被包成无 return
//   的 async IIFE,跨行对象字面量/箭头 IIFE 求值成 undefined → 静默返回 null;
//   单行 `await ...` 走 `(${script})` 表达式通道,page.evaluate 在非 async 函数体里
//   求值,`await` 被当普通标识符直接 SyntaxError。表象"无规律可循",每轮都要试错。
//
// 新策略(发页前 Node 侧用 AsyncFunction 编译校验,只编译不执行,零试错):
//   ① 能解析为表达式(含多行对象字面量/箭头 IIFE/顶层 await)→ (async()=>(script))()
//     直取值;
//   ② 语句且无顶层 return → 自动补 return 最后一个顶层表达式(控制台语义)。仅在
//     最后一个「顶层显式 ;」边界切分(显式 ; 必为语句终结符,不改语义;ASI 换行
//     边界一律不碰),拼装后整体再过编译校验,不合法立即回退 ③——任何词法扫描
//     误差都退化为旧行为,永不产生语义错误的混合体;
//   ③ 语句(显式 return 或纯副作用)→ 原样 async IIFE。
// ---------------------------------------------------------------------------

export type EvalWrapMode = "expression" | "statements-auto-return" | "statements";

export interface EvalWrapResult {
  code: string;
  mode: EvalWrapMode;
}

const AsyncFunctionConstructor: new (body: string) => Function = Object.getPrototypeOf(
  async function () {},
).constructor as new (body: string) => Function;

/** 编译校验(只编译不执行):语法合法返回 true。 */
function compiles(body: string): boolean {
  try {
    new AsyncFunctionConstructor(body);
    return true;
  } catch {
    return false;
  }
}

/** `/` 出现在这些字符(或关键字)之后按正则字面量处理,否则按除号。 */
const REGEX_ALLOWED_AFTER_CHARS = new Set("([{,;=:?&|!%^~*+<>-/");
const REGEX_ALLOWED_AFTER_WORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do",
  "else", "yield", "await",
]);

/**
 * 词法扫描(为 ② 服务,fail-safe):定位最后一个「顶层显式 ;」的结束位置,
 * 并检测顶层 return 关键字(有则说明调用方自己管理返回,不自动改写)。
 * 顶层 = 不在字符串/模板/注释/正则内,且 ()[]{} 合并深度为 0(含模板 ${} 插值内)。
 */
function scanTopLevel(script: string): { lastSemicolonEnd: number | null; topLevelReturn: boolean } {
  let lastSemicolonEnd: number | null = null;
  let topLevelReturn = false;
  type State = "code" | "sq" | "dq" | "tpl" | "line" | "block" | "regex" | "regexClass";
  let state: State = "code";
  let depth = 0; // () [] {} 合并深度
  const tplDepths: number[] = []; // 进入模板 ${} 插值时记录的 depth,配对 } 出栈
  let prevSig = ""; // 上一个有效字符(词法级;注释/空白不更新)
  let prevWord = ""; // 上一个完整标识符/关键字
  const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    switch (state) {
      case "line":
        if (ch === "\n") state = "code";
        continue;
      case "block":
        if (ch === "*" && script[i + 1] === "/") {
          state = "code";
          i++;
        }
        continue;
      case "sq":
      case "dq":
        if (ch === "\\") i++;
        else if ((state === "sq" && ch === "'") || (state === "dq" && ch === '"')) state = "code";
        continue;
      case "tpl":
        if (ch === "\\") i++;
        else if (ch === "`") {
          state = "code";
          prevSig = "`";
          prevWord = "";
        } else if (ch === "$" && script[i + 1] === "{") {
          tplDepths.push(depth);
          state = "code";
          i++;
        }
        continue;
      case "regex":
        if (ch === "\\") i++;
        else if (ch === "[") state = "regexClass";
        else if (ch === "/") {
          state = "code";
          prevSig = "/"; // 正则结束后跟 flags/运算符;`/` 也在 regex-allowed 集内(`a / /re/` 合法)
          prevWord = "";
        }
        continue;
      case "regexClass":
        if (ch === "\\") i++;
        else if (ch === "]") state = "regex";
        continue;
      case "code":
      default: {
        if (ch === "/" && script[i + 1] === "/") {
          state = "line";
          i++;
          continue;
        }
        if (ch === "/" && script[i + 1] === "*") {
          state = "block";
          i++;
          continue;
        }
        if (ch === "/") {
          const regexAllowed =
            prevSig === "" ||
            REGEX_ALLOWED_AFTER_CHARS.has(prevSig) ||
            REGEX_ALLOWED_AFTER_WORDS.has(prevWord);
          if (regexAllowed) {
            state = "regex";
          } else {
            prevSig = "/";
            prevWord = "";
          }
          continue;
        }
        if (ch === "'" || ch === '"') {
          state = ch === "'" ? "sq" : "dq";
          prevSig = ch;
          prevWord = "";
          continue;
        }
        if (ch === "`") {
          state = "tpl";
          prevSig = ch;
          prevWord = "";
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") {
          depth++;
          prevSig = ch;
          prevWord = "";
          continue;
        }
        if (ch === ")" || ch === "]") {
          depth = Math.max(0, depth - 1);
          prevSig = ch;
          prevWord = "";
          continue;
        }
        if (ch === "}") {
          if (tplDepths.length > 0 && depth === tplDepths[tplDepths.length - 1]) {
            tplDepths.pop();
            state = "tpl";
          } else {
            depth = Math.max(0, depth - 1);
          }
          prevSig = ch;
          prevWord = "";
          continue;
        }
        if (ch === ";") {
          if (depth === 0 && tplDepths.length === 0) lastSemicolonEnd = i + 1;
          prevSig = ch;
          prevWord = "";
          continue;
        }
        if (isWordChar(ch)) {
          let j = i;
          while (j < script.length && isWordChar(script[j])) j++;
          const word = script.slice(i, j);
          if (
            depth === 0 &&
            tplDepths.length === 0 &&
            word === "return" &&
            prevSig !== "." &&
            !isWordChar(prevSig)
          ) {
            topLevelReturn = true;
          }
          prevWord = word;
          prevSig = script[j - 1];
          i = j - 1;
          continue;
        }
        if (!/\s/.test(ch)) {
          prevSig = ch;
          prevWord = "";
        }
        continue;
      }
    }
  }
  return { lastSemicolonEnd, topLevelReturn };
}

/**
 * 把 eval 脚本包装成可直接交给 page.evaluate 的代码串,并标明实际执行形态。
 * 语法非法时在 Node 侧抛出引擎原始错误(消息与页内 V8 同源,提前暴露)。
 */
export function buildEvalScript(script: string): EvalWrapResult {
  // ① 表达式优先:多行对象字面量/箭头 IIFE/顶层 await 全在此通道直取值。
  //    括号内侧垫换行,尾部行注释不会吞掉闭合括号。
  if (compiles(`return (\n${script}\n)`)) {
    return { code: `(async () => (\n${script}\n))()`, mode: "expression" };
  }
  // ② 语句体:语法必须合法,否则把引擎错误原样抛给调用方。
  try {
    new AsyncFunctionConstructor(script);
  } catch (err) {
    throw new Error(`eval 脚本语法错误: ${(err as Error).message}`);
  }
  const { lastSemicolonEnd, topLevelReturn } = scanTopLevel(script);
  if (!topLevelReturn && lastSemicolonEnd !== null) {
    const head = script.slice(0, lastSemicolonEnd);
    const tail = script.slice(lastSemicolonEnd);
    if (tail.trim() !== "") {
      const candidate = `${head}\nreturn (\n${tail}\n);`;
      // 拼装后整体再校验:扫描误判在此兜底,退化回 ③,永不产生语义错误的混合体。
      if (compiles(candidate)) {
        return { code: `(async () => {\n${candidate}\n})()`, mode: "statements-auto-return" };
      }
    }
  }
  return { code: `(async () => {\n${script}\n})()`, mode: "statements" };
}

/**
 * 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
 * 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
 */
// ---------------------------------------------------------------------------
// F4 extract 字段建议(action: "suggest"):从命中容器首条记录(表格首行/卡片)
// 自动推断字段结构,返回可直接交给抽取模式的 fields + 样本数据;
// 推断不出规律结构时返回原因与容器概览,不猜。
// ---------------------------------------------------------------------------
