export const DFARM_ENDPOINT='https://api2.dfarm.co.th/dfarm/api/v2/bplus/Price/list';

const text=value=>typeof value==='string'?value.trim():'';
const number=value=>value===''||value===null||value===undefined?undefined:Number(value);

export function normalizeDfarmPayload(payload,priceField){
  if(!payload||!Array.isArray(payload.result))throw new Error('DFarm response ไม่ถูกต้อง: ไม่พบ result แบบ Array');
  const confirmedPriceField=priceField==='Price'||priceField==='New_Price'?priceField:undefined;
  const seen=new Map();
  const items=payload.result.map((raw,index)=>{
    const code=text(raw?.GOODS_CODE),productName=text(raw?.GOODS_NAME),unit=text(raw?.UTQ_NAME),price=number(raw?.Price),newPrice=number(raw?.New_Price);
    const reasons=[];
    if(!code)reasons.push(typeof raw?.GOODS_CODE==='number'?'GOODS_CODE ต้องส่งเป็นข้อความเพื่อรักษาเลขศูนย์นำหน้าและรหัสยาว':'ไม่มี GOODS_CODE');
    if(!productName)reasons.push('ไม่มี GOODS_NAME');
    if(!unit)reasons.push('ไม่มี UTQ_NAME');
    if(code)seen.set(code,(seen.get(code)||0)+1);
    const selectedPrice=confirmedPriceField?number(raw?.[confirmedPriceField]):undefined;
    if(confirmedPriceField&&selectedPrice!==undefined&&!Number.isFinite(selectedPrice))reasons.push(`${confirmedPriceField} ไม่ใช่ตัวเลข`);
    return{row:index+1,productCode:code,barcode:code,productName,unit,price:confirmedPriceField&&Number.isFinite(selectedPrice)?selectedPrice:undefined,priceCandidates:{Price:Number.isFinite(price)?price:undefined,New_Price:Number.isFinite(newPrice)?newPrice:undefined},reviewReasons:reasons};
  });
  items.forEach(item=>{if(item.productCode&&(seen.get(item.productCode)||0)>1)item.reviewReasons.push('GOODS_CODE ซ้ำในผลตอบกลับ')});
  return{items,priceField:confirmedPriceField,priceConfirmed:!!confirmedPriceField};
}

export function applyTemplate(value,branchCode){
  if(Array.isArray(value))return value.map(item=>applyTemplate(item,branchCode));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,applyTemplate(item,branchCode)]));
  return typeof value==='string'?value.replaceAll('{{BRANCH_CODE}}',branchCode):value;
}
