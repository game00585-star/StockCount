import * as XLSX from 'xlsx';
import type {CountSession,DamagedCount} from '../types';

export type DamagedSummaryRow={productCode:string;productName:string;unit:string;total:number};

export function summarizeDamagedCounts(records:DamagedCount[]):DamagedSummaryRow[]{
  const summary=new Map<string,DamagedSummaryRow>();
  records.forEach(record=>{
    const existing=summary.get(record.productCode);
    if(existing)existing.total+=record.signedQuantity;
    else summary.set(record.productCode,{productCode:record.productCode,productName:record.productNameSnapshot,unit:record.unitSnapshot,total:record.signedQuantity});
  });
  return [...summary.values()].filter(row=>Math.abs(row.total)>0.000001).sort((a,b)=>a.productName.localeCompare(b.productName,'th'));
}

function cloneSheet(sheet:XLSX.WorkSheet):XLSX.WorkSheet{
  const clone:XLSX.WorkSheet={};
  Object.entries(sheet).forEach(([key,value])=>{
    if(key.startsWith('!'))clone[key]=typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
    else if(value&&typeof value==='object')clone[key]={...(value as XLSX.CellObject),s:(value as XLSX.CellObject).s?structuredClone((value as XLSX.CellObject).s):undefined};
    else clone[key]=value;
  });
  return clone;
}

function setCell(sheet:XLSX.WorkSheet,address:string,value:string|number,kind:'s'|'n'='s'){
  const current=sheet[address] as XLSX.CellObject|undefined;
  sheet[address]={...(current||{}),t:kind,v:value};
}

function fillPage(sheet:XLSX.WorkSheet,session:CountSession,rows:DamagedSummaryRow[],page:number,totalPages:number){
  sheet['!ref']='A1:G43';
  setCell(sheet,'B5',session.branchName);
  setCell(sheet,'G5',`${session.sessionNumber}${totalPages>1?` หน้า ${page}/${totalPages}`:''}`);
  setCell(sheet,'G6',new Date().toLocaleDateString('th-TH'));
  for(let offset=0;offset<20;offset++){
    const excelRow=10+offset,row=rows[offset];
    setCell(sheet,`A${excelRow}`,offset+1,'n');
    setCell(sheet,`B${excelRow}`,row?.productCode||'');
    setCell(sheet,`C${excelRow}`,row?.productName||'');
    if(row)setCell(sheet,`D${excelRow}`,Number(row.total.toFixed(3)),'n');else setCell(sheet,`D${excelRow}`,'');
    setCell(sheet,`G${excelRow}`,'');
  }
  const total=rows.reduce((sum,row)=>sum+row.total,0);
  setCell(sheet,'D30',Number(total.toFixed(3)),'n');
}

export async function loadDefaultDamagedTemplate(){
  const response=await fetch('/damaged-product-template.xlsx',{cache:'no-store'});
  if(!response.ok)throw new Error('ไม่พบไฟล์แม่แบบ Excel กรุณาอัปโหลดแม่แบบใหม่');
  return response.arrayBuffer();
}

export function buildDamagedWorkbook(template:ArrayBuffer,session:CountSession,rows:DamagedSummaryRow[]){
  const workbook=XLSX.read(template,{type:'array',cellStyles:true,cellDates:true});
  const templateName=workbook.SheetNames.find(name=>name.trim()==='Apendix')||workbook.SheetNames[0];
  const templateSheet=workbook.Sheets[templateName];
  if(!templateSheet)throw new Error('ไม่พบชีต Apendix ในไฟล์แม่แบบ');
  const pages=Math.max(1,Math.ceil(rows.length/20));
  fillPage(templateSheet,session,rows.slice(0,20),1,pages);
  for(let page=2;page<=pages;page++){
    const name=`Apendix ${page}`;
    const copy=cloneSheet(templateSheet);
    fillPage(copy,session,rows.slice((page-1)*20,page*20),page,pages);
    workbook.SheetNames.push(name);workbook.Sheets[name]=copy;
  }
  if(!workbook.Workbook)workbook.Workbook={};
  const pageNames=Array.from({length:pages},(_,index)=>index===0?templateName:`Apendix ${index+1}`);
  const keepNames=(workbook.Workbook.Names||[]).filter(item=>item.Name!=='_xlnm.Print_Area');
  workbook.Workbook.Names=[...keepNames,...pageNames.map(name=>({Name:'_xlnm.Print_Area',Sheet:workbook.SheetNames.indexOf(name),Ref:`'${name.replace(/'/g,"''")}'!$A$1:$G$43`}))];
  return XLSX.write(workbook,{bookType:'xlsx',type:'array',cellStyles:true}) as ArrayBuffer;
}

export function damagedReportFileName(session:CountSession){
  const stamp=new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
  return `Damaged_Product_${session.branchName}_${stamp}.xlsx`;
}

export function downloadArrayBuffer(data:ArrayBuffer,fileName:string){
  const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
