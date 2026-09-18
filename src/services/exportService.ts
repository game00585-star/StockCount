import * as XLSX from 'xlsx';
import {db} from '../db/database';
import type {CountSession,CountSessionItem,CountTransaction,ExportRecord,ParsedMovement} from '../types';
import {buildCountWorkbook} from '../utils/stock';
function download(data:ArrayBuffer,fileName:string){const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function saveWorkbookExport(workbook:XLSX.WorkBook,fileName:string,exportType:ExportRecord['exportType'],sessionId?:number,branchName?:string){const data=XLSX.write(workbook,{bookType:'xlsx',type:'array'}) as ArrayBuffer;await db.exportRecords.add({fileName,exportType,sessionId,branchName,createdAt:new Date(),data});download(data,fileName);}
export async function exportCountSession(session:CountSession,items:CountSessionItem[],transactions:CountTransaction[],unmatched:ParsedMovement[]=[]){const stamp=new Date().toISOString().slice(0,16).replace('T','_').replace(':','');const fileName=`Audit_Stock_Count_${session.branchName}_${stamp}.xlsx`;await saveWorkbookExport(buildCountWorkbook(session,items,transactions,unmatched),fileName,'COUNT_SESSION',session.id,session.branchName);}
export function downloadExportRecord(record:ExportRecord){download(record.data,record.fileName);}
