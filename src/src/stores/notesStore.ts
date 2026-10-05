// 便签状态 store：本地 CRUD + 同步触发防抖（编辑 5s / 删除归档 2s，方案 §4.6）
import { create } from 'zustand';
import { noteRepository } from '../data/noteRepository';
import type { Note } from '../data/note';
import type { NoteColor } from '../data/theme';
import { performSyncRound } from '../sync/syncRunner';
import { logger } from '../services/logger';

interface NotesState {
  notes: Note[];
  loaded: boolean;
  refreshAsync: () => Promise<void>;
  createAsync: (content?: string, color?: NoteColor) => Promise<Note>;
  saveContentAsync: (id: string, content: string) => Promise<void>;
  setColorAsync: (id: string, color: NoteColor) => Promise<void>;
  togglePinAsync: (id: string) => Promise<void>;
  archiveAsync: (id: string) => Promise<void>;
  restoreAsync: (id: string) => Promise<void>;
  purgeAsync: (id: string) => Promise<void>;
  purgeAllDeletedAsync: () => Promise<void>;
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 编辑保存后 5 秒静默上行；归档/恢复后 2 秒快速同步墓碑 */
function scheduleSyncDebounce(delayMs: number): void {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      performSyncRound('debounce').catch((ex) =>
        logger.warn('sync', `debounced round failed: ${ex instanceof Error ? ex.message : String(ex)}`),
      );
    }, delayMs);
}

export const SYNC_DELAY_AFTER_EDIT_MS = 5000;
export const SYNC_DELAY_AFTER_DELETE_MS = 2000;

export const notesStore = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,

  refreshAsync: async () => {
    const notes = await noteRepository.getAllAsync();
    set({ notes, loaded: true });
  },

  createAsync: async (content = '', color = 'yellow') => {
    const note = await noteRepository.createAsync(content, color);
    set({ notes: [note, ...get().notes] });
    scheduleSyncDebounce(SYNC_DELAY_AFTER_EDIT_MS);
    return note;
  },

  saveContentAsync: async (id, content) => {
    await noteRepository.updateContentAsync(id, content);
    await patchLocal(set, get, id);
    scheduleSyncDebounce(SYNC_DELAY_AFTER_EDIT_MS);
  },

  setColorAsync: async (id, color) => {
    await noteRepository.updateColorAsync(id, color);
    await patchLocal(set, get, id);
    scheduleSyncDebounce(SYNC_DELAY_AFTER_EDIT_MS);
  },

  togglePinAsync: async (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    await noteRepository.setPinnedInListAsync(id, !note.isPinnedInList);
    await patchLocal(set, get, id);
    scheduleSyncDebounce(SYNC_DELAY_AFTER_EDIT_MS);
  },

  archiveAsync: async (id) => {
    await noteRepository.softDeleteAsync(id);
    await patchLocal(set, get, id);
    scheduleSyncDebounce(SYNC_DELAY_AFTER_DELETE_MS);
  },

  restoreAsync: async (id) => {
    await noteRepository.restoreAsync(id);
    await patchLocal(set, get, id);
    scheduleSyncDebounce(SYNC_DELAY_AFTER_DELETE_MS);
  },

  purgeAsync: async (id) => {
    await noteRepository.purgeAsync(id);
    set({ notes: get().notes.filter((n) => n.id !== id) });
  },

  purgeAllDeletedAsync: async () => {
    await noteRepository.purgeAllDeletedAsync();
    set({ notes: get().notes.filter((n) => !n.isDeleted) });
  },
}));

/** 从库中取回单条最新状态并替换列表中的旧行 */
async function patchLocal(
  set: (partial: Partial<NotesState>) => void,
  get: () => NotesState,
  id: string,
): Promise<void> {
  const fresh = await noteRepository.getByIdAsync(id);
  if (!fresh) {
    set({ notes: get().notes.filter((n) => n.id !== id) });
    return;
  }
  set({ notes: get().notes.map((n) => (n.id === id ? fresh : n)) });
}
