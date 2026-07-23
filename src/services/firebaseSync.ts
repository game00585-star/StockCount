import {db} from '../db/database';

const projectId='audit-stock-count';
const apiKey='AIzaSyD193e6G62EHa7nP0w2i-YLCPGe6Z3bOEU';
const base=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const collection='auditStockData';
const tableNames=['products','allowanceImports','movementImports','movementItems','countSessions','countSessionItems','countTransactions','movementDrafts','exportRecords'] as const;

type CloudDocument={name:string;fields?:{table?:{stringValue?:string};key?:{stringValue?:string};payload?:{stringValue?:string}}};

function toBase64(value:ArrayBuffer){
  const bytes=new Uint8Array(value);let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
function fromBase64(value:string){
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes.buffer;
}
function serialize(value:unknown){
  return JSON.stringify(value,(_key,item)=>item instanceof ArrayBuffer?{__arrayBuffer:toBase64(item)}:item);
}
function deserialize(payload:string){
  return JSON.parse(payload,(key,item)=>{
    if(item&&typeof item==='object'&&typeof item.__arrayBuffer==='string')return fromBase64(item.__arrayBuffer);
    if(typeof item==='string'&&/(At|Date|From|To)$/.test(key)&&/^\d{4}-\d\d-\d\dT/.test(item))return new Date(item);
    return item;
  });
}
function documentId(table:string,key:unknown){return `${table}__${encodeURIComponent(String(key))}`;}
async function request(url:string,init?:RequestInit){
  const response=await fetch(`${url}${url.includes('?')?'&':'?'}key=${apiKey}`,init);
  if(!response.ok)throw new Error(`Firebase ${response.status}: ${await response.text()}`);
  return response.status===204?undefined:response.json();
}
async function listDocuments(){
  const all:CloudDocument[]=[];let token='';
  do{
    const data=await request(`${base}/${collection}?pageSize=1000${token?`&pageToken=${encodeURIComponent(token)}`:''}`) as {documents?:CloudDocument[];nextPageToken?:string};
    all.push(...(data.documents||[]));token=data.nextPageToken||'';
  }while(token);
  return all;
}
async function localRows(){
  const rows:Array<{table:string;key:string;payload:string;id:string}>=[];
  for(const tableName of tableNames){
    const table=db.table(tableName),keyPath=table.schema.primKey.keyPath as string;
    for(const record of await table.toArray()){
      const key=record[keyPath];
      if(key===undefined||key===null)continue;
      rows.push({table:tableName,key:String(key),payload:serialize(record),id:documentId(tableName,key)});
    }
  }
  return rows;
}

async function performSync(){
  if(!navigator.onLine)return;
  const [local,remote]=await Promise.all([localRows(),listDocuments()]);
  const localIds=new Set(local.map(row=>row.id));
  const writes:object[]=[
    ...local.map(row=>({update:{name:`projects/${projectId}/databases/(default)/documents/${collection}/${row.id}`,fields:{table:{stringValue:row.table},key:{stringValue:row.key},payload:{stringValue:row.payload},updatedAt:{timestampValue:new Date().toISOString()}}}})),
    ...remote.filter(doc=>!localIds.has(doc.name.split('/').pop()||'')).map(doc=>({delete:doc.name}))
  ];
  for(let i=0;i<writes.length;i+=400){
    await request(`${base}:batchWrite`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes:writes.slice(i,i+400)})});
  }
}
export async function syncAllToFirestore(){
  try{await performSync();}
  catch(error){console.error('Firebase sync failed; data remains safely stored on this device.',error);}
}

export async function initializeCloudData(){
  try{
    const remote=await listDocuments();
    if(!remote.length){if((await localRows()).length)await syncAllToFirestore();return;}
    const localCount=await Promise.all(tableNames.map(name=>db.table(name).count()));
    if(localCount.some(Boolean))return;
    for(const tableName of tableNames){
      const records=remote.filter(doc=>doc.fields?.table?.stringValue===tableName&&doc.fields?.payload?.stringValue).map(doc=>deserialize(doc.fields!.payload!.stringValue!));
      if(records.length)await db.table(tableName).bulkPut(records);
    }
  }catch(error){
    console.error('Firebase sync unavailable; continuing with local data.',error);
  }
}
