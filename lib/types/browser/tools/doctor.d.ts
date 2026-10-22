import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
/** 一项诊断结果(ok=false 时附 advice 修复建议)。导出供测试。 */
export interface DoctorCheck {
    name: string;
    ok: boolean;
    detail: string;
    advice?: string;
}
export declare function setDoctorProbe(fn: ((basePath: string) => Promise<{
    ok: boolean;
    detail: string;
    advice?: string;
}>) | null): void;
/** 目录可写性检查(mkdir + 写探针文件 + 删除)。导出供测试。 */
export declare function checkWritableDir(dir: string): {
    ok: boolean;
    detail: string;
};
/** 可执行文件存在性检查(executablePath 显式配置用)。导出供测试。 */
export declare function checkExecutable(path: string): DoctorCheck;
/** 一次性健康诊断:不启动浏览器,只做静态/本地检查。 */
export declare function doctorTool(config: BrowserConfig, _args: Record<string, any>, exec?: ToolRunContext): Promise<{
    checks: DoctorCheck[];
    summary: {
        ok: boolean;
        passed: number;
        failed: number;
    };
}>;
//# sourceMappingURL=doctor.d.ts.map