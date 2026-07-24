import {useMemo,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Download,History,Plus,Search,Trash2} from 'lucide-react';
import {db} from '../db/database';
import type {CountSessionItem} from '../types';
import {auditRepository} from '../services/auditRepository';
import {exportCountSession} from '../services/exportService';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {Toast} from '../components/Toast';
import {ExportHistory} from '../components/ExportHistory';
import {CountHistoryDrawer,CountStepModal,ProductCountCard,RecentCountHistory,StockCountHeader} from '../components/CountUI';
import {Empty,Page} from './AllowanceImportPage';

const UNCATEGORIZED = 'ไม่ระบุหมวด';

export default function StockCountPage(){
  const selectedSessionId = Number(localStorage.getItem('audit-selected-session')) || undefined;
  const session = useLiveQuery(
    () => selectedSessionId ? db.countSessions.get(selectedSessionId) : db.countSessions.where('status').equals('ACTIVE').last(),
    [selectedSessionId]
  );
  const items = useLiveQuery(
    () => session?.id ? db.countSessionItems.where('sessionId').equals(session.id).toArray() : [],
    [session?.id]
  ) || [];
  const transactions = useLiveQuery(
    () => session?.id ? db.countTransactions.where('sessionId').equals(session.id).toArray() : [],
    [session?.id]
  ) || [];
  const products = useLiveQuery(() => db.products.toArray(), []) || [];

  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('all');
  const [category,setCategory] = useState('all');
  const [sort,setSort] = useState('category');
  const [selected,setSelected] = useState<CountSessionItem>();
  const [history,setHistory] = useState<CountSessionItem>();
  const [clear,setClear] = useState(false);
  const [toast,setToast] = useState('');

  const productByCode = useMemo(() => new Map(products.map(p => [p.productCode, p])), [products]);
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => set.add(productByCode.get(item.productCode)?.categoryName || UNCATEGORIZED));
    return [...set].sort((a,b) => a.localeCompare(b, 'th'));
  }, [items, productByCode]);

  const rows = useMemo(() => items.map(item => {
    const product = productByCode.get(item.productCode);
    const categoryName = product?.categoryName || UNCATEGORIZED;
    const tx = transactions.filter(t => t.productCode === item.productCode);
    const total = tx.reduce((sum,t) => sum + t.signedQuantity, 0);
    const latest = [...tx].sort((a,b) => +new Date(b.countedAt) - +new Date(a.countedAt))[0];
    return {item, categoryName, tx, total, latest};
  }).filter(row => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return [row.item.productCode, row.item.productNameSnapshot, row.categoryName]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  }).filter(row => category === 'all' || row.categoryName === category)
    .filter(row =>
      filter === 'all' ||
      (filter === 'new' && !row.latest) ||
      (filter === 'counted' && !!row.latest) ||
      (filter === 'zero' && !!row.latest && row.total === 0) ||
      (filter === 'negative' && row.total < 0)
    ).sort((a,b) => {
      if (sort === 'uncounted') return Number(!!a.latest) - Number(!!b.latest);
      if (sort === 'latest') return +new Date(b.latest?.countedAt || 0) - +new Date(a.latest?.countedAt || 0);
      if (sort === 'za') return b.item.productNameSnapshot.localeCompare(a.item.productNameSnapshot, 'th');
      if (sort === 'az') return a.item.productNameSnapshot.localeCompare(b.item.productNameSnapshot, 'th');
      return a.categoryName.localeCompare(b.categoryName, 'th') || a.item.productNameSnapshot.localeCompare(b.item.productNameSnapshot, 'th');
    }), [items, transactions, productByCode, query, category, filter, sort]);

  if (!session) {
    return <Page title="นับสต็อก" subtitle="สร้างสาขาและรอบนับจากเมนูไฟล์รายการเคลื่อนไหวก่อน">
      <section className="panel"><Empty text="ยังไม่มีรอบนับที่กำลังใช้งาน กรุณาสร้างสาขาก่อนนำเข้าไฟล์รายการเคลื่อนไหว"/></section>
      <div className="mt-5"><ExportHistory/></div>
    </Page>;
  }

  const save = async(v:{action:'ADD'|'SUBTRACT';quantity:number;note:string}) => {
    const item = selected!;
    const tx = transactions.filter(t => t.productCode === item.productCode);
    const old = tx.reduce((sum,t) => sum + t.signedQuantity, 0);
    const signed = v.action === 'ADD' ? v.quantity : -v.quantity;
    await auditRepository.addTransaction({
      sessionId: session.id!,
      productCode: item.productCode,
      productNameSnapshot: item.productNameSnapshot,
      action: v.action,
      quantity: v.quantity,
      signedQuantity: signed,
      previousTotal: old,
      newTotal: old + signed,
      note: v.note,
      countedAt: new Date(),
      countedBy: session.auditorName
    });
    setSelected(undefined);
    setToast('บันทึกรายการสำเร็จ');
    setTimeout(() => setToast(''), 2500);
  };

  const doExport = async() => {
    await exportCountSession(session, items, transactions);
    setToast('บันทึกไฟล์ลงประวัติและดาวน์โหลดแล้ว');
    setTimeout(() => setToast(''), 2500);
  };

  return <Page title="นับสต็อก" subtitle="เลือกสาขา ค้นหมวดหมู่ แล้วแตะรายการเพื่อบันทึกยอด">
    <StockCountHeader session={session} total={items.length} counted={new Set(transactions.map(t => t.productCode)).size}/>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <section className="panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_150px_170px]">
          <label className="input-shell"><Search/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาชื่อสินค้า / รหัสสินค้า / หมวดหมู่"/></label>
          <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="all">ทุกหมวดหมู่</option>
            {categories.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="input" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">ทั้งหมด</option>
            <option value="new">ยังไม่นับ</option>
            <option value="counted">นับแล้ว</option>
            <option value="zero">ยอดเป็นศูนย์</option>
            <option value="negative">ยอดติดลบ</option>
          </select>
          <select className="input" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="category">เรียงตามหมวดหมู่</option>
            <option value="uncounted">ยังไม่นับก่อน</option>
            <option value="latest">นับล่าสุด</option>
            <option value="az">ชื่อสินค้า ก-ฮ</option>
            <option value="za">ชื่อสินค้า ฮ-ก</option>
          </select>
        </div>

        <div className="stock-table mt-5">
          <div className="stock-table-head"><span>สินค้า / หมวดหมู่</span><span>สถานะ / ยอดนับ</span></div>
          <div className="grid gap-0">
            {rows.map(row => <div key={row.item.productCode} className="relative">
              <ProductCountCard item={row.item} categoryName={row.categoryName} transactions={row.tx} onClick={() => setSelected(row.item)}/>
              {row.latest && <button aria-label="ดูประวัติ" className="absolute bottom-3 left-3 rounded-lg p-2 text-slate-400 hover:bg-slate-100" onClick={() => setHistory(row.item)}><History size={17}/></button>}
            </div>)}
          </div>
        </div>
        {!rows.length && <Empty text="ไม่พบสินค้าตามเงื่อนไข"/>}
      </section>

      <aside className="space-y-5">
        <section className="panel">
          <h2 className="section-title">จัดการรอบนับ</h2>
          <div className="grid gap-2">
            <button className="btn-primary" onClick={doExport}><Download/>Export Excel</button>
            <button className="btn-secondary" onClick={() => document.getElementById('recent')?.scrollIntoView({behavior:'smooth'})}><History/>ดูประวัติการนับ</button>
            <button className="btn-secondary" onClick={() => location.assign('/movement')}><Plus/>เริ่มรอบนับใหม่</button>
            <button className="btn-danger-outline" onClick={() => setClear(true)}><Trash2/>ล้างข้อมูลรอบปัจจุบัน</button>
          </div>
        </section>
        <ExportHistory/>
        <div id="recent"><RecentCountHistory transactions={transactions}/></div>
      </aside>
    </div>

    {selected && <CountStepModal item={selected} transactions={transactions.filter(t => t.productCode === selected.productCode)} auditor={session.auditorName} onClose={() => setSelected(undefined)} onSave={save}/>}
    {history && <CountHistoryDrawer item={history} transactions={transactions.filter(t => t.productCode === history.productCode)} onClose={() => setHistory(undefined)}/>}
    <ConfirmDialog open={clear} title="ล้างข้อมูลรอบปัจจุบัน?" detail="รายการสินค้าและประวัติการนับในรอบนี้จะถูกลบ การกระทำนี้ย้อนกลับไม่ได้" onCancel={() => setClear(false)} onConfirm={async() => {await auditRepository.clearSession(session.id!);setClear(false);setToast('ล้างข้อมูลรอบปัจจุบันแล้ว')}}/>
    <Toast message={toast}/>
  </Page>;
}

export function ExportExcelButton(){return null}
