// 搜索输入状态：输入即更、300ms 防抖生效、清除立即归零（对齐桌面端 80ms 防抖语义，
// 节奏取移动端设计文档 §4.2 的 300ms 承诺）
import { useCallback, useEffect, useRef, useState } from 'react';

export function useSearchInput(delayMs = 300) {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuery = useCallback(
    (text: string) => {
      setQuery(text);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (text.trim() === '') {
        // 清空立即生效，不等防抖
        setSearchQuery('');
        return;
      }
      timerRef.current = setTimeout(() => setSearchQuery(text), delayMs);
    },
    [delayMs],
  );

  const clearSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setQuery('');
    setSearchQuery('');
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { query, searchQuery, updateQuery, clearSearch };
}
