import * as XLSX from 'xlsx';
import type {CountSession,CountSessionItem,CountTransaction} from '../types';

export type ManagerCountRow={productCode:string;managerTotal:number};
export type CountComparisonRow={productCode:string;productName:string;category:string;unit:string;auditTotal:number;managerTotal:number;difference:number;status:'MATCH'|'DIFFERENT'|'AUDIT_ONLY'|'MANAGER_ONLY'};

const text=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ');
const code=(value:unknown)=>text(value).replace(/\.0+$/,'');
const number=(value:unknown)=>{if(typeof value==='number')return Number.isFinite(value)?value:0;const parsed=Number(text(value).replace(/,/g,''));return Number.isFinite(parsed)?parsed:0};
const findHeader=(rows:unknown[][])=>rows.findIndex(row=>row.some(cell=>text(cell).includes('รหัสสินค้า'))&&row.some(cell=>text(cell).includes('นับรวม')));
const findColumn=(row:unknown[],label:string)=>row.findIndex(cell=>text(cell).includes(label));

export function parseManagerCountWorkbook(data:ArrayBuffer):{sheetName:string;rows:ManagerCountRow[]}{
  const workbook=XLSX.read(data,{type:'array',cellDates:true});
  for(const sheetName of workbook.SheetNames){
    const sheet=workbook.Sheets[sheetName],rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:false,defval:''});
    const headerIndex=findHeader(rows);if(headerIndex<0)continue;
    const header=rows[headerIndex],headerCodeColumn=findColumn(header,'รหัสสินค้า'),headerTotalColumn=findColumn(header,'นับรวม');
    if(headerCodeColumn<0||headerTotalColumn<0)continue;
    const sampleRows=rows.slice(headerIndex+1),offset=[-1,0,1].sort((a,b)=>sampleRows.filter(row=>{const productCode=code(row[headerCodeColumn+b]);return productCode&&/[0-9]/.test(productCode)}).length-sampleRows.filter(row=>{const productCode=code(row[headerCodeColumn+a]);return productCode&&/[0-9]/.test(productCode)}).length)[0];
    const codeColumn=headerCodeColumn+offset,totalColumn=headerTotalColumn+offset;
    const grouped=new Map<string,ManagerCountRow>();
    rows.slice(headerIndex+1).forEach(row=>{const productCode=code(row[codeColumn]);if(!productCode||!/[0-9]/.test(productCode))return;const current=grouped.get(productCode),managerTotal=number(row[totalColumn]);if(current){current.managerTotal+=managerTotal;return}grouped.set(productCode,{productCode,managerTotal})});
    if(grouped.size)return{sheetName,rows:[...grouped.values()]};
  }
  throw new Error('ไม่พบตารางที่มีคอลัมน์ “รหัสสินค้า” และ “นับรวม” ในไฟล์นี้');
}

export function compareCounts(items:CountSessionItem[],transactions:CountTransaction[],managerRows:ManagerCountRow[]):CountComparisonRow[]{
  const auditTotals=new Map<string,number>();transactions.forEach(row=>{const key=code(row.productCode);auditTotals.set(key,(auditTotals.get(key)||0)+row.signedQuantity)});
  const itemMap=new Map(items.map(item=>[code(item.productCode),item])),managerMap=new Map(managerRows.map(row=>[code(row.productCode),row]));
  const keys=[...new Set([...itemMap.keys(),...managerMap.keys()])];
  return keys.map(productCode=>{const item=itemMap.get(productCode),manager=managerMap.get(productCode),auditTotal=auditTotals.get(productCode)||0,managerTotal=manager?.managerTotal||0,difference=auditTotal-managerTotal;let status:CountComparisonRow['status'];if(!item)status='MANAGER_ONLY';else if(!manager)status='AUDIT_ONLY';else status=Math.abs(difference)<.0005?'MATCH':'DIFFERENT';return{productCode,productName:item?.productNameSnapshot||'ไม่พบรหัสนี้ในข้อมูล Audit',category:item?.categoryNameSnapshot||'',unit:item?.unitSnapshot||'',auditTotal,managerTotal,difference,status}}).sort((a,b)=>{const rank={DIFFERENT:0,AUDIT_ONLY:1,MANAGER_ONLY:2,MATCH:3};return rank[a.status]-rank[b.status]||a.productName.localeCompare(b.productName,'th')});
}

export function downloadCountComparison(session:CountSession,rows:CountComparisonRow[]){
  const labels={MATCH:'ตรงกัน',DIFFERENT:'ไม่ตรงกัน',AUDIT_ONLY:'มีเฉพาะ Audit',MANAGER_ONLY:'มีเฉพาะผู้จัดการสาขา'};
  const data=rows.map((row,index)=>({'ลำดับ':index+1,'รหัสสินค้า':row.productCode,'ชื่อสินค้า':row.productName,'หมวดหมู่':row.category,'หน่วย':row.unit,'ยอด Audit':row.auditTotal,'ยอดผู้จัดการสาขา':row.managerTotal,'ผลต่าง Audit - ผู้จัดการ':row.difference,'สถานะ':labels[row.status]}));
  const sheet=XLSX.utils.json_to_sheet(data),workbook=XLSX.utils.book_new();sheet['!cols']=[{wch:8},{wch:18},{wch:42},{wch:22},{wch:12},{wch:15},{wch:20},{wch:24},{wch:20}];sheet['!autofilter']={ref:`A1:I${Math.max(1,rows.length+1)}`};XLSX.utils.book_append_sheet(workbook,sheet,'เปรียบเทียบยอดนับ');
  const safeBranch=session.branchName.replace(/[\\/:*?"<>|]/g,'-'),stamp=new Date().toISOString().slice(0,16).replace('T','_').replace(':',''),outputName=`Audit_Compare_${safeBranch}_${stamp}.xlsx`,buffer=XLSX.write(workbook,{bookType:'xlsx',type:'array'}) as ArrayBuffer,url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download=outputName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
