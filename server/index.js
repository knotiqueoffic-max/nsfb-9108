require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security & Logging ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('dev'));
const clientUrl = process.env.CLIENT_URL;
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or tools without origin header
    if (!origin) return callback(null, true);
    // Explicitly allow configured CLIENT_URL, local dev, or *.netlify.app domains
    if (
      !clientUrl ||
      clientUrl === '*' ||
      origin === clientUrl ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      /\.netlify\.app$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Static: uploaded files (product photos) ─────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── API Routes ───────────────────────────────────────────────────────────────
// Auth (public signup + login; no tenant lock applied here)
app.use('/api/auth',       require('./routes/auth'));

// Multi-tenant routes
app.use('/api/tenants',     require('./routes/tenants'));
app.use('/api/invitations', require('./routes/invitations'));
app.use('/api/suppliers',   require('./routes/suppliers'));
app.use('/api/warehouses',  require('./routes/warehouses'));
app.use('/api/billing',     require('./routes/billing'));
app.use('/api/super-admin', require('./routes/super-admin'));

// Tenant business data routes (all internally scoped by tenant_id via JWT)
app.use('/api/materials',  require('./routes/materials'));
app.use('/api/purchases',  require('./routes/purchases'));
app.use('/api/products',            require('./routes/products'));
app.use('/api/production',          require('./routes/production'));
app.use('/api/production-requests', require('./routes/production-requests'));
app.use('/api/workers',             require('./routes/workers'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/payouts',    require('./routes/payouts'));
app.use('/api/reports',    require('./routes/reports'));
app.use('/api/settings',   require('./routes/settings'));
app.use('/api/stock',      require('./routes/stock'));
app.use('/api/todos',         require('./routes/todos'));
app.use('/api/expenses',      require('./routes/expenses'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/audit-logs',    require('./routes/audit-logs'));

// ─── Platform connector status ────────────────────────────────────────────────
const connectors = {
  flipkart: require('./connectors/flipkart.connector'),
  amazon:   require('./connectors/amazon.connector'),
  meesho:   require('./connectors/meesho.connector'),
  etsy:     require('./connectors/etsy.connector'),
  myntra:   require('./connectors/myntra.connector'),
};

const { authenticate, adminOnly } = require('./middleware/auth');
app.get('/api/connectors/status', authenticate, adminOnly, (req, res) => {
  res.json(Object.values(connectors).map(c => c.getStatus()));
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'Knotique SaaS', version: '2.0.0' }));

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const { initAutoBackupScheduler } = require('./services/backup.service');

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🧶 Knotique Server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
    initAutoBackupScheduler();
  });
}

module.exports = app;
