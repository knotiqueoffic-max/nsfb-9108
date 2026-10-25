// knexfile.js — supports SQLite (default) and PostgreSQL (set KNEX_CLIENT=pg)
require('dotenv').config();
const path = require('path');

const client = process.env.KNEX_CLIENT || (process.env.DATABASE_URL ? 'pg' : 'sqlite3');
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'knotique.db');

const configs = {
  sqlite3: {
    client: 'sqlite3',
    connection: {
      filename: dbPath,
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, 'db', 'migrations'),
    },
    seeds: {
      directory: path.resolve(__dirname, 'db', 'seeds'),
    },
  },
  pg: {
    client: 'pg',
    connection: process.env.DATABASE_URL
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DB_NO_SSL ? false : { rejectUnauthorized: false },
        }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'knotique',
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        },
    pool: { min: 2, max: 10 },
    migrations: {
      directory: path.resolve(__dirname, 'db', 'migrations'),
    },
    seeds: {
      directory: path.resolve(__dirname, 'db', 'seeds'),
    },
  },
};

module.exports = configs[client];
