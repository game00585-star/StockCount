import * as XLSX from 'xlsx';
import type {CountSession,DamagedCount} from '../types';

export type DamagedSummaryRow={productCode:string;productName:string;unit:string;category?:string;total:number};
export type DamagedAuditRow={productCode:string;productName:string;unit:string;category:string;quantity:number;photoDataUrl:string};
export function summarizeDamagedCounts(records:DamagedCount[]):DamagedSummaryRow[]{
  const summary=new Map<string,DamagedSummaryRow>();
  records.forEach(record=>{const existing=summary.get(record.productCode);if(existing)existing.total+=record.signedQuantity;else summary.set(record.productCode,{productCode:record.productCode,productName:record.productNameSnapshot,unit:record.unitSnapshot,total:record.signedQuantity})});
  return [...summary.values()].filter(row=>Math.abs(row.total)>0.000001).sort((a,b)=>a.productName.localeCompare(b.productName,'th'));
}

type ZipEntry={content:Uint8Array};type ZipPackage={FileIndex:ZipEntry[];FullPaths:string[]};
const root='Root Entry/';
const xmlEscape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function zipEntry(zip:ZipPackage,path:string){const index=zip.FullPaths.indexOf(`${root}${path}`);if(index<0)throw new Error(`ไฟล์แม่แบบไม่สมบูรณ์: ไม่พบ ${path}`);return zip.FileIndex[index]}
const readText=(zip:ZipPackage,path:string)=>new TextDecoder().decode(zipEntry(zip,path).content);
const writeText=(zip:ZipPackage,path:string,value:string)=>{zipEntry(zip,path).content=new TextEncoder().encode(value)};
const addText=(zip:ZipPackage,path:string,value:string)=>XLSX.CFB.utils.cfb_add(zip as never,path,new TextEncoder().encode(value));
const addBinary=(zip:ZipPackage,path:string,value:Uint8Array)=>XLSX.CFB.utils.cfb_add(zip as never,path,value);

function setCell(xml:string,address:string,value:string|number|undefined,kind:'s'|'n'='s'){
  const pattern=new RegExp(`<c([^>]*?r="${address}"[^>]*?)(?:\\s*/>|>[\\s\\S]*?<\\/c>)`),match=xml.match(pattern);
  if(!match)throw new Error(`แม่แบบไม่ตรงรูปแบบ: ไม่พบช่อง ${address}`);
  let attributes=match[1].replace(/\s+t="[^"]*"/g,'').replace(/\/\s*$/,'');
  if(value===undefined||value==='')return xml.replace(pattern,`<c${attributes}/>`);
  if(kind==='s')attributes+=' t="inlineStr"';
  const body=kind==='n'?`<v>${Number(value)}</v>`:`<is><t xml:space="preserve">${xmlEscape(String(value))}</t></is>`;
  return xml.replace(pattern,`<c${attributes}>${body}</c>`);
}
function fillPageXml(source:string,session:CountSession,rows:DamagedSummaryRow[],page:number,totalPages:number){
  let xml=setCell(source,'B5',session.branchName);xml=setCell(xml,'G5',`${session.sessionNumber}${totalPages>1?` หน้า ${page}/${totalPages}`:''}`);xml=setCell(xml,'G6',new Date().toLocaleDateString('th-TH'));
  for(let offset=0;offset<20;offset++){const excelRow=10+offset,row=rows[offset];xml=setCell(xml,`A${excelRow}`,offset+1,'n');xml=setCell(xml,`B${excelRow}`,row?.productCode);xml=setCell(xml,`C${excelRow}`,row?.productName);xml=setCell(xml,`D${excelRow}`,row?Number(row.total.toFixed(3)):undefined,row?'n':'s');for(const column of ['E','F','G'])xml=setCell(xml,`${column}${excelRow}`,undefined)}
  return setCell(xml,'D30',Number(rows.reduce((sum,row)=>sum+row.total,0).toFixed(3)),'n');
}
function insertBefore(xml:string,closingTag:string,content:string){const index=xml.lastIndexOf(closingTag);if(index<0)throw new Error('โครงสร้างไฟล์แม่แบบไม่ถูกต้อง');return `${xml.slice(0,index)}${content}${xml.slice(index)}`}
function nextNumericId(xml:string,prefix:string){return Math.max(0,...[...xml.matchAll(new RegExp(`${prefix}(\\d+)`,'g'))].map(match=>Number(match[1])))+1}

export async function loadDefaultDamagedTemplate(){const response=await fetch('/damaged-product-template.xlsx',{cache:'no-store'});if(!response.ok)throw new Error('ไม่พบไฟล์แม่แบบ Excel กรุณาอัปโหลดแม่แบบใหม่');return response.arrayBuffer()}
export async function loadDefaultActionPlanTemplate(){const response=await fetch('/damage-action-plan-template.xlsx',{cache:'no-store'});if(!response.ok)throw new Error('ไม่พบไฟล์แม่แบบรายงาน Action plan');return response.arrayBuffer()}

export function buildDamagedWorkbook(template:ArrayBuffer,session:CountSession,rows:DamagedSummaryRow[]){
  const zip=XLSX.CFB.read(new Uint8Array(template),{type:'buffer'}) as unknown as ZipPackage;
  const workbookPath='xl/workbook.xml',workbookRelsPath='xl/_rels/workbook.xml.rels';let workbookXml=readText(zip,workbookPath),workbookRels=readText(zip,workbookRelsPath),contentTypes=readText(zip,'[Content_Types].xml');
  const sheetMatch=workbookXml.match(/<sheet\b[^>]*name="Apendix"[^>]*r:id="([^"]+)"[^>]*\/>/i);if(!sheetMatch)throw new Error('ไม่พบชีต Apendix ในไฟล์แม่แบบ');
  const targetMatch=workbookRels.match(new RegExp(`<Relationship\\b[^>]*Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"[^>]*/>`));if(!targetMatch)throw new Error('ไม่พบข้อมูลเชื่อมโยงของชีต Apendix');
  const templateSheetPath=`xl/${targetMatch[1].replace(/^\//,'')}`,sheetFile=templateSheetPath.split('/').at(-1)!;
  const sourceSheet=readText(zip,templateSheetPath),sourceSheetRels=readText(zip,`xl/worksheets/_rels/${sheetFile}.rels`);
  const drawingTarget=sourceSheetRels.match(/Type="[^"]*\/drawing"[^>]*Target="\.\.\/drawings\/([^"]+)"/)?.[1],printerTarget=sourceSheetRels.match(/Type="[^"]*\/printerSettings"[^>]*Target="\.\.\/printerSettings\/([^"]+)"/)?.[1];
  const sourceDrawing=drawingTarget?readText(zip,`xl/drawings/${drawingTarget}`):undefined,sourceDrawingRels=drawingTarget?readText(zip,`xl/drawings/_rels/${drawingTarget}.rels`):undefined,sourcePrinter=printerTarget?zipEntry(zip,`xl/printerSettings/${printerTarget}`).content:undefined;
  const pages=Math.max(1,Math.ceil(rows.length/20));writeText(zip,templateSheetPath,fillPageXml(sourceSheet,session,rows.slice(0,20),1,pages));
  let nextSheetId=nextNumericId(workbookXml,'sheetId="'),nextRelId=nextNumericId(workbookRels,'rId'),nextSheetNumber=Math.max(...zip.FullPaths.map(path=>Number(path.match(/\/sheet(\d+)\.xml$/)?.[1]||0)))+1,nextDrawingNumber=Math.max(...zip.FullPaths.map(path=>Number(path.match(/\/drawing(\d+)\.xml$/)?.[1]||0)))+1,nextPrinterNumber=Math.max(...zip.FullPaths.map(path=>Number(path.match(/\/printerSettings(\d+)\.bin$/)?.[1]||0)))+1;
  for(let page=2;page<=pages;page++){
    const newSheetFile=`sheet${nextSheetNumber++}.xml`,newSheetPath=`xl/worksheets/${newSheetFile}`,newRel=`rId${nextRelId++}`,name=`Apendix ${page}`;let newSheetRels=sourceSheetRels;
    if(drawingTarget&&sourceDrawing&&sourceDrawingRels){const newDrawing=`drawing${nextDrawingNumber++}.xml`;newSheetRels=newSheetRels.replace(`../drawings/${drawingTarget}`,`../drawings/${newDrawing}`);addText(zip,`xl/drawings/${newDrawing}`,sourceDrawing);addText(zip,`xl/drawings/_rels/${newDrawing}.rels`,sourceDrawingRels);contentTypes=insertBefore(contentTypes,'</Types>',`<Override PartName="/xl/drawings/${newDrawing}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)}
    if(printerTarget&&sourcePrinter){const newPrinter=`printerSettings${nextPrinterNumber++}.bin`;newSheetRels=newSheetRels.replace(`../printerSettings/${printerTarget}`,`../printerSettings/${newPrinter}`);addBinary(zip,`xl/printerSettings/${newPrinter}`,sourcePrinter)}
    addText(zip,newSheetPath,fillPageXml(sourceSheet,session,rows.slice((page-1)*20,page*20),page,pages));addText(zip,`xl/worksheets/_rels/${newSheetFile}.rels`,newSheetRels);
    workbookXml=insertBefore(workbookXml,'</sheets>',`<sheet name="${name}" sheetId="${nextSheetId++}" r:id="${newRel}"/>`);workbookRels=insertBefore(workbookRels,'</Relationships>',`<Relationship Id="${newRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${newSheetFile}"/>`);contentTypes=insertBefore(contentTypes,'</Types>',`<Override PartName="/${newSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  }
  writeText(zip,workbookPath,workbookXml);writeText(zip,workbookRelsPath,workbookRels);writeText(zip,'[Content_Types].xml',contentTypes);
  const output=XLSX.CFB.write(zip as never,{type:'array',fileType:'zip'}) as Uint8Array;return output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer;
}

function xmlCell(address:string,style:number,value:string|number|undefined,kind:'s'|'n'='s'){
  if(value===undefined||value==='')return `<c r="${address}" s="${style}"/>`;
  return kind==='n'?`<c r="${address}" s="${style}"><v>${Number(value)}</v></c>`:`<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}
function actionPlanRow(row:number,cells:string[],height=17.25){return `<row r="${row}" spans="1:6" ht="${height}" customHeight="1" x14ac:dyDescent="0.2">${cells.join('')}</row>`}
function decodePhoto(dataUrl:string){
  const match=dataUrl.match(/^data:image\/(jpeg|jpg|png);base64,([\s\S]+)$/i);if(!match)throw new Error('รูปภาพรายการนับไม่ใช่ไฟล์ JPEG หรือ PNG ที่รองรับ');
  const binary=atob(match[2]),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return {bytes,extension:match[1].toLowerCase()==='png'?'png':'jpg',contentType:match[1].toLowerCase()==='png'?'image/png':'image/jpeg'};
}
function drawingAnchor(rowIndex:number,relationshipId:string,pictureId:number){
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${rowIndex}</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="2095500" cy="1095375"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${pictureId}" name="ภาพการนับ ${pictureId}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2095500" cy="1095375"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

export function buildDamageActionPlanWorkbook(template:ArrayBuffer,rows:DamagedAuditRow[]){
  const zip=XLSX.CFB.read(new Uint8Array(template),{type:'buffer'}) as unknown as ZipPackage,sheetPath='xl/worksheets/sheet1.xml',sheetRelsPath='xl/worksheets/_rels/sheet1.xml.rels';
  let xml=readText(zip,sheetPath),contentTypes=readText(zip,'[Content_Types].xml');const sheetRows:string[]=[];
  sheetRows.push(actionPlanRow(1,[xmlCell('A1',1,'รหัสสินค้า'),xmlCell('B1',1,'ชื่อสินค้า'),xmlCell('C1',1,'หน่วย'),xmlCell('D1',1,'หมวดหมู่'),xmlCell('E1',2,'จำนวนนับต่อครั้ง'),xmlCell('F1',1,'ภาพ')],24));
  rows.forEach((item,index)=>{const row=index+2;sheetRows.push(actionPlanRow(row,[xmlCell(`A${row}`,4,item.productCode),xmlCell(`B${row}`,4,item.productName),xmlCell(`C${row}`,4,item.unit),xmlCell(`D${row}`,4,item.category||'ไม่ระบุหมวดหมู่'),xmlCell(`E${row}`,5,Number(item.quantity.toFixed(3)),'n'),xmlCell(`F${row}`,4,undefined)],90))});
  const finalRow=Math.max(1,rows.length+1),sheetData=`<sheetData>${sheetRows.join('')}</sheetData>`,columns='<cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/><col min="3" max="3" width="13" customWidth="1"/><col min="4" max="4" width="25" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/><col min="6" max="6" width="31" customWidth="1"/></cols>';
  xml=xml.replace(/<dimension ref="[^"]+"\/>/,`<dimension ref="A1:F${finalRow}"/>`).replace(/<cols>[\s\S]*?<\/cols>/,columns).replace(/<sheetData>[\s\S]*?<\/sheetData>/,sheetData).replace(/<mergeCells[\s\S]*?<\/mergeCells>/,'').replace(/<drawing\b[^>]*\/>/g,'');
  if(!/<cols>/.test(xml))xml=xml.replace(/<sheetFormatPr\b[^>]*\/>/,match=>`${match}${columns}`);

  const anchors:string[]=[],relationships:string[]=[];const extensions=new Set<string>();
  rows.forEach((item,index)=>{const photo=decodePhoto(item.photoDataUrl),number=index+1,relationshipId=`rId${number}`,mediaPath=`xl/media/damaged-count-${number}.${photo.extension}`;addBinary(zip,mediaPath,photo.bytes);anchors.push(drawingAnchor(index+1,relationshipId,number));relationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/damaged-count-${number}.${photo.extension}"/>`);extensions.add(`${photo.extension}|${photo.contentType}`)});
  if(rows.length){
    const drawingXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`;
    const drawingRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`;
    const sheetRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
    addText(zip,'xl/drawings/drawing1.xml',drawingXml);addText(zip,'xl/drawings/_rels/drawing1.xml.rels',drawingRels);addText(zip,sheetRelsPath,sheetRels);xml=insertBefore(xml,'</worksheet>','<drawing r:id="rId1"/>');
    if(!contentTypes.includes('/xl/drawings/drawing1.xml'))contentTypes=insertBefore(contentTypes,'</Types>','<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
    extensions.forEach(value=>{const [extension,contentType]=value.split('|');if(!new RegExp(`<Default[^>]+Extension="${extension}"`,'i').test(contentTypes))contentTypes=insertBefore(contentTypes,'</Types>',`<Default Extension="${extension}" ContentType="${contentType}"/>`)})
  }
  writeText(zip,sheetPath,xml);writeText(zip,'[Content_Types].xml',contentTypes);const output=XLSX.CFB.write(zip as never,{type:'array',fileType:'zip'}) as Uint8Array;return output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer;
}

export function damagedReportFileName(session:CountSession){const stamp=new Date().toISOString().slice(0,16).replace('T','_').replace(':','');return `Damaged_Product_${session.branchName}_${stamp}.xlsx`}
export function damageActionPlanFileName(session:CountSession){const stamp=new Date().toISOString().slice(0,16).replace('T','_').replace(':','');return `Damage_Count_Detail_With_Photos_${session.branchName}_${stamp}.xlsx`}
export function downloadArrayBuffer(data:ArrayBuffer,fileName:string){const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
