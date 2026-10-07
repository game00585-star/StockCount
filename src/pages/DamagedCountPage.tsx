import {useEffect,useMemo,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Camera,Download,FileSpreadsheet,Image as ImageIcon,MapPin,Search,Share2,Trash2,X} from 'lucide-react';
import {db} from '../db/database';
import type {CountSessionItem,DamagedCount} from '../types';
import {Page,Empty} from './AllowanceImportPage';
import {CountActionStep,CountKeypadStep,ProductCountCard,StockCountHeader} from '../components/CountUI';
import {PageSizeControl,usePageSize} from '../components/PageSizeControl';
import {Toast} from '../components/Toast';
import {canAccessBranch,filterSessionsByUser,getCurrentUser} from '../services/authService';
import {resolveSessionItems} from '../services/sessionItems';
import {deleteFirestoreRows,queueFirestoreSync} from '../services/firebaseSync';
import {buildDamagedWorkbook,damagedReportFileName,downloadArrayBuffer,loadDefaultDamagedTemplate,summarizeDamagedCounts} from '../services/damagedExportService';

const normalize=(value:unknown)=>String(value??'').trim().toLowerCase();
type CapturedPhoto={photoDataUrl:string;photographedAt:Date;latitude:number;longitude:number;accuracy:number;locationText:string;mapUrl:string};
type StoredLocation={latitude:number;longitude:number;accuracy:number;locationText:string;mapUrl:string;cachedAt:number};
const locationCacheKey='audit-damaged-last-location-v2';

function getGpsLocation(fast=true){
  return new Promise<GeolocationPosition>((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('อุปกรณ์นี้ไม่รองรับ GPS'));
    navigator.geolocation.getCurrentPosition(resolve,error=>{
      const message=error.code===error.PERMISSION_DENIED?'กรุณาอนุญาตการเข้าถึงตำแหน่ง GPS ก่อนถ่ายภาพ':error.code===error.TIMEOUT?'ค้นหาตำแหน่งไม่ทันเวลา กรุณาเปิด GPS แล้วลองใหม่':'ไม่สามารถอ่านตำแหน่ง GPS ได้';
      reject(new Error(message));
    },{enableHighAccuracy:!fast,timeout:fast?6000:12000,maximumAge:fast?300000:30000});
  });
}

function placeLabel(prefix:string,value?:string){if(!value)return'';return new RegExp(`^${prefix}|จังหวัด|อำเภอ|ตำบล`,'i').test(value)?value:`${prefix}${value}`}
async function reverseGeocode(latitude:number,longitude:number){
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),6000);
  try{
    const response=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=th`,{signal:controller.signal});
    if(!response.ok)throw new Error('Reverse geocoding unavailable');
    const data=await response.json() as {locality?:string;city?:string;principalSubdivision?:string;postcode?:string;countryName?:string;localityInfo?:{administrative?:Array<{name?:string;description?:string}>}};
    const administrative=data.localityInfo?.administrative||[];
    const district=data.city||administrative.find(item=>/district|amphoe|อำเภอ/i.test(item.description||''))?.name;
    const province=data.principalSubdivision||administrative.find(item=>/province|จังหวัด/i.test(item.description||''))?.name;
    const values=[placeLabel('ต.',data.locality),placeLabel('อ.',district),placeLabel('จ.',province),data.postcode?`รหัสไปรษณีย์ ${data.postcode}`:'',data.countryName].filter(Boolean);
    return [...new Set(values)].join(' · ');
  }finally{window.clearTimeout(timer)}
}
function readLocationCache(){try{const value=JSON.parse(sessionStorage.getItem(locationCacheKey)||'null') as StoredLocation|null;return value&&Date.now()-value.cachedAt<3*60_000?value:undefined}catch{return undefined}}
async function resolveLocation(){
  const cached=readLocationCache();if(cached)return cached;
  let position:GeolocationPosition;try{position=await getGpsLocation(true)}catch{position=await getGpsLocation(false)}
  const latitude=position.coords.latitude,longitude=position.coords.longitude,accuracy=Math.round(position.coords.accuracy),mapUrl=`https://maps.google.com/?q=${latitude},${longitude}`;
  let address='';try{address=await reverseGeocode(latitude,longitude)}catch{/* Use coordinates when the address service is temporarily unavailable. */}
  const coordinateText=`GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy} ม.)`;
  const value={latitude,longitude,accuracy,locationText:address?`${address}\n${coordinateText}`:coordinateText,mapUrl,cachedAt:Date.now()};sessionStorage.setItem(locationCacheKey,JSON.stringify(value));return value;
}

function drawWrapped(context:CanvasRenderingContext2D,text:string,x:number,y:number,maxWidth:number,lineHeight:number,maxLines=2){
  const words=text.replace(/\n/g,' \n ').split(/\s+/);let line='',lines=0;
  for(const word of words){if(word==='\n'){context.fillText(line,x,y,maxWidth);line='';y+=lineHeight;lines++;continue}const test=line?`${line} ${word}`:word;if(context.measureText(test).width>maxWidth&&line){context.fillText(line,x,y,maxWidth);line=word;y+=lineHeight;lines++;if(lines>=maxLines-1)break}else line=test}
  if(line&&lines<maxLines)context.fillText(line,x,y,maxWidth);return y;
}

async function stampPhoto(file:File,productName:string):Promise<CapturedPhoto>{
  const location=await resolveLocation(),{latitude,longitude,accuracy,locationText,mapUrl}=location;
  const source=await createImageBitmap(file),maxSide=900,scale=Math.min(1,maxSide/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw new Error('อุปกรณ์นี้ไม่สามารถเตรียมรูปภาพได้');
  context.drawImage(source,0,0,width,height);source.close();
  const photographedAt=new Date(),labelHeight=Math.max(170,Math.round(height*.28)),gradient=context.createLinearGradient(0,height-labelHeight,0,height);gradient.addColorStop(0,'rgba(9,15,28,.72)');gradient.addColorStop(1,'rgba(9,15,28,.94)');context.fillStyle=gradient;context.fillRect(0,height-labelHeight,width,labelHeight);context.fillStyle='#e11d48';context.fillRect(0,height-labelHeight,8,labelHeight);
  const titleSize=Math.max(18,Math.min(32,Math.round(width/32))),maxWidth=width-32;
  context.fillStyle='#fff';context.font=`700 ${titleSize}px sans-serif`;
  let title=productName;while(title.length>8&&context.measureText(title).width>maxWidth)title=title.slice(0,-1);if(title!==productName)title+='…';
  context.font=`700 ${titleSize}px "Noto Sans Thai","Leelawadee UI",sans-serif`;context.fillText(title,20,height-labelHeight+titleSize+12,maxWidth-8);
  const detailSize=Math.max(13,Math.round(titleSize*.56));context.font=`600 ${detailSize}px "Noto Sans Thai","Leelawadee UI",sans-serif`;context.fillStyle='#f8fafc';
  context.fillText(`วันที่และเวลา ${photographedAt.toLocaleString('th-TH')}`,20,height-labelHeight+titleSize+detailSize+24,maxWidth-8);context.fillStyle='#fecdd3';context.font=`600 ${Math.max(12,detailSize-1)}px "Noto Sans Thai","Leelawadee UI",sans-serif`;drawWrapped(context,locationText,20,height-labelHeight+titleSize+detailSize*2+38,maxWidth-8,detailSize+7,3);
  let quality=.62,photoDataUrl=canvas.toDataURL('image/jpeg',quality);while(photoDataUrl.length>600_000&&quality>.32){quality-=.1;photoDataUrl=canvas.toDataURL('image/jpeg',quality)}
  if(photoDataUrl.length>680_000)throw new Error('รูปภาพมีรายละเอียดมากเกินไป กรุณาถ่ายใหม่ในระยะใกล้ขึ้น');
  return {photoDataUrl,photographedAt,latitude,longitude,accuracy,locationText,mapUrl};
}

function photoFile(record:DamagedCount){const bytes=atob(record.photoDataUrl.split(',')[1]||''),data=new Uint8Array(bytes.length);for(let index=0;index<bytes.length;index++)data[index]=bytes.charCodeAt(index);return new File([data],`สินค้าเสื่อมสภาพ_${record.productCode}_${new Date(record.photographedAt).toISOString().replace(/[:.]/g,'-')}.jpg`,{type:'image/jpeg'})}
function downloadPhoto(record:DamagedCount){const file=photoFile(record),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

export default function DamagedCountPage(){
  const user=getCurrentUser(),selectedSessionId=Number(localStorage.getItem('audit-selected-session'))||undefined;
  const session=useLiveQuery(async()=>{if(selectedSessionId){const chosen=await db.countSessions.get(selectedSessionId);if(chosen?.status==='ACTIVE'&&canAccessBranch(user,chosen.branchName))return chosen}const active=await db.countSessions.where('status').equals('ACTIVE').toArray();return filterSessionsByUser(active,user).at(-1)},[selectedSessionId,user?.username]);
  const storedItems=useLiveQuery(()=>session?.id?db.countSessionItems.where('sessionId').equals(session.id).toArray():[],[session?.id])||[],products=useLiveQuery(()=>db.products.toArray(),[])||[];
  const items=useMemo(()=>resolveSessionItems(session,storedItems,products),[session,storedItems,products]),records=useLiveQuery(()=>session?.id?db.damagedCounts.where('sessionId').equals(session.id).toArray():[],[session?.id])||[];
  const [query,setQuery]=useState(''),[pageSize,setPageSize]=usePageSize(),[page,setPage]=useState(1),[selected,setSelected]=useState<CountSessionItem>();
  const [photo,setPhoto]=useState<CapturedPhoto>(),[processing,setProcessing]=useState(false),[action,setAction]=useState<'ADD'|'SUBTRACT'|null>(null),[value,setValue]=useState(''),[toast,setToast]=useState('');
  const [photoPreview,setPhotoPreview]=useState<DamagedCount>(),[reportOpen,setReportOpen]=useState(false),[reportBuffer,setReportBuffer]=useState<ArrayBuffer>(),[templateBuffer,setTemplateBuffer]=useState<ArrayBuffer>(),[templateName,setTemplateName]=useState('กระบวนการทำลายสินค้า แก้ไขครั้งที่ 1.xlsx');
  const inputRef=useRef<HTMLInputElement>(null),templateInputRef=useRef<HTMLInputElement>(null);
  const filtered=useMemo(()=>items.filter(item=>normalize(`${item.productCode} ${item.productNameSnapshot} ${item.unitSnapshot}`).includes(normalize(query))),[items,query]);
  const byCode=useMemo(()=>{const map=new Map<string,DamagedCount[]>();records.forEach(record=>map.set(record.productCode,[...(map.get(record.productCode)||[]),record]));return map},[records]),reportRows=useMemo(()=>summarizeDamagedCounts(records),[records]);
  const reportPages=useMemo(()=>Array.from({length:Math.max(1,Math.ceil(reportRows.length/20))},(_,index)=>reportRows.slice(index*20,index*20+20)),[reportRows]);
  useEffect(()=>{if(readLocationCache()||!navigator.geolocation)return;const timer=window.setTimeout(()=>{void resolveLocation().catch(()=>undefined)},400);return()=>window.clearTimeout(timer)},[]);
  const close=()=>{setSelected(undefined);setPhoto(undefined);setAction(null);setValue('')};
  const handlePhoto=async(file?:File)=>{if(!file||!selected)return;try{setProcessing(true);setPhoto(await stampPhoto(file,selected.productNameSnapshot))}catch(error){setToast(error instanceof Error?error.message:'ถ่ายภาพไม่สำเร็จ')}finally{setProcessing(false);if(inputRef.current)inputRef.current.value=''}};
  const press=(key:string)=>{if(key==='back')return setValue(current=>current.slice(0,-1));if(key==='clear')return setValue('');setValue(current=>{if(key==='.'&&current.includes('.'))return current;if(key==='.'&&!current)return'0.';if(current.includes('.')&&current.split('.')[1].length>=3)return current;if(current==='0'&&key!=='.')return key;return current+key})};
  const save=async()=>{if(!session?.id||!selected||!photo||!action)return;const quantity=Number(value);if(!Number.isFinite(quantity)||quantity<=0)return;const previousTotal=(byCode.get(selected.productCode)||[]).reduce((sum,row)=>sum+row.signedQuantity,0),signedQuantity=action==='ADD'?quantity:-quantity,now=new Date();await db.damagedCounts.add({sessionId:session.id,productCode:selected.productCode,productNameSnapshot:selected.productNameSnapshot,unitSnapshot:selected.unitSnapshot,action,quantity,signedQuantity,previousTotal,newTotal:previousTotal+signedQuantity,photoDataUrl:photo.photoDataUrl,photographedAt:photo.photographedAt,latitude:photo.latitude,longitude:photo.longitude,locationAccuracy:photo.accuracy,locationText:photo.locationText,mapUrl:photo.mapUrl,countedAt:now,countedBy:session.auditorName,createdAt:now});queueFirestoreSync(['damagedCounts']);close();setToast('บันทึกสินค้าเสื่อมสภาพพร้อม GPS แล้ว');window.setTimeout(()=>setToast(''),2500)};
  const prepareReport=async()=>{if(!session||!reportRows.length)return setToast('ยังไม่มีรายการสินค้าเสื่อมสภาพสำหรับสร้างรายงาน');try{setProcessing(true);const template=templateBuffer||await loadDefaultDamagedTemplate();setReportBuffer(buildDamagedWorkbook(template,session,reportRows));setReportOpen(true)}catch(error){setToast(error instanceof Error?error.message:'สร้างรายงานไม่สำเร็จ')}finally{setProcessing(false)}};
  const chooseTemplate=async(file?:File)=>{if(!file)return;try{setTemplateBuffer(await file.arrayBuffer());setTemplateName(file.name);setToast('เปลี่ยนแม่แบบ Excel แล้ว')}catch{setToast('อ่านไฟล์แม่แบบไม่สำเร็จ')}finally{if(templateInputRef.current)templateInputRef.current.value=''}};
  const sharePhoto=async(record:DamagedCount)=>{try{const file=photoFile(record),text=`สินค้าเสื่อมสภาพ: ${record.productNameSnapshot}\nจำนวน ${record.signedQuantity.toLocaleString('th-TH')} ${record.unitSnapshot}\n${record.locationText||''}`;if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({title:'สินค้าเสื่อมสภาพ',text,files:[file]});return}downloadPhoto(record);setToast('อุปกรณ์นี้ไม่รองรับเมนูแชร์ จึงดาวน์โหลดรูปให้แทน')}catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;setToast('ไม่สามารถแชร์รูปภาพได้')}};
  const removePhoto=async(record:DamagedCount)=>{if(!record.id||!window.confirm(`ลบรูปและรายการนับ ${record.productNameSnapshot} ใช่หรือไม่?`))return;try{await db.damagedCounts.delete(record.id);await deleteFirestoreRows([{table:'damagedCounts',key:record.id}]);setPhotoPreview(undefined);setToast('ลบรูปและข้อมูลรายการนี้แล้ว')}catch{setToast('ลบรูปไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')}};
  if(!session)return <Page title="นับสินค้าเสื่อมสภาพ" subtitle="ใช้รอบนับเดียวกับการนับสต็อกปกติ"><section className="panel"><Empty text="ยังไม่มีรอบนับที่กำลังใช้งาน กรุณาสร้างสาขาและรอบนับก่อน"/></section></Page>;
  return <Page title="นับสินค้าเสื่อมสภาพ" subtitle="เลือกสินค้า ถ่ายภาพพร้อมวันเวลาและ GPS แล้วบันทึกจำนวนด้วย + หรือ -">
    <StockCountHeader session={session} total={items.length} counted={new Set(records.map(record=>record.productCode)).size}/>
    <section className="panel mt-5"><label className="input-shell"><Search/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} placeholder="ค้นหาชื่อสินค้า / รหัสสินค้า"/></label><div className="stock-table mt-4"><div className="stock-table-head"><span>ชื่อสินค้า / หน่วย</span><span>เสื่อมสภาพ / ยอด</span></div><div>{filtered.slice((page-1)*pageSize,page*pageSize).map(item=><ProductCountCard key={item.productCode} item={item} categoryName="สินค้าเสื่อมสภาพ" transactions={(byCode.get(item.productCode)||[]).map(row=>({...row,note:''}))} onClick={()=>setSelected(item)}/>)}</div></div>{!filtered.length&&<Empty text="ไม่พบสินค้าที่ค้นหา"/>}{!!filtered.length&&<PageSizeControl total={filtered.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>}</section>
    <section className="panel mt-5 damaged-report-panel"><div><h2 className="section-title"><FileSpreadsheet/>รายงาน Excel สินค้าเสื่อมสภาพ</h2><p>สรุปยอดรวมแยกตามรหัสสินค้า ลงในแม่แบบที่อัปโหลด พร้อมพรีวิวก่อนพิมพ์หรือดาวน์โหลด</p><small>แม่แบบ: {templateName}</small></div><div><input ref={templateInputRef} className="sr-only" type="file" accept=".xlsx,.xls" onChange={event=>void chooseTemplate(event.target.files?.[0])}/><button className="btn-secondary" onClick={()=>templateInputRef.current?.click()}>เปลี่ยนแม่แบบ</button><button className="btn-primary" disabled={processing||!reportRows.length} onClick={()=>void prepareReport()}><FileSpreadsheet/>{processing?'กำลังสร้าง...':'พรีวิวรายงาน'}</button></div></section>
    {!!records.length&&<section className="panel mt-5"><h2 className="section-title"><ImageIcon/>ภาพสินค้าเสื่อมสภาพ</h2><div className="damaged-history-grid">{[...records].sort((a,b)=>+new Date(b.countedAt)-+new Date(a.countedAt)).map(record=><article key={record.id}><button className="damaged-image-button" onClick={()=>setPhotoPreview(record)}><img src={record.photoDataUrl} alt={record.productNameSnapshot}/></button><div><b>{record.productNameSnapshot}</b><span>{record.action==='ADD'?'+':'-'}{record.quantity.toLocaleString('th-TH')} {record.unitSnapshot}</span><small>{new Date(record.countedAt).toLocaleString('th-TH')}</small><small><MapPin/> {record.locationText||'รูปเดิมยังไม่มีข้อมูล GPS'}</small><div className="damaged-photo-actions"><button aria-label="ดาวน์โหลดรูป" onClick={()=>downloadPhoto(record)}><Download/></button><button aria-label="แชร์รูป" onClick={()=>void sharePhoto(record)}><Share2/></button><button className="danger" aria-label="ลบรูป" onClick={()=>void removePhoto(record)}><Trash2/></button></div></div></article>)}</div></section>}
    {selected&&<div className="modal-backdrop"><div className="modal-card count-modal-card"><div className="flex items-center justify-between"><div><p className="eyebrow">สินค้าเสื่อมสภาพ</p><h2 className="text-xl font-black">{selected.productNameSnapshot}</h2></div><button className="icon-btn" aria-label="ปิด" onClick={close}><X/></button></div><input ref={inputRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={event=>void handlePhoto(event.target.files?.[0])}/>{!photo?<div className="damaged-photo-step"><div className="damaged-camera-placeholder"><Camera/><b>ถ่ายภาพสินค้าก่อนนับ</b><span>ระบบจะขอสิทธิ์ GPS และประทับชื่อสินค้า วันเวลา พิกัดลงบนภาพ</span></div><button className="btn-primary full-button" disabled={processing} onClick={()=>inputRef.current?.click()}><Camera/>{processing?'กำลังอ่าน GPS และเตรียมภาพ...':'เปิดกล้องถ่ายภาพ'}</button></div>:<><div className="damaged-photo-preview"><img src={photo.photoDataUrl} alt={`ภาพ ${selected.productNameSnapshot}`}/><p><MapPin/> {photo.locationText}</p><button className="btn-secondary" onClick={()=>inputRef.current?.click()}><ImageIcon/>ถ่ายใหม่</button></div>{!action?<CountActionStep value={action} onChange={setAction}/>:<><CountKeypadStep value={value} action={action} onPress={press}/><div className="modal-actions grid grid-cols-2 gap-3"><button className="btn-secondary" onClick={()=>{setAction(null);setValue('')}}>ย้อนกลับ</button><button className="btn-primary" disabled={!value||Number(value)<=0} onClick={()=>void save()}>บันทึกจำนวน</button></div></>}</>}</div></div>}
    {photoPreview&&<div className="modal-backdrop"><div className="modal-card count-modal-card damaged-photo-modal"><div className="flex items-center justify-between"><h2>{photoPreview.productNameSnapshot}</h2><button className="icon-btn" onClick={()=>setPhotoPreview(undefined)}><X/></button></div><img src={photoPreview.photoDataUrl} alt={photoPreview.productNameSnapshot}/><p>{new Date(photoPreview.photographedAt).toLocaleString('th-TH')}</p><p className="photo-location"><MapPin/> <span>{photoPreview.locationText||'รูปเดิมยังไม่มีข้อมูล GPS'}</span></p>{photoPreview.mapUrl&&<a className="btn-secondary" href={photoPreview.mapUrl} target="_blank" rel="noreferrer"><MapPin/>เปิดตำแหน่งในแผนที่</a>}<div className="damaged-preview-actions"><button className="btn-secondary" onClick={()=>downloadPhoto(photoPreview)}><Download/>ดาวน์โหลด</button><button className="btn-primary" onClick={()=>void sharePhoto(photoPreview)}><Share2/>แชร์</button><button className="btn-danger" onClick={()=>void removePhoto(photoPreview)}><Trash2/>ลบรูป</button></div></div></div>}
    {reportOpen&&<div className="modal-backdrop damaged-report-backdrop"><div className="modal-card damaged-report-modal"><div className="damaged-report-toolbar"><div><p className="eyebrow">ตรวจสอบก่อนดาวน์โหลด</p><h2>รายการสินค้าเสื่อมสภาพ</h2></div><button className="icon-btn" onClick={()=>setReportOpen(false)}><X/></button></div><div className="excel-preview-summary"><div><span>จำนวนสินค้า</span><b>{reportRows.length.toLocaleString('th-TH')} รายการ</b></div><div><span>จำนวนหน้าใน Excel</span><b>{reportPages.length.toLocaleString('th-TH')} หน้า</b></div><div><span>รูปแบบ</span><b>หน้าละไม่เกิน 20 รายการ</b></div></div><p className="print-hint">ระบบจะดาวน์โหลดไฟล์ Excel จากแม่แบบต้นฉบับ กรุณาเปิดไฟล์ด้วย Microsoft Excel แล้วตรวจสอบและสั่งพิมพ์เอกสารทางการจาก Excel เท่านั้น</p><div className="excel-preview-list">{reportRows.map((row,index)=><div key={row.productCode}><span>{index+1}</span><code>{row.productCode}</code><b>{row.productName}</b><strong>{row.total.toLocaleString('th-TH',{maximumFractionDigits:3})} {row.unit}</strong></div>)}</div><div className="damaged-report-actions"><button className="btn-primary" disabled={!reportBuffer} onClick={()=>reportBuffer&&downloadArrayBuffer(reportBuffer,damagedReportFileName(session))}><Download/>ดาวน์โหลด Excel ต้นฉบับ</button></div></div></div>}
    <Toast message={toast}/>
  </Page>;
}
