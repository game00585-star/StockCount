import * as XLSX from 'xlsx';
import {describe,expect,it} from 'vitest';
import {parseMovementWorkbook} from './stock';

describe('parseMovementWorkbook',()=>{
  it('uses only A for code, C for name and D for unit',()=>{
    const source=[
      ['บริษัท ตัวอย่าง'],
      ['รายงานการเคลื่อนไหว'],
      ['รหัสสินค้า','','ชื่อสินค้า','หน่วย','','','','','','','','','','','ยอดคงเหลือ'],
      ['00123','','หมูบด','กก.','','','','','','','','','','','42.5'],
    ];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(source),'Report');
    const data=XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
    expect(parseMovementWorkbook(data)).toEqual([{row:4,productCode:'00123',sourceProductName:'หมูบด',sourceUnit:'กก.'}]);
  });
});
