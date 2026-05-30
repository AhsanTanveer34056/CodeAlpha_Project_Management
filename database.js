const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.db');
let _db = null;
let _saveTimer = null;

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (_db) fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
  }, 150);
}

// Wraps sql.js to provide a better-sqlite3-like synchronous API
function getDB() {
  if (!_db) throw new Error('Database not initialized');

  return {
    prepare(sql) {
      return {
        run(...args) {
          const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
          _db.run(sql, params.map(p => p === undefined ? null : p));
          scheduleSave();
          const r1 = _db.exec('SELECT last_insert_rowid()');
          const r2 = _db.exec('SELECT changes()');
          return {
            lastInsertRowid: r1[0]?.values[0][0] ?? 0,
            changes: r2[0]?.values[0][0] ?? 0
          };
        },
        get(...args) {
          const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
          const stmt = _db.prepare(sql);
          stmt.bind(params.map(p => p === undefined ? null : p));
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },
        all(...args) {
          const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
          const rows = [];
          const stmt = _db.prepare(sql);
          stmt.bind(params.map(p => p === undefined ? null : p));
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        }
      };
    },
    exec(sql) {
      _db.exec(sql);
      scheduleSave();
    },
    transaction(fn) {
      return function (...args) {
        _db.run('BEGIN');
        try {
          const result = fn(...args);
          _db.run('COMMIT');
          scheduleSave();
          return result;
        } catch (e) {
          _db.run('ROLLBACK');
          throw e;
        }
      };
    }
  };
}

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules/sql.js/dist/', file)
  });

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }

  const db = getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      color TEXT DEFAULT '#0079bf',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#0079bf',
      owner_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assigned_to INTEGER,
      created_by INTEGER NOT NULL,
      due_date TEXT,
      priority TEXT DEFAULT 'medium',
      position INTEGER DEFAULT 0,
      labels TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      related_type TEXT,
      related_id INTEGER,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('Database initialized');
}

function isProjectMember(projectId, userId) {
  const row = getDB().prepare(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, userId);
  return !!row;
}

function createNotification(db, userId, type, message, relatedType, relatedId) {
  return db.prepare(
    'INSERT INTO notifications (user_id, type, message, related_type, related_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, type, message, relatedType, relatedId);
}

module.exports = { getDB, initDB, isProjectMember, createNotification };
