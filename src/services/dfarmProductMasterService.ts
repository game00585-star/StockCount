import type {DfarmConfig,DfarmProductResponse} from '../types';

async function read<T>(response:Response){const data=await response.json().catch(()=>({error:`Backend ตอบกลับ HTTP ${response.status}`})) as T&{error?:string};if(!response.ok)throw new Error(data.error||`Backend HTTP ${response.status}`);return data}
export const dfarmProductMasterService={
  async getConfig(){return read<DfarmConfig>(await fetch('/api/dfarm-product-master',{headers:{Accept:'application/json'}}))},
  async fetchProducts(branchCode:string){return read<DfarmProductResponse>(await fetch('/api/dfarm-product-master',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({branchCode})}))}
};
