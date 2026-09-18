import {useState} from 'react';

const KEY='audit-list-page-size';
const OPTIONS=[10,20,50,100];

export function usePageSize(){
  const[size,setSizeState]=useState(()=>{
    const saved=Number(localStorage.getItem(KEY));
    return OPTIONS.includes(saved)?saved:20;
  });
  const setSize=(value:number)=>{setSizeState(value);localStorage.setItem(KEY,String(value));};
  return [size,setSize] as const;
}

export function PageSizeControl({total,page,setPage,pageSize,setPageSize}:{total:number;page:number;setPage:(page:number)=>void;pageSize:number;setPageSize:(size:number)=>void}){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const safePage=Math.min(page,pages);
  return <div className="list-pagination"><label>แสดง<select value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1)}}>{OPTIONS.map(value=><option key={value} value={value}>{value} รายการ</option>)}</select></label><span>หน้า {safePage} / {pages} · ทั้งหมด {total.toLocaleString('th-TH')}</span><div><button type="button" className="btn-quiet" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>ก่อนหน้า</button><button type="button" className="btn-quiet" disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}>ถัดไป</button></div></div>;
}
