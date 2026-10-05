// 同步引擎：无状态全量对账 + 时间戳 LWW + 墓碑 + 下行条件更新守卫（对照桌面端 SyncEngine.cs）。
// 每轮从「本地库 + 远端列表」两个真值现场重新推导差量，不维护同步游标；
// 任意一轮中断，下一轮自动收敛。单飞信号量保证同一时刻只有一轮在跑。
//
// 端到端加密（可选）：加解密被内嵌在引擎与后端之间，UI 与本地库始终使用明文。
//   · 探针守卫：远端列目录后首步校验 .auth_verifier，不匹配立即中断整轮（不写库）
//   · 上行：正文注入 SN1: 魔数 → AES-256-CBC → 输出 iv + payload（不含 content）
//   · 下行：解密并核验魔数，失败计入 skippedInvalid 跳过，绝不写入乱码
import { noteRepository, type INoteRepository, type RemoteApplyItem } from '../data/noteRepository';
import { ensureVerifierAsync } from './authVerifier';
import {
  MAX_NOTE_FILE_BYTES,
  businessEquals,
  decryptDtoContent,
  dtoFromNote,
  dtoFromNoteEncrypted,
  isEncryptedDto,
  noteFromDto,
  noteKey,
  parseDto,
  serializeDto,
  tsValue,
  type NoteLike,
} from './dto';
import type { IStorageBackend } from './backends/types';

const DOWNLOAD_CONCURRENCY = 6;

export interface SyncRoundOptions {
  /** 启用端到端加密（正文以 iv + payload 落盘 stickynotes-vault/） */
  enableEncryption?: boolean;
  /** 保险箱口令；enableEncryption 为 true 时必填 */
  secret?: string;
}

export interface SyncRoundSummary {
  listed: number;
  downloaded: number;
  uploaded: number;
  skippedInvalid: number;
  guardedSkipped: number;
  appliedIds: string[];
}

export class SyncEngine {
  private running = false;
  private readonly repository: INoteRepository;

  constructor(repository: INoteRepository = noteRepository) {
    this.repository = repository;
  }

  /**
   * 执行一轮同步。返回 null 表示上一轮尚未结束（单飞直接放弃本轮，不排队）。
   * 上传失败会抛出异常（本轮已应用的下行依然有效，下一轮自动补传差量）。
   */
  async runAsync(
    backend: IStorageBackend,
    deviceId: string,
    options: SyncRoundOptions = {},
  ): Promise<SyncRoundSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runCoreAsync(backend, deviceId, options);
    } finally {
      this.running = false;
    }
  }

  private async runCoreAsync(
    backend: IStorageBackend,
    deviceId: string,
    options: SyncRoundOptions,
  ): Promise<SyncRoundSummary> {
    const enableEncryption = options.enableEncryption === true;
    const secret = options.secret;
    if (enableEncryption && !secret) {
      throw new Error('已启用端到端加密但缺少保险箱口令，本轮同步中止（配置异常）。');
    }

    // 1. 列出远端并全量下载解析（坏文件隔离，绝不中断整轮）
    const remoteItems = await backend.listAsync();

    // 1.1 探针守卫：远端目录已确保存在后再校验口令（不匹配则整轮中止，绝不逐个解密失败）
    if (enableEncryption && secret) {
      await ensureVerifierAsync(backend, secret);
    }

    const remote = new Map<string, NoteLike>();
    let skippedInvalid = 0;
    let failedDownloads = 0;
    let firstFailure: unknown = null;

    let cursor = 0;
    const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, remoteItems.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= remoteItems.length) return;
        const item = remoteItems[index];
        try {
          const text = await backend.getTextAsync(item.key);
          if (text == null || text.length > MAX_NOTE_FILE_BYTES) {
            skippedInvalid++;
            continue;
          }
          const dto = parseDto(text, item.key);
          if (!dto) {
            skippedInvalid++;
            continue;
          }

          // 密文文件：解密回填正文；密钥缺失或解密失败一律跳过（绝不落库乱码）
          let content: string;
          if (isEncryptedDto(dto)) {
            if (!secret) {
              skippedInvalid++;
              continue;
            }
            try {
              content = decryptDtoContent(dto, secret);
            } catch {
              skippedInvalid++;
              continue;
            }
          } else {
            content = dto.content ?? '';
          }

          remote.set(dto.id, noteFromDto({ ...dto, content }));
        } catch (ex) {
          failedDownloads++;
          firstFailure ??= ex;
        }
      }
    });
    await Promise.all(workers);

    // 全部下载失败视为本轮失败（典型为认证/断网），绝不能当作「远端为空」处理（铁律 7）
    if (remoteItems.length > 0 && failedDownloads === remoteItems.length && firstFailure != null) {
      throw firstFailure instanceof Error
        ? new Error(`远端下载全部失败（共 ${remoteItems.length} 个对象），本轮中止：${firstFailure.message}`, { cause: firstFailure })
        : new Error(`远端下载全部失败（共 ${remoteItems.length} 个对象），本轮中止`);
    }

    // 2. 全量对账与 LWW 合并裁决（比较对象始终为解密后的明文）
    const localNotes = await this.repository.getAllAsync();
    const snapshot = new Map(localNotes.map((n) => [n.id, n]));

    const downloads: RemoteApplyItem[] = [];
    const uploads: NoteLike[] = [];

    for (const id of new Set([...snapshot.keys(), ...remote.keys()])) {
      const localNote = snapshot.get(id);
      const remoteDto = remote.get(id);

      if (!localNote && remoteDto) {
        // 远端新便签（含其他设备的墓碑，回流入库为不可见行）
        downloads.push({ note: remoteDto, snapshotUpdatedAt: null });
      } else if (localNote && !remoteDto) {
        // 本地新便签（含尚未上传过的墓碑）
        uploads.push(localNote);
      } else if (localNote && remoteDto) {
        // 两边都有：updatedAt 大者胜；相等本地胜（确定性）
        if (tsValue(localNote.updatedAt) >= tsValue(remoteDto.updatedAt)) {
          if (!businessEquals(dtoFromNote(localNote, deviceId), remoteDto)) {
            uploads.push(localNote);
          }
        } else if (!businessEquals(dtoFromNote(localNote, deviceId), remoteDto)) {
          downloads.push({ note: remoteDto, snapshotUpdatedAt: localNote.updatedAt });
        }
      }
    }

    // 3. 下行应用（条件更新守卫）
    let applied = 0;
    let guardedSkipped = 0;
    if (downloads.length > 0) {
      const result = await this.repository.applyRemoteBatchAsync(downloads);
      applied = result.applied;
      guardedSkipped = result.guardedSkipped;
    }

    // 4. 上行（失败即整轮终止；已上传文件有效，下轮按差量续传）
    //    加密模式下每次加密使用新的随机 IV，业务内容的比较已在第 2 步用明文完成，不会产生乒乓。
    let uploaded = 0;
    for (const note of uploads) {
      const dto = enableEncryption && secret
        ? dtoFromNoteEncrypted(note, deviceId, secret)
        : dtoFromNote(note, deviceId);
      await backend.putTextAsync(noteKey(note.id), serializeDto(dto));
      uploaded++;
    }

    return {
      listed: remoteItems.length,
      downloaded: applied,
      uploaded,
      skippedInvalid,
      guardedSkipped,
      appliedIds: downloads.map((d) => d.note.id),
    };
  }
}
