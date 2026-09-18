import {useMemo,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Database,History,Search,Trash2} from 'lucide-react';
import {db} from '../db/database';
import type {ParsedProduct,Product} from '../types';
import {compareAllowance,formatThaiDateTime,parseAllowanceWorkbook} from '../utils/stock';
import {auditRepository} from '../services/auditRepository';
import {AllowanceImportPreview,FileDrop,MatchSummaryCards} from '../components/ImportUI';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {getCurrentUser} from '../services/authService';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';

export default function AllowanceImportPage(){
  const isAdmin=getCurrentUser()?.role==='ADMIN';
  const products=useLiveQuery(()=>db.products.toArray(),[])||[],imports=useLiveQuery(()=>db.allowanceImports.reverse().toArray(),[])||[];
  const [rows,setRows]=useState<ParsedProduct[]>([]),[file,setFile]=useState(''),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[page,setPage]=useState(1),[message,setMessage]=useState(''),[deleteOpen,setDeleteOpen]=useState(false),[deleting,setDeleting]=useState(false);
  const [pageSize,setPageSize]=usePageSize();
  const summary=useMemo(()=>Object.fromEntries(['insert','update','skip','duplicate','invalid'].map(key=>[key,rows.filter(row=>row.status===key).length])),[rows]);
  const filtered=products.filter(product=>(product.productCode.includes(query)||product.productName.toLowerCase().includes(query.toLowerCase()))&&(!category||product.categoryName===category));
  const handleFile=async(input:File)=>{try{setFile(input.name);setRows(compareAllowance(parseAllowanceWorkbook(await input.arrayBuffer()),products));setMessage('ตรวจสอบข้อมูลเรียบร้อยแล้ว กรุณาตรวจ Preview ก่อนยืนยัน')}catch(error){setMessage(error instanceof Error?error.message:'อ่านไฟล์ไม่สำเร็จ')}};
  const save=async()=>{await auditRepository.saveAllowance(file,rows);setRows([]);setMessage('อัปเดต Product Master แล้ว')};
  const clearAllowance=async()=>{try{setDeleting(true);await auditRepository.clearAllowance();setRows([]);setFile('');setQuery('');setCategory('');setPage(1);setDeleteOpen(false);setMessage('ลบข้อมูล Allowance และประวัตินำเข้าเรียบร้อยแล้ว')}catch(error){setMessage(error instanceof Error?error.message:'ไม่สามารถลบข้อมูล Allowance ได้')}finally{setDeleting(false)}};
  return <Page title="ไฟล์ Allowance" subtitle="จัดการข้อมูลสินค้าหลักและตรวจความเปลี่ยนแปลงก่อนบันทึก">
    <div className="allowance-layout">
      <section className="panel import-panel"><h2 className="section-title"><Database/>นำเข้า Product Master</h2><FileDrop label="เลือกไฟล์ Allowance" onFile={handleFile}/>{rows.length>0&&<><div className="section-gap"><MatchSummaryCards items={[{label:'เพิ่มใหม่',value:summary.insert},{label:'อัปเดต',value:summary.update},{label:'เหมือนเดิม',value:summary.skip},{label:'รหัสซ้ำ',value:summary.duplicate,tone:'text-amber-600'},{label:'ไม่ครบ',value:summary.invalid,tone:'text-red-600'}]}/></div><div className="section-gap"><AllowanceImportPreview rows={rows}/></div><button className="btn-primary section-gap full-button" onClick={save}>ยืนยันการอัปเดต</button></>}</section>
      <section className="panel product-panel">
        <div className="panel-heading"><h2 className="section-title">รายการสินค้า <span className="badge">{products.length}</span></h2><div className="desktop-actions">{isAdmin&&<button className="btn-danger-outline" disabled={!products.length||deleting} onClick={()=>setDeleteOpen(true)}><Trash2/>ลบข้อมูล Allowance</button>}</div></div>
        <div className="product-filters"><label className="input-shell"><Search/><span className="sr-only">ค้นหาสินค้า</span><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} placeholder="ค้นหารหัสหรือชื่อสินค้า"/></label><label><span className="sr-only">หมวดสินค้า</span><select className="input" value={category} onChange={event=>{setCategory(event.target.value);setPage(1)}}><option value="">ทุกหมวดสินค้า</option>{[...new Set(products.map(product=>product.categoryName).filter(Boolean))].map(name=><option key={name}>{name}</option>)}</select></label></div>
        <ProductMasterTable products={filtered.slice((page-1)*pageSize,page*pageSize)}/>
        <PageSizeControl total={filtered.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>
      </section>
    </div>
    <section className="panel import-history"><h2 className="section-title"><History/>ประวัติการ Import</h2>{imports.length?<div className="table-scroll" role="region" aria-label="ตารางประวัติการนำเข้า" tabIndex={0}><table><thead><tr><th>ชื่อไฟล์</th><th>วันที่นำเข้า</th><th>เพิ่ม</th><th>อัปเดต</th><th>ข้าม</th><th>ผิดพลาด</th></tr></thead><tbody>{imports.map(item=><tr key={item.id}><td>{item.fileName}</td><td>{formatThaiDateTime(item.importedAt)}</td><td>{item.insertedCount}</td><td>{item.updatedCount}</td><td>{item.skippedCount}</td><td>{item.duplicateCount+item.invalidCount}</td></tr>)}</tbody></table></div>:<Empty text="ยังไม่มีประวัติการนำเข้า"/>}</section>
    {message&&<div className="notice">{message}</div>}
    <ConfirmDialog open={deleteOpen} title="ลบข้อมูล Allowance ทั้งหมด?" detail={`ระบบจะลบสินค้า ${products.length.toLocaleString('th-TH')} รายการและประวัตินำเข้า Allowance แต่จะไม่ลบรอบนับหรือประวัติการนับ การดำเนินการนี้ย้อนกลับไม่ได้ ควรดาวน์โหลด Backup ก่อนดำเนินการ`} onCancel={()=>setDeleteOpen(false)} onConfirm={()=>void clearAllowance()}/>
  </Page>
}

export function ProductMasterTable({products}:{products:Product[]}){
  if(!products.length)return <Empty text="ยังไม่มีข้อมูลสินค้า"/>;
  return <><div className="product-mobile-list">{products.map(product=><article className="mobile-product-card" key={product.productCode}><div><code>{product.productCode}</code><h3>{product.productName}</h3></div><details><summary>ดูรายละเอียด</summary><dl><div><dt>หน่วย</dt><dd>{product.unit||'-'}</dd></div><div><dt>หมวดสินค้า</dt><dd>{product.categoryName||'-'}</dd></div><div><dt>สถานะ</dt><dd><span className="status-counted">พร้อมใช้งาน</span></dd></div></dl></details></article>)}</div><div className="product-desktop-table table-scroll" role="region" aria-label="ตารางรายการสินค้า" tabIndex={0}><table><thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>หน่วย</th><th>หมวดสินค้า</th><th>สถานะ</th></tr></thead><tbody>{products.map(product=><tr key={product.productCode}><td className="font-mono">{product.productCode}</td><td className="font-bold wrap-cell">{product.productName}</td><td>{product.unit}</td><td className="wrap-cell">{product.categoryName||'-'}</td><td><span className="status-counted">พร้อมใช้งาน</span></td></tr>)}</tbody></table></div></>
}

export function Page({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){return <div className="page-shell"><header className="page-header"><p className="eyebrow">AUDIT WORKSPACE</p><h1>{title}</h1><p>{subtitle}</p></header>{children}</div>}
export function Empty({text}:{text:string}){return <div className="empty-state">{text}</div>}
