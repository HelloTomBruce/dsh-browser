# AGENTS.md

面向 AI 编码代理(及新成员)的本仓库工作约定。

## ⚠️ 强制约定:功能更新文档先行

**任何功能更新,必须先更新 DocMind （通过 mcp） 产品文档(项目名 `dsh-browser`,再动代码。**

- 变更类型 → 应更新的模块文档映射表、状态流转(in_progress → completed)
- 快速映射:新工具/参数 → 04 工具全景;定位引擎 → 03;UI 原语 → 11;快照 → 12;抽取 → 13;协作/面板 → 05/07;回归 → 06;安全 → 08;**新配置键 → 09(必同步)**;版本发布 → 10 + 根文档版本号;新限制/踩坑 → 15;新用法 → 14
- 版本号三处对齐:`package.json` / DocMind 根文档 / 10 版本演进

## 常用命令

```sh
pnpm install
pnpm verify          # typecheck + biome lint + vitest 全量 + tsdown 构建(提测前必须全绿)
npx vitest run test/<file>.test.ts   # 单跑某测试
# e2e(真实浏览器,自包含静态托管 playground,无需外部服务)
HEADLESS=true pnpm test:enterprise   # antd 企业场景 6 项
HEADLESS=true pnpm test:energy       # 能源总览 7 项
HEADLESS=true pnpm test:shadow       # Shadow DOM 穿透 6 项
HEADLESS=true pnpm test:pick         # 面板点选 4 项(生产面板 API + 真浏览器)
HEADLESS=true pnpm test:mcp          # MCP server 全链路 5 项(需先 pnpm build,驱动 lib/mcp.js 产物)
```

## 不可破坏的契约(改到这里先读对应测试)

| 契约                      | 把关测试                       | 说明                                                                                                                            |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 工具返回值过 outputSchema | `test/output-contract.test.ts` | 宿主严格校验,未声明字段会导致真实会话报错——**改返回值必须先扩 schema**                                                          |
| 工具数硬编码              | `test/toolset.test.ts`         | all=38 / core=25;增删工具、调整 core 集必须同步计数                                                                             |
| 配置键三处同步            | `test/config.test.ts`          | `src/lib/schema.ts`(SCHEMA + DEFAULT_CONFIG 单一来源,`src/index.ts` 与 `src/mcp.ts` 共用)、`src/browser/types.ts`、README 配置块、DocMind 09 |
| 页内注入单一来源          | —                              | `src/browser/walker.ts` 是页内逻辑唯一来源;语义扫描唯一实现在 `src/browser/session/semantic.ts`(find 与 what 共用),不得再造副本 |
| 执行器单一源              | —                              | `register.ts` 的 stepImpls 是 live/replay/batch/面板重跑共用实现;审批闸在包装层,不得绕过                                        |

## 架构速览

- `src/index.ts` 插件入口:双进程拆分(agent 进程注册工具 / web 宿主注册 `/browser/*` API),零 `@deepseek-ai` 运行时依赖;`src/mcp.ts` 独立 MCP 入口(stdio,bin `dsh-browser-mcp`),复用 registerTools 装配链,SDK 不得进 `lib/index.js` 加载链
- `src/browser/session/` 会话层:target(定位解析管线)、cache(ref/mark 注册表 + navSeq)、semantic(what 语义)、collaboration(审批/点选状态机)、recorder、screencast、tracer(时光机)
- `src/browser/tools/` + `definitions/` 工具实现与 JSON Schema;`primitives/` 企业控件适配原语(11 个);`policy/` 审批策略引擎;`stealth/` 拟人化输入
- `src/client/` React 面板(shell.overlay/settings.section 插槽,轮询消费 API)
- 依赖方向红线:session 层模块只 import 叶子(walker/primitives/tools-common),不得 import session facade 或 tools/inspection(防循环)

## 测试书写注意

- mock Page/Locator 用手写 stub(模式照抄 `test/target-resolver.test.ts`)
- `vi.mock` 提升后同文件只有一个 factory 生效——多用 `vi.hoisted` 共享状态(见 `test/effect-verify.test.ts`)
- 页内注入逻辑(walker/扫描/坐标探测)无法 node 单测,走 playground e2e;**测平台机制用裸静态页**(`playground/shadow-dom.html`,无框架噪音、不依赖构建新鲜度),测组件库适配才用 Vue 页面
- `evalTool` 多行脚本必须自带 `return`

## 禁止
- 没有用户明确要求，不得提交代码