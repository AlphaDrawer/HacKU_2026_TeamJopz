/**
 * storage.ts（本地报告仓库 · 实现冻结 ReportStore）
 * ------------------------------------------------------------------
 * IndexedDB schema 对齐规范 §5.4：
 *   - 库名 gaitrace-db，版本 1
 *   - 对象仓库 reports，keyPath = "sessionId"
 *   - 索引 by_createdAt（createdAtMs）
 *   - 索引 by_alertLevel（conclusion.alertLevel，多层 keyPath）
 *   - getAll 按时间【升序】（早 → 晚）
 *   - getByRange 按 createdAtMs 区间取
 *   - delete(sessionId)
 *
 * 报告只存本设备浏览器；无网络传输，不存视频/关键点。
 * 纯 IndexedDB 封装，不查询 DOM。
 */
import type { AlertLevel, ReportRecord, ReportStore } from "../contracts/types";

const DB_NAME = "gaitrace-db";
const DB_VERSION = 1;
const STORE = "reports";
const INDEX_CREATED = "by_createdAt";
const INDEX_ALERT = "by_alertLevel";
/** alertLevel 索引多层 keyPath：conclusion.alertLevel */
const ALERT_KEYPATH = ["conclusion", "alertLevel"] as const;

function openIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("此環境不支援 IndexedDB，無法本地保存報告。");
  }
  return indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = openIndexedDb().open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: "sessionId" });
      store.createIndex(INDEX_CREATED, "createdAtMs", { unique: false });
      store.createIndex(INDEX_ALERT, ALERT_KEYPATH, { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("開啟本地資料庫失敗"));
    request.onblocked = () => reject(new Error("本地資料庫被其他分頁佔用，請關閉後重試"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地資料庫操作失敗"));
  });
}

export class LocalReportStore implements ReportStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  async save(record: ReportRecord): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("保存報告失敗"));
    });
  }

  /** 按 createdAt 升序返回全部（早 → 晚），符合 §5.4 */
  async getAll(): Promise<ReportRecord[]> {
    const db = await this.db();
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index(INDEX_CREATED);
    return requestToPromise(index.getAll()) as Promise<ReportRecord[]>;
  }

  /** 时间区间（含边界）查询，供周报/趋势使用 */
  async getByRange(fromMs: number, toMs: number): Promise<ReportRecord[]> {
    const db = await this.db();
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index(INDEX_CREATED);
    const range = IDBKeyRange.bound(fromMs, toMs);
    return requestToPromise(index.getAll(range)) as Promise<ReportRecord[]>;
  }

  /** 按告警等级筛选（严重异常快速检索）；非 ReportStore 必需，属扩展能力 */
  async getByAlertLevel(level: AlertLevel): Promise<ReportRecord[]> {
    const db = await this.db();
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index(INDEX_ALERT);
    return requestToPromise(index.getAll(IDBKeyRange.only(level))) as Promise<ReportRecord[]>;
  }

  async delete(sessionId: string): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("刪除報告失敗"));
    });
  }
}

export function createReportStore(): ReportStore {
  return new LocalReportStore();
}
