// dsh-browser · 浏览器 — 类型定义
import type { Browser, BrowserContext, Frame, Locator, Page } from "playwright-core";

export interface BrowserConfig {
  enabled?: boolean;
  channel?: string;
  executablePath?: string;
  headless?: boolean;
  userDataDir?: string;
  profiles?: Record<string, Partial<BrowserConfig>>;
  screenshotDir?: string;
  downloadDir?: string;
  /** 截图/下载/上传的落盘基准目录(默认探测会话 cwd;显式指定后优先)。 */
  workspaceDir?: string;
  /** 截图保留天数(0 = 不按时间清理)。 */
  screenshotMaxAgeDays?: number;
  /** 截图保留数量上限(0 = 不按数量清理)。 */
  screenshotMaxCount?: number;
  /** 面板嵌入 + 实时画面 API 基路径。 */
  basePath?: string;
  /** 网络记录是否保存请求/响应体(默认 true,截断存储)。 */
  recordBodies?: boolean;
  maxTextChars?: number;
  maxLinks?: number;
  timeoutMs?: number;
  /** 视觉回归基线截图目录(默认 .dsh-browser/baselines,不受截图清理策略约束)。 */
  baselineDir?: string;
  /** 回放/批处理时的选择器自愈(默认 true;只作用于失败路径,live 工具不受影响)。 */
  selectorHealing?: boolean;
  /** 自愈时单次尝试的超时毫秒(默认 3000,避免等满全局超时)。 */
  healTimeoutMs?: number;
  /** ARIA 快照每次分配的最大 ref 数(默认 200)。 */
  maxRefs?: number;
  /** browser_extract 单次最多聚合的行数(默认 1000)。 */
  maxRows?: number;
  /**
   * 增量快照保留的历史版本数 K(默认 5,上限 20;内存上界 ≈100KB/page)。
   * since ∈ [latest-K+1, latest] 都能 diff,更旧版本回落全量标 stale。
   */
  snapshotHistory?: number;
  /**
   * 敏感操作审批模式:off(默认,行为与 v0.2 一致,工具仍可手动调用)|
   * manual(systemPrompt 指示 agent 在提交/删除/支付类动作前调用 browser_confirm)|
   * auto(硬约束:宿主层在 sensitiveTools 工具执行前强制解析目标元素并与
   * sensitivePatterns 匹配,命中即弹审批卡,拒绝/超时该步失败,agent 无法绕过)。
   */
  confirmMode?: "off" | "manual" | "auto";
  /** browser_confirm 等待人工决策的默认超时毫秒(默认 60000)。 */
  confirmTimeoutMs?: number;
  /**
   * auto 模式敏感文本模式:对目标元素的 role/name/text/id/testid/tag 做
   * 子串匹配(大小写不敏感),命中任一即拦。默认 提交/删除/支付。
   */
  sensitivePatterns?: string[];
  /**
   * auto 模式参与判定的工具(默认只拦 browser_click —— type 误报率高,
   * 需要拦输入类动作时显式加入)。
   */
  sensitiveTools?: string[];
  /** 多维环境与路径自适应策略规则链 (v0.6 Policy Engine) */
  confirmPolicies?: import("./policy/types.js").PolicyRule[];
  /** 拟人化操作引擎: auto(遇风控/登录页自动激活) | true(全局开启) | false(默认关闭) */
  humanize?: boolean | "auto";
  /** 拟人化操作速率: slow | normal (默认) | fast */
  humanizeSpeed?: "slow" | "normal" | "fast";
  /**
   * replay/batch 是否同样走 auto 审批闸(默认 true)。设为 false 表示回放
   * 不再弹审批 —— 数据驱动/定时回归的逃生口,风险自担(见 README)。
   */
  confirmInReplay?: boolean;
  /**
   * what 语义定位零命中时是否自动附 SoM 标徽截图(默认 true):多模态模型
   * 可看图后 browser_click { mark: N } 一次往返完成定位。仅失败路径触发。
   */
  somFallback?: boolean;
  /**
   * SPA ref 软失效重锚定(默认 true):主 frame 导航不清空 ref 表,推进
   * navSeq 代际;定位失败时全量重扫按 role+name 指纹重映射(路由切换场景
   * DOM 大部分未变,免整轮快照往返)。false 回退「导航即清空」旧行为。
   */
  refReanchor?: boolean;
  /**
   * 工具集:all(默认,全部工具)| core(只注册高频核心集,低频的
   * 录制/回放/报告/抽取/profile 等不注册,降 systemPrompt 常驻 token)。
   */
  toolset?: "core" | "all";
}

/** 一个命名 profile 的会话状态。 */
export interface ProfileState {
  browser: Browser | null;
  context: BrowserContext | null;
  persistent: boolean;
  pages: Map<number, Page>;
  activeId: number | null;
  counter: number;
  channel?: string;
}

/** 一次页面下载的记录。 */
export interface DownloadEntry {
  download: {
    saveAs(path: string): Promise<void>;
    suggestedFilename(): string;
    url(): string;
  };
  suggestedFilename: string;
  at: number;
}

/** 一次页面访问(导航)的记录,供实时画面模态框展示访问历史。 */
export interface NavEntry {
  url: string;
  title: string;
  ts: number;
}

/** 表单字段(selector 或 label 二选一)。 */
export interface FormField {
  selector?: string;
  label?: string;
  value?: string;
}

/** ARIA 快照分配的 ref 注册项(ref → 定位信息)。 */
export interface RefEntry {
  role: string;
  name: string;
  /** 生成快照时计算的稳定 CSS 路径(优先 #id / [data-testid] / nth-of-type 链)。 */
  selector: string;
  /** 元素所在 Frame 的全局索引(0 为主 Frame, >=1 为子 Frame)。 */
  frameIndex?: number;
  /** 元素所在 Frame 的当前 URL(用于导航防漂移二次校验)。 */
  frameUrl?: string;
  /** 快照时的视口内包围盒(仅视口内元素记录);ref 路径与 role 降级全部失灵时的坐标兜底。 */
  rect?: { x: number; y: number; w: number; h: number };
  /** 快照时的滚动偏移;坐标兜底按当前 scroll 修正视口位置。 */
  scroll?: { x: number; y: number };
  /** 注册时的导航代际;落后于 pageNavSeq = 疑似过期(SPA 路由),定位失败时按指纹重锚定。 */
  navSeq?: number;
}

/** SoM 标徽(browser_screenshot { som: true })的注册项(id → 定位信息)。 */
export interface MarkEntry {
  role: string;
  name: string;
  selector: string;
  /** 标徽快照时的视口内包围盒与滚动偏移(坐标兜底语义同 RefEntry)。 */
  rect?: { x: number; y: number; w: number; h: number };
  scroll?: { x: number; y: number };
}

/** 统一目标定位解析结果(无论在主 Frame 还是子 Frame 均可统一操作)。 */
export interface TargetResolution {
  /** 绑定的 Playwright Locator 实例。 */
  locator: Locator;
  /** 执行上下文容器(主页面 Page 或子 Frame)。 */
  container: Page | Frame;
  /** 原始 RefEntry 元数据(仅 ref 定位时有效)。 */
  entry?: RefEntry;
  /** 是否位于子 Frame 中。 */
  isIFrame: boolean;
  /** 匹配到的总元素数量 (用于排障诊断) */
  matchedCount?: number;
  /** 匹配到的可见元素数量 */
  visibleCount?: number;
}

/** 录制时采集的选择器指纹(回放自愈的降级候选来源)。 */
export interface SelectorHint {
  testid?: string;
  role?: string;
  name?: string;
  id?: string;
  text?: string;
  tag?: string;
}

/** 录制/回放的一步(formatVersion 2 起支持 meta.hint 选择器指纹)。 */
export interface ReplayStep {
  tool: string;
  args: any;
  meta?: { hint?: SelectorHint; source?: "human" };
}
