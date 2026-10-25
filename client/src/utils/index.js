// Format number as Indian currency: ₹1,23,456
export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Format date as DD/MM/YYYY
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})[/\-](\d{2})[/\-](\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Get today's date as YYYY-MM-DD
export function today() {
  return new Date().toISOString().split('T')[0];
}

// Get date N days ago as YYYY-MM-DD
export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// Capitalize first letter
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

// Platform display names
export const PLATFORM_NAMES = {
  flipkart: 'Flipkart',
  meesho: 'Meesho',
  myntra: 'Myntra',
  etsy: 'Etsy',
  amazon: 'Amazon',
  manual: 'Manual',
};

export const PLATFORMS = ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon'];

export const WAGE_MODES = [
  { value: 'per_piece', label: 'Per Piece' },
  { value: 'per_hour', label: 'Per Hour' },
  { value: 'per_day', label: 'Per Day' },
];

export const ORDER_STATUSES = ['pending', 'packed', 'shipped', 'delivered', 'returned', 'cancelled'];

// Trigger a file download from a blob URL or API response
export function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
