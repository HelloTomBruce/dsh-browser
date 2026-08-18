// 配置校验器:轻量 schema 校验(运行时零依赖)。
// 模块在 apply 前校验并给出中文错误信息。
const TYPES = ["string", "number", "boolean", "array", "object", "string[]", "any"];
function typeOf(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function checkField(key, value, schema, errors) {
    if (value === undefined || value === null) {
        if (!schema.optional)
            errors.push(`config.${key}: 必填但缺失`);
        return;
    }
    const t = typeOf(value);
    if (schema.type === "any")
        return;
    if (schema.type === "string[]") {
        if (t !== "array" || !value.every((v) => typeof v === "string")) {
            errors.push(`config.${key}: 期望 string[] 实际 ${t}`);
        }
        return;
    }
    if (t !== schema.type) {
        errors.push(`config.${key}: 期望 ${schema.type} 实际 ${t}`);
        return;
    }
    if (schema.type === "number") {
        const n = value;
        if (schema.max !== undefined && n > schema.max)
            errors.push(`config.${key}: 超过上限 ${schema.max}`);
        if (schema.min !== undefined && n < schema.min)
            errors.push(`config.${key}: 低于下限 ${schema.min}`);
    }
    if (schema.type === "string" && schema.enum !== undefined && !schema.enum.includes(value)) {
        errors.push(`config.${key}: 必须是 ${schema.enum.join(" / ")} 之一`);
    }
}
/** 校验配置;返回错误列表(空 = 通过)。 */
export function validateConfig(schema, config) {
    const errors = [];
    for (const [key, field] of Object.entries(schema)) {
        checkField(key, config[key], field, errors);
    }
    return errors;
}
/** 合并默认值 + 校验;抛错时带模块名前缀。 */
export function resolveConfig(moduleName, schema, defaults, raw) {
    const config = { ...defaults, ...(raw ?? {}) };
    for (const [key, field] of Object.entries(schema)) {
        if (field.default !== undefined && config[key] === undefined)
            config[key] = field.default;
    }
    const errors = validateConfig(schema, config);
    if (errors.length > 0) {
        throw new Error(`dsh-browser: 配置无效 — ${errors.join("; ")}`);
    }
    return config;
}
export { TYPES };
//# sourceMappingURL=config.js.map