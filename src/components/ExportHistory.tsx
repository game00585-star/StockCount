import {useLiveQuery} from 'dexie-react-hooks';
import {Download, FileClock} from 'lucide-react';
import {db} from '../db/database';
import {canAccessBranch, getCurrentUser} from '../services/authService';
import {downloadExportRecord} from '../services/exportService';
import {formatThaiDateTime} from '../utils/stock';

export function ExportHistory() {
  const currentUser = getCurrentUser();
  const allRecords = useLiveQuery(() => db.exportRecords.orderBy('createdAt').reverse().limit(50).toArray(), []) || [];
  const records = allRecords.filter(record => !record.branchName || canAccessBranch(currentUser, record.branchName)).slice(0, 20);

  return <section className="panel">
    <h2 className="section-title"><FileClock/>ประวัติไฟล์ Export</h2>
    {records.length ? records.map(record =>
      <div key={record.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
        <div className="min-w-0">
          <b className="block truncate text-sm">{record.fileName}</b>
          <span className="text-xs text-slate-500">{record.branchName || 'รายการไม่พบ'} · {formatThaiDateTime(record.createdAt)}</span>
        </div>
        <button className="icon-btn shrink-0" aria-label={`ดาวน์โหลด ${record.fileName}`} onClick={() => downloadExportRecord(record)}><Download size={18}/></button>
      </div>
    ) : <p className="text-sm text-slate-500">ยังไม่มีไฟล์ Export</p>}
  </section>;
}
