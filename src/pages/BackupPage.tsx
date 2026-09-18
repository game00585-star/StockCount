import {useState} from 'react';
import {DatabaseBackup, Download} from 'lucide-react';
import {downloadJsonBackup} from '../services/backupService';
import {Page} from './AllowanceImportPage';

export default function BackupPage() {
  const [message, setMessage] = useState('');
  const backup = async () => {
    await downloadJsonBackup();
    setMessage('ดาวน์โหลดไฟล์ Backup JSON เรียบร้อยแล้ว');
  };

  return <Page title="สำรองข้อมูล" subtitle="ดาวน์โหลดข้อมูลระบบเก็บไว้เป็นไฟล์ JSON">
    <section className="panel mx-auto max-w-2xl">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-700"><DatabaseBackup/></span>
        <div>
          <h2 className="text-xl font-black">Backup ข้อมูลทั้งหมด</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">สำรองสินค้า สาขา รอบนับ ประวัติการนับ ผู้ใช้งาน และข้อมูลนำเข้า สามารถดาวน์โหลดได้แม้ขณะออฟไลน์</p>
        </div>
      </div>
      <button className="btn-primary mt-6 w-full" onClick={backup}><Download/>ดาวน์โหลด Backup JSON</button>
      <p className="mt-4 text-xs leading-5 text-amber-700">ไฟล์นี้มีข้อมูลผู้ใช้งาน กรุณาเก็บไว้ในที่ปลอดภัย</p>
      {message && <div className="notice">{message}</div>}
    </section>
  </Page>;
}
