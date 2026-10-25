const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const BACKUP_DIR = path.resolve(__dirname, '../backups');
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../knotique.db');

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Format timestamp for filename: YYYY-MM-DD_HH-mm-ss
 */
function getTimestampString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

/**
 * Perform a database backup snapshot.
 */
async function performBackup(isAuto = false, tenantId = 1) {
  ensureBackupDir();
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Database file does not exist to backup');
  }

  const timestampStr = getTimestampString();
  const filename = `knotique-${isAuto ? 'auto' : 'manual'}-backup-${timestampStr}.db`;
  const destination = path.join(BACKUP_DIR, filename);

  // Copy SQLite DB file synchronously to ensure an atomic snapshot copy
  fs.copyFileSync(DB_PATH, destination);

  const stats = fs.statSync(destination);

  // Record last backup metadata in settings table if DB is available
  try {
    const backupInfo = {
      last_backup_at: new Date().toISOString(),
      last_backup_filename: filename,
      last_backup_type: isAuto ? 'auto' : 'manual',
      last_backup_status: 'success',
      last_backup_size_bytes: stats.size,
    };

    for (const [key, val] of Object.entries(backupInfo)) {
      const serialized = JSON.stringify(val);
      const existing = await db('settings').where({ tenant_id: tenantId, key }).first();
      if (existing) {
        await db('settings').where({ tenant_id: tenantId, key }).update({ value: serialized, updated_at: db.fn.now() });
      } else {
        await db('settings').insert({ tenant_id: tenantId, key, value: serialized });
      }
    }
  } catch (err) {
    console.warn('Could not record backup metadata in settings:', err.message);
  }

  // Prune old backups based on retention policy
  await pruneOldBackups(tenantId);

  return {
    filename,
    size: stats.size,
    created_at: stats.birthtime || stats.mtime,
    is_auto: isAuto,
  };
}

/**
 * Get configured backup retention days (default 30).
 */
async function getRetentionDays(tenantId = 1) {
  try {
    const row = await db('settings').where({ tenant_id: tenantId, key: 'backup_retention_days' }).first();
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      const num = parseInt(parsed, 10);
      if (!isNaN(num) && num > 0) return num;
    }
  } catch (err) {
    // fallback
  }
  return 30;
}

/**
 * Check if auto backup is enabled (default true).
 */
async function isAutoBackupEnabled(tenantId = 1) {
  try {
    const row = await db('settings').where({ tenant_id: tenantId, key: 'auto_backup_enabled' }).first();
    if (row && row.value !== undefined) {
      return Boolean(JSON.parse(row.value));
    }
  } catch (err) {
    // fallback
  }
  return true;
}

/**
 * Remove backups older than retention period.
 */
async function pruneOldBackups(tenantId = 1) {
  ensureBackupDir();
  const retentionDays = await getRetentionDays(tenantId);
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const files = fs.readdirSync(BACKUP_DIR);
  for (const file of files) {
    if (!file.endsWith('.db')) continue;
    const filePath = path.join(BACKUP_DIR, file);
    try {
      const stats = fs.statSync(filePath);
      const fileTime = stats.mtime.getTime();
      if (fileTime < cutoffTime) {
        fs.unlinkSync(filePath);
        console.log(`[Backup] Pruned old backup file: ${file}`);
      }
    } catch (e) {
      console.error(`Failed to prune backup file ${file}:`, e.message);
    }
  }
}

/**
 * List all available backup snapshots in BACKUP_DIR.
 */
async function listBackups() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR);
  const result = [];

  for (const file of files) {
    if (!file.endsWith('.db')) continue;
    const filePath = path.join(BACKUP_DIR, file);
    try {
      const stats = fs.statSync(filePath);
      result.push({
        filename: file,
        size: stats.size,
        created_at: stats.mtime || stats.birthtime,
        is_auto: file.includes('-auto-'),
      });
    } catch (e) {
      // skip unreadable files
    }
  }

  // Sort newest first
  result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return result;
}

/**
 * Restore database from a specific backup file.
 * Creates a safety backup before restoring.
 */
async function restoreBackup(filename) {
  ensureBackupDir();

  // Validate filename to prevent path traversal
  const safeName = path.basename(filename);
  const targetBackupPath = path.join(BACKUP_DIR, safeName);

  if (!fs.existsSync(targetBackupPath)) {
    throw new Error(`Backup file '${safeName}' not found`);
  }

  // 1. Create a safety snapshot of current DB before replacing
  const safetyName = `knotique-pre-restore-safety-${getTimestampString()}.db`;
  const safetyPath = path.join(BACKUP_DIR, safetyName);
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, safetyPath);
  }

  // 2. Restore DB file
  fs.copyFileSync(targetBackupPath, DB_PATH);

  return { message: `Database restored from '${safeName}'. Safety backup saved as '${safetyName}'.` };
}

/**
 * Delete a specific backup file.
 */
async function deleteBackup(filename) {
  ensureBackupDir();
  const safeName = path.basename(filename);
  const targetPath = path.join(BACKUP_DIR, safeName);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup file '${safeName}' not found`);
  }

  fs.unlinkSync(targetPath);
  return { message: `Backup '${safeName}' deleted successfully` };
}

/**
 * Initialize automatic daily backup scheduler on server startup.
 */
let schedulerInterval = null;

function initAutoBackupScheduler() {
  console.log('⏰ [Backup Scheduler] Initializing Daily Auto Backup System...');

  async function checkAndRunAutoBackup() {
    try {
      const enabled = await isAutoBackupEnabled();
      if (!enabled) return;

      const todayStr = new Date().toISOString().split('T')[0];
      const backups = await listBackups();
      
      // Check if an auto-backup or manual backup already exists for today's date
      const backedUpToday = backups.some(b => {
        const dStr = new Date(b.created_at).toISOString().split('T')[0];
        return dStr === todayStr;
      });

      if (!backedUpToday) {
        console.log(`[Backup Scheduler] No backup found for today (${todayStr}). Running daily backup...`);
        const result = await performBackup(true);
        console.log(`✅ [Backup Scheduler] Daily backup completed: ${result.filename} (${(result.size / 1024).toFixed(1)} KB)`);
      }
    } catch (err) {
      console.error('❌ [Backup Scheduler] Error running daily auto backup:', err.message);
    }
  }

  // Run initial check 10 seconds after server startup
  setTimeout(checkAndRunAutoBackup, 10000);

  // Check every 1 hour (3600000 ms)
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(checkAndRunAutoBackup, 60 * 60 * 1000);
}

module.exports = {
  performBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  initAutoBackupScheduler,
  isAutoBackupEnabled,
  getRetentionDays,
  BACKUP_DIR,
};
