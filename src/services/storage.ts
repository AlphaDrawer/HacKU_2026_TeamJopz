import type { ReportRecord } from '../domain/report'

const DB_NAME = 'gaittrace-local'
const STORE_NAME = 'reports'
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('此瀏覽器不支援本機歷史記錄。'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('無法開啟本機儲存。'))
  })
}

export async function saveReport(record: ReportRecord): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('無法儲存本機記錄。'))
      tx.onabort = () => reject(tx.error ?? new Error('本機儲存已取消。'))
    })
  } finally {
    db.close()
  }
}

export async function getReports(): Promise<ReportRecord[]> {
  const db = await openDatabase()
  try {
    return await new Promise<ReportRecord[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve((request.result as ReportRecord[]).sort((a, b) => b.measuredAt - a.measuredAt))
      request.onerror = () => reject(request.error ?? new Error('無法讀取本機記錄。'))
    })
  } finally {
    db.close()
  }
}

export async function clearReports(): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('無法清除本機記錄。'))
    })
  } finally {
    db.close()
  }
}
