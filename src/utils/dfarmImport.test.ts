import {describe,expect,it} from 'vitest';
import type {DfarmProductItem,Product} from '../types';
import {prepareDfarmImport} from './stock';

const existing:Product={productCode:'SKU-1',barcode:'000123456789012345',productName:'สินค้าเดิม 500 กรัม',unit:'แพ็ค',categoryCode:'C',categoryName:'ทดสอบ',unitPrice:10,isActive:true,createdAt:new Date(),updatedAt:new Date()};
const apiItem:DfarmProductItem={row:1,productCode:'000123456789012345',barcode:'000123456789012345',productName:'สินค้าเดิม',unit:'แพ็ค',price:12,priceCandidates:{Price:10,New_Price:12},reviewReasons:[]};

describe('prepareDfarmImport',()=>{
  it('detects a confirmed price change and preserves an existing size missing from API',()=>{const [row]=prepareDfarmImport([apiItem],[existing],true);expect(row.priceChanged).toBe(true);expect(row.unitPrice).toBe(12);expect(row.productName).toContain('500 กรัม')});
  it('keeps the latest saved price while price semantics are unconfirmed',()=>{const [row]=prepareDfarmImport([apiItem],[existing],false);expect(row.unitPrice).toBe(10);expect(row.reviewReason).toContain('รอยืนยันความหมายฟิลด์ราคา')});
});
