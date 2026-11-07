/** 「看起来是同一件事」的判据：标题（去空白、忽略大小写）+ 起止时间完全一致。 */
function shapeOf(event) {
    return [event.summary.trim().toLowerCase(), event.start, event.end].join('\u0000');
}
/** 只读预检：不写任何东西，把三类情况数清楚，交给用户决定要不要继续。 */
export async function planMigration(from, to, signal) {
    const [source, target] = await Promise.all([from.importSnapshot(signal), to.importSnapshot(signal)]);
    const existingUids = new Set(target.uids);
    const shapeIndex = new Map();
    for (const event of target.events)
        shapeIndex.set(shapeOf(event), event.uid);
    const plan = { from: from.kind, to: to.kind, total: source.events.length, create: [], exists: 0, duplicates: [], invalid: 0 };
    for (const event of source.events) {
        signal?.throwIfAborted();
        const icalUid = event.icalUid;
        if (icalUid === undefined || icalUid === '') {
            plan.invalid += 1;
            continue;
        }
        const item = { uid: event.uid, icalUid, summary: event.summary, start: event.start, end: event.end };
        if (existingUids.has(icalUid)) {
            plan.exists += 1;
            continue;
        }
        const twin = shapeIndex.get(shapeOf(event));
        if (twin !== undefined) {
            plan.duplicates.push({ ...item, existingUid: twin });
            continue;
        }
        plan.create.push(item);
    }
    return plan;
}
/**
 * 执行迁移：只搬预检里判为「将新建」的那些，**逐条原样搬运**（`raw()` 取原文，
 * 不走解析再拼装，否则 ATTENDEE / EXDATE 这类没建模的字段会丢）。
 *
 * @param limit 单次最多搬多少条；超出部分让用户分批执行（避免一个请求挂太久）。
 */
export async function runMigration(from, to, plan, options = {}, signal) {
    const limit = options.limit ?? 200;
    const items = plan.create.slice(0, limit);
    const result = { migrated: 0, failed: [] };
    for (const item of items) {
        signal?.throwIfAborted();
        try {
            const data = await from.raw(item.uid, signal);
            await to.importRaw(item.icalUid, data, signal);
            result.migrated += 1;
        }
        catch (error) {
            result.failed.push({
                uid: item.uid,
                summary: item.summary,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return result;
}
/** 给面板用的一句话摘要，避免前端各自拼文案拼错。 */
export function describePlan(plan) {
    const parts = ['将迁移 ' + plan.create.length + ' 条', '已存在跳过 ' + plan.exists + ' 条'];
    if (plan.duplicates.length > 0)
        parts.push('疑似重复跳过 ' + plan.duplicates.length + ' 条');
    if (plan.invalid > 0)
        parts.push('缺少 UID 跳过 ' + plan.invalid + ' 条');
    return parts.join('，');
}
