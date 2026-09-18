import {db} from '../db/database';
import type {SharePointBackupJob} from '../types';
import {getCurrentUser,canAccessBranch} from './authService';
import {getGraphToken} from './sharePointAuth';
import {isSharePointConfigured,sharePointConfig} from '../config/sharePointConfig';

const GRAPH='https://graph.microsoft.com/v1.0',AUTO_KEY='sharepoint-auto-backup',LAST_KEY='sharepoint-last-success';
let processing:Promise<void>|undefined,timer:number|undefined,changeTimer:number|undefined,started=false;
export type SharePointStatus={configured:boolean;autoEnabled:boolean;pending:number;lastSuccess?:string;lastError?:string;needsLogin:boolean;processing:boolean};
function notify(){window.dispatchEvent(new Event('audit-sharepoint-status'))}
function json(value:unknown){return JSON.stringify(value,(_key,item)=>item instanceof Date?item.toISOString():item)}
function safePart(value:string){return value.normalize('NFKD').replace(/[^a-zA-Z0-9ก-๙_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'unknown'}
function deviceId(){let id=localStorage.getItem('audit-device-id');if(!id){id=crypto.randomUUID();localStorage.setItem('audit-device-id',id)}return id}
async function setting(key:string){return (await db.appSettings.get(key))?.value}
async function setSetting(key:string,value:unknown){await db.appSettings.put({key,value,updatedAt:new Date()})}
export async function getSharePointStatus():Promise<SharePointStatus>{const jobs=await db.sharePointBackupJobs.toArray(),last=await setting(LAST_KEY);return{configured:isSharePointConfigured(),autoEnabled:(await setting(AUTO_KEY))===true,pending:jobs.filter(j=>j.status!=='UPLOADING').length,lastSuccess:typeof last==='string'?last:undefined,lastError:jobs.find(j=>j.lastError)?.lastError,needsLogin:jobs.some(j=>j.status==='AUTH_REQUIRED'),processing:Boolean(processing)}}
export async function setAutomaticSharePointBackup(enabled:boolean){await setSetting(AUTO_KEY,enabled);notify();if(enabled)await enqueueSharePointBackup('เปิดสำรองอัตโนมัติ')}

async function buildPayload(reason:string){
  const user=getCurrentUser();if(!user)throw new Error('กรุณาเข้าสู่ระบบ Audit Stock ก่อนสำรองข้อมูล');
  const [products,allowanceImports,movementImports,movementItems,sessions,sessionItems,transactions,movementDrafts]=await Promise.all([db.products.toArray(),db.allowanceImports.toArray(),db.movementImports.toArray(),db.movementItems.toArray(),db.countSessions.toArray(),db.countSessionItems.toArray(),db.countTransactions.toArray(),db.movementDrafts.toArray()]);
  const allowedSessions=sessions.filter(s=>canAccessBranch(user,s.branchName)),sessionIds=new Set(allowedSessions.map(s=>s.id));
  const allowedImports=movementImports.filter(i=>canAccessBranch(user,i.branchName)),importIds=new Set(allowedImports.map(i=>i.id));
  const branches=[...new Set(allowedSessions.map(s=>s.branchName).concat(allowedImports.map(i=>i.branchName)))];
  const backupId=crypto.randomUUID(),createdAt=new Date().toISOString();
  return{document:{format:'audit-stock-sharepoint-backup',schemaVersion:1,backupId,createdAt,reason,source:{app:'Audit Stock',deviceId:deviceId(),user:user.username},scope:{type:user.role==='ADMIN'?'AUTHORIZED_ALL_BRANCHES':'AUTHORIZED_BRANCHES',branches,excluded:['auditUsers.password','Microsoft tokens','Firebase credentials','exportRecords.data']},data:{products,allowanceImports:user.role==='ADMIN'?allowanceImports:[],movementImports:allowedImports,movementItems:movementItems.filter(i=>importIds.has(i.movementImportId)),countSessions:allowedSessions,countSessionItems:sessionItems.filter(i=>sessionIds.has(i.sessionId)),countTransactions:transactions.filter(i=>sessionIds.has(i.sessionId)),movementDrafts}},branches,backupId,createdAt};
}
export async function enqueueSharePointBackup(reason='ข้อมูลเปลี่ยนแปลง'){
  if(!isSharePointConfigured())throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ Microsoft');
  const {document,branches,backupId,createdAt}=await buildPayload(reason),stamp=createdAt.replace(/[:.]/g,'-'),branch=branches.length===1?branches[0]:'all-authorized-branches';
  const job:SharePointBackupJob={id:backupId,fileName:`AuditStock_${safePart(branch)}_${safePart(deviceId())}_${stamp}.json`,payload:json(document),reason,branchScope:branches,status:'PENDING',attempts:0,createdAt:new Date(createdAt),nextAttemptAt:new Date()};
  await db.sharePointBackupJobs.put(job);notify();void processSharePointQueue();return job;
}
async function graph(path:string,token:string,init?:RequestInit){const response=await fetch(`${GRAPH}${path}`,{...init,headers:{...init?.headers,Authorization:`Bearer ${token}`}});if(!response.ok){const body=await response.text();if(response.status===401||response.status===403)throw new Error(`MICROSOFT_LOGIN_REQUIRED:${response.status}`);throw new Error(`Microsoft Graph ${response.status}: ${body.slice(0,300)}`)}return response.status===204?undefined:response.json()}
async function destination(token:string){const site=await graph(`/sites/${sharePointConfig.hostName}:${sharePointConfig.sitePath}?$select=id,displayName`,token) as {id:string};const drives=await graph(`/sites/${site.id}/drives?$select=id,name`,token) as {value:Array<{id:string;name:string}>};const drive=drives.value.find(d=>d.name===sharePointConfig.libraryName);if(!drive)throw new Error(`ไม่พบ Document Library: ${sharePointConfig.libraryName}`);await graph(`/drives/${drive.id}/root:/${encodeURIComponent(sharePointConfig.folderName)}?$select=id,name`,token);return drive.id}
export async function testSharePointConnection(){const token=await getGraphToken(),driveId=await destination(token);return{driveId,folder:sharePointConfig.folderName}}
async function upload(job:SharePointBackupJob){const token=await getGraphToken(),driveId=await destination(token),path=[sharePointConfig.folderName,job.fileName].map(encodeURIComponent).join('/');await graph(`/drives/${driveId}/root:/${path}:/content`,token,{method:'PUT',headers:{'Content-Type':'application/json;charset=utf-8'},body:job.payload})}
export async function processSharePointQueue(){if(processing||!navigator.onLine||!isSharePointConfigured())return processing;processing=(async()=>{for(const job of await db.sharePointBackupJobs.where('nextAttemptAt').belowOrEqual(new Date()).sortBy('createdAt')){try{await db.sharePointBackupJobs.update(job.id,{status:'UPLOADING',lastError:undefined});notify();await upload(job);await db.sharePointBackupJobs.delete(job.id);await setSetting(LAST_KEY,new Date().toISOString())}catch(reason){const message=reason instanceof Error?reason.message:'อัปโหลด SharePoint ไม่สำเร็จ',auth=message.includes('MICROSOFT_LOGIN_REQUIRED'),attempts=job.attempts+1;await db.sharePointBackupJobs.update(job.id,{status:auth?'AUTH_REQUIRED':'FAILED',attempts,lastError:auth?'เซสชัน Microsoft หมดอายุ กรุณาเชื่อมต่อใหม่':message,nextAttemptAt:new Date(Date.now()+Math.min(60,2**attempts)*60_000)});if(auth)break}finally{notify()}}})().finally(()=>{processing=undefined;notify()});return processing}
export function initializeSharePointBackup(){if(started)return;started=true;window.addEventListener('online',()=>void processSharePointQueue());window.addEventListener('audit-data-changed',()=>{if(changeTimer)clearTimeout(changeTimer);changeTimer=window.setTimeout(async()=>{if((await setting(AUTO_KEY))===true)void enqueueSharePointBackup('ข้อมูลเปลี่ยนแปลง').catch(()=>{})},15_000)});window.addEventListener('audit-work-completed',()=>void enqueueSharePointBackup('จบงาน').catch(()=>{}));timer=window.setInterval(async()=>{if((await setting(AUTO_KEY))===true){await enqueueSharePointBackup('สำรองตามรอบ 15 นาที').catch(()=>{});void processSharePointQueue()}},15*60_000);void processSharePointQueue()}
