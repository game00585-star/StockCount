/* global process, AbortController, setTimeout, clearTimeout, fetch */
import mockPayload from './mock/dfarm-price-list.json' with {type:'json'};
import {DFARM_ENDPOINT,applyTemplate,normalizeDfarmPayload} from './dfarmProductMasterCore.mjs';

const json=(response,status,payload)=>response.status(status).setHeader('Content-Type','application/json; charset=utf-8').json(payload);
const parseBranches=()=>{try{const value=JSON.parse(process.env.DFARM_API_BRANCHES||'[]');return Array.isArray(value)?value.filter(item=>typeof item?.code==='string'&&typeof item?.name==='string'):[]}catch{return[]}};
const mode=()=>process.env.DFARM_API_ENABLED==='true'?'live':'mock';
const secretHeaders=()=>{const headers={};const raw=process.env.DFARM_API_HEADERS_JSON;if(raw){const parsed=JSON.parse(raw);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('DFARM_API_HEADERS_JSON ต้องเป็น JSON object');for(const [key,value] of Object.entries(parsed)){if(typeof value!=='string')throw new Error('ค่า header ทุกตัวใน DFARM_API_HEADERS_JSON ต้องเป็นข้อความ');headers[key]=value}}const name=process.env.DFARM_API_AUTH_HEADER_NAME,value=process.env.DFARM_API_AUTH_HEADER_VALUE;if(name&&value)headers[name]=value;return headers};

export default async function handler(request,response){
  if(request.method==='GET'){
    const branches=mode()==='live'?parseBranches():[{code:'MOCK_BRANCH',name:'สาขาทดสอบ (Mock)'}];
    return json(response,200,{mode:mode(),branches,priceField:process.env.DFARM_API_PRICE_FIELD||null,priceConfirmed:['Price','New_Price'].includes(process.env.DFARM_API_PRICE_FIELD||''),message:mode()==='mock'?'โหมดทดสอบ: ยังไม่มีการเรียก DFarm API จริง':'พร้อมเชื่อมต่อ DFarm ผ่าน Backend'});
  }
  if(request.method!=='POST')return json(response,405,{error:'รองรับเฉพาะ GET และ POST'});
  const branchCode=typeof request.body?.branchCode==='string'?request.body.branchCode.trim():'';
  const branches=mode()==='live'?parseBranches():[{code:'MOCK_BRANCH',name:'สาขาทดสอบ (Mock)'}],branch=branches.find(item=>item.code===branchCode);
  if(!branch)return json(response,403,{error:'สาขานี้ไม่ได้รับอนุญาตจากการตั้งค่า Backend'});
  try{
    let payload=mockPayload;
    if(mode()==='live'){
      const templateText=process.env.DFARM_API_REQUEST_TEMPLATE,headers=secretHeaders();
      if(!Object.keys(headers).length||!templateText)return json(response,503,{error:'ยังตั้งค่า DFarm Secret Headers หรือ Request Template ไม่ครบ'});
      let template;try{template=JSON.parse(templateText)}catch{return json(response,503,{error:'DFARM_API_REQUEST_TEMPLATE ไม่ใช่ JSON ที่ถูกต้อง'});}
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Number(process.env.DFARM_API_TIMEOUT_MS||20000));
      try{
        const upstream=await fetch(process.env.DFARM_API_URL||DFARM_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(applyTemplate(template,branchCode)),signal:controller.signal});
        const text=await upstream.text();if(!upstream.ok)throw new Error(`DFarm API ${upstream.status}: ${text.slice(0,300)}`);
        try{payload=JSON.parse(text)}catch{throw new Error('DFarm API ตอบกลับมาเป็นข้อมูลที่ไม่ใช่ JSON');}
      }finally{clearTimeout(timeout)}
    }
    const normalized=normalizeDfarmPayload(payload,process.env.DFARM_API_PRICE_FIELD);
    return json(response,200,{mode:mode(),branch,sourceFetchedAt:new Date().toISOString(),...normalized});
  }catch(error){return json(response,502,{error:error instanceof Error?error.message:'ดึงข้อมูล DFarm ไม่สำเร็จ'});}
}
