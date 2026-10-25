const { safeDate } = require('./services/csv.service');
// copy-paste to test safeDate logic on "14-08-2026 14:30:00"
function testSafeDate(raw) {
  let str = String(raw).trim();
  if (!str) return new Date().toISOString().split('T')[0];
  const dateOnlyStr = str.split(' ')[0].split('T')[0];
  const yyyymmdd = dateOnlyStr.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, '0')}-${yyyymmdd[3].padStart(2, '0')}`;
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
  return "FAILED";
}
console.log('14-08-2026 14:30:00 =>', testSafeDate('14-08-2026 14:30:00'));
console.log('2026-08-14 14:30:00 =>', testSafeDate('2026-08-14 14:30:00'));
