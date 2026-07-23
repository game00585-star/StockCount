import 'fake-indexeddb/auto';import * as XLSX from 'xlsx';import {beforeEach,describe,expect,it} from 'vitest';import {db} from '../db/database';import {auditRepository} from '../services/auditRepository';import type {CountSession,CountSessionItem,CountTransaction,ParsedProduct,Product} from '../types';import {buildCountWorkbook,calculateProductTotal,compareAllowance,matchMovementWithProducts,normalizeProductCode} from './stock';
const now=new Date('2026-07-21T14:00:00');
const base:Product={productCode:'00123',productName:'หมูบด',unit:'กก.',categoryCode:'M',categoryName:'เนื้อสัตว์',isActive:true,createdAt:now,updatedAt:now};
const row=(patch:Partial<ParsedProduct>={}):ParsedProduct=>({row:2,productCode:'00123',productName:'หมูบด',unit:'กก.',categoryCode:'M',categoryName:'เนื้อสัตว์',...patch});
const tx=(signedQuantity:number,id=1):CountTransaction=>({id,sessionId:1,productCode:'00123',productNameSnapshot:'หมูบด',action:signedQuantity<0?'SUBTRACT':'ADD',quantity:Math.abs(signedQuantity),signedQuantity,previousTotal:0,newTotal:signedQuantity,note:'',countedAt:new Date(now.getTime()+id*1000),countedBy:'A',createdAt:now});
describe('product normalization and allowance import',()=>{
  it('preserves leading zero and removes Excel artifacts',()=>{expect(normalizeProductCode("'00123.0")).toBe('00123');expect(normalizeProductCode('1.23E+5')).toBe('123000')});
  it('same row skips, changed row updates, new row inserts',()=>{expect(compareAllowance([row()],[base])[0].status).toBe('skip');expect(compareAllowance([row({productName:'หมูบดใหม่'})],[base])[0].status).toBe('update');expect(compareAllowance([row({productCode:'00999'})],[base])[0].status).toBe('insert')});
  it('duplicate code is rejected',()=>expect(compareAllowance([row(),row({row:3})],[base]).every(x=>x.status==='duplicate')).toBe(true));
});
describe('movement matching',()=>{
  it('only exact master code is matched',()=>{const result=matchMovementWithProducts([{row:1,productCode:'00123',sourceProductName:'X',sourceUnit:'kg'},{row:2,productCode:'999',sourceProductName:'Y',sourceUnit:'kg'}],[base]);expect(result[0].matched).toBe(true);expect(result[0].selected).toBe(true);expect(result[1].matched).toBe(false);expect(result[1].selected).toBe(false)});
  it('duplicate movement is not selected',()=>expect(matchMovementWithProducts([{row:1,productCode:'00123',sourceProductName:'X',sourceUnit:'kg'},{row:2,productCode:'00123',sourceProductName:'X',sourceUnit:'kg'}],[base])[1].status).toBe('duplicate'));
});
describe('count math and export',()=>{
  it('adds and subtracts without losing decimals',()=>{expect(calculateProductTotal([tx(32),tx(190,2)])).toBe(222);expect(calculateProductTotal([tx(32),tx(190,2),tx(-2,3)])).toBe(220);expect(calculateProductTotal([tx(97.42),tx(.98,2)])).toBeCloseTo(98.4)});
  it('exports quantity as number',()=>{const session:CountSession={id:1,sessionNumber:'AUD-STOCK-20260721-001',branchName:'A',countDate:now,auditorName:'A',note:'',status:'ACTIVE',createdBy:'A',createdAt:now,updatedAt:now};const item:CountSessionItem={id:1,sessionId:1,productCode:'00123',productNameSnapshot:'หมูบด',unitSnapshot:'กก.',addedAt:now};const wb=buildCountWorkbook(session,[item],[tx(32)]);const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets['สรุปการนับ']);expect(typeof rows[0]['ยอดสุทธิ']).toBe('number')});
});
describe('IndexedDB persistence and uniqueness',()=>{
  beforeEach(async()=>{await db.delete();await db.open()});
  it('same allowance twice does not duplicate products',async()=>{await auditRepository.saveAllowance('a.xlsx',compareAllowance([row()],[]));const existing=await db.products.toArray();await auditRepository.saveAllowance('a.xlsx',compareAllowance([row()],existing));expect(await db.products.count()).toBe(1);expect((await db.allowanceImports.orderBy('id').last())?.skippedCount).toBe(1)});
  it('session product compound key prevents duplicate import',async()=>{const sid=await auditRepository.createSession({branchName:'A',countDate:now,auditorName:'A',note:''});const session=(await db.countSessions.get(sid))!;const matched=matchMovementWithProducts([{row:1,productCode:'00123',sourceProductName:'X',sourceUnit:'kg'}],[base]);await auditRepository.addMovement('m.xlsx',matched,session,'A');await auditRepository.addMovement('m.xlsx',matched,session,'A');expect(await db.countSessionItems.where('sessionId').equals(sid).count()).toBe(1)});
  it('history survives reload and sorts newest first',async()=>{await db.countTransactions.bulkAdd([tx(1,1),tx(2,2)]);db.close();await db.open();const h=await db.countTransactions.orderBy('countedAt').reverse().toArray();expect(h.map(x=>x.id)).toEqual([2,1])});
});
