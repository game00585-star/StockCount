import {db} from '../db/database';
import type {CountSession,CountTransaction,ParsedMovement,ParsedProduct} from '../types';
import {createSessionNumber} from '../utils/stock';

export const auditRepository={
  async saveAllowance(fileName:string,rows:ParsedProduct[],by='ผู้ใช้งาน'){
    const now=new Date(),valid=rows.filter(r=>r.status==='insert'||r.status==='update');
    await db.transaction('rw',db.products,db.allowanceImports,async()=>{
      await db.products.bulkPut(valid.map(r=>({productCode:r.productCode,productName:r.productName,unit:r.unit,categoryCode:r.categoryCode,categoryName:r.categoryName,isActive:true,createdAt:now,updatedAt:now})));
      await db.allowanceImports.add({fileName,totalRows:rows.length,insertedCount:rows.filter(r=>r.status==='insert').length,updatedCount:rows.filter(r=>r.status==='update').length,skippedCount:rows.filter(r=>r.status==='skip').length,duplicateCount:rows.filter(r=>r.status==='duplicate').length,invalidCount:rows.filter(r=>r.status==='invalid').length,importedAt:now,importedBy:by});
    });
  },
  async createSession(data:Pick<CountSession,'branchName'|'countDate'|'auditorName'|'note'>):Promise<number>{
    const now=new Date(),today=await db.countSessions.filter(s=>new Date(s.createdAt).toDateString()===now.toDateString()).count();
    return Number(await db.countSessions.add({...data,sessionNumber:createSessionNumber(now,today+1),status:'ACTIVE',createdBy:data.auditorName,createdAt:now,updatedAt:now}));
  },
  async addMovement(fileName:string,rows:ParsedMovement[],session:CountSession,by:string){
    const now=new Date();
    return db.transaction('rw',db.movementImports,db.movementItems,db.countSessionItems,async()=>{
      const importId=Number(await db.movementImports.add({fileName,branchName:session.branchName,totalRows:rows.length,matchedCount:rows.filter(r=>r.matched).length,unmatchedCount:rows.filter(r=>!r.matched&&r.status==='valid').length,duplicateCount:rows.filter(r=>r.status==='duplicate').length,invalidCount:rows.filter(r=>r.status==='invalid').length,importedAt:now,importedBy:by}));
      await db.movementItems.bulkAdd(rows.map(r=>({movementImportId:importId,productCode:r.productCode,sourceProductName:r.sourceProductName,sourceUnit:r.sourceUnit,sourceBalance:r.sourceBalance,matched:!!r.matched,matchReason:r.matchReason||'',createdAt:now})));
      for(const r of rows.filter(r=>r.selected&&r.matched&&r.product))await db.countSessionItems.put({sessionId:session.id!,productCode:r.productCode,productNameSnapshot:r.product!.productName,unitSnapshot:r.product!.unit,sourceBalance:r.sourceBalance,addedAt:now});
      return importId;
    });
  },
  async addTransaction(input:Omit<CountTransaction,'id'|'createdAt'>){await db.countTransactions.add({...input,createdAt:new Date()});await db.countSessions.update(input.sessionId,{updatedAt:new Date()});},
  async clearSession(sessionId:number){await db.transaction('rw',db.countSessionItems,db.countTransactions,async()=>{await db.countSessionItems.where('sessionId').equals(sessionId).delete();await db.countTransactions.where('sessionId').equals(sessionId).delete();});}
};
