import {useMemo,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {CalendarDays,Download,FileClock,UserRound} from 'lucide-react';
import {db} from '../db/database';
import type {CountSession} from '../types';
import {canAccessBranch,getCurrentUser} from '../services/authService';
import {downloadExportRecord,exportCountSession} from '../services/exportService';
import {Page,Empty} from './AllowanceImportPage';

export default function CountHistoryPage(){
 const user=getCurrentUser();
 const all=useLiveQuery(()=>db.countSessions.where('status').equals('CLOSED').reverse().sortBy('updatedAt'),[])||[];
 const sessions=all.filter(s=>canAccessBranch(user,s.branchName));
 const[selectedId,setSelectedId]=useState<number>();
 const selected=sessions.find(s=>s.id===selectedId);
 const items=useLiveQuery(()=>selectedId?db.countSessionItems.where('sessionId').equals(selectedId).toArray():[],[selectedId])||[];
 const transactions=useLiveQuery(()=>selectedId?db.countTransactions.where('sessionId').equals(selectedId).toArray():[],[selectedId])||[];
 const exports=useLiveQuery(()=>selectedId?db.exportRecords.where('sessionId').equals(selectedId).reverse().sortBy('createdAt'):[],[selectedId])||[];
 const rows=useMemo(()=>items.map(item=>{const tx=transactions.filter(t=>t.productCode===item.productCode),ordered=[...tx].sort((a,b)=>+new Date(b.countedAt)-+new Date(a.countedAt));return{item,total:tx.reduce((sum,t)=>sum+t.signedQuantity,0),attempts:tx.length,last:ordered[0]}}),[items,transactions]);
 const download=async(session:CountSession)=>{const existing=exports[0];if(existing)return downloadExportRecord(existing);await exportCountSession(session,items,transactions)};
 return <Page title="ประวัติการนับสินค้า" subtitle="รอบนับที่จบงานแล้ว พร้อมรายละเอียดและไฟล์ Excel ย้อนหลัง"><div className="history-layout">
  <section className="panel"><h2 className="section-title"><FileClock/>รอบนับที่จบงานแล้ว</h2>{sessions.length?sessions.map(session=><button key={session.id} className={`history-session-card ${selectedId===session.id?'history-session-active':''}`} onClick={()=>setSelectedId(session.id)}><b>{session.branchName}</b><span><CalendarDays/> {new Date(session.countDate).toLocaleDateString('th-TH')}</span><span><UserRound/> {session.auditorName}</span><small>{session.sessionNumber}</small></button>):<Empty text="ยังไม่มีประวัติการนับที่จบงาน"/>}</section>
  <section className="panel history-detail">{selected?<><div className="history-detail-head"><div><p className="eyebrow">COMPLETED COUNT</p><h2>{selected.branchName}</h2><p><CalendarDays/> {new Date(selected.countDate).toLocaleDateString('th-TH')} <UserRound/> {selected.auditorName}</p></div><button className="btn-primary" onClick={()=>void download(selected)}><Download/>ดาวน์โหลด Excel</button></div><div className="history-summary"><div><span>สินค้า</span><b>{items.length}</b></div><div><span>นับแล้ว</span><b>{new Set(transactions.map(t=>t.productCode)).size}</b></div><div><span>รายการบันทึก</span><b>{transactions.length}</b></div></div><div className="history-product-list">{rows.map(row=><div key={row.item.id}><div><code>{row.item.productCode}</code><b>{row.item.productNameSnapshot}</b><span>{row.item.unitSnapshot} · บันทึก {row.attempts} ครั้ง{row.last?` · ล่าสุด ${new Date(row.last.countedAt).toLocaleString('th-TH')}`:''}</span></div><strong>{row.total.toLocaleString('th-TH',{maximumFractionDigits:3})}</strong></div>)}</div></>:<Empty text="เลือกรอบนับเพื่อดูรายละเอียด"/>}</section>
 </div></Page>
}
