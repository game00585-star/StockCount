import Dexie from 'dexie';
import {db} from '../db/database';
import {getCurrentUser, type AuthUser} from './authService';
import {queueFirestoreSync} from './firebaseSync';

export const backupTableNames = ['products','allowanceImports','movementImports','movementItems','countSessions','countSessionItems','countTransactions','movementDrafts','auditUsers','exportRecords'] as const;
export type BackupTableName=typeof backupTableNames[number];
export type BackupData=Record<BackupTableName,unknown[]>;
export type BackupDocument={format:'audit-stock-count-backup';version:1|2;exportedAt:string;data:BackupData};
export type BackupPreview={fileName:string;document:BackupDocument;counts:Record<BackupTableName,number>};
const dateFieldPattern=/(At|Date|From|To)$/;

function arrayBufferToBase64(value:ArrayBuffer){const bytes=new Uint8Array(value);let binary='';for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(binary)}
function base64ToArrayBuffer(value:string){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);return bytes.buffer}
function encodeJson(value:unknown){return JSON.stringify(value,(_key,item)=>item instanceof ArrayBuffer?{__type:'ArrayBuffer',base64:arrayBufferToBase64(item)}:item,2)}
function reviveValues(value:unknown,key=''):unknown{if(Array.isArray(value))return value.map(item=>reviveValues(item));if(value&&typeof value==='object'){const record=value as Record<string,unknown>;if(record.__type==='ArrayBuffer'&&typeof record.base64==='string')return base64ToArrayBuffer(record.base64);return Object.fromEntries(Object.entries(record).map(([childKey,child])=>[childKey,reviveValues(child,childKey)]))}if(typeof value==='string'&&dateFieldPattern.test(key)&&!Number.isNaN(Date.parse(value)))return new Date(value);return value}
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}
function requireString(record:Record<string,unknown>,field:string,table:string,row:number){if(typeof record[field]!=='string'||!String(record[field]).trim())throw new Error(`ข้อมูล ${table} แถวที่ ${row+1} ไม่มี ${field} ที่ถูกต้อง`)}
function ensureUnique(records:unknown[],field:string,table:string){const values=new Set<string>();records.forEach((item,row)=>{if(!isRecord(item))throw new Error(`ข้อมูล ${table} แถวที่ ${row+1} มีรูปแบบไม่ถูกต้อง`);const value=String(item[field]??'');if(!value)return;if(values.has(value))throw new Error(`ข้อมูล ${table} มี ${field} ซ้ำ: ${value}`);values.add(value)})}
function validateRelations(data:BackupData){const movementIds=new Set(data.movementImports.map(item=>String((item as Record<string,unknown>).id))),sessionIds=new Set(data.countSessions.map(item=>String((item as Record<string,unknown>).id)));data.movementItems.forEach((item,row)=>{if(!movementIds.has(String((item as Record<string,unknown>).movementImportId)))throw new Error(`รายการเคลื่อนไหวแถวที่ ${row+1} อ้างถึงไฟล์นำเข้าที่ไม่มีอยู่`)});for(const table of ['countSessionItems','countTransactions'] as const)data[table].forEach((item,row)=>{if(!sessionIds.has(String((item as Record<string,unknown>).sessionId)))throw new Error(`${table} แถวที่ ${row+1} อ้างถึงรอบนับที่ไม่มีอยู่`)});data.countSessions.forEach((item,row)=>{const movementId=(item as Record<string,unknown>).movementImportId;if(movementId!=null&&!movementIds.has(String(movementId)))throw new Error(`รอบนับแถวที่ ${row+1} อ้างถึงไฟล์นำเข้าที่ไม่มีอยู่`)})}

export function parseBackupText(text:string,fileName='backup.json'):BackupPreview{
  let raw:unknown;try{raw=JSON.parse(text)}catch{throw new Error('ไฟล์ JSON เสียหรือมีรูปแบบ JSON ไม่ถูกต้อง')}
  if(!isRecord(raw)||raw.format!=='audit-stock-count-backup')throw new Error('ไฟล์นี้ไม่ใช่ Backup ของระบบ Audit Stock');
  if(raw.version!==1&&raw.version!==2)throw new Error(`ไม่รองรับ Backup เวอร์ชัน ${String(raw.version??'ไม่ระบุ')}`);
  if(!isRecord(raw.data))throw new Error('ไฟล์ Backup ไม่มีส่วน data');
  const data={} as BackupData;
  for(const tableName of backupTableNames){const rows=raw.data[tableName];if(!Array.isArray(rows))throw new Error(`ไฟล์ Backup ไม่มีข้อมูล ${tableName} หรือมีรูปแบบไม่ถูกต้อง`);data[tableName]=reviveValues(rows) as unknown[]}
  data.products.forEach((item,row)=>{if(!isRecord(item))throw new Error(`ข้อมูล products แถวที่ ${row+1} ไม่ถูกต้อง`);requireString(item,'productCode','products',row);requireString(item,'productName','products',row)});
  data.countSessions.forEach((item,row)=>{if(!isRecord(item))throw new Error(`ข้อมูล countSessions แถวที่ ${row+1} ไม่ถูกต้อง`);requireString(item,'sessionNumber','countSessions',row);requireString(item,'branchName','countSessions',row)});
  data.auditUsers.forEach((item,row)=>{if(!isRecord(item))throw new Error(`ข้อมูล auditUsers แถวที่ ${row+1} ไม่ถูกต้อง`);requireString(item,'username','auditUsers',row);if(!['ADMIN','USER'].includes(String(item.role)))throw new Error(`ผู้ใช้แถวที่ ${row+1} มีสิทธิ์ไม่ถูกต้อง`)});
  if(!data.auditUsers.some(item=>(item as Record<string,unknown>).role==='ADMIN'))throw new Error('ไฟล์ Backup ไม่มีผู้ใช้สิทธิ์ Admin จึงไม่สามารถกู้คืนได้');
  ensureUnique(data.products,'productCode','products');ensureUnique(data.countSessions,'sessionNumber','countSessions');ensureUnique(data.auditUsers,'username','auditUsers');validateRelations(data);
  if(raw.version===1)data.exportRecords=data.exportRecords.map(item=>({...item as Record<string,unknown>,data:new ArrayBuffer(0)}));
  const exportedAt=typeof raw.exportedAt==='string'&&!Number.isNaN(Date.parse(raw.exportedAt))?raw.exportedAt:'';
  return{fileName,document:{format:'audit-stock-count-backup',version:raw.version,exportedAt,data},counts:Object.fromEntries(backupTableNames.map(name=>[name,data[name].length])) as Record<BackupTableName,number>};
}

export async function createBackupDocument():Promise<BackupDocument>{const entries=await Promise.all(backupTableNames.map(async name=>[name,await db.table(name).toArray()] as const));return{format:'audit-stock-count-backup',version:2,exportedAt:new Date().toISOString(),data:Object.fromEntries(entries) as BackupData}}
export async function downloadJsonBackup(prefix='Audit_Stock_Backup'){const backup=await createBackupDocument(),blob=new Blob([encodeJson(backup)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a'),stamp=new Date().toISOString().replace(/[:.]/g,'-');link.href=url;link.download=`${prefix}_${stamp}.json`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);return backup}
export async function readBackupFile(file:File){if(file.size>100*1024*1024)throw new Error('ไฟล์ Backup มีขนาดเกิน 100 MB');return parseBackupText(await file.text(),file.name)}
export async function restoreBackup(preview:BackupPreview,actor:AuthUser|undefined=getCurrentUser(),backupCurrent:()=>Promise<unknown>=()=>downloadJsonBackup('Audit_Stock_Before_Restore')){
  if(!actor||actor.role!=='ADMIN')throw new Error('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่กู้คืนข้อมูลได้');
  await backupCurrent();
  const tables=backupTableNames.map(name=>db.table(name));
  // Merge conservatively: existing permanent keys win. Never clear or silently replace the current database.
  await db.transaction('rw',tables,async()=>{for(const name of backupTableNames){const table=db.table(name),keyPath=table.schema.primKey.keyPath as string;for(const row of preview.document.data[name] as Record<string,unknown>[]){const key=row[keyPath];if(key!==undefined&&await table.get(key as string|number))continue;try{await table.add(row)}catch(error){if(!(error instanceof Dexie.ConstraintError))throw error}}}});
  queueFirestoreSync([...backupTableNames.filter(name=>name!=='exportRecords')]);
}
