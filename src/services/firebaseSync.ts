import {db} from '../db/database';

const projectId = 'audit-stock-count';
const apiKey = 'AIzaSyD193e6G62EHa7nP0w2i-YLCPGe6Z3bOEU';
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const collection = 'auditStockData';
const tableNames = [
  'products',
  'allowanceImports',
  'movementImports',
  'movementItems',
  'countSessions',
  'countSessionItems',
  'countTransactions',
  'movementDrafts',
  'exportRecords',
  'auditUsers'
] as const;

let activeSync: Promise<void> | undefined;
let queuedTimer: number | undefined;
let onlineListenerInstalled = false;

type CloudDocument = {
  name: string;
  fields?: {
    table?: {stringValue?: string};
    key?: {stringValue?: string};
    payload?: {stringValue?: string};
    updatedAt?: {timestampValue?: string};
  };
};

type LocalRow = {table: string; key: string; payload: string; id: string};
type RemoteRow = LocalRow & {updatedAt?: string};

function toBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item) => item instanceof ArrayBuffer ? {__arrayBuffer: toBase64(item)} : item);
}

function deserialize(payload: string) {
  return JSON.parse(payload, (key, item) => {
    if (item && typeof item === 'object' && typeof item.__arrayBuffer === 'string') return fromBase64(item.__arrayBuffer);
    if (typeof item === 'string' && /(At|Date|From|To)$/.test(key) && /^\d{4}-\d\d-\d\dT/.test(item)) return new Date(item);
    return item;
  });
}

function documentId(table: string, key: unknown) {
  return `${table}__${encodeURIComponent(String(key))}`;
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${apiKey}`, init);
  if (!response.ok) throw new Error(`Firebase ${response.status}: ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}

async function safeRequest(url: string, init?: RequestInit) {
  try {
    return await request(url, init);
  } catch (error) {
    console.error('Firebase row sync skipped.', error);
    return undefined;
  }
}

async function listDocuments() {
  const all: CloudDocument[] = [];
  let token = '';

  do {
    const data = await request(`${base}/${collection}?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`) as {
      documents?: CloudDocument[];
      nextPageToken?: string;
    };
    all.push(...(data.documents || []));
    token = data.nextPageToken || '';
  } while (token);

  return all;
}

function cloudRows(documents: CloudDocument[]): RemoteRow[] {
  return documents.flatMap(document => {
    const id = document.name.split('/').pop() || '';
    const table = document.fields?.table?.stringValue;
    const key = document.fields?.key?.stringValue;
    const payload = document.fields?.payload?.stringValue;
    if (!id || !table || !key || !payload) return [];
    return [{id, table, key, payload, updatedAt: document.fields?.updatedAt?.timestampValue}];
  });
}

async function localRows() {
  const rows: LocalRow[] = [];

  for (const tableName of tableNames) {
    const table = db.table(tableName);
    const keyPath = table.schema.primKey.keyPath as string;
    for (const record of await table.toArray()) {
      const key = record[keyPath];
      if (key === undefined || key === null) continue;
      rows.push({table: tableName, key: String(key), payload: serialize(record), id: documentId(tableName, key)});
    }
  }

  return rows;
}

async function pullFirestoreToLocal(remoteRows: RemoteRow[]) {
  for (const tableName of tableNames) {
    const records = remoteRows
      .filter(row => row.table === tableName)
      .map(row => deserialize(row.payload));

    if (records.length) await db.table(tableName).bulkPut(records);
  }
}

async function pushLocalToFirestore(rows: LocalRow[]) {
  const jobs = rows.map(row => () => safeRequest(`${base}/${collection}/${row.id}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      fields: {
        table: {stringValue: row.table},
        key: {stringValue: row.key},
        payload: {stringValue: row.payload},
        updatedAt: {timestampValue: new Date().toISOString()}
      }
    })
  }));

  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(job => job()));
  }
}

async function performSync() {
  if (!navigator.onLine) return;

  const remote = cloudRows(await listDocuments());

  // Firebase เป็นฐานกลาง: ดึงข้อมูลจาก Cloud ลง IndexedDB ทุกครั้งก่อน
  await pullFirestoreToLocal(remote);

  // จากนั้นค่อยส่งข้อมูล local ที่มีอยู่ขึ้นไป Cloud
  // ห้ามลบเอกสารบน Firebase อัตโนมัติ เพราะมือถือ/เครื่องใหม่ local ยังว่างได้
  await pushLocalToFirestore(await localRows());
}

export async function syncAllToFirestore() {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    try {
      await performSync();
    } catch (error) {
      console.error('Firebase sync failed; data remains safely stored on this device.', error);
    } finally {
      activeSync = undefined;
    }
  })();
  return activeSync;
}

export function queueFirestoreSync(delay = 1200) {
  if (queuedTimer) window.clearTimeout(queuedTimer);
  queuedTimer = window.setTimeout(() => {
    queuedTimer = undefined;
    void syncAllToFirestore();
  }, delay);
}

export async function refreshFromFirestore() {
  if (!navigator.onLine) return;
  try {
    await pullFirestoreToLocal(cloudRows(await listDocuments()));
  } catch (error) {
    console.error('Firebase refresh unavailable; continuing with local data.', error);
  }
}

export async function deleteFirestoreRows(rows: Array<{table: string; key: unknown}>) {
  if (!navigator.onLine || !rows.length) return;

  const jobs = rows.map(row => () => safeRequest(`${base}/${collection}/${documentId(row.table, row.key)}`, {method: 'DELETE'}));
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(job => job()));
  }
}

export async function initializeCloudData() {
  if (!onlineListenerInstalled) {
    window.addEventListener('online', () => queueFirestoreSync(500));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refreshFromFirestore();
    });
    onlineListenerInstalled = true;
  }

  try {
    await syncAllToFirestore();
  } catch (error) {
    console.error('Firebase sync unavailable; continuing with local data.', error);
  }
}
