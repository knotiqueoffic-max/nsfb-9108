const { safeDate } = require('./services/csv.service');

// I can't require it directly because csv.service might not export safeDate. 
// I will just copy safeDate to test it.

function testSafeDate(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return new Date().toISOString().split('T')[0];
  }

  const numVal = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()) ? parseFloat(raw.trim()) : NaN);
  if (!isNaN(numVal) && numVal > 30000 && numVal < 60000) {
    const date = new Date((numVal - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  let str = String(raw).trim();
  if (!str) return new Date().toISOString().split('T')[0];

  const dateOnlyStr = str.split(' ')[0].split('T')[0];

  const yyyymmdd = dateOnlyStr.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (yyyymmdd) {
    const year = yyyymmdd[1];
    const month = yyyymmdd[2].padStart(2, '0');
    const day = yyyymmdd[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const ddmmyyyy = dateOnlyStr.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/);
  if (ddmmyyyy) {
    const p1 = parseInt(ddmmyyyy[1], 10);
    const p2 = parseInt(ddmmyyyy[2], 10);
    const year = ddmmyyyy[3];
    let month, day;
    if (p1 > 12) {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      month = String(p1).padStart(2, '0');
      day = String(p2).padStart(2, '0');
    } else {
      day = String(p1).padStart(2, '0');
      month = String(p2).padStart(2, '0');
    }
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return new Date().toISOString().split('T')[0];
}

console.log('16-08-2026 =>', testSafeDate('16-08-2026'));
console.log('05/08/2026 =>', testSafeDate('05/08/2026'));
console.log('2026-08-01 14:30:00 =>', testSafeDate('2026-08-01 14:30:00'));
console.log('08 Aug 2026 =>', testSafeDate('08 Aug 2026'));
console.log('Aug 08, 2026 =>', testSafeDate('Aug 08, 2026'));
