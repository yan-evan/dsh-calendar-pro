/**
 * 工具参数 DSL → 注册所需的 JSON Schema。
 *
 * ctx.tools.register 的 parameters 必须是 { type:'object', properties, required? }，
 * 不能直接传 DSL，否则标准模式下 DeepSeek API 会以
 * "schema must be a JSON Schema of 'type: object'" 拒绝。
 * @module dsh-calendar-pro/parameters
 */
/**
 * 把参数 DSL 编译成注册用的 JSON Schema。
 * @param dsl 参数描述映射
 * @returns 以 object 为根的 schema
 */
export function compileParameters(dsl) {
    const properties = {};
    const required = [];
    for (const [name, spec] of Object.entries(dsl)) {
        const property = { type: spec.type };
        if (spec.enum !== undefined)
            property.enum = [...spec.enum];
        if (spec.description !== undefined)
            property.description = spec.description;
        if (spec.type === 'array' && spec.items !== undefined) {
            property.items = { type: spec.items };
        }
        properties[name] = property;
        if (spec.required === true)
            required.push(name);
    }
    const schema = { type: 'object', properties };
    if (required.length > 0)
        schema.required = required;
    return schema;
}
