import {db} from '../db/database';
import type {CountSession,CountTransaction,ParsedMovement,ParsedProduct} from '../types';
import {createSessionNumber} from '../utils/stock';
import {deleteFirestoreRows, queueFirestoreSync} from './firebaseSync';
import {getCurrentUser,verifyHistoryDeleteCredentials} from './authService';

async function deleteSessionData(sessionId:number){
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
    const importId=await db.transaction('rw',db.movementImports,db.movementItems,db.countSessionItems,db.countSessions,async()=>{
      const importId=Number(await db.movementImports.add({fileName,branchName:session.branchName,totalRows:rows.length,matchedCount:rows.filter(r=>r.matched).length,unmatchedCount:rows.filter(r=>!r.matched&&r.status==='valid').length,duplicateCount:rows.filter(r=>r.status==='duplicate').length,invalidCount:rows.filter(r=>r.status==='invalid').length,importedAt:now,importedBy:by}));
      await db.movementItems.bulkAdd(rows.map(r=>({movementImportId:importId,productCode:r.productCode,sourceProductName:r.sourceProductName,sourceUnit:r.sourceUnit,sourceBalance:r.sourceBalance,matched:!!r.matched,matchReason:r.matchReason||'',createdAt:now})));
      for(const r of rows.filter(r=>r.selected&&r.matched&&r.product)){
        const existing=await db.countSessionItems.where('[sessionId+productCode]').equals([session.id!,r.productCode]).first();
        const data={sessionId:session.id!,productCode:r.productCode,productNameSnapshot:r.product!.productName,unitSnapshot:r.product!.unit,sourceBalance:r.sourceBalance,addedAt:existing?.addedAt||now};
        if(existing?.id)await db.countSessionItems.update(existing.id,data);else await db.countSessionItems.add(data);
      }
      await db.countSessions.update(session.id!,{itemSource:'MOVEMENT',movementImportId:importId,movementFileName:fileName,updatedAt:now});
      return importId;
    });queueFirestoreSync(['movementImports','movementItems','countSessionItems','countSessions']);return importId;
  },
  async useAllowanceForSession(sessionId:number,productCount:number){
    const session=await db.countSessions.get(sessionId);
    if(!session)throw new Error('ไม่พบรอบนับที่ต้องการ');
    const transactionCount=await db.countTransactions.where('sessionId').equals(sessionId).count();
    if(transactionCount>0&&session.itemSource!=='ALLOWANCE')throw new Error('รอบนี้เริ่มนับแล้ว จึงไม่สามารถเปลี่ยนแหล่งรายการสินค้าได้');
    const now=new Date();
    const oldItemKeys=await db.countSessionItems.where('sessionId').equals(sessionId).primaryKeys();
    await db.transaction('rw',db.countSessions,db.countSessionItems,async()=>{
      await db.countSessionItems.where('sessionId').equals(sessionId).delete();
      await db.countSessions.update(sessionId,{itemSource:'ALLOWANCE',allowanceProductCount:productCount,allowanceReferencedAt:now,movementImportId:undefined,movementFileName:undefined,updatedAt:now});
    });
    if(oldItemKeys.length)await deleteFirestoreRows(oldItemKeys.map(key=>({table:'countSessionItems',key})));
    queueFirestoreSync(['countSessions','countSessionItems']);
  },
  async addTransaction(input:Omit<CountTransaction,'id'|'createdAt'>){await db.countTransactions.add({...input,createdAt:new Date()});await db.countSessions.update(input.sessionId,{updatedAt:new Date()});queueFirestoreSync(['countTransactions','countSessions']);},
  async closeSession(sessionId:number){
    const session=await db.countSessions.get(sessionId);
    if(!session)throw new Error('ไม่พบรอบนับที่ต้องการจบงาน');
    if(session.status==='CLOSED')return;
    await db.countSessions.update(sessionId,{status:'CLOSED',updatedAt:new Date()});
    queueFirestoreSync(['countSessions']);
  },
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
    const session=await db.countSessions.get(sessionId);
    if(session?.status==='CLOSED')throw new Error('รอบที่จบงานแล้วต้องลบผ่านเมนูประวัติการนับสินค้า');
    await deleteSessionData(sessionId);
  },
  async deleteClosedSession(sessionId:number,username:string,password:string){
    const session=await db.countSessions.get(sessionId);
    if(!session)throw new Error('ไม่พบประวัติการนับที่ต้องการลบ');
    if(session.status!=='CLOSED')throw new Error('ลบได้เฉพาะรอบที่จบงานแล้ว');
    await verifyHistoryDeleteCredentials(username,password,session.branchName);
    await deleteSessionData(sessionId);
  }
};
