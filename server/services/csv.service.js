const Papa = require('papaparse');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');

/**
 * Strip leading apostrophe (') from strings e.g. Excel text artifacts like "'OD12345" or "'400001"
 */
function stripLeadingApostrophe(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.startsWith("'")) {
    str = str.slice(1).trim();
  }
  return str;
}

/**
 * Clean and normalize a header or string token.
 */
function cleanHeader(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/^\ufeff/, '')
    .toLowerCase()
    .replace(/[₹$€£]/g, '')
    .replace(/\b(rs\.?|inr)\b/gi, '')
    .replace(/[^a-z0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLATFORM_NORMALIZERS = {
  flipkart: {
    external_order_id: ['Order Id', 'Order ID', 'order_id', 'OrderId'],
    order_item_id:     ['ORDER ITEM ID', 'Order Item ID', 'order_item_id'],
    shipment_id:       ['Shipment ID', 'shipment_id'],
    sku:               ['SKU', 'Seller SKU', 'Product SKU', 'seller_sku'],
    product_name:      ['Product', 'Product Title', 'Product Name', 'Item Title'],
    quantity:          ['Quantity', 'Qty', 'quantity'],
    unit_price:        ['Selling Price Per Item', 'Selling Price', 'Your Selling Price', 'Final Settlement Price'],
    listing_price:     ['Price inc. FKMP Contribution & Subsidy', 'Listing Price', 'MRP', 'Invoice Amount'],
    order_date:        ['Ordered On', 'Order Date', 'order_date', 'Order Approval Date'],
    status:            ['Order State', 'Item Status', 'Order Status', 'Status'],
    tracking_id:       ['Tracking ID', 'tracking_id'],
    shipping_deadline: ['Dispatch by date', 'Dispatch After date', 'Expected Ship Date'],
    customer_name:     ['Ship to name', 'Buyer name', 'Customer Name'],
    address_line_1:    ['Address Line 1'],
    address_line_2:    ['Address Line 2'],
    customer_city:     ['City', 'Buyer City', 'Ship City'],
    customer_state:    ['State', 'Buyer State', 'Ship State'],
    customer_pincode:  ['PIN Code', 'Pin Code', 'Pincode', 'Zip Code'],
  },
  meesho: {
    external_order_id: ['Sub Order No.', 'Sub Order No', 'Order ID', 'sub_order_no'],
    order_item_id:     ['Sub Order No.', 'Order ID'],
    shipment_id:       ['Sub Order No.'],
    sku:               ['SKU', 'Product SKU', 'Style Code', 'Vendor SKU'],
    product_name:      ['Product Name', 'Item Name', 'Product Title'],
    quantity:          ['Quantity', 'Qty'],
    unit_price:        ['Customer Price', 'Selling Price', 'Supplier Discounted Price', 'Price'],
    listing_price:     ['Listing Price', 'MRP', 'Invoice Amount'],
    order_date:        ['Order Date', 'order_date', 'Created At', 'Order Date Time', 'Sub Order Date'],
    status:            ['Status', 'Order Status', 'Sub Order Status'],
    tracking_id:       ['AWB Number', 'Tracking ID'],
    shipping_deadline: ['Expected Dispatch Date', 'Dispatch Date'],
    customer_name:     ['Customer Name', 'Buyer Name'],
    address_line_1:    ['Customer Address', 'Address'],
    address_line_2:    ['Landmark'],
    customer_city:     ['City', 'Buyer City'],
    customer_state:    ['State', 'Buyer State'],
    customer_pincode:  ['Pincode', 'PIN Code'],
  },
  amazon: {
    external_order_id: ['order-id', 'Order ID', 'amazon-order-id'],
    order_item_id:     ['order-item-id', 'Order Item ID'],
    shipment_id:       ['shipment-id', 'Shipment ID'],
    sku:               ['sku', 'SKU', 'seller-sku', 'ASIN'],
    product_name:      ['product-name', 'Product Name', 'item-name'],
    quantity:          ['quantity-purchased', 'Quantity'],
    unit_price:        ['item-price', 'Price', 'price'],
    listing_price:     ['list-price', 'Listing Price', 'MRP'],
    order_date:        ['purchase-date', 'Order Date', 'order-date'],
    status:            ['order-status', 'Order Status'],
    tracking_id:       ['tracking-number', 'Tracking ID'],
    shipping_deadline: ['ship-service-level', 'Latest Ship Date'],
    customer_name:     ['recipient-name', 'Buyer Name'],
    address_line_1:    ['ship-address-1'],
    address_line_2:    ['ship-address-2'],
    customer_city:     ['ship-city', 'City'],
    customer_state:    ['ship-state', 'State'],
    customer_pincode:  ['ship-postal-code', 'PIN Code'],
  },
  etsy: {
    external_order_id: ['Order ID', 'Receipt ID', 'order_id'],
    order_item_id:     ['Transaction ID', 'Item ID'],
    shipment_id:       ['Receipt ID'],
    sku:               ['SKU', 'Listing ID'],
    product_name:      ['Item Name', 'Product', 'Title'],
    quantity:          ['Quantity', 'Qty'],
    unit_price:        ['Order Value', 'Sale Amount', 'Price'],
    listing_price:     ['Listing Price', 'MRP'],
    order_date:        ['Sale Date', 'Order Date', 'sale-date'],
    status:            ['Shipment', 'Shipping Status', 'Status'],
    tracking_id:       ['Tracking ID', 'Tracking Number'],
    shipping_deadline: null,
    customer_name:     ['Ship Name', 'Buyer'],
    address_line_1:    ['Ship Address1'],
    address_line_2:    ['Ship Address2'],
    customer_city:     ['Ship City', 'City'],
    customer_state:    ['Ship State', 'Country'],
    customer_pincode:  ['Ship Zipcode', 'PIN Code'],
  },
  myntra: {
    external_order_id: ['Myntra Order No', 'Order No', 'Order ID'],
    order_item_id:     ['Order Release ID', 'Item ID'],
    shipment_id:       ['Shipment No', 'Order ID'],
    sku:               ['SKU', 'Product SKU', 'Style Code'],
    product_name:      ['Product', 'Item', 'Product Name'],
    quantity:          ['Quantity', 'Qty'],
    unit_price:        ['Selling Price', 'MRP', 'Customer Paid Amount'],
    listing_price:     ['Listing Price', 'MRP'],
    order_date:        ['Order Date', 'order_date', 'Created Date'],
    status:            ['Current Status', 'Status'],
    tracking_id:       ['AWB No', 'Tracking ID'],
    shipping_deadline: ['Expected Ship Date', 'SLA Date'],
    customer_name:     ['Customer Name'],
    address_line_1:    ['Address Line 1'],
    address_line_2:    ['Address Line 2'],
    customer_city:     ['City', 'Delivery City'],
    customer_state:    ['State', 'Delivery State'],
    customer_pincode:  ['PIN Code', 'Pincode'],
  },
  generic: {
    external_order_id: ['Order ID', 'Order Id', 'order_id', 'External Order ID', 'Order No', 'Order Number'],
    order_item_id:     ['ORDER ITEM ID', 'Order Item ID', 'Item ID'],
    shipment_id:       ['Shipment ID', 'Shipment Id'],
    sku:               ['SKU', 'sku', 'Product SKU', 'Seller SKU', 'Item SKU'],
    product_name:      ['Product Name', 'product_name', 'Item Name', 'Product Title', 'Product'],
    quantity:          ['Quantity', 'quantity', 'Qty'],
    unit_price:        ['Selling Price Per Item', 'Price', 'price', 'Unit Price', 'Selling Price', 'Amount'],
    listing_price:     ['Price inc. FKMP Contribution & Subsidy', 'Listing Price', 'MRP', 'List Price'],
    order_date:        ['Ordered On', 'Order Date', 'order_date', 'Date', 'Created At'],
    status:            ['Order State', 'Status', 'status', 'Order Status'],
    tracking_id:       ['Tracking ID', 'Tracking Number'],
    shipping_deadline: ['Dispatch by date', 'Expected Ship Date', 'Promise Date'],
    customer_name:     ['Ship to name', 'Buyer name', 'Customer Name'],
    address_line_1:    ['Address Line 1', 'Address 1'],
    address_line_2:    ['Address Line 2', 'Address 2'],
    customer_city:     ['City', 'city', 'Buyer City'],
    customer_state:    ['State', 'state', 'Buyer State'],
    customer_pincode:  ['PIN Code', 'Pin Code', 'Pincode'],
  },
};

/**
 * Auto-detect platform from CSV headers.
 */
function detectPlatform(headers) {
  const cleanHeaders = headers.map(h => cleanHeader(h));
  const headerSet = new Set(cleanHeaders);

  if (
    headerSet.has('ordered on') ||
    headerSet.has('order item id') ||
    headerSet.has('selling price per item') ||
    headerSet.has('price inc fkmp contribution subsidy') ||
    headerSet.has('order state')
  ) {
    return 'flipkart';
  }

  if (headerSet.has('sub order no') || headerSet.has('sub order status')) return 'meesho';
  if (headerSet.has('amazon order id') || headerSet.has('asin') || headerSet.has('ship service level')) return 'amazon';
  if (headerSet.has('sale date') || headerSet.has('listing id') || headerSet.has('receipt id')) return 'etsy';
  if (headerSet.has('myntra order no') || headerSet.has('order release date')) return 'myntra';

  return 'generic';
}

/**
 * Safely parse a number value from a CSV cell.
 */
function safeNumber(raw, defaultValue = 0) {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  const cleaned = stripLeadingApostrophe(raw);
  const withoutCommas = cleaned.replace(/,/g, '');
  const match = withoutCommas.match(/-?\d+(\.\d+)?/);
  if (match) {
    const parsed = parseFloat(match[0]);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

function safeInt(raw, defaultValue = 1) {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  const cleaned = stripLeadingApostrophe(raw).replace(/[,\s]/g, '').trim();
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/**
 * Safely parse a date value from a CSV/Excel cell and format it as YYYY-MM-DD.
 * Handles "Aug 04, 2026", "Aug 4, 2026", "04-Aug-2026", "08/04/2026", "2026-08-04", Excel serials, etc.
 */
function safeDate(raw) {
  const getLocalToday = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (raw === null || raw === undefined || raw === '') {
    return getLocalToday();
  }

  if (raw instanceof Date) {
    if (!isNaN(raw.getTime())) {
      const y = raw.getFullYear();
      const m = String(raw.getMonth() + 1).padStart(2, '0');
      const d = String(raw.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return getLocalToday();
  }

  const cleanedRaw = stripLeadingApostrophe(raw);

  const numVal = typeof cleanedRaw === 'number' ? cleanedRaw : (typeof cleanedRaw === 'string' && /^\d+(\.\d+)?$/.test(cleanedRaw.trim()) ? parseFloat(cleanedRaw.trim()) : NaN);
  if (!isNaN(numVal) && numVal > 30000 && numVal < 60000) {
    const date = new Date((numVal - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  let str = String(cleanedRaw).trim();
  if (!str) return getLocalToday();

  // Clean time components
  let cleanStr = str.replace(/T\d{2}:\d{2}.*/, '').trim();
  cleanStr = cleanStr.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?/gi, '').trim();

  // 1. MMM DD, YYYY or MMM D, YYYY or MMM DD YYYY (e.g. "Aug 04, 2026", "Aug 4, 2026", "August 04, 2026")
  const mmmDdYyyy = cleanStr.match(/^([a-zA-Z]{3,9})[/\-\s]+(\d{1,2}),?[/\-\s]+(\d{2,4})/);
  if (mmmDdYyyy) {
    const monthStr = mmmDdYyyy[1].toLowerCase();
    const day = mmmDdYyyy[2].padStart(2, '0');
    let year = mmmDdYyyy[3];
    if (year.length === 2) year = '20' + year;
    const month = MONTH_MAP[monthStr];
    if (month) return `${year}-${month}-${day}`;
  }

  // 2. DD-MMM-YYYY or DD MMM YYYY (e.g. "04-Aug-2026", "4 Aug 2026")
  const ddMmmYyyy = cleanStr.match(/^(\d{1,2})[/\-\s]+([a-zA-Z]{3,9})[/\-\s]+(\d{2,4})/);
  if (ddMmmYyyy) {
    const day = ddMmmYyyy[1].padStart(2, '0');
    const monthStr = ddMmmYyyy[2].toLowerCase();
    let year = ddMmmYyyy[3];
    if (year.length === 2) year = '20' + year;
    const month = MONTH_MAP[monthStr];
    if (month) return `${year}-${month}-${day}`;
  }

  // 3. YYYY-MM-DD or YYYY/MM/DD
  const yyyymmdd = cleanStr.match(/^(\d{4})[/\-\.](\d{1,2})[/\-\.](\d{1,2})/);
  if (yyyymmdd) {
    const year = yyyymmdd[1];
    const month = yyyymmdd[2].padStart(2, '0');
    const day = yyyymmdd[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 4. DD-MM-YYYY or MM/DD/YYYY or DD/MM/YYYY
  const ddmmyyyy = cleanStr.match(/^(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})/);
  if (ddmmyyyy) {
    const p1 = parseInt(ddmmyyyy[1], 10);
    const p2 = parseInt(ddmmyyyy[2], 10);
    let year = ddmmyyyy[3];
    if (year.length === 2) year = '20' + year;

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

  return getLocalToday();
}

/**
 * Map raw Order State to internal status enum:
 * 'pending' | 'packed' | 'shipped' | 'delivered' | 'returned' | 'cancelled'
 */
function normalizeStatus(rawStatus, platform) {
  if (!rawStatus) return 'pending';
  const s = String(rawStatus).toLowerCase().trim();

  if (/cancel/.test(s)) return 'cancelled';
  if (/return|rto|refund/.test(s)) return 'returned';
  if (/deliver|complete|fulfilled|successful/.test(s)) return 'delivered';
  if (/pack|ready.*dispatch|ready.*ship|manifest/.test(s)) return 'packed';
  if (/shipped|shipping|dispatch|transit|out.for.delivery|handover/.test(s)) return 'shipped';
  if (/approved|complete|created|plle|pending|new|unshipped|processing|confirm|placed/.test(s)) return 'pending';

  return 'pending';
}

/**
 * Map a row from a platform CSV to the unified order schema.
 */
function normalizeRow(row, platform, headers = []) {
  const mapping = PLATFORM_NORMALIZERS[platform] || PLATFORM_NORMALIZERS.generic;

  const rowKeyMap = {};
  for (const actualKey of Object.keys(row)) {
    const cleaned = cleanHeader(actualKey);
    if (cleaned) rowKeyMap[cleaned] = actualKey;
  }

  function findValue(aliases, keyType = null, colIndex = -1) {
    if (aliases && Array.isArray(aliases)) {
      for (const alias of aliases) {
        const cleanAlias = cleanHeader(alias);
        if (rowKeyMap[cleanAlias] !== undefined) {
          const actualKey = rowKeyMap[cleanAlias];
          const val = row[actualKey];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return val;
          }
        }
      }
    }

    if (colIndex >= 0 && headers && headers[colIndex] !== undefined) {
      const colHeader = headers[colIndex];
      const val = row[colHeader];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }

    if (keyType) {
      const entry = Object.entries(rowKeyMap).find(([cleanH, actualK]) => {
        const val = row[actualK];
        if (val === undefined || val === null || String(val).trim() === '') return false;

        if (keyType === 'price') {
          return cleanH.includes('selling price') || cleanH.includes('item price') || cleanH.includes('price') || cleanH.includes('amount');
        }
        if (keyType === 'date') {
          if (cleanH.includes('ship') || cleanH.includes('dispatch') || cleanH.includes('deliver')) return false;
          return cleanH.includes('date') || cleanH.includes('ordered') || cleanH.includes('created');
        }
        if (keyType === 'sku') {
          return cleanH.includes('sku');
        }
        if (keyType === 'order_id') {
          return cleanH.includes('order id') || cleanH.includes('order no');
        }
        return false;
      });
      if (entry) return row[entry[1]];
    }

    return null;
  }

  const skuRaw = stripLeadingApostrophe(findValue(mapping.sku, 'sku'));
  const sku = skuRaw ? String(skuRaw).trim() : '';

  const extOrderId = stripLeadingApostrophe(findValue(mapping.external_order_id, 'order_id'));
  const orderItemId = stripLeadingApostrophe(findValue(mapping.order_item_id));
  const shipmentId = stripLeadingApostrophe(findValue(mapping.shipment_id));
  const trackingId = stripLeadingApostrophe(findValue(mapping.tracking_id));
  const pinCode = stripLeadingApostrophe(findValue(mapping.customer_pincode));

  const rawDeadline = findValue(mapping.shipping_deadline);
  const priceRaw = findValue(mapping.unit_price, 'price', 16); // Column P (Selling Price Per Item)
  const listingPriceRaw = findValue(mapping.listing_price, null, 19); // Column T (Price inc. FKMP...)
  const orderDateRaw = findValue(mapping.order_date, 'date', 0); // Column A (Ordered On)

  const addr1 = findValue(mapping.address_line_1) || '';
  const addr2 = findValue(mapping.address_line_2) || '';
  const fullAddress = [addr1, addr2].filter(Boolean).join(', ');

  return {
    platform: platform || 'flipkart',
    external_order_id: String(extOrderId || `IMPORT-${Date.now()}`).trim(),
    order_item_id: orderItemId || null,
    shipment_id: shipmentId || null,
    sku,
    product_name: String(findValue(mapping.product_name) || '').trim(),
    quantity: safeInt(findValue(mapping.quantity), 1),
    unit_price: safeNumber(priceRaw, 0),
    listing_price: (listingPriceRaw !== null && listingPriceRaw !== undefined && String(listingPriceRaw).trim() !== '') ? safeNumber(listingPriceRaw, null) : null,
    order_date: safeDate(orderDateRaw),
    status: normalizeStatus(findValue(mapping.status), platform),
    customer_name: String(findValue(mapping.customer_name) || '').trim(),
    customer_address: fullAddress || null,
    customer_city: String(findValue(mapping.customer_city) || '').trim(),
    customer_state: String(findValue(mapping.customer_state) || '').trim(),
    customer_pincode: pinCode || null,
    tracking_id: trackingId || null,
    shipping_deadline: rawDeadline ? safeDate(rawDeadline) : null,
    worker_name: findValue(['Worker Name', 'Worker', 'Assigned Worker', 'worker_name', 'worker']) || null,
  };
}

/**
 * Parse an uploaded CSV or XLSX file and return normalized order rows.
 */
async function parseOrderFile(filePath, forcePlatform = null) {
  const ext = path.extname(filePath).toLowerCase();
  let rows = [];
  let headers = [];

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf8');
    const result = Papa.parse(content, { header: true, skipEmptyLines: true, trimHeaders: true });
    rows = result.data;
    headers = result.meta.fields || [];
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = xlsx.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    headers = Object.keys(rows[0] || {});
  } else {
    throw new Error('Unsupported file format. Upload CSV or Excel.');
  }

  const platform = forcePlatform || detectPlatform(headers);
  const normalized = rows.map((row) => normalizeRow(row, platform, headers));
  return { platform, rows: normalized, count: normalized.length };
}

/**
 * Match normalized orders to product IDs in the DB by SKU.
 * SKU is source of truth. Product name is fallback display name only.
 */
async function matchOrdersToProducts(orders, tenantId = null) {
  const productsQuery = db('products').select('id', 'sku', 'name');
  if (tenantId) productsQuery.where('tenant_id', tenantId);
  const products = await productsQuery;

  // Build SKU lookup (trimmed, uppercase)
  const skuMap = {};
  products.forEach(p => {
    if (p.sku) skuMap[p.sku.trim().toUpperCase()] = p.id;
  });

  return orders.map(order => {
    let product_id = null;

    if (order.sku) {
      const orderSkuUpper = order.sku.trim().toUpperCase();
      product_id = skuMap[orderSkuUpper] || null;

      // Partial SKU match fallback (e.g. "SKU01-FBA" matches "SKU01")
      if (!product_id) {
        for (const [prodSku, prodId] of Object.entries(skuMap)) {
          if (orderSkuUpper.includes(prodSku) || prodSku.includes(orderSkuUpper)) {
            product_id = prodId;
            break;
          }
        }
      }
    }

    const unmatched_sku = !product_id;
    return { ...order, product_id, unmatched_sku };
  });
}

module.exports = {
  parseOrderFile,
  matchOrdersToProducts,
  detectPlatform,
  normalizeRow,
  safeDate,
  safeNumber,
  cleanHeader,
  stripLeadingApostrophe,
};
