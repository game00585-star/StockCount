import {useRef,useState} from 'react';
import {DatabaseBackup,Download,FileJson,RefreshCw,Upload} from 'lucide-react';
import {backupTableNames,downloadJsonBackup,readBackupFile,restoreBackup,type BackupPreview} from '../services/backupService';
import {getCurrentUser} from '../services/authService';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {Page} from './AllowanceImportPage';

const labels:Record<string,string>={products:'สินค้า',allowanceImports:'ประวัตินำเข้า Allowance',movementImports:'ไฟล์รายการเคลื่อนไหว',movementItems:'รายการเคลื่อนไหว',countSessions:'รอบนับ',countSessionItems:'สินค้าในรอบนับ',countTransactions:'ประวัติการนับ',movementDrafts:'ฉบับร่างนำเข้า',auditUsers:'ผู้ใช้งาน',exportRecords:'ประวัติ Export'};

export default function BackupPage(){
  const user=getCurrentUser(),isAdmin=user?.role==='ADMIN',inputRef=useRef<HTMLInputElement>(null);
  const [preview,setPreview]=useState<BackupPreview>(),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  const backup=async()=>{try{setBusy(true);setError('');await downloadJsonBackup();setMessage('ดาวน์โหลด Backup JSON เรียบร้อยแล้ว')}catch(reason){setError(reason instanceof Error?reason.message:'ไม่สามารถสำรองข้อมูลได้')}finally{setBusy(false)}};
  const choose=async(file?:File)=>{setPreview(undefined);setMessage('');setError('');if(!file)return;try{setBusy(true);setPreview(await readBackupFile(file))}catch(reason){setError(reason instanceof Error?reason.message:'ไม่สามารถอ่านไฟล์ Backup ได้')}finally{setBusy(false)}};
  const restore=async()=>{if(!preview)return;try{setBusy(true);setError('');setConfirm(false);await restoreBackup(preview);setMessage('กู้คืนข้อมูลแล้ว กำลังโหลดข้อมูลใหม่');window.setTimeout(()=>window.location.reload(),700)}catch(reason){setError(reason instanceof Error?reason.message:'การกู้คืนล้มเหลว ข้อมูลเดิมยังคงอยู่');setBusy(false)}};
  return <Page title="สำรองและกู้คืนข้อมูล" subtitle="ดาวน์โหลดข้อมูลทั้งหมด หรือกู้คืนระบบจากไฟล์ Backup JSON">
    <div className="backup-grid">
      <section className="panel backup-card"><span className="backup-icon"><DatabaseBackup/></span><div><h2 className="section-title">สำรองข้อมูล</h2><p>เก็บสินค้า สาขา รอบนับ ประวัติการนับ ผู้ใช้งาน ข้อมูลนำเข้า และประวัติ Export ไว้ในไฟล์เดียว</p></div><button className="btn-primary full-button" disabled={busy} onClick={backup}>{busy?<RefreshCw className="animate-spin"/>:<Download/>}{busy?'กำลังดำเนินการ...':'ดาวน์โหลด Backup JSON'}</button></section>
      <section className="panel backup-card"><span className="backup-icon"><Upload/></span><div><h2 className="section-title">กู้คืนข้อมูล</h2><p>เลือกไฟล์ที่ระบบ Audit Stock ส่งออก ระบบจะตรวจสอบข้อมูลทั้งหมดก่อนเขียนกลับ</p></div>
        {!isAdmin&&<div className="backup-warning" role="alert">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่กู้คืนข้อมูลได้</div>}
        <input ref={inputRef} className="sr-only" type="file" accept="application/json,.json" disabled={!isAdmin||busy} onChange={event=>void choose(event.target.files?.[0])}/>
        <button className="btn-secondary full-button" disabled={!isAdmin||busy} onClick={()=>inputRef.current?.click()}><FileJson/>เลือกไฟล์ Backup JSON</button>
        {preview&&<div className="backup-preview"><h3>ตรวจพบ Backup ที่รองรับ</h3><dl><div><dt>ชื่อไฟล์</dt><dd>{preview.fileName}</dd></div><div><dt>วันที่สำรอง</dt><dd>{preview.document.exportedAt?new Date(preview.document.exportedAt).toLocaleString('th-TH'):'ไม่ระบุ'}</dd></div><div><dt>รุ่นไฟล์</dt><dd>{preview.document.version}</dd></div></dl><div className="backup-counts">{backupTableNames.map(name=><div key={name}><span>{labels[name]}</span><strong>{preview.counts[name].toLocaleString('th-TH')}</strong></div>)}</div><p className="backup-danger">ระบบจะสำรองข้อมูลปัจจุบันก่อนเริ่มกู้คืน และจะไม่เขียนทับรายการที่มีรหัสเดิมอยู่แล้ว</p></div>}
        <button className="btn-danger full-button" disabled={!isAdmin||!preview||busy} onClick={()=>setConfirm(true)}><Upload/>กู้คืนข้อมูล</button>
      </section>
    </div>
    {message&&<div className="notice" role="status">{message}</div>}{error&&<div className="error-notice" role="alert">{error}</div>}
    <ConfirmDialog open={confirm} title="ยืนยันการกู้คืนข้อมูล?" detail="ระบบจะดาวน์โหลดข้อมูลปัจจุบันก่อน แล้วเพิ่มข้อมูลจากไฟล์โดยไม่เขียนทับรายการรหัสเดิม" onCancel={()=>setConfirm(false)} onConfirm={()=>void restore()}/>
  </Page>
}
