import {useMemo,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {CalendarDays,Download,FileClock,ShieldCheck,Trash2,UserRound} from 'lucide-react';
import {db} from '../db/database';
import type {CountSession} from '../types';
import {canAccessBranch,getCurrentUser} from '../services/authService';
import {auditRepository} from '../services/auditRepository';
import {downloadExportRecord,exportCountSession} from '../services/exportService';
import {Page,Empty} from './AllowanceImportPage';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';
import {resolveSessionItems} from '../services/sessionItems';

export default function CountHistoryPage(){
 const user=getCurrentUser();
 const all=useLiveQuery(()=>db.countSessions.where('status').equals('CLOSED').reverse().sortBy('updatedAt'),[])||[];
 const sessions=all.filter(s=>canAccessBranch(user,s.branchName));
 const[selectedId,setSelectedId]=useState<number>();
 const[deleteTarget,setDeleteTarget]=useState<CountSession>();
 const[credentials,setCredentials]=useState({username:user?.username||'',password:''});
 const[deleteError,setDeleteError]=useState('');
 const[deleting,setDeleting]=useState(false);
 const[message,setMessage]=useState('');
 const[pageSize,setPageSize]=usePageSize();
 const[sessionPage,setSessionPage]=useState(1);
 const[detailPage,setDetailPage]=useState(1);
 const selected=sessions.find(s=>s.id===selectedId);
 const storedItems=useLiveQuery(()=>selectedId?db.countSessionItems.where('sessionId').equals(selectedId).toArray():[],[selectedId])||[];
 const products=useLiveQuery(()=>db.products.toArray(),[])||[];
 const items=useMemo(()=>resolveSessionItems(selected,storedItems,products),[selected,storedItems,products]);
 const transactions=useLiveQuery(()=>selectedId?db.countTransactions.where('sessionId').equals(selectedId).toArray():[],[selectedId])||[];
 const exports=useLiveQuery(()=>selectedId?db.exportRecords.where('sessionId').equals(selectedId).reverse().sortBy('createdAt'):[],[selectedId])||[];
 const transactionsByCode=useMemo(()=>{const map=new Map<string,typeof transactions>();transactions.forEach(transaction=>{const group=map.get(transaction.productCode);if(group)group.push(transaction);else map.set(transaction.productCode,[transaction])});return map},[transactions]);
 const rows=useMemo(()=>items.map(item=>{const tx=transactionsByCode.get(item.productCode)||[],ordered=[...tx].sort((a,b)=>+new Date(b.countedAt)-+new Date(a.countedAt));return{item,total:tx.reduce((sum,t)=>sum+t.signedQuantity,0),attempts:tx.length,last:ordered[0]}}),[items,transactionsByCode]);
 const download=async(session:CountSession)=>{const existing=exports[0];if(existing)return downloadExportRecord(existing);await exportCountSession(session,items,transactions)};
 const openDelete=(session:CountSession)=>{setDeleteTarget(session);setCredentials({username:user?.username||'',password:''});setDeleteError('')};
 const closeDelete=()=>{if(deleting)return;setDeleteTarget(undefined);setCredentials({username:user?.username||'',password:''});setDeleteError('')};
 const confirmDelete=async(event:React.FormEvent)=>{
  event.preventDefault();
  if(!deleteTarget?.id)return;
  setDeleting(true);setDeleteError('');
  try{
   await auditRepository.deleteClosedSession(deleteTarget.id,credentials.username,credentials.password);
   if(selectedId===deleteTarget.id)setSelectedId(undefined);
   setMessage(`ลบประวัติการนับของสาขา ${deleteTarget.branchName} แล้ว`);
   setDeleteTarget(undefined);setCredentials({username:user?.username||'',password:''});
  }catch(error){setDeleteError(error instanceof Error?error.message:'ลบประวัติไม่สำเร็จ')}
  finally{setDeleting(false)}
 };
 return <Page title="ประวัติการนับสินค้า" subtitle="รอบนับที่จบงานแล้ว ดูรายละเอียด ดาวน์โหลด Excel หรือลบด้วยบัญชีที่มีสิทธิ์"><div className="history-layout">
  <section className="panel"><h2 className="section-title"><FileClock/>รอบนับที่จบงานแล้ว</h2>{sessions.length?<>{sessions.slice((sessionPage-1)*pageSize,sessionPage*pageSize).map(session=><button key={session.id} className={`history-session-card ${selectedId===session.id?'history-session-active':''}`} onClick={()=>{setSelectedId(session.id);setDetailPage(1)}}><b>{session.branchName}</b><span><CalendarDays/> {new Date(session.countDate).toLocaleDateString('th-TH')}</span><span><UserRound/> {session.auditorName}</span><small>{session.sessionNumber}</small></button>)}<PageSizeControl total={sessions.length} page={sessionPage} setPage={setSessionPage} pageSize={pageSize} setPageSize={setPageSize}/></>:<Empty text="ยังไม่มีประวัติการนับที่จบงาน"/>}</section>
  <section className="panel history-detail">{selected?<><div className="history-detail-head"><div><p className="eyebrow">COMPLETED COUNT</p><h2>{selected.branchName}</h2><p><CalendarDays/> {new Date(selected.countDate).toLocaleDateString('th-TH')} <UserRound/> {selected.auditorName}</p></div><div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={()=>void download(selected)}><Download/>ดาวน์โหลด Excel</button><button className="btn-danger-outline" onClick={()=>openDelete(selected)}><Trash2/>ลบประวัติ</button></div></div><div className="history-summary"><div><span>สินค้า</span><b>{items.length}</b></div><div><span>นับแล้ว</span><b>{new Set(transactions.map(t=>t.productCode)).size}</b></div><div><span>รายการบันทึก</span><b>{transactions.length}</b></div></div><div className="history-product-list">{rows.slice((detailPage-1)*pageSize,detailPage*pageSize).map(row=><div key={row.item.id}><div><code>{row.item.productCode}</code><b>{row.item.productNameSnapshot}</b><span>{row.item.unitSnapshot} · บันทึก {row.attempts} ครั้ง{row.last?` · ล่าสุด ${new Date(row.last.countedAt).toLocaleString('th-TH')}`:''}</span></div><strong>{row.total.toLocaleString('th-TH',{maximumFractionDigits:3})}</strong></div>)}</div><PageSizeControl total={rows.length} page={detailPage} setPage={setDetailPage} pageSize={pageSize} setPageSize={setPageSize}/></>:<Empty text="เลือกรอบนับเพื่อดูรายละเอียด"/>}</section>
 </div>{message&&<div className="notice">{message}</div>}{deleteTarget&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-history-title"><form className="modal-card count-modal-card" onSubmit={confirmDelete}><div className="backup-icon"><ShieldCheck/></div><h2 id="delete-history-title" className="mt-4 text-xl font-black">ยืนยันลบประวัติการนับ</h2><p className="mt-2 text-slate-600">กำลังลบรอบ <b>{deleteTarget.sessionNumber}</b> ของสาขา <b>{deleteTarget.branchName}</b></p><p className="backup-danger mt-4">ข้อมูลการนับและไฟล์ Excel ของรอบนี้จะถูกลบและไม่สามารถย้อนกลับได้ ต้องใช้บัญชี Admin หรือบัญชีผู้ใช้ที่ได้รับสิทธิ์สาขานี้</p><div className="mt-4 grid gap-4"><label>Username<input className="input mt-1" value={credentials.username} onChange={event=>setCredentials({...credentials,username:event.target.value})} autoComplete="username" required disabled={deleting}/></label><label>Password<input className="input mt-1" type="password" value={credentials.password} onChange={event=>setCredentials({...credentials,password:event.target.value})} autoComplete="current-password" required disabled={deleting}/></label></div>{deleteError&&<p className="backup-danger mt-4" role="alert">{deleteError}</p>}<div className="modal-actions grid grid-cols-2 gap-2"><button type="button" className="btn-secondary" onClick={closeDelete} disabled={deleting}>ยกเลิก</button><button type="submit" className="btn-danger" disabled={deleting}>{deleting?'กำลังลบ...':'ยืนยันลบประวัติ'}</button></div></form></div>}</Page>
}
