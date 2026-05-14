// backend/src/config/initDb.js

require('dotenv').config()
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

// Connect WITHOUT specifying database first (to create it if needed)
const adminPool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
  database: 'postgres', // connect to default db first
})

const DB_NAME = process.env.DB_NAME || 'smart_school'

// ─── Full Schema (matching YOUR schema exactly) ─────────────────────────────
const SCHEMA_SQL = `
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS (base auth table) ────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('teacher','student')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- ── TEACHERS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teachers (
  id            SERIAL PRIMARY KEY,
  user_id       INT          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),
  course        VARCHAR(150) NOT NULL UNIQUE,
  qualification VARCHAR(200),
  bio           TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);

-- ── STUDENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id            SERIAL PRIMARY KEY,
  user_id       INT          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),
  level         VARCHAR(10)  NOT NULL CHECK (level IN ('5','4','3')),
  date_of_birth DATE,
  address       TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_level   ON students(level);

-- ── ATTENDANCE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id         SERIAL PRIMARY KEY,
  student_id INT         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INT         NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  course     VARCHAR(150),
  status     VARCHAR(20) NOT NULL CHECK (status IN ('Present','Absent','Late','Excused')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, date, course)
);

CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_teacher_id ON attendance(teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date       ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_status     ON attendance(status);

-- ── ASSIGNMENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id          SERIAL PRIMARY KEY,
  teacher_id  INT          NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  description TEXT         NOT NULL,
  course      VARCHAR(150),
  due_date    DATE,
  priority    VARCHAR(20)  NOT NULL DEFAULT 'Medium'
                           CHECK (priority IN ('Low','Medium','High')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_teacher_id ON assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assignments_due_date   ON assignments(due_date);
CREATE INDEX IF NOT EXISTS idx_assignments_priority   ON assignments(priority);

-- ── NOTES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id         SERIAL PRIMARY KEY,
  teacher_id INT          NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL,
  content    TEXT         NOT NULL,
  course     VARCHAR(150),
  category   VARCHAR(50)  NOT NULL DEFAULT 'Lecture'
             CHECK (category IN ('Lecture','Summary','Reference','Exercise','Announcement')),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_teacher_id ON notes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_notes_category   ON notes(category);

-- ── MESSAGES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_message CHECK (sender_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_sender_id   ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at  ON messages(created_at);

-- ── Updated_at trigger function ────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers (safe — drops first if exists)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','teachers','students','attendance','assignments','notes']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END;
$$;
`

// ─── Seed Data ───────────────────────────────────────────────────────────────
// Password for ALL seed users: password123
// Hash: $2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u

const SEED_SQL = `
-- ── Users ─────────────────────────────────────────────────
INSERT INTO users (email, password_hash, role) VALUES
  ('teacher1@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'teacher'),
  ('teacher2@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'teacher'),
  ('teacher3@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'teacher'),
  ('student1@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'student'),
  ('student2@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'student'),
  ('student3@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'student')
ON CONFLICT (email) DO NOTHING;

-- ── Teachers ──────────────────────────────────────────────
INSERT INTO teachers (user_id, first_name, last_name, phone, course, qualification, bio)
SELECT u.id, t.first_name, t.last_name, t.phone, t.course, t.qualification, t.bio
FROM (VALUES
  ('teacher1@school.com', 'Alice',  'Johnson',  '+1234567890', 'Mathematics', 'PhD in Mathematics', 'Experienced math teacher with 10 years of experience.'),
  ('teacher2@school.com', 'Bob',    'Smith',    '+1234567891', 'Science',     'MSc in Physics',     'Passionate about science education.'),
  ('teacher3@school.com', 'Carol',  'Williams', '+1234567892', 'English',     'MA in Literature',   'Loves teaching literature and writing.')
) AS t(email, first_name, last_name, phone, course, qualification, bio)
JOIN users u ON u.email = t.email
ON CONFLICT (user_id) DO NOTHING;

-- ── Students ──────────────────────────────────────────────
INSERT INTO students (user_id, first_name, last_name, phone, level, date_of_birth, address)
SELECT u.id, s.first_name, s.last_name, s.phone, s.level, s.dob::DATE, s.address
FROM (VALUES
  ('student1@school.com', 'David', 'Brown',  '+1234567893', '5', '2010-05-15', '123 Main St, City'),
  ('student2@school.com', 'Eva',   'Davis',  '+1234567894', '4', '2011-08-20', '456 Oak Ave, City'),
  ('student3@school.com', 'Frank', 'Miller', '+1234567895', '3', '2012-12-10', '789 Pine Rd, City')
) AS s(email, first_name, last_name, phone, level, dob, address)
JOIN users u ON u.email = s.email
ON CONFLICT (user_id) DO NOTHING;

-- ── Assignments ───────────────────────────────────────────
INSERT INTO assignments (teacher_id, title, description, course, due_date, priority)
SELECT t.id, a.title, a.description, a.course, a.due_date::DATE, a.priority
FROM (VALUES
  ('teacher1@school.com', 'Algebra Homework',      'Solve the quadratic equations.',             'Mathematics', '2026-06-15', 'High'),
  ('teacher2@school.com', 'Physics Lab Report',    'Write a report on the pendulum experiment.', 'Science',     '2026-06-20', 'Medium'),
  ('teacher3@school.com', 'Essay on Shakespeare',  'Write a 1000-word essay on Hamlet.',         'English',     '2026-06-25', 'High')
) AS a(email, title, description, course, due_date, priority)
JOIN users u   ON u.email = a.email
JOIN teachers t ON t.user_id = u.id;

-- ── Notes ─────────────────────────────────────────────────
INSERT INTO notes (teacher_id, title, content, course, category)
SELECT t.id, n.title, n.content, n.course, n.category
FROM (VALUES
  ('teacher1@school.com', 'Introduction to Algebra', 'Algebra is the study of mathematical symbols...', 'Mathematics', 'Lecture'),
  ('teacher2@school.com', 'Newton''s Laws',           'First law: An object at rest stays at rest...',  'Science',     'Summary'),
  ('teacher3@school.com', 'Shakespeare Overview',     'William Shakespeare was an English playwright...','English',     'Reference')
) AS n(email, title, content, course, category)
JOIN users u   ON u.email = n.email
JOIN teachers t ON t.user_id = u.id;

-- ── Attendance ────────────────────────────────────────────
INSERT INTO attendance (student_id, teacher_id, date, course, status, note)
SELECT s.id, t.id, a.date::DATE, a.course, a.status, a.note
FROM (VALUES
  ('student1@school.com', 'teacher1@school.com', '2026-05-10', 'Mathematics', 'Present', 'On time'),
  ('student2@school.com', 'teacher2@school.com', '2026-05-10', 'Science',     'Present', 'Participated actively'),
  ('student3@school.com', 'teacher3@school.com', '2026-05-10', 'English',     'Late',    'Arrived 10 minutes late')
) AS a(student_email, teacher_email, date, course, status, note)
JOIN users su ON su.email = a.student_email
JOIN students s ON s.user_id = su.id
JOIN users tu ON tu.email = a.teacher_email
JOIN teachers t ON t.user_id = tu.id
ON CONFLICT (student_id, date, course) DO NOTHING;

-- ── Messages ──────────────────────────────────────────────
INSERT INTO messages (sender_id, receiver_id, content, is_read)
SELECT s.id, t.id, m.content, m.is_read::BOOLEAN
FROM (VALUES
  ('student1@school.com', 'teacher1@school.com', 'Hello teacher, I have a question about the homework.', 'false'),
  ('teacher1@school.com', 'student1@school.com', 'Sure, what''s your question?',                        'true')
) AS m(sender_email, receiver_email, content, is_read)
JOIN users s ON s.email = m.sender_email
JOIN users t ON t.email = m.receiver_email;
`

// ─── Main function ───────────────────────────────────────────────────────────

async function initDatabase() {
  console.log('\n╔════════════════════════════════════════════╗')
  console.log('║       🗄️  Database Initializer              ║')
  console.log('╚════════════════════════════════════════════╝\n')

  // ── Step 1: Create database if it doesn't exist ──────────
  console.log(`📌 Step 1: Checking if database "${DB_NAME}" exists...`)

  try {
    const client = await adminPool.connect()

    const exists = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [DB_NAME]
    )

    if (exists.rows.length === 0) {
      console.log(`   ➕ Creating database "${DB_NAME}"...`)
      // Can't use parameterized query for CREATE DATABASE
      await client.query(`CREATE DATABASE "${DB_NAME}"`)
      console.log(`   ✅ Database "${DB_NAME}" created!`)
    } else {
      console.log(`   ✅ Database "${DB_NAME}" already exists`)
    }

    client.release()
  } catch (err) {
    console.error(`   ❌ Failed to check/create database: ${err.message}`)
    console.error('\n   🔧 Make sure PostgreSQL is running and credentials are correct in .env')
    await adminPool.end()
    process.exit(1)
  }

  await adminPool.end()

  // ── Step 2: Connect to the target database ────────────────
  console.log(`\n📌 Step 2: Connecting to "${DB_NAME}"...`)

  const appPool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD,
    database: DB_NAME,
  })

  // ── Step 3: Create schema ─────────────────────────────────
  console.log('\n📌 Step 3: Creating tables and indexes...')

  try {
    await appPool.query(SCHEMA_SQL)
    console.log('   ✅ Schema created successfully!')

    // Verify tables
    const tablesResult = await appPool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    const tables = tablesResult.rows.map(r => r.table_name)
    console.log(`   📋 Tables found: ${tables.join(', ')}`)

  } catch (err) {
    console.error(`   ❌ Schema creation failed: ${err.message}`)
    await appPool.end()
    process.exit(1)
  }

  // ── Step 4: Seed data ─────────────────────────────────────
  console.log('\n📌 Step 4: Seeding sample data...')

  try {
    await appPool.query(SEED_SQL)
    console.log('   ✅ Seed data inserted!')

    // Show counts
    const tables = ['users', 'teachers', 'students', 'attendance', 'assignments', 'notes', 'messages']
    console.log('\n   📊 Record Counts:')
    console.log('   ┌──────────────┬──────────┐')
    console.log('   │ Table        │ Records  │')
    console.log('   ├──────────────┼──────────┤')

    for (const table of tables) {
      const r = await appPool.query(`SELECT COUNT(*) FROM ${table}`)
      const count = r.rows[0].count
      console.log(`   │ ${table.padEnd(12)} │ ${String(count).padStart(8)} │`)
    }

    console.log('   └──────────────┴──────────┘')

  } catch (err) {
    console.error(`   ⚠️  Seed warning: ${err.message}`)
    console.log('   (Tables exist but seed may have partial data — this is OK)')
  }

  // ── Step 5: Done ──────────────────────────────────────────
  await appPool.end()

  console.log('\n╔════════════════════════════════════════════╗')
  console.log('║   🎉 Database initialized successfully!     ║')
  console.log('╚════════════════════════════════════════════╝')
  console.log('\n   🔑 Test Credentials (all passwords: password123)')
  console.log('   ┌────────────────────────────┬──────────────┐')
  console.log('   │ Email                      │ Role         │')
  console.log('   ├────────────────────────────┼──────────────┤')
  console.log('   │ teacher1@school.com        │ teacher      │')
  console.log('   │ teacher2@school.com        │ teacher      │')
  console.log('   │ teacher3@school.com        │ teacher      │')
  console.log('   │ student1@school.com        │ student      │')
  console.log('   │ student2@school.com        │ student      │')
  console.log('   │ student3@school.com        │ student      │')
  console.log('   └────────────────────────────┴──────────────┘')
  console.log('\n   ▶  Now run: npm run dev\n')

  process.exit(0)
}

// ─── Run ─────────────────────────────────────────────────────────────────────
initDatabase().catch(err => {
  console.error('❌ Fatal error:', err.message)
  process.exit(1)
})