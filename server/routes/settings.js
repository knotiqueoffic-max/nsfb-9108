const router = require('express').Router();
const db = require('../db/database');
const { authenticate, adminOnly, ownerOnly } = require('../middleware/auth');

router.use(authenticate, adminOnly);

// GET /api/settings — all settings for this tenant
router.get('/', async (req, res) => {
  const rows = await db('settings').where('tenant_id', req.tenant_id);
  const settings = {};
  rows.forEach(row => {
    try { settings[row.key] = JSON.parse(row.value); }
    catch { settings[row.key] = row.value; }
  });
  res.json(settings);
});

// PUT /api/settings — update one or more settings for this tenant
router.put('/', async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    const serialized = JSON.stringify(value);
    const existing = await db('settings').where({ tenant_id: req.tenant_id, key }).first();
    if (existing) {
      await db('settings').where({ tenant_id: req.tenant_id, key }).update({ value: serialized, updated_at: db.fn.now() });
    } else {
      await db('settings').insert({ tenant_id: req.tenant_id, key, value: serialized });
    }
  }

  const rows = await db('settings').where('tenant_id', req.tenant_id);
  const settings = {};
  rows.forEach(row => {
    try { settings[row.key] = JSON.parse(row.value); }
    catch { settings[row.key] = row.value; }
  });
  res.json(settings);
});

const path = require('path');
const fs = require('fs');
const {
  performBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  isAutoBackupEnabled,
  getRetentionDays,
  BACKUP_DIR,
} = require('../services/backup.service');

// GET /api/settings/backup — stream current SQLite DB file (legacy support & owner download)
router.get('/backup', ownerOnly, (req, res) => {
  const dbPath = path.resolve(__dirname, '../../knotique.db');

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Database file not found' });
  }

  const filename = `knotique-backup-${new Date().toISOString().split('T')[0]}.db`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  fs.createReadStream(dbPath).pipe(res);
});

// GET /api/settings/backups — list all backups & system status
router.get('/backups', ownerOnly, async (req, res) => {
  try {
    const tid = req.tenant_id || 1;
    const [backups, enabled, retention] = await Promise.all([
      listBackups(),
      isAutoBackupEnabled(tid),
      getRetentionDays(tid),
    ]);

    const lastBackupSetting = await db('settings').where({ tenant_id: tid, key: 'last_backup_at' }).first();
    let lastBackupAt = null;
    if (lastBackupSetting && lastBackupSetting.value) {
      try { lastBackupAt = JSON.parse(lastBackupSetting.value); } catch { lastBackupAt = lastBackupSetting.value; }
    } else if (backups.length > 0) {
      lastBackupAt = backups[0].created_at;
    }

    res.json({
      backups,
      auto_backup_enabled: enabled,
      backup_retention_days: retention,
      last_backup_at: lastBackupAt,
      count: backups.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list backups' });
  }
});

// POST /api/settings/backups/run — trigger instant backup snapshot
router.post('/backups/run', ownerOnly, async (req, res) => {
  try {
    const tid = req.tenant_id || 1;
    const backup = await performBackup(false, tid);
    res.json({ message: 'Backup created successfully!', backup });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create backup' });
  }
});

// GET /api/settings/backups/download/:filename — download specific snapshot
router.get('/backups/download/:filename', ownerOnly, (req, res) => {
  const safeName = path.basename(req.params.filename);
  const targetPath = path.join(BACKUP_DIR, safeName);

  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Requested backup file not found' });
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename=${safeName}`);
  fs.createReadStream(targetPath).pipe(res);
});

// POST /api/settings/backups/restore/:filename — restore DB from snapshot
router.post('/backups/restore/:filename', ownerOnly, async (req, res) => {
  try {
    const result = await restoreBackup(req.params.filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to restore database' });
  }
});

// DELETE /api/settings/backups/:filename — delete specified backup snapshot
router.delete('/backups/:filename', ownerOnly, async (req, res) => {
  try {
    const result = await deleteBackup(req.params.filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete backup' });
  }
});

// POST /api/settings/reset-database — wipe only this tenant's data
router.post('/reset-database', ownerOnly, async (req, res) => {
  const tid = req.tenant_id;
  try {
    await db('payouts').where('tenant_id', tid).del();
    await db('stock_adjustments').where('tenant_id', tid).del();
    await db('orders').where('tenant_id', tid).del();
    await db('production_entries').where('tenant_id', tid).del();

    // Cascade for finished_goods_stock: delete for tenant's products
    const tenantProducts = await db('products').where('tenant_id', tid).select('id');
    const productIds = tenantProducts.map(p => p.id);
    if (productIds.length > 0) {
      await db('finished_goods_stock').whereIn('product_id', productIds).del();
      await db('product_bom').whereIn('product_id', productIds).del();
      await db('product_platforms').whereIn('product_id', productIds).del();
    }

    await db('products').where('tenant_id', tid).del();
    await db('purchase_log').where('tenant_id', tid).del();
    await db('raw_materials').where('tenant_id', tid).del();
    // Keep users (workers) — resetting data doesn't delete the team

    res.json({ message: 'Database reset successfully! All business data cleared.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reset database' });
  }
});

module.exports = router;
