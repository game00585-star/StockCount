import {useMemo,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {useNavigate} from 'react-router-dom';
import {db} from '../db/database';
import type {CountSession,ParsedMovement} from '../types';
import {matchMovementWithProducts,parseMovementWorkbook} from '../utils/stock';
import {auditRepository} from '../services/auditRepository';
import {FileDrop,MatchSummaryCards,MovementImportPreview} from '../components/ImportUI';
import {Page} from './AllowanceImportPage';
import {canAccessBranch, filterSessionsByUser, getCurrentUser} from '../services/authService';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';

const sessionKey='audit-selected-session';
export default function MovementImportPageV2(){
  const products=useLiveQuery(()=>db.products.toArray(),[])||[];
  const currentUser=getCurrentUser();
  const allSessions=(useLiveQuery(()=>db.countSessions.where('status').equals('ACTIVE').toArray(),[])||[]) as CountSession[];
  const sessions=filterSessionsByUser(allSessions,currentUser);
  const [selectedId,setSelectedId]=useState<number|undefined>(()=>Number(localStorage.getItem(sessionKey))||undefined);
  const [creating,setCreating]=useState(false);
  const [rows,setRows]=useState<ParsedMovement[]>([]),[file,setFile]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const [pageSize,setPageSize]=usePageSize();
  const [page,setPage]=useState(1);
  const [form,setForm]=useState({branchName:'',countDate:new Date().toISOString().slice(0,10),auditorName:'',note:''});
  const active=sessions.find(session=>session.id===selectedId);
  const nav=useNavigate();
  const matchedCount=useMemo(()=>rows.filter(row=>row.matched).length,[rows]);
  const selectedCount=useMemo(()=>rows.filter(row=>row.selected&&row.matched).length,[rows]);
  const choose=(session:CountSession)=>{if(!canAccessBranch(currentUser,session.branchName))return;setSelectedId(session.id);localStorage.setItem(sessionKey,String(session.id));setCreating(false);setRows([]);};
  const openStock=(session:CountSession)=>{choose(session);nav('/count');};
  const removeBranch=async(session:CountSession)=>{
    if(!session.id||!confirm(`ลบสาขา ${session.branchName} และข้อมูลการนับทั้งหมดใช่หรือไม่?`))return;
    await auditRepository.deleteSession(session.id);
    if(selectedId===session.id){setSelectedId(undefined);localStorage.removeItem(sessionKey);}
    setMessage(`ลบสาขา ${session.branchName} แล้ว`);
  };
  const updateRows=(updater:(current:ParsedMovement[])=>ParsedMovement[])=>setRows(current=>updater(current));
  const createBranch=async()=>{
    if(currentUser?.role!=='ADMIN'){setMessage('User นี้ไม่มีสิทธิ์สร้างสาขาใหม่');return;}
    if(!form.branchName||!form.auditorName)return;
    try{setSaving(true);const id=await auditRepository.createSession({...form,countDate:new Date(form.countDate)});const session=await db.countSessions.get(id);if(session)choose(session);setMessage(`สร้างสาขา ${form.branchName} แล้ว`);}
    catch(error){setMessage(error instanceof Error?error.message:'สร้างสาขาไม่สำเร็จ');}finally{setSaving(false);}
  };
  const handle=async(input:File)=>{
    try{const parsed=matchMovementWithProducts(parseMovementWorkbook(await input.arrayBuffer()),products);setFile(input.name);setRows(parsed);setPage(1);setMessage(`พบใน Allowance ${parsed.filter(row=>row.matched).length} รายการ`);}
    catch(error){setRows([]);setMessage(error instanceof Error?error.message:'อ่านไฟล์ไม่สำเร็จ');}
  };
  const useAllAllowance=async()=>{
    if(!active?.id)return;
    const activeCount=products.filter(product=>product.isActive).length;
    if(!activeCount){setMessage('ยังไม่มีข้อมูล Allowance กรุณานำเข้าไฟล์ Allowance ก่อน');return;}
    try{
      setSaving(true);
      await auditRepository.useAllowanceForSession(active.id,activeCount);
      localStorage.setItem(sessionKey,String(active.id));
      nav('/count');
      return;
    }catch(error){setMessage(error instanceof Error?error.message:'ไม่สามารถอ้างอิงข้อมูล Allowance ได้');return;}
    finally{setSaving(false);}
    if(!products.length){setMessage('ยังไม่มีข้อมูล Allowance กรุณานำเข้าไฟล์ Allowance ก่อน');return;}
    const allowanceRows:ParsedMovement[]=products.filter(product=>product.isActive).map((product,index)=>({
      row:index+1,
      productCode:product.productCode,
      sourceProductName:product.productName,
      sourceUnit:product.unit,
      matched:true,
      matchReason:'อ้างอิงจาก Allowance',
      product,
      selected:true,
      status:'valid'
    }));
    setFile(`Allowance-${new Date().toISOString().slice(0,10)}.json`);
    setRows(allowanceRows);
    setPage(1);
    setMessage(`อ้างอิงสินค้าจาก Allowance แล้ว ${allowanceRows.length.toLocaleString('th-TH')} รายการ กรุณาตรวจสอบและกดยืนยันนำไปนับสต็อก`);
  };
  const useRows=async()=>{
    if(!active||!selectedCount)return;
    try{setSaving(true);await auditRepository.addMovement(file,rows,active,active.auditorName);localStorage.setItem(sessionKey,String(active.id));nav('/count');}
    catch(error){setMessage(error instanceof Error?error.message:'นำรายการไปนับไม่สำเร็จ');}finally{setSaving(false);}
  };
  if(currentUser?.role!=='ADMIN'&&!sessions.length)return <Page title="ไม่มีสาขาที่ได้รับสิทธิ์" subtitle="ติดต่อผู้ดูแลระบบให้เพิ่มสาขาให้ User นี้"><section className="panel"><p className="text-sm text-slate-600">User <b>{currentUser?.username}</b> ยังไม่ได้รับสิทธิ์เข้าสาขาใดในระบบ</p></section></Page>;
  if(creating||!sessions.length)return <Page title="สร้างสาขาและรอบนับ" subtitle="สร้างได้หลายสาขาและเปิดนับพร้อมกันได้"><section className="panel mx-auto max-w-xl">
    {!!sessions.length&&<button className="btn-secondary mb-4" onClick={()=>setCreating(false)}>กลับไปเลือกสาขา</button>}
    <form onSubmit={event=>{event.preventDefault();void createBranch();}}><div className="grid gap-4">
      <label>ชื่อสาขา<input className="input mt-1" value={form.branchName} onChange={event=>setForm({...form,branchName:event.target.value})} required/></label>
      <label>วันที่ตรวจนับ<input className="input mt-1" type="date" value={form.countDate} onChange={event=>setForm({...form,countDate:event.target.value})} required/></label>
      <label>ชื่อผู้ตรวจนับ<input className="input mt-1" value={form.auditorName} onChange={event=>setForm({...form,auditorName:event.target.value})} required/></label>
      <label>หมายเหตุ<textarea className="input mt-1 min-h-20" value={form.note} onChange={event=>setForm({...form,note:event.target.value})}/></label>
      <button className="btn-primary" disabled={saving}>{saving?'กำลังสร้าง...':'สร้างสาขาและรอบนับ'}</button>
    </div></form></section>{message&&<div className="notice">{message}</div>}</Page>;
  if(!active)return <Page title="เลือกสาขาที่จะใส่ไฟล์เคลื่อนไหว" subtitle="คลิกเข้าสาขาที่ต้องการ หรือสร้างสาขาใหม่"><section className="panel">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{sessions.map(session=><div key={session.id} className="rounded-2xl border border-rose-100 p-3"><button className="w-full rounded-xl p-2 text-left hover:bg-rose-50" onClick={()=>openStock(session)}><b className="block text-lg">{session.branchName}</b><span className="text-xs text-slate-500">{session.sessionNumber}</span><span className="mt-2 block text-sm font-bold text-rose-700">คลิกเพื่อเข้าหน้านับสต็อก</span></button>{currentUser?.role==='ADMIN'&&<button className="mt-2 w-full rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50" onClick={()=>void removeBranch(session)}>ลบสาขา</button>}</div>)}</div>
    {currentUser?.role==='ADMIN'&&<button className="btn-primary mt-5" onClick={()=>setCreating(true)}>+ สร้างสาขาใหม่</button>}
  </section></Page>;
  return <Page title="ไฟล์รายการเคลื่อนไหว" subtitle="เลือกสาขาก่อนอัปโหลด — A = รหัสสินค้า, C = ชื่อสินค้า, D = หน่วยนับ">
    <section className="mb-5 rounded-2xl bg-slate-950 p-4 text-white"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="text-xs text-slate-400">สาขาที่เลือก</span><b className="block text-lg">{active.branchName}</b><span className="text-xs text-slate-300">{active.sessionNumber} · {active.auditorName}</span></div><button className="btn-secondary" onClick={()=>{setSelectedId(undefined);localStorage.removeItem(sessionKey);setRows([]);}}>เปลี่ยน/เพิ่มสาขา</button></div></section>
    <section className="panel"><FileDrop label={`เลือกไฟล์รายการเคลื่อนไหวของ ${active.branchName}`} onFile={handle}/><div className="movement-allowance-fallback"><div><b>ไม่มีไฟล์รายการเคลื่อนไหว?</b><p>ใช้สินค้าทุกรายการที่พร้อมใช้งานจากไฟล์ Allowance แทนได้</p></div><button type="button" className="btn-secondary" disabled={!products.length||saving} onClick={useAllAllowance}>อ้างอิงสินค้าทั้งหมดจาก Allowance ({products.filter(product=>product.isActive).length.toLocaleString('th-TH')})</button></div>{rows.length>0&&<>
      <div className="mt-5"><MatchSummaryCards items={[{label:'ทั้งหมด',value:rows.length},{label:'พบ Allowance',value:matchedCount},{label:'เลือกไปนับ',value:selectedCount,tone:'text-rose-700'}]}/></div>
      <div className="mt-5 flex flex-wrap gap-2"><button className="btn-quiet" onClick={()=>updateRows(current=>current.map(row=>({...row,selected:!!row.matched})))}>เลือกทั้งหมด ({matchedCount})</button><button className="btn-quiet" onClick={()=>updateRows(current=>current.map(row=>({...row,selected:false})))}>ยกเลิกทั้งหมด</button></div>
      <div className="mt-4"><MovementImportPreview rows={rows.slice((page-1)*pageSize,page*pageSize)} onToggle={index=>{const absoluteIndex=(page-1)*pageSize+index;updateRows(current=>current.map((row,rowIndex)=>rowIndex===absoluteIndex&&row.matched?{...row,selected:!row.selected}:row))}}/></div>
      <PageSizeControl total={rows.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>
      <button className="btn-primary mt-4 w-full" disabled={!selectedCount||saving} onClick={()=>void useRows()}>{saving?'กำลังนำรายการเข้า...':`นำรายการไปนับที่ ${active.branchName} (${selectedCount})`}</button>
    </>}</section>{message&&<div className="notice">{message}</div>}
  </Page>;
}
