import {useMemo,useState} from 'react';
import {PackagePlus,X} from 'lucide-react';
import {db} from '../db/database';
import {queueFirestoreSync} from '../services/firebaseSync';
import type {CountSessionItem,Product} from '../types';

const clean=(value:string)=>value.trim().replace(/\s+/g,' ');
const codeKey=(value:string)=>clean(value).toLowerCase();

export function AddSessionProductDialog({open,sessionId,products,existingItems,onClose,onAdded}:{open:boolean;sessionId:number;products:Product[];existingItems:CountSessionItem[];onClose:()=>void;onAdded:(item:CountSessionItem)=>void}){
  const [productCode,setProductCode]=useState(''),[productName,setProductName]=useState(''),[unit,setUnit]=useState(''),[categoryName,setCategoryName]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const productMap=useMemo(()=>new Map(products.map(product=>[codeKey(product.productCode),product])),[products]);
  if(!open)return null;
  const fillFromMaster=(rawCode:string)=>{setProductCode(rawCode);const product=productMap.get(codeKey(rawCode));if(product){setProductName(product.productName);setUnit(product.unit);setCategoryName(product.categoryName);setError('')}};
  const close=()=>{if(saving)return;setProductCode('');setProductName('');setUnit('');setCategoryName('');setError('');onClose()};
  const save=async()=>{
    const code=clean(productCode),name=clean(productName),countUnit=clean(unit),category=clean(categoryName);
    if(!code||!name||!countUnit){setError('กรุณากรอกรหัสสินค้า ชื่อสินค้า และหน่วยให้ครบ');return}
    if(existingItems.some(item=>codeKey(item.productCode)===codeKey(code))){setError('รหัสสินค้านี้มีอยู่ในรอบนับแล้ว');return}
    try{
      setSaving(true);setError('');const master=productMap.get(codeKey(code)),item:CountSessionItem={sessionId,productCode:code,productNameSnapshot:name,unitSnapshot:countUnit,categoryCodeSnapshot:master?.categoryCode||'',categoryNameSnapshot:category||master?.categoryName||'ไม่ระบุหมวด',addedAt:new Date()};
      item.id=await db.countSessionItems.add(item);queueFirestoreSync(['countSessionItems']);onAdded(item);close();
    }catch(reason){setError(reason instanceof Error&&reason.name==='ConstraintError'?'รหัสสินค้านี้มีอยู่ในรอบนับแล้ว':'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่');setSaving(false)}
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="เพิ่มสินค้าเข้ารอบนับ"><div className="modal-card add-session-product-modal"><div className="flex items-center justify-between"><div><p className="eyebrow">เพิ่มสินค้าที่มาภายหลัง</p><h2><PackagePlus/>เพิ่มสินค้าเข้ารอบนับ</h2></div><button className="icon-btn" aria-label="ปิด" onClick={close}><X/></button></div><p className="add-product-help">กรอกรหัสสินค้าจาก Excel หากพบในไฟล์ Allowance ระบบจะเติมชื่อ หน่วย และหมวดหมู่ให้อัตโนมัติ</p><div className="add-product-fields"><label>รหัสสินค้า<input className="input" list="late-product-codes" value={productCode} onChange={event=>fillFromMaster(event.target.value)} onBlur={event=>fillFromMaster(event.target.value)} placeholder="เช่น 1110070011" autoFocus/></label><datalist id="late-product-codes">{products.filter(product=>product.isActive).map(product=><option key={product.productCode} value={product.productCode}>{product.productName}</option>)}</datalist><label>ชื่อสินค้า<input className="input" value={productName} onChange={event=>setProductName(event.target.value)} placeholder="ชื่อสินค้า"/></label><label>หน่วย<input className="input" value={unit} onChange={event=>setUnit(event.target.value)} placeholder="แพ็ค / กก. / ขวด"/></label><label>หมวดหมู่<input className="input" value={categoryName} onChange={event=>setCategoryName(event.target.value)} placeholder="หมวดหมู่สินค้า"/></label></div>{error&&<div className="backup-danger mt-4" role="alert">{error}</div>}<div className="modal-actions grid grid-cols-2 gap-3"><button className="btn-secondary" disabled={saving} onClick={close}>ยกเลิก</button><button className="btn-primary" disabled={saving} onClick={()=>void save()}><PackagePlus/>{saving?'กำลังเพิ่ม...':'เพิ่มสินค้า'}</button></div></div></div>;
}
