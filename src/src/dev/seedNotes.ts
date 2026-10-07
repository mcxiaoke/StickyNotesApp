// 仅限 debug（__DEV__）：注入测试便签，供 deep link 路由与 EXPO_PUBLIC_SEED 启动播种共用。
// 固定 UUID + INSERT OR IGNORE 保证幂等：重复注入不产生重复行，Metro reload 也安全。
import { getDatabase, openAppDatabase } from '../data/db';
import { isoFromMs } from '../data/note';
import type { NoteColor } from '../data/theme';
import { logger } from '../services/logger';

/** 种子便签的固定 id 前缀（24 字符 + 12 位序号 = 36 字符 UUID 形态），可据此识别/清除 */
const SEED_ID_PREFIX = '00000000-0000-4000-8000-';

const SAMPLE_NOTES: { content: string; color: NoteColor; pinned?: boolean }[] = [
  { content: '购物清单\n牛奶、鸡蛋、全麦面包\n洗衣液', color: 'yellow' },
  { content: '周一站会要点：搜索联调已对齐桌面端，剩余瀑布流间距 bug 待回归。', color: 'blue' },
  {
    content: '同步引擎排查记录\n\n1. 对账快照与台账不一致时以本地为准\n2. 硬删除后的下行写入直接否决\n3. 冲突优先保留更新时间 newer 的一方\n\n待办：补一组 E2E 用例覆盖第三条。',
    color: 'green',
  },
  { content: '短便签', color: 'pink', pinned: true },
  {
    content: '读书摘录：同步系统设计的核心不是"如何传输"，而是"如何收敛"——任何两端状态经过足够多轮对账后应趋于一致，期间的临时分叉都是允许的中间态。',
    color: 'purple',
  },
  { content: ' IDEAS\n\n- 便签支持 Markdown 渲染\n- 桌面端快捷键对齐\n- 归档页搜索', color: 'gray', pinned: true },
  { content: '报销：差旅 320 元，晚餐 58 元，记得上传发票截图。', color: 'yellow' },
  {
    content: '性能观察：双列瀑布流在 200+ 条时首帧仍稳定，FlashList masonry 回收正常；注意卡片回调必须保持引用稳定，否则 memo 全部失效。',
    color: 'charcoal',
  },
];

export interface SeedOptions {
  /** 注入条数，默认 8（SAMPLE_NOTES 长度），超出内容循环取用；上限 50 */
  count?: number;
  /** 先清除此前注入的种子便签再注入（不影响用户自建数据） */
  clear?: boolean;
}

/** 注入测试便签，返回本轮处理的条数（含 clear 清除的行不计入） */
export async function seedNotesAsync(options?: SeedOptions): Promise<number> {
  const count = Math.max(0, Math.min(options?.count ?? SAMPLE_NOTES.length, 50));
  openAppDatabase();
  const db = getDatabase();
  db.withTransactionSync(() => {
    if (options?.clear) {
      db.runSync('DELETE FROM notes WHERE id LIKE ?', `${SEED_ID_PREFIX}%`);
    }
    // updatedAt 逐条回退 1 分钟，保证列表时间降序与注入顺序一致
    for (let i = 0; i < count; i++) {
      const sample = SAMPLE_NOTES[i % SAMPLE_NOTES.length];
      const id = `${SEED_ID_PREFIX}${String(i + 1).padStart(12, '0')}`;
      const ts = isoFromMs(Date.now() - i * 60_000);
      db.runSync(
        `INSERT OR IGNORE INTO notes (id, content, color, is_pinned_in_list, always_on_top, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
        id,
        sample.content,
        sample.color,
        sample.pinned ? 1 : 0,
        ts,
        ts,
      );
    }
  });
  logger.info('dev-seed', `seeded ${count} notes (clear=${options?.clear === true})`);
  return count;
}
