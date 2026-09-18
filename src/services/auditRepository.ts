import {db} from '../db/database';
import type {CountSession,CountTransaction,ParsedMovement,ParsedProduct} from '../types';
import {createSessionNumber} from '../utils/stock';
import {deleteFirestoreRows, queueFirestoreSync} from './firebaseSync';
import {getCurrentUser} from './authService';

export const auditRepository={
  async saveAllowance(fileName:string,rows:ParsedProduct[],by='ผู้ใช้งาน'){
    const now=new Date(),valid=rows.filter(r=>r.status==='insert'||r.status==='update');
    await db.transaction('rw',db.products,db.allowanceImports,async()=>{
      await db.products.bulkPut(valid.map(r=>({productCode:r.productCode,productName:r.productName,unit:r.unit,categoryCode:r.categoryCode,categoryName:r.categoryName,isActive:true,createdAt:now,updatedAt:now})));
      await db.allowanceImports.add({fileName,totalRows:rows.length,insertedCount:rows.filter(r=>r.status==='insert').length,updatedCount:rows.filter(r=>r.status==='update').length,skippedCount:rows.filter(r=>r.status==='skip').length,duplicateCount:rows.filter(r=>r.status==='duplicate').length,invalidCount:rows.filter(r=>r.status==='invalid').length,importedAt:now,importedBy:by});
    });
    queueFirestoreSync(['products','allowanceImports']);
  },
  async clearAllowance(){
    if(getCurrentUser()?.role!=='ADMIN')throw new Error('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่ลบข้อมูล Allowance ได้');
    await db.transaction('rw',db.products,db.allowanceImports,async()=>{
      await db.products.clear();
      await db.allowanceImports.clear();
    });
    queueFirestoreSync(['products','allowanceImports']);
  },
  async createSession(data:Pick<CountSession,'branchName'|'countDate'|'auditorName'|'note'>):Promise<number>{
    const now=new Date(),today=await db.countSessions.filter(s=>new Date(s.createdAt).toDateString()===now.toDateString()).count();
    const id=Number(await db.countSessions.add({...data,sessionNumber:createSessionNumber(now,today+1),status:'ACTIVE',createdBy:data.auditorName,createdAt:now,updatedAt:now}));
    queueFirestoreSync(['countSessions']);return id;
  },
  async addMovement(fileName:string,rows:ParsedMovement[],session:CountSession,by:string){
    const now=new Date();
    const importId=await db.transaction('rw',db.movementImports,db.movementItems,db.countSessionItems,async()=>{
      const importId=Number(await db.movementImports.add({fileName,branchName:session.branchName,totalRows:rows.length,matchedCount:rows.filter(r=>r.matched).length,unmatchedCount:rows.filter(r=>!r.matched&&r.status==='valid').length,duplicateCount:rows.filter(r=>r.status==='duplicate').length,invalidCount:rows.filter(r=>r.status==='invalid').length,importedAt:now,importedBy:by}));
      await db.movementItems.bulkAdd(rows.map(r=>({movementImportId:importId,productCode:r.productCode,sourceProductName:r.sourceProductName,sourceUnit:r.sourceUnit,sourceBalance:r.sourceBalance,matched:!!r.matched,matchReason:r.matchReason||'',createdAt:now})));
      for(const r of rows.filter(r=>r.selected&&r.matched&&r.product)){
        const existing=await db.countSessionItems.where('[sessionId+productCode]').equals([session.id!,r.productCode]).first();
        const data={sessionId:session.id!,productCode:r.productCode,productNameSnapshot:r.product!.productName,unitSnapshot:r.product!.unit,sourceBalance:r.sourceBalance,addedAt:existing?.addedAt||now};
        if(existing?.id)await db.countSessionItems.update(existing.id,data);else await db.countSessionItems.add(data);
      }
      return importId;
    });queueFirestoreSync(['movementImports','movementItems','countSessionItems']);return importId;
  },
  async addTransaction(input:Omit<CountTransaction,'id'|'createdAt'>){await db.countTransactions.add({...input,createdAt:new Date()});await db.countSessions.update(input.sessionId,{updatedAt:new Date()});queueFirestoreSync(['countTransactions','countSessions']);},
  async clearSession(sessionId:number){
    const itemKeys=await db.countSessionItems.where('sessionId').equals(sessionId).primaryKeys();
    const transactionKeys=await db.countTransactions.where('sessionId').equals(sessionId).primaryKeys();
    await db.transaction('rw',db.countSessionItems,db.countTransactions,async()=>{await db.countSessionItems.where('sessionId').equals(sessionId).delete();await db.countTransactions.where('sessionId').equals(sessionId).delete();});
    await deleteFirestoreRows([
      ...itemKeys.map(key=>({table:'countSessionItems',key})),
      ...transactionKeys.map(key=>({table:'countTransactions',key}))
    ]);
    queueFirestoreSync(['countSessionItems','countTransactions']);
  },
  async deleteSession(sessionId:number){
    const itemKeys=await db.countSessionItems.where('sessionId').equals(sessionId).primaryKeys();
    const transactionKeys=await db.countTransactions.where('sessionId').equals(sessionId).primaryKeys();
    const exportKeys=await db.exportRecords.where('sessionId').equals(sessionId).primaryKeys();
    await db.transaction('rw',db.countSessions,db.countSessionItems,db.countTransactions,db.exportRecords,async()=>{await db.countSessionItems.where('sessionId').equals(sessionId).delete();await db.countTransactions.where('sessionId').equals(sessionId).delete();await db.exportRecords.where('sessionId').equals(sessionId).delete();await db.countSessions.delete(sessionId);});
    await deleteFirestoreRows([
      {table:'countSessions',key:sessionId},
      ...itemKeys.map(key=>({table:'countSessionItems',key})),
      ...transactionKeys.map(key=>({table:'countTransactions',key})),
      ...exportKeys.map(key=>({table:'exportRecords',key}))
    ]);
    queueFirestoreSync(['countSessions','countSessionItems','countTransactions']);
  }
};
