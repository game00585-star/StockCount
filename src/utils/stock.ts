import * as XLSX from 'xlsx';
import type {
  CountSession,
  CountSessionItem,
  CountTransaction,
  ParsedMovement,
  ParsedProduct,
  Product,
  ProductMasterRow
} from '../types';

export function normalizeProductCode(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value).trim().replace(/^'/, '');

  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const [co, ex] = s.toLowerCase().split('e');
    const neg = co.startsWith('-');
    const c = co.replace(/^[-+]/, '');
    const [a, b = ''] = c.split('.');
    const digits = a + b;
    const point = a.length + Number(ex);
    s = point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point);
    if (neg) s = '-' + s;
  }

  return s.replace(/^(\d+)\.0+$/, '$1');
}

const tidy = (value: unknown) => String(value ?? '').trim();
const headerKey = (value: unknown) => tidy(value).replace(/\s/g, '').toLowerCase();
const matchName = (value: unknown) => tidy(value).normalize('NFKC').toLowerCase().replace(/[()（）[\]{}]/g,' ').replace(/[.,/\\\-_]/g,' ').replace(/\s+/g,' ').trim();
const sizePattern=/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(กิโลกรัม|กก\.?|kg\.?|กรัม|กร\.?|g\.?|มิลลิลิตร|มล\.?|ml\.?|ลิตร|ล\.?|ซม\.?|cm\.?|มม\.?|mm\.?|แพ็ค|แพค|ชิ้น|ขวด|ถุง|กล่อง|ห่อ|ซอง|ใบ)/giu;
const packPattern=/(?:แพ็ค|แพค|หิ้ว|กล่อง|ลัง)\s*[x×]\s*(\d+)/giu;
function sizeSignature(value:unknown){const text=tidy(value).normalize('NFKC').toLowerCase(),sizes:string[]=[];for(const match of text.matchAll(sizePattern)){let amount=Number(match[1].replace(/,/g,'')),unit=match[2].replace(/\./g,'');if(/กิโลกรัม|กก|kg/.test(unit)){amount*=1000;unit='g'}else if(/กรัม|กร|^g$/.test(unit))unit='g';else if(/มิลลิลิตร|มล|ml/.test(unit))unit='ml';else if(/ลิตร|^ล$/.test(unit)){amount*=1000;unit='ml'}else if(/ซม|cm/.test(unit))unit='cm';else if(/มม|mm/.test(unit))unit='mm';else unit=`count-${unit}`;sizes.push(`${Number(amount.toFixed(3))}${unit}`)}for(const match of text.matchAll(packPattern))sizes.push(`${Number(match[1])}count-pack`);return[...new Set(sizes)].sort().join('|')}
function baseProductName(value:unknown){return matchName(tidy(value).replace(sizePattern,' ').replace(packPattern,' ').replace(/ยกเลิก|ลดราคา/gi,' ')).replace(/\b(ขนาด|บรรจุ|แพ็ค|แพค|ชิ้น|ขวด|ถุง|กล่อง|ห่อ|ซอง)\b/gi,' ').replace(/\s+/g,' ').trim()}
function diceScore(left:string,right:string){const a=left.replace(/\s/g,''),b=right.replace(/\s/g,'');if(a===b)return 1;if(a.length<2||b.length<2)return 0;const grams=new Map<string,number>();for(let index=0;index<a.length-1;index++){const gram=a.slice(index,index+2);grams.set(gram,(grams.get(gram)||0)+1)}let hits=0;for(let index=0;index<b.length-1;index++){const gram=b.slice(index,index+2),count=grams.get(gram)||0;if(count){hits++;grams.set(gram,count-1)}}return 2*hits/(a.length+b.length-2)}

function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let index=0;index<text.length;index++){const character=text[index];if(character==='"'){if(quoted&&text[index+1]==='"'){cell+='"';index++}else quoted=!quoted}else if(character===','&&!quoted){row.push(cell);cell=''}else if((character==='\n'||character==='\r')&&!quoted){if(character==='\r'&&text[index+1]==='\n')index++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell=''}else cell+=character}row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows}

export function parseProductMasterCsv(data:ArrayBuffer):ProductMasterRow[]{let text='';try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{text=new TextDecoder('windows-874').decode(data)}text=text.replace(/^\uFEFF/,'');const rows=parseCsv(text),headers=rows[0]||[],barcodeIndex=locate(headers,['รหัสสินค้า/บาร์โค้ด','บาร์โค้ด','barcode'],0),nameIndex=locate(headers,['ชื่อสินค้า','productname'],1),unitIndex=locate(headers,['หน่วย','unit'],3),priceIndex=locate(headers,['ราคา(บาท)','ราคา','price'],4),typeIndex=locate(headers,['ประเภทราคา','pricetype'],7);return rows.slice(1).map(row=>({barcode:normalizeProductCode(row[barcodeIndex]),productName:tidy(row[nameIndex]),unitPrice:Number(String(row[priceIndex]??'').replace(/,/g,'')),unit:tidy(row[unitIndex]),priceType:tidy(row[typeIndex])})).filter(row=>row.barcode&&row.productName&&Number.isFinite(row.unitPrice))}

export function enrichAllowanceWithProductMaster(rows:ParsedProduct[],masterRows:ProductMasterRow[]){const ordered=[...masterRows].sort((a,b)=>Number(!/ปกติ|normal/i.test(a.priceType))-Number(!/ปกติ|normal/i.test(b.priceType))),normalRows=ordered.filter(row=>!/ลดราคา|discount/i.test(row.priceType)),masterByCode=new Map<string,ProductMasterRow>(),masterByName=new Map<string,ProductMasterRow>(),masterByCompactName=new Map<string,ProductMasterRow>();ordered.forEach(row=>{if(row.barcode&&!masterByCode.has(row.barcode))masterByCode.set(row.barcode,row)});normalRows.forEach(row=>{const key=matchName(row.productName),compact=key.replace(/\s/g,'');if(key&&!masterByName.has(key))masterByName.set(key,row);if(compact&&!masterByCompactName.has(compact))masterByCompactName.set(compact,row)});return rows.map(row=>{const key=matchName(row.productName),compact=key.replace(/\s/g,''),sourceSize=sizeSignature(row.productName),sourceBase=baseProductName(row.productName).replace(/\s/g,'');let matched=masterByCode.get(row.productCode)||masterByName.get(key)||masterByCompactName.get(compact);if(!matched){const ranked=normalRows.filter(candidate=>sizeSignature(candidate.productName)===sourceSize).map(candidate=>{const candidateBase=baseProductName(candidate.productName).replace(/\s/g,'');return{candidate,candidateBase,score:diceScore(sourceBase,candidateBase)}}).sort((a,b)=>b.score-a.score),best=ranked[0],second=ranked[1],contained=best&&(sourceBase.includes(best.candidateBase)||best.candidateBase.includes(sourceBase))&&Math.min(sourceBase.length,best.candidateBase.length)/Math.max(sourceBase.length,best.candidateBase.length)>=.65;if(best&&(contained||best.score>=.92&&best.score-(second?.score||0)>=.03))matched=best.candidate}return matched?{...row,barcode:matched.barcode,unitPrice:matched.unitPrice,masterMatched:true}:{...row,masterMatched:false}})}

function locate(headers: unknown[], names: string[], fallback: number) {
  const index = headers.findIndex(header => names.some(name => headerKey(header).includes(name)));
  return index >= 0 ? index : fallback;
}

export function parseAllowanceWorkbook(data: ArrayBuffer): ParsedProduct[] {
  const workbook = XLSX.read(data, {type: 'array', raw: false});
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false
  });

  if (!rows.length) throw new Error('ไม่พบข้อมูลในไฟล์ Allowance');

  let headerIndex = rows.findIndex(row =>
    row.some(cell => ['รหัสสินค้า', 'productcode', 'รหัส'].some(key => headerKey(cell).includes(key)))
  );
  if (headerIndex < 0) headerIndex = 0;

  const headers = rows[headerIndex];
  const codeIndex = locate(headers, ['รหัสสินค้า', 'productcode', 'code'], 0);
  const nameIndex = locate(headers, ['ชื่อสินค้า', 'productname', 'description'], 1);
  const unitIndex = locate(headers, ['หน่วยนับ', 'unit'], 2);
  const categoryCodeIndex = locate(headers, ['รหัสหมวด', 'categorycode'], 3);
  const categoryNameIndex = locate(headers, ['หมวดสินค้า', 'categoryname', 'category'], 4);

  return rows
    .slice(headerIndex + 1)
    .map((row, index) => ({
      row: headerIndex + index + 2,
      productCode: normalizeProductCode(row[codeIndex]),
      productName: tidy(row[nameIndex]),
      unit: tidy(row[unitIndex]),
      categoryCode: tidy(row[categoryCodeIndex]),
      categoryName: tidy(row[categoryNameIndex])
    }))
    .filter(row => row.productCode || row.productName);
}

function isMovementProductCode(value: unknown) {
  const code = normalizeProductCode(value);
  return !!code &&
    /\d/.test(code) &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(code) &&
    !/(รหัส|สินค้า|รวม|ยอด|report|company|date)/i.test(code);
}

export function parseMovementWorkbook(data: ArrayBuffer): ParsedMovement[] {
  const workbook = XLSX.read(data, {type: 'array', raw: false});
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false
  });

  if (!rows.length) throw new Error('ไม่พบข้อมูลในไฟล์รายการเคลื่อนไหว');

  const headerRow = rows.findIndex(row =>
    ['รหัสสินค้า', 'productcode', 'itemcode'].some(key => headerKey(row[0]).includes(key))
  );
  const start = rows.findIndex((row, index) => index > headerRow && isMovementProductCode(row[0]));

  if (start < 0) {
    throw new Error('ไม่พบรหัสสินค้าใน Column A กรุณาตรวจสอบว่าไฟล์ใช้ A = รหัสสินค้า และ C = ชื่อสินค้า');
  }

  return rows
    .slice(start)
    .map((row, index) => ({
      row: start + index + 1,
      productCode: normalizeProductCode(row[0]),
      sourceProductName: tidy(row[2]),
      sourceUnit: tidy(row[3])
    }))
    .filter(row => isMovementProductCode(row.productCode));
}

export function compareAllowance(rows: ParsedProduct[], existing: Product[]) {
  const seen = new Map<string, number>();
  rows.forEach(row => seen.set(row.productCode, (seen.get(row.productCode) || 0) + 1));

  const map = new Map(existing.map(product => [product.productCode, product]));

  return rows.map(row => {
    if (!row.productCode || !row.productName || !row.unit) {
      return {...row, status: 'invalid' as const, error: 'ข้อมูลสำคัญไม่ครบ'};
    }
    if ((seen.get(row.productCode) || 0) > 1) {
      return {...row, status: 'duplicate' as const, error: 'รหัสซ้ำในไฟล์'};
    }

    const old = map.get(row.productCode);
    if (!old) return {...row, status: 'insert' as const};

    const same = ['productName', 'unit', 'categoryCode', 'categoryName', 'barcode', 'unitPrice'].every(
      key => old[key as keyof Product] === row[key as keyof ParsedProduct]
    );
    return {...row, status: same ? 'skip' as const : 'update' as const};
  });
}

export function matchMovementWithProducts(rows: ParsedMovement[], products: Product[]) {
  const map = new Map(products.map(product => [product.productCode, product]));
  const seen = new Set<string>();

  return rows.map(row => {
    if (!row.productCode) {
      return {...row, status: 'invalid' as const, matched: false, matchReason: 'ไม่มีรหัสสินค้า', selected: false};
    }
    if (seen.has(row.productCode)) {
      return {...row, status: 'duplicate' as const, matched: false, matchReason: 'รหัสซ้ำในไฟล์', selected: false};
    }

    seen.add(row.productCode);
    const product = map.get(row.productCode);
    return {
      ...row,
      status: 'valid' as const,
      product,
      matched: !!product,
      matchReason: product ? 'พบใน Allowance' : 'ไม่พบใน Allowance',
      selected: !!product
    };
  });
}

export function calculateProductTotal(transactions: CountTransaction[]) {
  return transactions.reduce((sum, transaction) => sum + transaction.signedQuantity, 0);
}

export function formatThaiDateTime(date: Date | string) {
  return new Intl.DateTimeFormat('th-TH', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(date));
}

export function createSessionNumber(now = new Date(), sequence = 1) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  return `AUD-STOCK-${date}-${String(sequence).padStart(3, '0')}`;
}

function setupSheet(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!autofilter'] = {ref: ws['!ref'] || 'A1:A1'};
  ws['!freeze'] = {xSplit: 0, ySplit: 1};
  ws['!cols'] = widths.map(width => ({wch: width}));
}

function sortByCountTime(a: CountTransaction, b: CountTransaction) {
  return +new Date(a.countedAt) - +new Date(b.countedAt);
}

export function buildCountWorkbook(
  session: CountSession,
  items: CountSessionItem[],
  transactions: CountTransaction[],
  unmatched: ParsedMovement[] = []
) {
  const transactionsByProduct = new Map<string, CountTransaction[]>();
  transactions.forEach(transaction => {
    const code = normalizeProductCode(transaction.productCode);
    const current = transactionsByProduct.get(code) || [];
    current.push(transaction);
    transactionsByProduct.set(code, current);
  });

  transactionsByProduct.forEach(list => list.sort(sortByCountTime));
  const maxAttemptCount = Math.max(0, ...items.map(item => transactionsByProduct.get(normalizeProductCode(item.productCode))?.length || 0));

  const summary = items.map((item, index) => {
    const itemTransactions = transactionsByProduct.get(normalizeProductCode(item.productCode)) || [];
    const latest = [...itemTransactions].sort((a, b) => +new Date(b.countedAt) - +new Date(a.countedAt))[0];

    const row: Record<string, unknown> = {
      'ลำดับ': index + 1,
      'เลขที่รอบนับ': session.sessionNumber,
      'สาขา': session.branchName,
      'วันที่ตรวจ': new Date(session.countDate),
      'รหัสสินค้า': item.productCode,
      'ชื่อสินค้า': item.productNameSnapshot,
      'หน่วยนับ': item.unitSnapshot,
      'จำนวนเพิ่มรวม': itemTransactions.filter(transaction => transaction.action === 'ADD').reduce((sum, transaction) => sum + transaction.quantity, 0),
      'จำนวนลบรวม': itemTransactions.filter(transaction => transaction.action === 'SUBTRACT').reduce((sum, transaction) => sum + transaction.quantity, 0),
      'ยอดสุทธิ': calculateProductTotal(itemTransactions),
      'จำนวนครั้งที่บันทึก': itemTransactions.length,
      'วันที่และเวลาล่าสุด': latest ? new Date(latest.countedAt) : '',
      'ผู้ตรวจนับล่าสุด': latest?.countedBy || '',
      'หมายเหตุล่าสุด': latest?.note || ''
    };

    for (let attempt = 0; attempt < maxAttemptCount; attempt += 1) {
      const transaction = itemTransactions[attempt];
      const label = `นับครั้งที่ ${attempt + 1}`;
      row[`${label} รายการ`] = transaction ? (transaction.action === 'ADD' ? 'เพิ่ม' : 'ลบ') : '';
      row[`${label} จำนวน`] = transaction?.signedQuantity ?? '';
      row[`${label} ยอดก่อน`] = transaction?.previousTotal ?? '';
      row[`${label} ยอดหลัง`] = transaction?.newTotal ?? '';
      row[`${label} เวลา`] = transaction ? new Date(transaction.countedAt) : '';
      row[`${label} ผู้ตรวจ`] = transaction?.countedBy || '';
      row[`${label} หมายเหตุ`] = transaction?.note || '';
    }

    return row;
  });

  const history = [...transactions].sort(sortByCountTime).map((transaction, index) => ({
    'ลำดับ': index + 1,
    'เลขที่รอบนับ': session.sessionNumber,
    'สาขา': session.branchName,
    'รหัสสินค้า': transaction.productCode,
    'ชื่อสินค้า': transaction.productNameSnapshot,
    'ประเภทรายการ': transaction.action === 'ADD' ? 'เพิ่ม' : 'ลบ',
    'จำนวน': transaction.quantity,
    'จำนวนแบบมีเครื่องหมาย': transaction.signedQuantity,
    'ยอดก่อน': transaction.previousTotal,
    'ยอดหลัง': transaction.newTotal,
    'หมายเหตุ': transaction.note,
    'ผู้ตรวจนับ': transaction.countedBy,
    'วันที่': new Date(transaction.countedAt),
    'เวลา': new Date(transaction.countedAt).toLocaleTimeString('th-TH'),
    'วันที่และเวลาเต็ม': new Date(transaction.countedAt)
  }));

  const missing = unmatched.map((row, index) => ({
    'ลำดับ': index + 1,
    'รหัสสินค้าจากไฟล์เคลื่อนไหว': row.productCode,
    'ชื่อสินค้า': row.sourceProductName,
    'หน่วยนับ': row.sourceUnit,
    'ชื่อไฟล์': session.movementFileName || '',
    'เหตุผล': row.matchReason || 'ไม่พบใน Allowance',
    'วันที่ Import': new Date()
  }));

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(summary);
  setupSheet(summarySheet, [
    8, 24, 18, 16, 18, 36, 14, 16, 16, 14, 18, 22, 22, 30,
    ...Array.from({length: maxAttemptCount}).flatMap(() => [14, 14, 14, 14, 22, 20, 28])
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'สรุปการนับ');

  const historySheet = XLSX.utils.json_to_sheet(history);
  setupSheet(historySheet, [8, 24, 18, 18, 36, 14, 12, 18, 14, 14, 28, 20, 16, 14, 22]);
  XLSX.utils.book_append_sheet(workbook, historySheet, 'ประวัติการนับ');

  const missingSheet = XLSX.utils.json_to_sheet(missing);
  setupSheet(missingSheet, [8, 24, 36, 14, 28, 24, 20]);
  XLSX.utils.book_append_sheet(workbook, missingSheet, 'รายการไม่พบใน Allowance');

  return workbook;
}

export function exportCountSessionToExcel(
  session: CountSession,
  items: CountSessionItem[],
  transactions: CountTransaction[],
  unmatched: ParsedMovement[] = []
) {
  const workbook = buildCountWorkbook(session, items, transactions, unmatched);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  XLSX.writeFile(workbook, `Audit_Stock_Count_${session.branchName}_${stamp}.xlsx`);
}
