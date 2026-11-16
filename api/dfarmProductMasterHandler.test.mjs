/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './dfarm-product-master.js';

function invoke(method,body){
  let statusCode=0,payload;
  const response={status(code){statusCode=code;return this},setHeader(){return this},json(value){payload=value;return this}};
  return Promise.resolve(handler({method,body},response)).then(()=>({statusCode,payload}));
}

test('starts in mock mode without calling the real API',async()=>{
  const old=process.env.DFARM_API_ENABLED;delete process.env.DFARM_API_ENABLED;
  try{const result=await invoke('POST',{branchCode:'MOCK_BRANCH'});assert.equal(result.statusCode,200);assert.equal(result.payload.mode,'mock');assert.ok(result.payload.items.length>0)}finally{if(old===undefined)delete process.env.DFARM_API_ENABLED;else process.env.DFARM_API_ENABLED=old}
});

test('rejects a branch outside the backend allowlist',async()=>{
  const result=await invoke('POST',{branchCode:'NOT_ALLOWED'});
  assert.equal(result.statusCode,403);
});
