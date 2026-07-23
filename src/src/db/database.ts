import Dexie,{type EntityTable} from 'dexie';
import type {AllowanceImport,CountSession,CountSessionItem,CountTransaction,MovementImport,MovementItem,ParsedMovement,Product} from '../types';
type MovementDraft={id:'movement';fileName:string;rows:ParsedMovement[];updatedAt:Date};
const baseSchema={products:'&productCode,productName,categoryName,isActive,updatedAt',allowanceImports:'++id,importedAt',movementImports:'++id,importedAt',movementItems:'++id,movementImportId,productCode,matched,[movementImportId+productCode]',countSessions:'++id,&sessionNumber,status,createdAt',countSessionItems:'++id,sessionId,productCode,&[sessionId+productCode]',countTransactions:'++id,sessionId,productCode,countedAt,[sessionId+productCode]'};
export class AuditDatabase extends Dexie {
  products!:EntityTable<Product,'productCode'>;allowanceImports!:EntityTable<AllowanceImport,'id'>;movementImports!:EntityTable<MovementImport,'id'>;movementItems!:EntityTable<MovementItem,'id'>;countSessions!:EntityTable<CountSession,'id'>;countSessionItems!:EntityTable<CountSessionItem,'id'>;countTransactions!:EntityTable<CountTransaction,'id'>;movementDrafts!:EntityTable<MovementDraft,'id'>;
  constructor(){super('AuditStockCountDB');this.version(1).stores(baseSchema);this.version(2).stores({...baseSchema,movementDrafts:'&id,updatedAt'});}
}
export const db=new AuditDatabase();
