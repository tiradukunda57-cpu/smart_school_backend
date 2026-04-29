-- ============================================================
-- Smart School Management Platform — PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Drop tables (dev convenience) ──────────────────────────
DROP TABLE IF EXISTS messages        CASCADE;
DROP TABLE IF EXISTS notes           CASCADE;
DROP TABLE IF EXISTS assignments     CASCADE;
DROP TABLE IF EXISTS attendance      CASCADE;
DROP TABLE IF EXISTS students        CASCADE;
DROP TABLE IF EXISTS teachers        CASCADE;
DROP TABLE IF EXISTS users           CASCADE;

-- ── USERS (base auth table) ────────────────────────────────
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('teacher','student')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

-- ── TEACHERS ───────────────────────────────────────────────
CREATE TABLE teachers (
  id            SERIAL PRIMARY KEY,
  user_id       INT          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),
  subject       VARCHAR(150),
  qualification VARCHAR(200),
  bio           TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teachers_user_id ON teachers(user_id);

-- ── STUDENTS ───────────────────────────────────────────────
CREATE TABLE students (
  id            SERIAL PRIMARY KEY,
  user_id       INT          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),
  grade         VARCHAR(50),
  date_of_birth DATE,
  address       TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_grade   ON students(grade);

-- ── ATTENDANCE ─────────────────────────────────────────────
CREATE TABLE attendance (
  id         SERIAL PRIMARY KEY,
  student_id INT         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INT         NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  subject    VARCHAR(150),
  status     VARCHAR(20) NOT NULL CHECK (status IN ('Present','Absent','Late','Excused')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, date, subject)
);

CREATE INDEX idx_attendance_student_id ON attendance(student_id);
CREATE INDEX idx_attendance_teacher_id ON attendance(teacher_id);
CREATE INDEX idx_attendance_date       ON attendance(date);
CREATE INDEX idx_attendance_status     ON attendance(status);

-- ── ASSIGNMENTS ────────────────────────────────────────────
CREATE TABLE assignments (
  id          SERIAL PRIMARY KEY,
  teacher_id  INT          NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  description TEXT         NOT NULL,
  subject     VARCHAR(150),
  due_date    DATE,
  priority    VARCHAR(20)  NOT NULL DEFAULT 'Medium'
                           CHECK (priority IN ('Low','Medium','High')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_teacher_id ON assignments(teacher_id);
CREATE INDEX idx_assignments_due_date   ON assignments(due_date);
CREATE INDEX idx_assignments_priority   ON assignments(priority);

-- ── NOTES ─────────────────────────────────────────────────
CREATE TABLE notes (
  id         SERIAL PRIMARY KEY,
  teacher_id INT          NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL,
  content    TEXT         NOT NULL,
  subject    VARCHAR(150),
  category   VARCHAR(50)  NOT NULL DEFAULT 'Lecture'
             CHECK (category IN ('Lecture','Summary','Reference','Exercise','Announcement')),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_teacher_id ON notes(teacher_id);
CREATE INDEX idx_notes_category   ON notes(category);

-- ── MESSAGES ──────────────────────────────────────────────
CREATE TABLE messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_message CHECK (sender_id <> receiver_id)
);

CREATE INDEX idx_messages_sender_id   ON messages(sender_id);
CREATE INDEX idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX idx_messages_created_at  ON messages(created_at);

-- ── Updated_at trigger function ────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all relevant tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','teachers','students','attendance','assignments','notes']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END;
$$;

-- ── Sample seed data (optional) ────────────────────────────
-- Passwords are all bcrypt of "password123"
-- Hash: $2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u