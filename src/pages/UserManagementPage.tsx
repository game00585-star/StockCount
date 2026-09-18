import {type FormEvent, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Trash2, UserPlus} from 'lucide-react';
import {db} from '../db/database';
import {getCurrentUser} from '../services/authService';
import {queueFirestoreSync} from '../services/firebaseSync';
import {Empty, Page} from './AllowanceImportPage';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';

export default function UserManagementPage() {
  const currentUser = getCurrentUser();
  const users = useLiveQuery(() => db.auditUsers.orderBy('username').toArray(), []) || [];
  const sessions = useLiveQuery(() => db.countSessions.toArray(), []) || [];
  const branches = useMemo(() => [...new Set(sessions.map(session => session.branchName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')), [sessions]);
  const [form, setForm] = useState({username: '', password: '', displayName: '', role: 'USER', allowedBranches: ''});
  const [message, setMessage] = useState('');
  const [pageSize,setPageSize]=usePageSize();
  const [page,setPage]=useState(1);

  if (currentUser?.role !== 'ADMIN') {
    return <Page title="ผู้ใช้งาน" subtitle="เฉพาะผู้ดูแลระบบเท่านั้น">
      <section className="panel"><Empty text="User นี้ไม่มีสิทธิ์จัดการผู้ใช้งาน"/></section>
    </Page>;
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const now = new Date();
    const allowedBranches = form.role === 'ADMIN'
      ? ['*']
      : form.allowedBranches.split(',').map(branch => branch.trim()).filter(Boolean);

    if (!allowedBranches.length) {
      setMessage('กรุณาระบุสาขาอย่างน้อย 1 สาขา');
      return;
    }

    const old = await db.auditUsers.where('username').equals(form.username.trim()).first();
    if (old?.id) {
      await db.auditUsers.update(old.id, {
        password: form.password,
        displayName: form.displayName || form.username,
        role: form.role as 'ADMIN' | 'USER',
        allowedBranches,
        isActive: true,
        updatedAt: now
      });
      setMessage(`อัปเดต User ${form.username} แล้ว`);
    } else {
      await db.auditUsers.add({
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName || form.username,
        role: form.role as 'ADMIN' | 'USER',
        allowedBranches,
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
      setMessage(`สร้าง User ${form.username} แล้ว`);
    }
    queueFirestoreSync(['auditUsers']);
    setForm({username: '', password: '', displayName: '', role: 'USER', allowedBranches: ''});
  };

  const remove = async (id?: number) => {
    if (!id || !confirm('ลบ User นี้ใช่หรือไม่?')) return;
    await db.auditUsers.delete(id);
    queueFirestoreSync(['auditUsers']);
  };

  return <Page title="ผู้ใช้งาน" subtitle="กำหนด User, Password และสาขาที่อนุญาตให้เข้าใช้งาน">
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
      <section className="panel">
        <h2 className="section-title"><UserPlus/>เพิ่ม / แก้ไข User</h2>
        <form className="grid gap-4" onSubmit={save}>
          <label>User<input className="input mt-1" value={form.username} onChange={event => setForm({...form, username: event.target.value})} required/></label>
          <label>Password<input className="input mt-1" value={form.password} onChange={event => setForm({...form, password: event.target.value})} required/></label>
          <label>ชื่อผู้ใช้งาน<input className="input mt-1" value={form.displayName} onChange={event => setForm({...form, displayName: event.target.value})}/></label>
          <label>สิทธิ์
            <select className="input mt-1" value={form.role} onChange={event => setForm({...form, role: event.target.value})}>
              <option value="USER">User เห็นเฉพาะสาขาที่กำหนด</option>
              <option value="ADMIN">Admin เห็นทุกสาขา</option>
            </select>
          </label>
          <label>สาขาที่เข้าได้
            <input className="input mt-1" value={form.allowedBranches} onChange={event => setForm({...form, allowedBranches: event.target.value})} placeholder="เช่น ร้อยเอ็ด, ขอนแก่น"/>
            <span className="mt-1 block text-xs text-slate-500">ถ้ามีหลายสาขาให้คั่นด้วย comma เช่น ร้อยเอ็ด, ขอนแก่น — User หลายคนใส่สาขาเดียวกันได้</span>
          </label>
          {!!branches.length && <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
            สาขาที่มีในระบบ: {branches.join(', ')}
          </div>}
          <button className="btn-primary">บันทึก User</button>
        </form>
        {message && <div className="notice mt-4">{message}</div>}
      </section>

      <section className="panel">
        <h2 className="section-title">รายการ User</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>ชื่อ</th><th>สิทธิ์</th><th>สาขาที่เห็น</th><th></th></tr></thead>
            <tbody>{users.slice((page-1)*pageSize,page*pageSize).map(user => <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.displayName}</td>
              <td>{user.role}</td>
              <td>{user.allowedBranches.includes('*') ? 'ทุกสาขา' : user.allowedBranches.join(', ')}</td>
              <td><button className="icon-btn" onClick={() => void remove(user.id)}><Trash2 size={16}/></button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <PageSizeControl total={users.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>
      </section>
    </div>
  </Page>;
}
