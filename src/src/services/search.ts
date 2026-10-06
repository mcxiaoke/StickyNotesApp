// 实时搜索与关键词高亮（方案 §4.2 主界面）
import type { Note } from '../data/note';

export interface SearchSegment {
  text: string;
  hit: boolean;
}

export function filterNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => n.content.toLowerCase().includes(q));
}

/** 命中片段拆分（用于 Text 嵌套渲染高亮） */
export function highlightSegments(text: string, query: string): SearchSegment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const segments: SearchSegment[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  while (true) {
    const idx = lower.indexOf(q, cursor);
    if (idx < 0) {
      if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), hit: false });
    segments.push({ text: text.slice(idx, idx + q.length), hit: true });
    cursor = idx + q.length;
  }
  return segments;
}
