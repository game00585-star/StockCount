import {useMemo,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Camera,Image as ImageIcon,Search,Trash2,X} from 'lucide-react';
import {db} from '../db/database';
import type {CountSessionItem,DamagedCount} from '../types';
import {Page,Empty} from './AllowanceImportPage';
import {CountActionStep,CountKeypadStep,ProductCountCard,StockCountHeader} from '../components/CountUI';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';
import {Toast} from '../components/Toast';
import {canAccessBranch,filterSessionsByUser,getCurrentUser} from '../services/authService';
import {resolveSessionItems} from '../services/sessionItems';
import {queueFirestoreSync} from '../services/firebaseSync';

const normalize=(value:unknown)=>String(value??'').trim().toLowerCase();

async function stampPhoto(file:File,productName:string){
  const source=await createImageBitmap(file);
  const maxSide=900;
  const scale=Math.min(1,maxSide/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*scale));
  const height=Math.max(1,Math.round(source.height*scale));
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('อุปกรณ์นี้ไม่สามารถเตรียมรูปภาพได้');
  context.drawImage(source,0,0,width,height);
  source.close();
  const photographedAt=new Date();
  const labelHeight=Math.max(78,Math.round(height*.13));
  context.fillStyle='rgba(0,0,0,.72)';
  context.fillRect(0,height-labelHeight,width,labelHeight);
  const titleSize=Math.max(18,Math.min(32,Math.round(width/32)));
  context.fillStyle='#fff';
  context.font=`700 ${titleSize}px sans-serif`;
  const maxWidth=width-32;
  let title=productName;
  while(title.length>8&&context.measureText(title).width>maxWidth)title=title.slice(0,-1);
  if(title!==productName)title+='…';
  context.fillText(title,16,height-labelHeight+titleSize+10,maxWidth);
  context.font=`500 ${Math.max(14,Math.round(titleSize*.62))}px sans-serif`;
  context.fillStyle='#f8fafc';
  context.fillText(`ถ่ายเมื่อ ${photographedAt.toLocaleString('th-TH')}`,16,height-14,maxWidth);
  let quality=.62;
  let photoDataUrl=canvas.toDataURL('image/jpeg',quality);
  while(photoDataUrl.length>600_000&&quality>.32){quality-=.1;photoDataUrl=canvas.toDataURL('image/jpeg',quality)}
  if(photoDataUrl.length>680_000)throw new Error('รูปภาพมีรายละเอียดมากเกินไป กรุณาถ่ายใหม่ในระยะใกล้ขึ้น');
  return {photoDataUrl,photographedAt};
}

export default function DamagedCountPage(){
  const user=getCurrentUser();
  const selectedSessionId=Number(localStorage.getItem('audit-selected-session'))||undefined;
  const session=useLiveQuery(async()=>{
    if(selectedSessionId){const chosen=await db.countSessions.get(selectedSessionId);if(chosen?.status==='ACTIVE'&&canAccessBranch(user,chosen.branchName))return chosen;}
    const active=await db.countSessions.where('status').equals('ACTIVE').toArray();
    return filterSessionsByUser(active,user).at(-1);
  },[selectedSessionId,user?.username]);
  const storedItems=useLiveQuery(()=>session?.id?db.countSessionItems.where('sessionId').equals(session.id).toArray():[],[session?.id])||[];
  const products=useLiveQuery(()=>db.products.toArray(),[])||[];
  const items=useMemo(()=>resolveSessionItems(session,storedItems,products),[session,storedItems,products]);
  const records=useLiveQuery(()=>session?.id?db.damagedCounts.where('sessionId').equals(session.id).toArray():[],[session?.id])||[];
  const [query,setQuery]=useState('');
  const [pageSize,setPageSize]=usePageSize();
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<CountSessionItem>();
  const [photo,setPhoto]=useState<{photoDataUrl:string;photographedAt:Date}>();
  const [processing,setProcessing]=useState(false);
  const [action,setAction]=useState<'ADD'|'SUBTRACT'|null>(null);
  const [value,setValue]=useState('');
  const [toast,setToast]=useState('');
  const inputRef=useRef<HTMLInputElement>(null);
  const filtered=useMemo(()=>items.filter(item=>normalize(`${item.productCode} ${item.productNameSnapshot} ${item.unitSnapshot}`).includes(normalize(query))),[items,query]);
  const byCode=useMemo(()=>{const map=new Map<string,DamagedCount[]>();records.forEach(record=>map.set(record.productCode,[...(map.get(record.productCode)||[]),record]));return map},[records]);
  const close=()=>{setSelected(undefined);setPhoto(undefined);setAction(null);setValue('')};
  const handlePhoto=async(file?:File)=>{if(!file||!selected)return;try{setProcessing(true);setPhoto(await stampPhoto(file,selected.productNameSnapshot))}catch(error){setToast(error instanceof Error?error.message:'ถ่ายภาพไม่สำเร็จ')}finally{setProcessing(false)}};
  const press=(key:string)=>{if(key==='back')return setValue(current=>current.slice(0,-1));if(key==='clear')return setValue('');setValue(current=>{if(key==='.'&&current.includes('.'))return current;if(key==='.'&&!current)return'0.';if(current.includes('.')&&current.split('.')[1].length>=3)return current;if(current==='0'&&key!=='.')return key;return current+key})};
  const save=async()=>{
    if(!session?.id||!selected||!photo||!action)return;
    const quantity=Number(value);if(!Number.isFinite(quantity)||quantity<=0)return;
    const previousTotal=(byCode.get(selected.productCode)||[]).reduce((sum,row)=>sum+row.signedQuantity,0);
    const signedQuantity=action==='ADD'?quantity:-quantity;
    const now=new Date();
    await db.damagedCounts.add({sessionId:session.id,productCode:selected.productCode,productNameSnapshot:selected.productNameSnapshot,unitSnapshot:selected.unitSnapshot,action,quantity,signedQuantity,previousTotal,newTotal:previousTotal+signedQuantity,photoDataUrl:photo.photoDataUrl,photographedAt:photo.photographedAt,countedAt:now,countedBy:session.auditorName,createdAt:now});
    queueFirestoreSync(['damagedCounts']);
    close();setToast('บันทึกสินค้าเสื่อมสภาพแล้ว');window.setTimeout(()=>setToast(''),2500);
  };
  if(!session)return <Page title="นับสินค้าเสื่อมสภาพ" subtitle="ใช้รอบนับเดียวกับการนับสต็อกปกติ"><section className="panel"><Empty text="ยังไม่มีรอบนับที่กำลังใช้งาน กรุณาสร้างสาขาและรอบนับก่อน"/></section></Page>;
  return <Page title="นับสินค้าเสื่อมสภาพ" subtitle="เลือกสินค้า ถ่ายภาพพร้อมชื่อและเวลา แล้วบันทึกจำนวนด้วย + หรือ -">
    <StockCountHeader session={session} total={items.length} counted={new Set(records.map(record=>record.productCode)).size}/>
    <section className="panel mt-5">
      <label className="input-shell"><Search/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} placeholder="ค้นหาชื่อสินค้า / รหัสสินค้า"/></label>
      <div className="stock-table mt-4"><div className="stock-table-head"><span>ชื่อสินค้า / หน่วย</span><span>เสื่อมสภาพ / ยอด</span></div><div>{filtered.slice((page-1)*pageSize,page*pageSize).map(item=><ProductCountCard key={item.productCode} item={item} categoryName="สินค้าเสื่อมสภาพ" transactions={(byCode.get(item.productCode)||[]).map(row=>({...row,note:''}))} onClick={()=>setSelected(item)}/>)}</div></div>
      {!filtered.length&&<Empty text="ไม่พบสินค้าที่ค้นหา"/>}
      {!!filtered.length&&<PageSizeControl total={filtered.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>} 
    </section>
    {!!records.length&&<section className="panel mt-5"><h2 className="section-title"><ImageIcon/>ภาพสินค้าเสื่อมสภาพล่าสุด</h2><div className="damaged-history-grid">{[...records].sort((a,b)=>+new Date(b.countedAt)-+new Date(a.countedAt)).slice(0,12).map(record=><article key={record.id}><img src={record.photoDataUrl} alt={record.productNameSnapshot}/><div><b>{record.productNameSnapshot}</b><span>{record.action==='ADD'?'+':'-'}{record.quantity.toLocaleString('th-TH')} {record.unitSnapshot}</span><small>{new Date(record.countedAt).toLocaleString('th-TH')}</small></div></article>)}</div></section>}
    {selected&&<div className="modal-backdrop"><div className="modal-card count-modal-card"><div className="flex items-center justify-between"><div><p className="eyebrow">สินค้าเสื่อมสภาพ</p><h2 className="text-xl font-black">{selected.productNameSnapshot}</h2></div><button className="icon-btn" aria-label="ปิด" onClick={close}><X/></button></div>
      {!photo?<div className="damaged-photo-step"><div className="damaged-camera-placeholder"><Camera/><b>ถ่ายภาพสินค้าก่อนนับ</b><span>ระบบจะประทับชื่อสินค้าและเวลาลงบนภาพ</span></div><input ref={inputRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={event=>void handlePhoto(event.target.files?.[0])}/><button className="btn-primary full-button" disabled={processing} onClick={()=>inputRef.current?.click()}><Camera/>{processing?'กำลังเตรียมภาพ...':'เปิดกล้องถ่ายภาพ'}</button></div>:<><div className="damaged-photo-preview"><img src={photo.photoDataUrl} alt={`ภาพ ${selected.productNameSnapshot}`}/><button className="btn-secondary" onClick={()=>inputRef.current?.click()}><ImageIcon/>ถ่ายใหม่</button><input ref={inputRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={event=>void handlePhoto(event.target.files?.[0])}/></div>{!action?<CountActionStep value={action} onChange={setAction}/>:<><CountKeypadStep value={value} action={action} onPress={press}/><div className="modal-actions grid grid-cols-2 gap-3"><button className="btn-secondary" onClick={()=>{setAction(null);setValue('')}}>ย้อนกลับ</button><button className="btn-primary" disabled={!value||Number(value)<=0} onClick={()=>void save()}>บันทึกจำนวน</button></div></>}</>}
    </div></div>}
    <Toast message={toast}/>
  </Page>;
}
