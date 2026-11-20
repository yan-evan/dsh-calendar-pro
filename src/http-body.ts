/**
 * 请求体读取：两个同源路由（日历设置、邮件日程）共用。
 *
 * 两处本来各写了一份完全相同的实现，只有上限常量不同；抽出来以后
 * 「超限拒绝 / 空体视为 {} / 非 JSON 报错」这三条行为只有一处需要维护。
 */
const DEFAULT_LIMIT = 256 * 1024

export async function readJsonBody(req: any, limit = DEFAULT_LIMIT): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buf.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}
