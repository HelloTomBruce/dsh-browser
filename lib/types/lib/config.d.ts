export interface FieldSchema {
    type: "string" | "number" | "boolean" | "array" | "object" | "string[]" | "any";
    optional?: boolean;
    default?: unknown;
    enum?: string[];
    items?: FieldSchema;
    max?: number;
    min?: number;
}
export type ConfigSchema = Record<string, FieldSchema>;
declare const TYPES: string[];
/** 校验配置;返回错误列表(空 = 通过)。 */
export declare function validateConfig(schema: ConfigSchema, config: Record<string, any>): string[];
/** 合并默认值 + 校验;抛错时带模块名前缀。 */
export declare function resolveConfig(moduleName: string, schema: ConfigSchema, defaults: Record<string, any>, raw: Record<string, any> | undefined): Record<string, any>;
export { TYPES };
//# sourceMappingURL=config.d.ts.map