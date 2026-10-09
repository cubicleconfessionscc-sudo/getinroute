require('./env');
const path = require('node:path');

// PostgreSQL production mode: activated solely by DATABASE_URL being set.
// Everything below this branch is the existing SQLite path and stays untouched.
const USE_PG = !!process.env.DATABASE_URL;
if (USE_PG) {
  // Only reached on a BRAND-NEW, empty database (fresh Railway volume or the
  // local pg-migrate target BEFORE pg-migrate --apply runs). A migrated
  // database already has its own settings row; this seed is idempotent and is
  // never touched again afterwards.
  const FRESH_SETTINGS = {
    company: { name: 'GetinRoute', contactPhone: '', supportEmail: 'getinroute0@gmail.com', domain: '', inviteCode: '' },
    vehicleTypes: [
      { label: 'Sedan', slug: 'sedan', seats: 4 },
      { label: 'SUV', slug: 'suv', seats: 6 },
      { label: 'Tempo Traveller', slug: 'tempo', seats: 12 },
      { label: 'Mini Bus', slug: 'minibus', seats: 24 }
    ],
    loginTimes: [
      { label: 'Morning Shift', time: '09:00', cutoffMinutes: 120 },
      { label: 'Afternoon Shift', time: '14:00', cutoffMinutes: 120 }
    ],
    logoutTimes: [
      { label: 'Morning Shift', time: '18:00', cutoffMinutes: 120 },
      { label: 'Afternoon Shift', time: '22:00', cutoffMinutes: 120 }
    ],
    cabCutoffTime: '21:30',
    safeDropWindowMinutes: 30,
    defaultSpeedLimitKmph: 40,
    maxEmployees: 10000,
    maxVehicles: 750,
    noShowWindowMinutes: 15,
    noShowCountBeforeSuspension: 3,
    nightSafetyEnabled: false,
    nightSafetyStart: '20:00',
    nightSafetyEnd: '06:00',
    nightHours: { start: '20:00', end: '06:00' },
    maxAddressChanges: 2,
    checkInReminderMinutes: 15,
    nodalRadiusMeters: 1000,
    pickupRadiusMeters: 1000,
    nightDropAfter: '20:00',
    weeklyOff: ['Sun']
  };
  const pgdb = require('./pgdb');
  const { PG_SCHEMA } = require('./pg-schema');
  pgdb.setAppTimezone(process.env.APP_TIMEZONE || 'Asia/Kolkata');
  pgdb.exec(PG_SCHEMA);
  // Idempotent column ensures an already-migrated PG database gets P1.6 columns.
  try { pgdb.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS safety_drop_eligible INTEGER DEFAULT 0;"); } catch (e) {}
  // Soft-delete/archive columns (idempotent; safe on already-migrated databases).
  try { pgdb.exec("ALTER TABLE schedules ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE schedules ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE checkins ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE checkins ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE speed_events ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE speed_events ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE safety_alerts ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE safety_alerts ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE trip_events ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE trip_events ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE location_history ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE location_history ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  // Authoritative no-show log soft-delete columns (admin delete/clear is archive-only).
  try { pgdb.exec("ALTER TABLE employee_no_show_log ADD COLUMN IF NOT EXISTS archived_at TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE employee_no_show_log ADD COLUMN IF NOT EXISTS archived_by BIGINT;"); } catch (e) {}
  // Route type (LOGIN/LOGOUT/CUSTOM) + selected office for LOGIN/LOGOUT routes.
  try { pgdb.exec("ALTER TABLE routes ADD COLUMN IF NOT EXISTS route_type TEXT DEFAULT 'CUSTOM';"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE routes ADD COLUMN IF NOT EXISTS office_point_id BIGINT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE routes ADD COLUMN IF NOT EXISTS office_label TEXT;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE routes ADD COLUMN IF NOT EXISTS office_lat DOUBLE PRECISION;"); } catch (e) {}
  try { pgdb.exec("ALTER TABLE routes ADD COLUMN IF NOT EXISTS office_lng DOUBLE PRECISION;"); } catch (e) {}
  // Operational location a user belongs to (nullable; additive).
  try { pgdb.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS company_location_id BIGINT;"); } catch (e) {}
  const existing = pgdb.prepare('SELECT data FROM settings WHERE id = 1').get();
  if (!existing) {
    pgdb.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(FRESH_SETTINGS));
  }
  module.exports = pgdb;
  return;
}

const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'getinroute.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('admin','employee','driver','vendor')),
  emp_id TEXT UNIQUE,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  department TEXT,
  designation TEXT,
  password_hash TEXT NOT NULL,
  approved INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  lat REAL,
  lng REAL,
  last_update TEXT,
  vehicle_id INTEGER,
  reset_token TEXT,
  reset_expiry TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_point TEXT,
  end_point TEXT,
  speed_limit REAL DEFAULT 40,
  stops TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  company_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_name TEXT NOT NULL,
  plate TEXT,
  type TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  line INTEGER DEFAULT 1,
  trip INTEGER DEFAULT 1,
  route_id INTEGER,
  capacity INTEGER DEFAULT 4,
  stand TEXT,
  vendor_id INTEGER,
  speed REAL DEFAULT 0,
  lat REAL,
  lng REAL,
  last_update TEXT,
  status TEXT DEFAULT 'idle',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  vehicle_id INTEGER,
  route_id INTEGER,
  date TEXT,
  pickup_time TEXT,
  drop_time TEXT,
  login_time TEXT,
  logout_time TEXT,
  sequence INTEGER,
  status TEXT DEFAULT 'scheduled',
  approved INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  archived_at TEXT,
  archived_by INTEGER
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER,
  user_id INTEGER,
  type TEXT CHECK (type IN ('checkin','checkout')),
  lat REAL,
  lng REAL,
  time TEXT DEFAULT (datetime('now','localtime')),
  archived_at TEXT,
  archived_by INTEGER
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  schedule_id INTEGER,
  rating INTEGER,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT,
  message TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS speed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  vehicle_name TEXT,
  driver_name TEXT,
  speed REAL,
  speed_limit REAL,
  lat REAL,
  lng REAL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  archived_at TEXT,
  archived_by INTEGER
);

CREATE TABLE IF NOT EXISTS parking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  vehicle_name TEXT,
  plate TEXT,
  driver_id INTEGER,
  driver_name TEXT,
  parking_line TEXT,
  trip_date TEXT,
  vertical TEXT DEFAULT 'company',
  school_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS driver_cancel_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  driver_id INTEGER,
  all_stop_ids TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  resolved_at TEXT,
  vertical TEXT DEFAULT 'company',
  school_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER,
  receiver_id INTEGER,
  message TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS trip_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL,
  sender_id INTEGER,
  sender_role TEXT,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS route_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (route_id, employee_id)
);

CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_phone TEXT,
  message TEXT,
  provider TEXT,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_emp ON schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_vehicle ON schedules(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_checkins_sched ON checkins(schedule_id);
CREATE INDEX IF NOT EXISTS idx_veh_line_trip ON vehicles(line, trip);
CREATE INDEX IF NOT EXISTS idx_chat_sender ON chat_messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_chat_receiver ON chat_messages(receiver_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_trip_chat_trip ON trip_chat_messages(trip_id, id);
CREATE INDEX IF NOT EXISTS idx_route_emps_route ON route_employees(route_id);
`);

try { db.exec(`ALTER TABLE vehicles ADD COLUMN live_status TEXT DEFAULT 'idle';`); } catch (e) {}
try { db.exec(`ALTER TABLE vehicles ADD COLUMN current_stop INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN locked_until TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN method TEXT DEFAULT 'swipe';`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN schedule_date TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN otp TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN confirmed INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN otp_expires TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN otp_attempts INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN state TEXT DEFAULT 'pending';`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN cancelled_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN cancelled_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN safety_status TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN safety_drop_eligible INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN gender TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN last_login TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN home_address TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN home_lat REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN home_lng REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN pending_address TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN pending_lat REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN pending_lng REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN vendor_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE vehicles ADD COLUMN stand TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE vehicles ADD COLUMN vendor_id INTEGER;`); } catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT,
  status TEXT DEFAULT 'active',
  assigned_locations TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  last_login TEXT,
  login_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS address_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  old_address TEXT,
  new_address TEXT,
  new_lat REAL,
  new_lng REAL,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS nodal_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  type TEXT DEFAULT 'office',
  radius_meters INTEGER DEFAULT 1000,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Multi-location hierarchy: Company -> State -> City -> Operational Location.
-- company_id reuses the existing tenant key (the owning company admin's user id).
CREATE TABLE IF NOT EXISTS company_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_states ON company_states(company_id, name);

CREATE TABLE IF NOT EXISTS company_cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  state_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_cities ON company_cities(company_id, state_id, name);
CREATE INDEX IF NOT EXISTS idx_company_cities_state ON company_cities(state_id);

CREATE TABLE IF NOT EXISTS company_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  state_id INTEGER NOT NULL,
  city_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_locations ON company_locations(company_id, city_id, name);
CREATE INDEX IF NOT EXISTS idx_company_locations_city ON company_locations(city_id);
CREATE INDEX IF NOT EXISTS idx_company_locations_state ON company_locations(state_id);
`);

const DEFAULT_SETTINGS = {
  company: { name: 'GetinRoute', contactPhone: '', supportEmail: 'getinroute0@gmail.com', domain: '', inviteCode: '' },
  vehicleTypes: [
    { label: 'Sedan', slug: 'sedan', seats: 4 },
    { label: 'SUV', slug: 'suv', seats: 6 },
    { label: 'Tempo Traveller', slug: 'tempo', seats: 12 },
    { label: 'Mini Bus', slug: 'minibus', seats: 24 }
  ],
  loginTimes: [
    { label: 'Morning Shift', time: '09:00', cutoffMinutes: 120 },
    { label: 'Afternoon Shift', time: '14:00', cutoffMinutes: 120 }
  ],
  logoutTimes: [
    { label: 'Morning Shift', time: '18:00', cutoffMinutes: 120 },
    { label: 'Afternoon Shift', time: '22:00', cutoffMinutes: 120 }
  ],
  cabCutoffTime: '21:30',
  safeDropWindowMinutes: 30,
  defaultSpeedLimitKmph: 40,
  maxEmployees: 10000,
  maxVehicles: 750,
  noShowWindowMinutes: 15,
  noShowCountBeforeSuspension: 3,
  nightSafetyEnabled: false,
  nightSafetyStart: '20:00',
  nightSafetyEnd: '06:00',
  nightHours: { start: '20:00', end: '06:00' },
  maxAddressChanges: 2,
  checkInReminderMinutes: 15,
  nodalRadiusMeters: 1000,
  pickupRadiusMeters: 1000,
  nightDropAfter: '20:00',
  weeklyOff: ['Sun']
};

const existing = db.prepare('SELECT data FROM settings WHERE id = 1').get();
if (!existing) {
  db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS));
}

db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER NOT NULL,
  assigned_to INTEGER,
  escalation_level TEXT DEFAULT 'employee' CHECK (escalation_level IN ('employee','admin','owner')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','escalated','resolved','closed')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category TEXT DEFAULT 'general',
  subject TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  is_internal INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ticket_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id);
`);

module.exports = db;

/* ================= SCHOOL VERTICAL ================= */
// Discriminator model:
//   vertical   'company' | 'school'   (default 'company' — existing data untouched)
//   school_id  NULL for company rows; owning school for school rows (multi-school)

db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_phone TEXT,
  support_email TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS school_settings (
  school_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY,
  class_grade TEXT,
  section TEXT,
  education_level TEXT DEFAULT 'school' CHECK (education_level IN ('school','college')),
  can_login INTEGER DEFAULT 0,
  guardian_name_1 TEXT,
  guardian_phone_1 TEXT,
  guardian_name_2 TEXT,
  guardian_phone_2 TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS parent_children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  relation TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (parent_id, student_id)
);

CREATE TABLE IF NOT EXISTS sos_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER,
  reporter_id INTEGER,
  reporter_role TEXT,
  student_id INTEGER,
  vehicle_id INTEGER,
  lat REAL,
  lng REAL,
  message TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  resolved_at TEXT,
  resolved_by INTEGER
);

CREATE TABLE IF NOT EXISTS geofence_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER,
  zone_id INTEGER,
  vehicle_id INTEGER,
  student_id INTEGER,
  event TEXT CHECK (event IN ('enter','exit')),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_parent_children_student ON parent_children(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_children_parent ON parent_children(parent_id);
CREATE INDEX IF NOT EXISTS idx_sos_student ON sos_events(student_id, status);
CREATE INDEX IF NOT EXISTS idx_geofence_vehicle ON geofence_events(vehicle_id, created_at);
`);

// Safe additive columns (idempotent, mirrors the existing pattern).
try { db.exec(`ALTER TABLE vehicles ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE vehicles ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE vehicles ADD COLUMN speed_limit REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN sequence_control TEXT NOT NULL DEFAULT 'admin';`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN absent INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN boarded_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN dropped_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN drop_confirmed INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN drop_confirmed_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN drop_otp TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN direction TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN checkin_otp TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN cancel_status TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN cancel_reason TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE address_updates ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE address_updates ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE nodal_points ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE nodal_points ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE vendors ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE vendors ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN vertical TEXT NOT NULL DEFAULT 'company';`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN school_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN driver_verified INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN invite_code TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE vendors ADD COLUMN vendor_code TEXT;`); } catch (e) {}
// company vertical tenant binding: id of the company's owner admin (role='admin',
// vertical='company'). NULL means "shared workspace / legacy unbound account".
try { db.exec(`ALTER TABLE users ADD COLUMN company_id INTEGER;`); } catch (e) {}

// One-time table recreation to relax the users.role CHECK (SQLite cannot alter a CHECK).
(function migrateUsersRoles() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row || /student/.test(row.sql)) return;
  db.exec('BEGIN;');
  try {
    db.exec('ALTER TABLE users RENAME TO users_old;');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('admin','employee','driver','vendor','student','parent')),
        emp_id TEXT UNIQUE,
        email TEXT UNIQUE,
        name TEXT NOT NULL,
        phone TEXT,
        department TEXT,
        designation TEXT,
        password_hash TEXT NOT NULL,
        approved INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        lat REAL,
        lng REAL,
        last_update TEXT,
        vehicle_id INTEGER,
        reset_token TEXT,
        reset_expiry TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        locked_until TEXT,
        last_login TEXT,
        login_count INTEGER DEFAULT 0,
        home_address TEXT,
        home_lat REAL,
        home_lng REAL,
        pending_address TEXT,
        pending_lat REAL,
        pending_lng REAL,
        vendor_id INTEGER,
        invite_code TEXT,
        vertical TEXT NOT NULL DEFAULT 'company',
        school_id INTEGER,
        company_id INTEGER,
        driver_verified INTEGER DEFAULT 0,
        must_change_password INTEGER DEFAULT 0
      );
    `);
    db.exec(`
      INSERT INTO users (id, role, emp_id, email, name, phone, department, designation, password_hash, approved, status, lat, lng, last_update, vehicle_id, reset_token, reset_expiry, created_at, locked_until, last_login, login_count, home_address, home_lat, home_lng, pending_address, pending_lat, pending_lng, vendor_id, invite_code, vertical, school_id, company_id, driver_verified, must_change_password)
      SELECT id, role, emp_id, email, name, phone, department, designation, password_hash, approved, status, lat, lng, last_update, vehicle_id, reset_token, reset_expiry, created_at, locked_until, last_login, login_count, home_address, home_lat, home_lng, pending_address, pending_lat, pending_lng, vendor_id, invite_code, COALESCE(vertical, 'company'), school_id, NULL, COALESCE(driver_verified, 0), 0
      FROM users_old;
    `);
    db.exec('DROP TABLE users_old;');
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
})();

// Post-rebuild columns: the one-time users rebuild above recreates the table
// from an explicit column list, so any column that is only ALTERed before it
// (e.g. gender / safety_drop_eligible) would be silently dropped. Re-add them
// here so both legacy and brand-new databases end up with them.
try { db.exec(`ALTER TABLE users ADD COLUMN gender TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN safety_drop_eligible INTEGER DEFAULT 0;`); } catch (e) {}

try { db.exec(`ALTER TABLE users ADD COLUMN invite_code TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE vendors ADD COLUMN vendor_code TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE vendors ADD COLUMN assigned_route_ids TEXT DEFAULT '[]';`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN start_lat REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN start_lng REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN end_lat REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN end_lng REAL;`); } catch (e) {}
// Route type (LOGIN = Employees->Office, LOGOUT = Office->Employees) plus the
// selected office (a company nodal point). Existing routes keep the legacy
// CUSTOM type so their manually-set start/end are never altered.
try { db.exec(`ALTER TABLE routes ADD COLUMN route_type TEXT DEFAULT 'CUSTOM';`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN office_point_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN office_label TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN office_lat REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN office_lng REAL;`); } catch (e) {}
// Operational location a user (employee/driver/admin) belongs to. Additive and
// nullable so every existing user keeps working (unassigned = no location scope).
try { db.exec(`ALTER TABLE users ADD COLUMN company_location_id INTEGER;`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_users_company_location ON users(company_location_id);`); } catch (e) {}
// Employee home pickup radius (metres) set by admin on address approval; governs
// whether pickup defaults to the home address vs a shared pickup point.
try { db.exec(`ALTER TABLE users ADD COLUMN pickup_radius REAL;`); } catch (e) {}
// Employee-requested schedules go to the admin queue (source='employee',
// status='requested') instead of auto-confirming. Admin-created stay confirmed.
try { db.exec(`ALTER TABLE schedules ADD COLUMN source TEXT DEFAULT 'admin';`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN pickup_point TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN drop_mode TEXT DEFAULT 'door';`); } catch (e) {}
try { db.exec(`ALTER TABLE address_updates ADD COLUMN pickup_radius REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN missed_email_sent INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN missed_email_type TEXT;`); } catch (e) {}

// Soft-delete/archive columns (retention + audit friendly soft deletes so
// historical attendance/trip/safety/GPS records stay readable by AI + reports).
try { db.exec(`ALTER TABLE schedules ADD COLUMN archived_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE schedules ADD COLUMN archived_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN archived_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE checkins ADD COLUMN archived_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE speed_events ADD COLUMN archived_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE speed_events ADD COLUMN archived_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE safety_alerts ADD COLUMN archived_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE safety_alerts ADD COLUMN archived_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE trip_events ADD COLUMN archived_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE trip_events ADD COLUMN archived_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE location_history ADD COLUMN archived_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE location_history ADD COLUMN archived_by INTEGER;`); } catch (e) {}

// Realtime GPS usage + health monitoring (adaptive ping, stale detection, and
// usage counter vs the free-tier message budget). All added additively.
try { db.exec(`ALTER TABLE vehicles ADD COLUMN connected INTEGER DEFAULT 0;`); } catch (e) {}
try { db.exec(`ALTER TABLE vehicles ADD COLUMN gps_status TEXT DEFAULT 'stopped';`); } catch (e) {}

// Geocoding/routing response cache (MapLibre era). Keeps provider call volume
// minimal: identical searches/routes within TTL are served from PG/SQLite.
db.exec(`
CREATE TABLE IF NOT EXISTS geo_result_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('search','reverse')),
  cache_key TEXT UNIQUE NOT NULL,
  result TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS geo_route_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT UNIQUE NOT NULL,
  profile TEXT NOT NULL DEFAULT 'driving',
  points TEXT NOT NULL,
  result TEXT NOT NULL,
  distance_meters REAL,
  duration_seconds REAL,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_geo_result_cache_key ON geo_result_cache(kind, cache_key);
CREATE INDEX IF NOT EXISTS idx_geo_route_cache_key ON geo_route_cache(cache_key);
`);

// Cumulative realtime message / GPS-ping usage log. Row per active month keeps
// the table tiny (one row per month) so it never grows unbounded.
db.exec(`
  CREATE TABLE IF NOT EXISTS realtime_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL UNIQUE,
    messages INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Last-known socket connectivity per driver user (heartbeat + reconnect flags)
// so the admin dashboard can flag stale pins and "reconnecting" drivers.
db.exec(`
  CREATE TABLE IF NOT EXISTS driver_heartbeats (
    user_id INTEGER PRIMARY KEY,
    connected INTEGER DEFAULT 0,
    last_ping TEXT,
    reconnecting INTEGER DEFAULT 0,
    reconnecting_since TEXT,
    disconnected_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// GPS movement history — separate append-only store so the *current* position
// stays in vehicles/users (fast reads) while here we keep an audit trail of
// every accepted ping (coalesced server-side to GPS_HISTORY_COALESCE_MS).
db.exec(`
  CREATE TABLE IF NOT EXISTS location_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL CHECK (subject IN ('vehicle','user')),
    subject_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    speed REAL DEFAULT 0,
    source TEXT DEFAULT 'gps',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    archived_at TEXT,
    archived_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_location_history_subject ON location_history(subject, subject_id, id);
`);

// Keyed current-location store: ONE row per driver/employee, upserted on every
// incoming GPS ping (never appended). This is what lets the web map update a
// single driver's marker without re-fetching the whole fleet, and what scales
// to many concurrent drivers. Canonical UI reads stay in vehicles/users (done
// for speed); this table holds the tenant-scoped current position + heading.
db.exec(`
  CREATE TABLE IF NOT EXISTS driver_locations (
    driver_id INTEGER PRIMARY KEY,
    role TEXT DEFAULT 'driver',
    driver_name TEXT,
    vehicle_id INTEGER,
    company_id INTEGER,
    vendor_id INTEGER,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    speed_kmph REAL DEFAULT 0,
    heading REAL,
    source TEXT DEFAULT 'gps',
    last_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_driver_locations_company ON driver_locations(company_id, last_updated_at);
  CREATE INDEX IF NOT EXISTS idx_driver_locations_vendor ON driver_locations(vendor_id, last_updated_at);
`);

// Owner/Admin raw-data import audit trail: who imported what, when, how many
// rows landed, how many were skipped/rejected and the rejected rows + reasons
// (used later to export a "rejected.csv" back to the operator).
db.exec(`
  CREATE TABLE IF NOT EXISTS import_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    entity TEXT NOT NULL,
    source TEXT NOT NULL,
    filename TEXT,
    total_rows INTEGER DEFAULT 0,
    valid_rows INTEGER DEFAULT 0,
    duplicate_rows INTEGER DEFAULT 0,
    error_rows INTEGER DEFAULT 0,
    inserted_rows INTEGER DEFAULT 0,
    skipped_rows INTEGER DEFAULT 0,
    rejected_json TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Night Safety Drop alerts + confirmations. Row per employee-drop that enters the
// safety workflow: pending (awaiting passenger confirmation), confirmed (reached
// safely), alert ("I did not reach home") and resolved/allowed (admin/vendor
// intervention). Company + school verticals share this; vertical/school_id tag rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS safety_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER,
    employee_id INTEGER,
    employee_name TEXT,
    driver_id INTEGER,
    driver_name TEXT,
    vehicle_id INTEGER,
    vehicle_name TEXT,
    trip_id TEXT,
    lat REAL,
    lng REAL,
    vertical TEXT NOT NULL DEFAULT 'company',
    school_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    kind TEXT NOT NULL DEFAULT 'safety',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT,
    resolved_at TEXT,
    resolved_by INTEGER,
    resolved_by_role TEXT,
    action TEXT,
    archived_at TEXT,
    archived_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_safety_alerts_status ON safety_alerts(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_safety_alerts_schedule ON safety_alerts(schedule_id);
`);

// Immutable, additive per-trip event trail (boarded / dropped / cancelled /
// office_arrival / safety_* / driver_requested_cancel …). Never updated, never
// deleted — a complete audit record for every stop of every run.
db.exec(`
  CREATE TABLE IF NOT EXISTS trip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER,
    employee_id INTEGER,
    employee_name TEXT,
    vehicle_id INTEGER,
    date TEXT,
    kind TEXT NOT NULL,
    meta TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    archived_at TEXT,
    archived_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_trip_events_schedule ON trip_events(schedule_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_trip_events_kind ON trip_events(kind, created_at);
`);
