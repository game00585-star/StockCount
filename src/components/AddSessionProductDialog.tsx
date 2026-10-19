import {useMemo,useState} from 'react';
import {PackagePlus,X} from 'lucide-react';
import {db} from '../db/database';
import {queueFirestoreSync} from '../services/firebaseSync';
import type {CountSessionItem,Product} from '../types';

const key=(value:string)=>value.trim().toLowerCase();
const uncategorized='ไม่ระบุหมวด';

export function AddSessionProductDialog({open,sessionId,products,existingItems,onClose,onAdded}:{open:boolean;sessionId:number;products:Product[];existingItems:CountSessionItem[];onClose:()=>void;onAdded:(item:CountSessionItem)=>void}){
  const [productText,setProductText]=useState(''),[selectedCode,setSelectedCode]=useState(''),[category,setCategory]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const existingCodes=useMemo(()=>new Set(existingItems.map(item=>key(item.productCode))),[existingItems]);
  const availableProducts=useMemo(()=>products.filter(product=>product.isActive&&!existingCodes.has(key(product.productCode))).sort((a,b)=>a.productName.localeCompare(b.productName,'th')),[products,existingCodes]);
  const categories=useMemo(()=>[...new Set(availableProducts.map(product=>product.categoryName.trim()||uncategorized))].sort((a,b)=>a.localeCompare(b,'th')),[availableProducts]);
  const filteredProducts=useMemo(()=>availableProducts.filter(product=>!category||key(product.categoryName||uncategorized).includes(key(category))),[availableProducts,category]);
  if(!open)return null;
  const productLabel=(product:Product)=>`${product.productName} (${product.productCode})`;
  const close=()=>{if(saving)return;setProductText('');setSelectedCode('');setCategory('');setError('');onClose()};
  const chooseProduct=(value:string)=>{setProductText(value);const normalized=key(value),product=availableProducts.find(item=>key(productLabel(item))===normalized||key(item.productCode)===normalized||key(item.productName)===normalized);setSelectedCode(product?.productCode||'');if(product)setCategory(product.categoryName.trim()||uncategorized);setError('')};
  const chooseCategory=(value:string)=>{setCategory(value);const selected=availableProducts.find(product=>product.productCode===selectedCode);if(selected&&value&&!key(selected.categoryName||uncategorized).includes(key(value))){setSelectedCode('');setProductText('')}setError('')};
  const save=async()=>{
    const product=availableProducts.find(item=>item.productCode===selectedCode);if(!product){setError('กรุณาเลือกชื่อสินค้า');return}
    try{
      setSaving(true);setError('');const item:CountSessionItem={sessionId,productCode:product.productCode,productNameSnapshot:product.productName,unitSnapshot:product.unit,categoryCodeSnapshot:product.categoryCode,categoryNameSnapshot:product.categoryName||uncategorized,addedAt:new Date()};
      item.id=await db.countSessionItems.add(item);queueFirestoreSync(['countSessionItems']);onAdded(item);close();
    }catch(reason){setError(reason instanceof Error&&reason.name==='ConstraintError'?'สินค้านี้มีอยู่ในรอบนับแล้ว':'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่');setSaving(false)}
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="เพิ่มสินค้าเข้ารอบนับ"><div className="modal-card add-session-product-modal"><div className="flex items-center justify-between"><div><p className="eyebrow">เพิ่มสินค้าที่มาภายหลัง</p><h2><PackagePlus/>เพิ่มสินค้าเข้ารอบนับ</h2></div><button className="icon-btn" aria-label="ปิด" onClick={close}><X/></button></div><p className="add-product-help">แตะเพื่อเลือกจาก Drop Down หรือพิมพ์ชื่อสินค้าและหมวดหมู่เพื่อค้นหา ระบบจะนำรหัสและหน่วยนับมาให้อัตโนมัติ</p><div className="add-product-fields"><label>ชื่อสินค้า<input className="input" list="available-product-options" value={productText} onChange={event=>chooseProduct(event.target.value)} placeholder="พิมพ์หรือเลือกชื่อสินค้า" autoFocus/><datalist id="available-product-options">{filteredProducts.map(product=><option key={product.productCode} value={productLabel(product)}/>)}</datalist></label><label>หมวดหมู่<input className="input" list="available-category-options" value={category} onChange={event=>chooseCategory(event.target.value)} placeholder="พิมพ์หรือเลือกหมวดหมู่"/><datalist id="available-category-options">{categories.map(name=><option key={name} value={name}/>)}</datalist></label></div>{!availableProducts.length&&<div className="empty-state">สินค้าจาก Allowance ถูกเพิ่มเข้ารอบนับครบแล้ว</div>}{error&&<div className="backup-danger mt-4" role="alert">{error}</div>}<div className="modal-actions grid grid-cols-2 gap-3"><button className="btn-secondary" disabled={saving} onClick={close}>ยกเลิก</button><button className="btn-primary" disabled={saving||!selectedCode} onClick={()=>void save()}><PackagePlus/>{saving?'กำลังเพิ่ม...':'เพิ่มสินค้า'}</button></div></div></div>;
}
