// 相对时间格式化：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / MM-DD HH:mm
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';

  const diffMs = now.getTime() - t;
  if (diffMs < 0) return '刚刚';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}-${md} ${hm}`;
}
