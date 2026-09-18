import {db} from '../db/database';

export async function downloadJsonBackup() {
  const [
    products,
    allowanceImports,
    movementImports,
    movementItems,
    countSessions,
    countSessionItems,
    countTransactions,
    movementDrafts,
    auditUsers,
    exportRecords
  ] = await Promise.all([
    db.products.toArray(),
    db.allowanceImports.toArray(),
    db.movementImports.toArray(),
    db.movementItems.toArray(),
    db.countSessions.toArray(),
    db.countSessionItems.toArray(),
    db.countTransactions.toArray(),
    db.movementDrafts.toArray(),
    db.auditUsers.toArray(),
    db.exportRecords.toArray()
  ]);

  const backup = {
    format: 'audit-stock-count-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      products,
      allowanceImports,
      movementImports,
      movementItems,
      countSessions,
      countSessionItems,
      countTransactions,
      movementDrafts,
      auditUsers,
      // Keep only export history metadata. Excel binary files can be downloaded separately.
      exportRecords: exportRecords.map(({data: _data, ...record}) => record)
    }
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `Audit_Stock_Backup_${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
