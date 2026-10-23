import { describe, expect, it } from "vitest";
import { evaluatePolicy, matchPolicyRule, sensitiveHits } from "../src/browser/policy/engine.js";
import type { PolicyRule } from "../src/browser/policy/types.js";
import type { BrowserConfig } from "../src/browser/types.js";

describe("PolicyEngine 策略规则链判定", () => {
  const policies: PolicyRule[] = [
    {
      name: "开发与测试环境白名单",
      urlPattern: ".*(localhost|127\\.0\\.0\\.1|\\.test\\.|\\.qa\\.).*",
      level: "off",
    },
    {
      name: "生产集群高危保护",
      urlPattern: ".*\\.prod\\.company\\.com.*",
      patterns: ["提交", "删除", "发布", "扩缩容", "支付", "转账"],
      level: "auto",
      timeoutMs: 90000,
    },
    {
      name: "敏感 API 穿透拦截",
      actionPattern: "browser_click",
      selectorPattern: "#danger-action.*",
      level: "auto",
      timeoutMs: 45000,
    },
  ];

  const config: BrowserConfig = {
    confirmMode: "auto",
    confirmPolicies: policies,
  };

  it("规则 1: 本地开发或 QA 环境一律静默通过 (即使包含危险关键词)", () => {
    const decision = evaluatePolicy(config, {
      url: "http://localhost:3000/admin/users",
      tool: "browser_click",
      selector: "#delete-btn",
      desc: { name: "删除所有用户", role: "button" },
    });
    expect(decision.level).toBe("off");
    expect(decision.matchedRule?.name).toBe("开发与测试环境白名单");
  });

  it("规则 1: .qa. 域名静默通过", () => {
    const decision = evaluatePolicy(config, {
      url: "https://order.qa.internal/orders",
      tool: "browser_click",
      selector: "#pay-btn",
      desc: { name: "确认支付", role: "button" },
    });
    expect(decision.level).toBe("off");
  });

  it("规则 2: 生产环境核心危险动作命中拦截，并带自定义超时时间", () => {
    const decision = evaluatePolicy(config, {
      url: "https://billing.prod.company.com/pay",
      tool: "browser_click",
      selector: "#submit-btn",
      desc: { name: "确认转账 10000 元", text: "立即转账" },
    });
    expect(decision.level).toBe("auto");
    expect(decision.timeoutMs).toBe(90000);
    expect(decision.matchedRule?.name).toBe("生产集群高危保护");
    expect(decision.reason).toContain("转账");
  });

  it("规则 2: 生产环境非危险动作放行", () => {
    const decision = evaluatePolicy(config, {
      url: "https://billing.prod.company.com/view",
      tool: "browser_click",
      selector: "#next-page",
      desc: { name: "下一页", text: "下一页" },
    });
    // 不匹配生产保护的 patterns，跳到规则 3（selector 不匹配），最终未命中放行
    expect(decision.level).toBe("off");
  });

  it("规则 3: 任意环境命中危险 selectorPattern 均拦截", () => {
    const decision = evaluatePolicy(config, {
      url: "https://dashboard.some-cloud.io/control",
      tool: "browser_click",
      selector: "#danger-action-reset",
      desc: { name: "重置集群" },
    });
    expect(decision.level).toBe("auto");
    expect(decision.timeoutMs).toBe(45000);
    expect(decision.matchedRule?.name).toBe("敏感 API 穿透拦截");
  });

  it("未配置 confirmPolicies 时平滑回退到传统 confirmMode: auto", () => {
    const legacyConfig: BrowserConfig = {
      confirmMode: "auto",
      sensitivePatterns: ["删除"],
      sensitiveTools: ["browser_click"],
    };
    const hitDecision = evaluatePolicy(legacyConfig, {
      url: "https://any.site/users",
      tool: "browser_click",
      selector: ".del-btn",
      desc: { text: "删除记录" },
    });
    expect(hitDecision.level).toBe("auto");
    expect(hitDecision.reason).toContain("[删除]");

    const passDecision = evaluatePolicy(legacyConfig, {
      url: "https://any.site/users",
      tool: "browser_click",
      selector: ".view-btn",
      desc: { text: "查看详情" },
    });
    expect(passDecision.level).toBe("off");
  });
});
