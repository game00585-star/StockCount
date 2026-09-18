import {useMemo,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {useEffect,useRef} from 'react';
import {BrowserMultiFormatReader,type IScannerControls} from '@zxing/browser';
import {Camera,CheckCircle2,Download,History,Plus,Search,Trash2,X} from 'lucide-react';
import {db} from '../db/database';
import type {CountSessionItem} from '../types';
import {auditRepository} from '../services/auditRepository';
import {exportCountSession} from '../services/exportService';
import {downloadJsonBackup} from '../services/backupService';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {Toast} from '../components/Toast';
import {ExportHistory} from '../components/ExportHistory';
import {CountHistoryDrawer,CountStepModal,ProductCountCard,RecentCountHistory,StockCountHeader} from '../components/CountUI';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';
import {Empty,Page} from './AllowanceImportPage';
import {canAccessBranch, filterSessionsByUser, getCurrentUser} from '../services/authService';
import {resolveSessionItems} from '../services/sessionItems';

const UNCATEGORIZED = 'ไม่ระบุหมวด';
const normalizeCode = (value: unknown) => String(value ?? '').trim();
const normalizeText = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const getItemCategory = (item: CountSessionItem) => {
  const looseItem = item as CountSessionItem & {
    categoryName?: string;
    categoryNameSnapshot?: string;
    category?: string;
  };
  return looseItem.categoryNameSnapshot || looseItem.categoryName || looseItem.category || '';
};

export default function StockCountPage(){
  const currentUser = getCurrentUser();
  const selectedSessionId = Number(localStorage.getItem('audit-selected-session')) || undefined;
  const session = useLiveQuery(
    async () => {
      if (selectedSessionId) {
        const selectedSession = await db.countSessions.get(selectedSessionId);
        if (selectedSession && canAccessBranch(currentUser, selectedSession.branchName)) return selectedSession;
      }
      const activeSessions = await db.countSessions.where('status').equals('ACTIVE').toArray();
      const allowedSessions = filterSessionsByUser(activeSessions, currentUser);
      return allowedSessions[allowedSessions.length - 1];
    },
    [selectedSessionId, currentUser?.username]
  );
  const storedItems = useLiveQuery(
    () => session?.id ? db.countSessionItems.where('sessionId').equals(session.id).toArray() : [],
    [session?.id]
  ) || [];
  const transactions = useLiveQuery(
    () => session?.id ? db.countTransactions.where('sessionId').equals(session.id).toArray() : [],
    [session?.id]
  ) || [];
  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const items = useMemo(() => resolveSessionItems(session, storedItems, products), [session, storedItems, products]);

  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('all');
  const [category,setCategory] = useState('all');
  const [sort,setSort] = useState('category');
  const [pageSize,setPageSize] = usePageSize();
  const [page,setPage] = useState(1);
  const [selected,setSelected] = useState<CountSessionItem>();
  const [history,setHistory] = useState<CountSessionItem>();
  const [clear,setClear] = useState(false);
  const [finishConfirm,setFinishConfirm] = useState(false);
  const [finishing,setFinishing] = useState(false);
  const [toast,setToast] = useState('');
  const [scannerOpen,setScannerOpen] = useState(false);
  const [scannerError,setScannerError] = useState('');
  const scanBuffer = useRef('');
  const lastScanKeyAt = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<IScannerControls | undefined>(undefined);

  const productByCode = useMemo(() => {
    const map = new Map<string, (typeof products)[number]>();
    products.forEach(product => {
      map.set(normalizeCode(product.productCode), product);
    });
    return map;
  }, [products]);
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => {
      const product = productByCode.get(normalizeCode(item.productCode));
      const categoryName = (product?.categoryName || getItemCategory(item) || UNCATEGORIZED).trim();
      set.add(categoryName || UNCATEGORIZED);
    });
    return [...set].sort((a,b) => a.localeCompare(b, 'th'));
  }, [items, productByCode]);
  const transactionsByCode = useMemo(() => {
    const map = new Map<string, typeof transactions>();
    transactions.forEach(transaction => {
      const code = normalizeCode(transaction.productCode);
      const group = map.get(code);
      if (group) group.push(transaction); else map.set(code, [transaction]);
    });
    return map;
  }, [transactions]);

  const rows = useMemo(() => items.map(item => {
    const itemCode = normalizeCode(item.productCode);
    const product = productByCode.get(itemCode);
    const categoryName = (product?.categoryName || getItemCategory(item) || UNCATEGORIZED).trim() || UNCATEGORIZED;
    const categoryKey = normalizeText(categoryName);
    const tx = transactionsByCode.get(itemCode) || [];
    const total = tx.reduce((sum,t) => sum + t.signedQuantity, 0);
    const latest = [...tx].sort((a,b) => +new Date(b.countedAt) - +new Date(a.countedAt))[0];
    return {item, itemCode, categoryName, categoryKey, tx, total, latest};
  }).filter(row => {
    const keyword = normalizeText(query);
    if (!keyword) return true;
    return [row.itemCode, row.item.productNameSnapshot, row.categoryName]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  }).filter(row => category === 'all' || row.categoryKey === normalizeText(category))
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
    }), [items, transactionsByCode, productByCode, query, category, filter, sort]);

  const openBarcode = (rawCode:string) => {
    const code = normalizeCode(rawCode);
    if (!code) return;
    const exact = items.find(item => normalizeCode(item.productCode) === code);
    setQuery(code);
    setCategory('all');
    setFilter('all');
    if (exact) {
      setSelected(exact);
      setToast(`พบบาร์โค้ด ${code}: ${exact.productNameSnapshot}`);
    } else {
      setToast(`ไม่พบบาร์โค้ด ${code} ในรอบนับนี้`);
      const input=document.querySelector<HTMLInputElement>('.stock-filters input');
      input?.focus();
      input?.select();
    }
    window.setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    const receiveScanner = (event:KeyboardEvent) => {
      if (selected || history || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const now = Date.now();
      if (now - lastScanKeyAt.current > 120) scanBuffer.current = '';
      lastScanKeyAt.current = now;
      if (event.key === 'Enter') {
        if (scanBuffer.current.length >= 3) {
          event.preventDefault();
          const code = scanBuffer.current;
          scanBuffer.current = '';
          openBarcode(code);
        }
        return;
      }
      if (event.key.length === 1) scanBuffer.current += event.key;
    };
    window.addEventListener('keydown', receiveScanner);
    return () => window.removeEventListener('keydown', receiveScanner);
  }, [items, selected, history]);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    let disposed = false;
    const reader = new BrowserMultiFormatReader(undefined, {delayBetweenScanAttempts: 120});
    setScannerError('');
    reader.decodeFromConstraints(
      {audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},
      videoRef.current,
      result => {
        if (!result || disposed) return;
        const code = result.getText();
        scannerControls.current?.stop();
        scannerControls.current = undefined;
        setScannerOpen(false);
        openBarcode(code);
      }
    ).then(controls => {
      if (disposed) controls.stop();
      else scannerControls.current = controls;
    }).catch(error => {
      if (disposed) return;
      const name = error instanceof Error ? error.name : '';
      setScannerError(name === 'NotAllowedError'
        ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาต Camera ในการตั้งค่าเว็บไซต์'
        : name === 'NotFoundError'
          ? 'ไม่พบกล้องบนอุปกรณ์นี้'
          : 'เปิดกล้องไม่สำเร็จ กรุณาใช้ HTTPS และตรวจสอบสิทธิ์กล้อง');
    });
    return () => {
      disposed = true;
      scannerControls.current?.stop();
      scannerControls.current = undefined;
    };
  }, [scannerOpen, items]);

  if (!session) {
    return <Page title="นับสต็อก" subtitle="สร้างสาขาและรอบนับจากเมนูไฟล์รายการเคลื่อนไหวก่อน">
      <section className="panel"><Empty text="ยังไม่มีรอบนับที่กำลังใช้งาน กรุณาสร้างสาขาก่อนนำเข้าไฟล์รายการเคลื่อนไหว"/></section>
      <div className="mt-5"><ExportHistory/></div>
    </Page>;
  }

  const save = async(v:{action:'ADD'|'SUBTRACT';quantity:number;note:string}) => {
    const item = selected!;
    const itemCode = normalizeCode(item.productCode);
    const tx = transactions.filter(t => normalizeCode(t.productCode) === itemCode);
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

  const doBackup = async() => {
    await downloadJsonBackup();
    setToast('ดาวน์โหลดไฟล์ Backup JSON แล้ว');
    setTimeout(() => setToast(''), 2500);
  };

  const finishWork = async() => {
    try {
      setFinishing(true);
      await exportCountSession(session,items,transactions);
      await auditRepository.closeSession(session.id!);
      localStorage.removeItem('audit-selected-session');
      location.assign('/count-history');
    } catch (reason) {
      setFinishConfirm(false);
      setToast(reason instanceof Error?reason.message:'ไม่สามารถจบงานได้');
      setFinishing(false);
    }
  };

  return <Page title="นับสต็อก" subtitle="เลือกสาขา ค้นหมวดหมู่ แล้วแตะรายการเพื่อบันทึกยอด">
    <StockCountHeader session={session} total={items.length} counted={new Set(transactions.map(t => normalizeCode(t.productCode))).size}/>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <section className="panel">
        <div className="stock-filters grid gap-3" onKeyDown={event=>{if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();openBarcode(query)}}}>
          <label className="input-shell barcode-search-shell"><Search/><input value={query} onChange={e => {setQuery(e.target.value);setPage(1)}} placeholder="ค้นหาชื่อสินค้า / รหัสสินค้า / หมวดหมู่"/><button type="button" className="barcode-camera-button" aria-label="เปิดกล้องสแกนบาร์โค้ด" title="สแกนบาร์โค้ดด้วยกล้อง" onClick={event=>{event.preventDefault();setScannerOpen(true)}}><Camera/></button></label>
          <select className="input" value={category} onChange={e => {setCategory(e.target.value);setPage(1)}}>
            <option value="all">ทุกหมวดหมู่</option>
            {categories.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="input" value={filter} onChange={e => {setFilter(e.target.value);setPage(1)}}>
            <option value="all">ทั้งหมด</option>
            <option value="new">ยังไม่นับ</option>
            <option value="counted">นับแล้ว</option>
            <option value="zero">ยอดเป็นศูนย์</option>
            <option value="negative">ยอดติดลบ</option>
          </select>
          <select className="input" value={sort} onChange={e => {setSort(e.target.value);setPage(1)}}>
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
            {rows.slice((page-1)*pageSize,page*pageSize).map(row => <div key={row.item.productCode} className="relative">
              <ProductCountCard item={row.item} categoryName={row.categoryName} transactions={row.tx} onClick={() => setSelected(row.item)}/>
              {row.latest && <button aria-label="ดูประวัติ" className="absolute bottom-3 left-3 rounded-lg p-2 text-slate-400 hover:bg-slate-100" onClick={() => setHistory(row.item)}><History size={17}/></button>}
            </div>)}
          </div>
        </div>
        {!rows.length && <Empty text="ไม่พบสินค้าตามเงื่อนไข"/>}
        {!!rows.length&&<PageSizeControl total={rows.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>}
      </section>

      <aside className="space-y-5">
        <section className="panel">
          <h2 className="section-title">จัดการรอบนับ</h2>
          <div className="grid gap-2">
            <button className="btn-primary" onClick={()=>setFinishConfirm(true)} disabled={finishing}><CheckCircle2/>{finishing?'กำลังจบงาน...':'จบงานและเก็บประวัติ'}</button>
            <button className="btn-secondary" onClick={doExport}><Download/>Export Excel</button>
            <button className="btn-secondary" onClick={doBackup}><Download/>Backup JSON</button>
            <button className="btn-secondary" onClick={() => document.getElementById('recent')?.scrollIntoView({behavior:'smooth'})}><History/>ดูประวัติการนับ</button>
            <button className="btn-secondary" onClick={() => location.assign('/movement')}><Plus/>เริ่มรอบนับใหม่</button>
            <button className="btn-danger-outline" onClick={() => setClear(true)}><Trash2/>ล้างข้อมูลรอบปัจจุบัน</button>
          </div>
        </section>
        <ExportHistory/>
        <div id="recent"><RecentCountHistory transactions={transactions}/></div>
      </aside>
    </div>

    {selected && <CountStepModal item={selected} transactions={transactions.filter(t => normalizeCode(t.productCode) === normalizeCode(selected.productCode))} auditor={session.auditorName} onClose={() => setSelected(undefined)} onSave={save}/>}
    {history && <CountHistoryDrawer item={history} transactions={transactions.filter(t => normalizeCode(t.productCode) === normalizeCode(history.productCode))} onClose={() => setHistory(undefined)}/>}
    {scannerOpen && <div className="modal-backdrop barcode-scanner-backdrop" role="dialog" aria-modal="true" aria-label="สแกนบาร์โค้ด"><div className="modal-card barcode-scanner-card"><div className="barcode-scanner-head"><div><h2>สแกนบาร์โค้ดสินค้า</h2><p>หันกล้องไปที่บาร์โค้ด ระบบจะค้นหาให้อัตโนมัติ</p></div><button type="button" className="barcode-scanner-close" aria-label="ปิดกล้อง" onClick={()=>setScannerOpen(false)}><X/></button></div><div className="barcode-video-wrap"><video ref={videoRef} autoPlay muted playsInline/><div className="barcode-scan-line"/></div>{scannerError&&<div className="backup-danger mt-4" role="alert">{scannerError}</div>}<button type="button" className="btn-secondary full-button mt-4" onClick={()=>setScannerOpen(false)}>ปิดกล้อง</button></div></div>}
    <ConfirmDialog open={clear} title="ล้างข้อมูลรอบปัจจุบัน?" detail="รายการสินค้าและประวัติการนับในรอบนี้จะถูกลบ การกระทำนี้ย้อนกลับไม่ได้" onCancel={() => setClear(false)} onConfirm={async() => {await auditRepository.clearSession(session.id!);setClear(false);setToast('ล้างข้อมูลรอบปัจจุบันแล้ว')}}/>
    <ConfirmDialog open={finishConfirm} title="ยืนยันจบงานนับสต็อก?" detail="ระบบจะสร้างไฟล์ Excel ปิดรอบนับ และย้ายข้อมูลไปเมนูประวัติการนับสินค้า หลังจบงานจะเพิ่มรายการนับในรอบนี้ไม่ได้" onCancel={()=>!finishing&&setFinishConfirm(false)} onConfirm={()=>void finishWork()}/>
    <Toast message={toast}/>
  </Page>;
}

export function ExportExcelButton(){return null}
