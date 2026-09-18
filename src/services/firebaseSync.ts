import {db} from '../db/database';
import {getFirebaseIdToken} from './firebaseAuth';

const projectId = 'audit-stock-count';
const apiKey = 'AIzaSyD193e6G62EHa7nP0w2i-YLCPGe6Z3bOEU';
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// ใช้ collection ใหม่แบบประหยัด: 1 ตารางถูกบีบเป็นเอกสารไม่กี่ก้อน
// แทนแบบเดิมที่สินค้า 1,885 รายการ = 1,885 documents
const chunkCollection = 'auditStockChunks';

// ไม่ sync exportRecords เพราะมีไฟล์ Excel แบบ ArrayBuffer ใหญ่ กิน quota เร็วมาก
// Export ยังใช้งานในเครื่องได้ตามปกติ และกด Export ใหม่จากฐานกลางได้
const tableNames = [
  'products',
  'allowanceImports',
  'movementImports',
  'movementItems',
  'countSessions',
  'countSessionItems',
  'countTransactions',
  'movementDrafts',
  'auditUsers'
] as const;

type TableName = typeof tableNames[number];
type ChunkDocument = {
  name: string;
  fields?: {
    table?: {stringValue?: string};
    chunkIndex?: {integerValue?: string};
    payload?: {stringValue?: string};
    updatedAt?: {timestampValue?: string};
  };
};

// Firestore limits strings by UTF-8 bytes; Thai characters can use three bytes.
const maxPayloadBytes = 700_000;
const pendingStorageKey = 'audit-stock-pending-sync-v1';
let activeSync: Promise<void> | undefined;
let queuedTimer: number | undefined;
let onlineListenerInstalled = false;
let blockedUntil = 0;
const dirtyTables = new Set<TableName>(loadPendingTables());

function isTableName(value: string): value is TableName {
  return (tableNames as readonly string[]).includes(value);
}

function loadPendingTables(): TableName[] {
  try {
    const values = JSON.parse(localStorage.getItem(pendingStorageKey) || '[]') as string[];
    return values.filter(isTableName);
  } catch {
    return [];
  }
}

function persistPendingTables() {
  localStorage.setItem(pendingStorageKey, JSON.stringify([...dirtyTables]));
}

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

function chunkId(table: string, index: number) {
  return `${table}__${String(index).padStart(4, '0')}`;
}

async function request(url: string, init?: RequestInit) {
  if (Date.now() < blockedUntil) throw new Error('Firebase sync is temporarily paused after an authorization error.');
  const idToken = await getFirebaseIdToken();
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${apiKey}`, {
    ...init,
    headers: {...init?.headers, Authorization: `Bearer ${idToken}`}
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) blockedUntil = Date.now() + 5 * 60_000;
    throw new Error(`Firebase ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

async function listChunkDocuments() {
  const all: ChunkDocument[] = [];
  let token = '';

  do {
    const data = await request(`${base}/${chunkCollection}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`) as {
      documents?: ChunkDocument[];
      nextPageToken?: string;
    };
    all.push(...(data.documents || []));
    token = data.nextPageToken || '';
  } while (token);

  return all;
}

async function markMissingCloudTablesForUpload() {
  if (!navigator.onLine) return;
  const documents = await listChunkDocuments();
  const cloudTables = new Set(documents.map(document => document.fields?.table?.stringValue).filter(Boolean));
  for (const tableName of tableNames) {
    if (cloudTables.has(tableName)) continue;
    if (await db.table(tableName).count()) dirtyTables.add(tableName);
  }
  persistPendingTables();
}

function makeChunks(records: unknown[]) {
  const chunks: string[] = [];
  let parts: string[] = [];
  let currentBytes = 2;
  const encoder = new TextEncoder();

  for (const record of records) {
    const part = serialize(record);
    const partBytes = encoder.encode(part).byteLength + (parts.length ? 1 : 0);
    if (currentBytes + partBytes > maxPayloadBytes && parts.length) {
      chunks.push(`[${parts.join(',')}]`);
      parts = [];
      currentBytes = 2;
    }
    parts.push(part);
    currentBytes += partBytes;
  }

  chunks.push(`[${parts.join(',')}]`);
  return chunks;
}

async function pullFirestoreToLocal() {
  if (!navigator.onLine) return;

  const documents = await listChunkDocuments();
  const byTable = new Map<TableName, ChunkDocument[]>();

  for (const document of documents) {
    const table = document.fields?.table?.stringValue;
    if (!table || !isTableName(table)) continue;
    byTable.set(table, [...(byTable.get(table) || []), document]);
  }

  for (const [tableName, tableChunks] of byTable) {
    const records = tableChunks
      .sort((a, b) => Number(a.fields?.chunkIndex?.integerValue || 0) - Number(b.fields?.chunkIndex?.integerValue || 0))
      .flatMap(document => deserialize(document.fields?.payload?.stringValue || '[]'));

    // Never clear local data during refresh. Firebase can be behind this device
    // (for example when the page is refreshed before a queued upload finishes).
    // Merge missing remote rows and only replace a local row when the remote row
    // has a newer updatedAt value. This keeps offline/local counts from vanishing.
    const table = db.table(tableName);
    const remoteRecords=(records as Array<Record<string,unknown>>).filter(record=>{
      const keyPath=table.schema.primKey.keyPath;
      const key=typeof keyPath==='string'?record[keyPath]:undefined;
      return typeof key==='string'||typeof key==='number';
    });
    const keyPath=table.schema.primKey.keyPath as string;
    const keys=remoteRecords.map(record=>record[keyPath] as string|number);
    const locals=await table.bulkGet(keys) as Array<Record<string,unknown>|undefined>;
    const toPut=remoteRecords.filter((record,index)=>{
      const local=locals[index];
      if(!local)return true;
      const remoteUpdated=record.updatedAt?+new Date(record.updatedAt as string|Date):0;
      const localUpdated=local.updatedAt?+new Date(local.updatedAt as string|Date):0;
      return !!remoteUpdated&&remoteUpdated>localUpdated;
    });
    if(toPut.length)await table.bulkPut(toPut);
  }
}

async function pushTablesToFirestore(tables: Iterable<TableName>) {
  if (!navigator.onLine) throw new Error('Offline');

  const priority:TableName[]=['countTransactions','countSessionItems','countSessions','products','allowanceImports','movementImports','movementItems','movementDrafts','auditUsers'];
  const requested=new Set(tables);
  const tableList = priority.filter(table=>requested.has(table));
  if (!tableList.length) return;

  const existing = await listChunkDocuments();

  const failures:string[]=[];
  for (const tableName of tableList) {
    try {
      await new Promise<void>(resolve=>window.setTimeout(resolve,0));
      const records = await db.table(tableName).toArray();
      const chunks = makeChunks(records);
      const keepIds = new Set(chunks.map((_payload, index) => chunkId(tableName, index)));

      const writes = chunks.map((payload, index) => () => request(`${base}/${chunkCollection}/${chunkId(tableName, index)}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        fields: {
          table: {stringValue: tableName},
          chunkIndex: {integerValue: String(index)},
          payload: {stringValue: payload},
          updatedAt: {timestampValue: new Date().toISOString()}
        }
      })
    }));

      const deletes = existing
      .filter(document => {
        const id = document.name.split('/').pop() || '';
        return document.fields?.table?.stringValue === tableName && !keepIds.has(id);
      })
      .map(document => () => request(`https://firestore.googleapis.com/v1/${document.name}`, {method: 'DELETE'}));

      const jobs = [...writes, ...deletes];
      for (let i = 0; i < jobs.length; i += 4) {
        await Promise.all(jobs.slice(i, i + 4).map(job => job()));
      }
      dirtyTables.delete(tableName);
      persistPendingTables();
    } catch(error) {
      failures.push(tableName);
      console.error(`Firebase table sync failed: ${tableName}`,error);
    }
  }
  if(failures.length)throw new Error(`Firebase sync incomplete: ${failures.join(', ')}`);
}

export async function syncAllToFirestore() {
  if (activeSync) return activeSync;
  if (!navigator.onLine || !dirtyTables.size || Date.now() < blockedUntil) return;

  activeSync = (async () => {
    try {
      await pushTablesToFirestore([...dirtyTables]);
    } catch (error) {
      console.error('Firebase sync failed; data remains safely stored on this device.', error);
      if (Date.now() >= blockedUntil) window.setTimeout(() => {
        if (navigator.onLine && dirtyTables.size) queueFirestoreSync([], 0);
      }, 15000);
    } finally {
      activeSync = undefined;
    }
  })();

  return activeSync;
}

export function queueFirestoreSync(tablesOrDelay?: TableName[] | number, delay = 5000) {
  if (Array.isArray(tablesOrDelay)) {
    tablesOrDelay.forEach(table => dirtyTables.add(table));
  } else {
    tableNames.forEach(table => dirtyTables.add(table));
    if (typeof tablesOrDelay === 'number') delay = tablesOrDelay;
  }
  persistPendingTables();

  if (queuedTimer) window.clearTimeout(queuedTimer);
  queuedTimer = window.setTimeout(() => {
    queuedTimer = undefined;
    void syncAllToFirestore();
  }, delay);
}


export async function refreshFromFirestore() {
  if (Date.now() < blockedUntil) return;
  try {
    await pullFirestoreToLocal();
  } catch (error) {
    console.error('Firebase refresh unavailable; continuing with local data.', error);
  }
}

// เก็บชื่อ function เดิมไว้ให้ repository เรียกได้
// โหมดประหยัดใช้การ upload chunk ทั้งตารางแทนการลบเอกสารรายตัว
export async function deleteFirestoreRows(_rows: Array<{table: string; key: unknown}>) {
  return;
}

export async function initializeCloudData() {
  if (!onlineListenerInstalled) {
    window.addEventListener('online', () => queueFirestoreSync([], 2000));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) {
        if (dirtyTables.size) queueFirestoreSync([], 0);
        else void refreshFromFirestore();
      }
    });
    onlineListenerInstalled = true;
  }

  try {
    // Cloud-first merge is required for a second device. Local rows still win
    // conflicts, but missing cloud rows are added before any full-table upload.
    await pullFirestoreToLocal();
    await markMissingCloudTablesForUpload();
    if (dirtyTables.size) await syncAllToFirestore();
  } catch (error) {
    console.error('Firebase sync unavailable; continuing with local data.', error);
  }
}
