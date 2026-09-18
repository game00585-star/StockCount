import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {db} from '../db/database';
import {backupTableNames,parseBackupText,restoreBackup,type BackupData,type BackupPreview} from './backupService';
import type {AuthUser} from './authService';

const admin:AuthUser={id:1,username:'admin',displayName:'Admin',role:'ADMIN',allowedBranches:['*'],isActive:true,createdAt:new Date(),updatedAt:new Date()};
const ordinary:AuthUser={...admin,username:'user',role:'USER'};
const emptyData=()=>Object.fromEntries(backupTableNames.map(name=>[name,[]])) as unknown as BackupData;
function preview(data:BackupData):BackupPreview{return{fileName:'test.json',document:{format:'audit-stock-count-backup',version:2,exportedAt:new Date().toISOString(),data},counts:Object.fromEntries(backupTableNames.map(name=>[name,data[name].length])) as BackupPreview['counts']}}

beforeEach(async()=>{await db.delete();await db.open()});

describe('backup validation and restore',()=>{
  it('rejects broken and unsupported files without touching the database',async()=>{
    await db.products.put({productCode:'OLD',productName:'ข้อมูลเดิม',unit:'ชิ้น',categoryCode:'',categoryName:'',isActive:true,createdAt:new Date(),updatedAt:new Date()});
    expect(()=>parseBackupText('{broken')).toThrow('ไฟล์ JSON เสีย');
    expect(()=>parseBackupText(JSON.stringify({format:'other',version:2,data:{}}))).toThrow('ไม่ใช่ Backup');
    expect(await db.products.get('OLD')).toBeTruthy();
  });

  it('blocks restore for non-admin users before backup or writes',async()=>{
    const backupCurrent=vi.fn(async()=>undefined),data=emptyData();
    data.auditUsers=[{...admin,password:'1234'}];
    await expect(restoreBackup(preview(data),ordinary,backupCurrent)).rejects.toThrow('เฉพาะผู้ดูแลระบบ');
    expect(backupCurrent).not.toHaveBeenCalled();
  });

  it('backs up current data and restores every table in one transaction',async()=>{
    const backupCurrent=vi.fn(async()=>undefined),data=emptyData(),now=new Date();
    data.products=[{productCode:'NEW',productName:'สินค้าใหม่',unit:'ชิ้น',categoryCode:'A',categoryName:'ทดสอบ',isActive:true,createdAt:now,updatedAt:now}];
    data.auditUsers=[{...admin,password:'1234'}];
    await restoreBackup(preview(data),admin,backupCurrent);
    expect(backupCurrent).toHaveBeenCalledOnce();
    expect((await db.products.toArray()).map(item=>item.productCode)).toEqual(['NEW']);
    expect(await db.auditUsers.count()).toBe(1);
  });

  it('rolls back all cleared tables when any restored row fails',async()=>{
    const now=new Date();
    await db.products.put({productCode:'OLD',productName:'ข้อมูลเดิม',unit:'ชิ้น',categoryCode:'',categoryName:'',isActive:true,createdAt:now,updatedAt:now});
    const data=emptyData();data.products=[{productCode:'NEW',productName:'ข้อมูลใหม่',unit:'ชิ้น',categoryCode:'',categoryName:'',isActive:true,createdAt:now,updatedAt:now}];
    data.auditUsers=[{...admin,password:'1'},{...admin,id:2,password:'2'}];
    await expect(restoreBackup(preview(data),admin,async()=>undefined)).rejects.toBeTruthy();
    expect(await db.products.get('OLD')).toBeTruthy();
    expect(await db.products.get('NEW')).toBeFalsy();
  });
});
