import {db} from '../db/database';import {auditRepository} from '../services/auditRepository';
const products:[string,string,string][]=[['0001001','หมูบด สูตร 5 บรรจุ 1 กก.','กก.'],['0001002','ปอด','กก.'],['0001003','เลือดต้ม (ก้อน)','ก้อน'],['0001004','เนื้อแดง (ไหล่)','กก.'],['0001005','สะโพก','กก.'],['0001006','หมูสามชั้นบาง','กก.']];
export async function loadDemoData(){
  if(await db.products.where('categoryCode').equals('__DEMO__').count())return;
  const now=new Date();
  await db.products.bulkPut(products.map(([productCode,productName,unit])=>({productCode,productName,unit,categoryCode:'__DEMO__',categoryName:'ข้อมูลตัวอย่าง',isActive:true,createdAt:now,updatedAt:now})));
  const sid=await auditRepository.createSession({branchName:'สาขาตัวอย่าง',countDate:now,auditorName:'ผู้ตรวจนับตัวอย่าง',note:'Demo Data'});
  await db.countSessionItems.bulkAdd(products.map(([productCode,productName,unit])=>({sessionId:sid,productCode,productNameSnapshot:productName,unitSnapshot:unit,addedAt:now})));
  let offset=0;
  for(const [code,action,qty] of [['0001001','ADD',32],['0001001','ADD',190],['0001004','ADD',97.42],['0001004','ADD',0.98],['0001005','ADD',131.14],['0001005','SUBTRACT',3.89]] as const){
    const old=(await db.countTransactions.where('[sessionId+productCode]').equals([sid,code]).toArray()).reduce((s,t)=>s+t.signedQuantity,0),signed=action==='ADD'?qty:-qty;
    await auditRepository.addTransaction({sessionId:sid,productCode:code,productNameSnapshot:products.find(p=>p[0]===code)![1],action,quantity:qty,signedQuantity:signed,previousTotal:old,newTotal:old+signed,note:'ข้อมูลตัวอย่าง',countedAt:new Date(now.getTime()+offset++*60000),countedBy:'ผู้ตรวจนับตัวอย่าง'});
  }
}
export async function removeDemoData(){const demos=await db.products.where('categoryCode').equals('__DEMO__').primaryKeys();const sessions=await db.countSessions.filter(s=>s.note==='Demo Data').toArray();await db.transaction('rw',db.products,db.countSessions,db.countSessionItems,db.countTransactions,async()=>{await db.products.bulkDelete(demos);for(const s of sessions){await db.countTransactions.where('sessionId').equals(s.id!).delete();await db.countSessionItems.where('sessionId').equals(s.id!).delete();await db.countSessions.delete(s.id!);}});}
