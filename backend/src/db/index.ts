import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let db: Database.Database | null = null;

const MEETINGS_COLUMNS = ['id', 'require_approval', 'created_at', 'last_used_at'] as const;

function resolveDatabasePath(): string {
  const configured = config.databasePath.trim();
  if (configured === ':memory:') {
    return configured;
  }

  return path.resolve(configured);
}

function ensureDatabaseDirectory(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

function getTableColumns(database: Database.Database, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  )
    .map((column) => column.name)
    .sort();
}

function initializeSchema(database: Database.Database): void {
  const existingColumns = getTableColumns(database, 'meetings');

  if (existingColumns.length > 0) {
    const expectedColumns = [...MEETINGS_COLUMNS].sort();

    if (existingColumns.join(',') !== expectedColumns.join(',')) {
      database.exec('DROP TABLE IF EXISTS meetings');
      logger.info('Dropped outdated meetings table for schema refresh');
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      require_approval INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_meetings_last_used_at ON meetings(last_used_at);
  `);
}

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = resolveDatabasePath();
    ensureDatabaseDirectory(dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -8000');
    db.pragma('busy_timeout = 5000');
    db.pragma('temp_store = MEMORY');
    initializeSchema(db);
    logger.info({ dbPath: dbPath === ':memory:' ? ':memory:' : dbPath }, 'Database initialized');
  }

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Clears all meeting records. Used by tests only. */
export function resetDatabase(): void {
  const database = getDatabase();
  database.exec('DELETE FROM meetings');
}

/** Drops and recreates the schema. Used by tests only. */
export function refreshDatabase(): void {
  const database = getDatabase();
  database.exec('DROP TABLE IF EXISTS meetings');
  initializeSchema(database);
}
