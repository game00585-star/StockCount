import type {CountSession,CountSessionItem,Product} from '../types';

export function resolveSessionItems(
  session:CountSession|undefined,
  storedItems:CountSessionItem[],
  products:Product[]
):CountSessionItem[]{
  if(!session?.id||session.itemSource!=='ALLOWANCE')return storedItems;
  const allowanceItems=products.filter(product=>product.isActive).map(product=>({
    sessionId:session.id!,
    productCode:product.productCode,
    productNameSnapshot:product.productName,
    unitSnapshot:product.unit,
    categoryCodeSnapshot:product.categoryCode,
    categoryNameSnapshot:product.categoryName,
    addedAt:session.allowanceReferencedAt||session.createdAt
  }));
  const merged=new Map<string,CountSessionItem>(allowanceItems.map(item=>[item.productCode.trim().toLowerCase(),item]));
  storedItems.forEach(item=>merged.set(item.productCode.trim().toLowerCase(),item));
  return [...merged.values()];
}
