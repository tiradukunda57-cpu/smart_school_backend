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
  course        VARCHAR(150) NOT NULL UNIQUE,
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
  level         VARCHAR(10)  NOT NULL CHECK (level IN ('5','4','3')),
  date_of_birth DATE,
  address       TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_level   ON students(level);

-- ── ATTENDANCE ─────────────────────────────────────────────
CREATE TABLE attendance (
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
  course      VARCHAR(150),
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
  course     VARCHAR(150),
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

-- ── Sample seed data ────────────────────────────
-- Passwords are all bcrypt of "password123"
-- Hash: $2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u

-- Users
INSERT INTO users (email, password_hash, role) VALUES
  ('teacher1@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'teacher'),
  ('teacher2@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'teacher'),
  ('teacher3@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'teacher'),
  ('student1@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'student'),
  ('student2@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'student'),
  ('student3@school.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCMRW.4UoKmbyJlQvamFZ0u', 'student');

-- Teachers (one per course)
INSERT INTO teachers (user_id, first_name, last_name, phone, course, qualification, bio) VALUES
  (1, 'Alice', 'Johnson', '+1234567890', 'Mathematics', 'PhD in Mathematics', 'Experienced math teacher with 10 years of experience.'),
  (2, 'Bob', 'Smith', '+1234567891', 'Science', 'MSc in Physics', 'Passionate about science education.'),
  (3, 'Carol', 'Williams', '+1234567892', 'English', 'MA in Literature', 'Loves teaching literature and writing.');

-- Students (all levels, no subject choice)
INSERT INTO students (user_id, first_name, last_name, phone, level, date_of_birth, address) VALUES
  (4, 'David', 'Brown', '+1234567893', '5', '2010-05-15', '123 Main St, City'),
  (5, 'Eva', 'Davis', '+1234567894', '4', '2011-08-20', '456 Oak Ave, City'),
  (6, 'Frank', 'Miller', '+1234567895', '3', '2012-12-10', '789 Pine Rd, City');

-- Assignments (updated to 2026)
INSERT INTO assignments (teacher_id, title, description, course, due_date, priority) VALUES
  (1, 'Algebra Homework', 'Solve the quadratic equations.', 'Mathematics', '2026-06-15', 'High'),
  (2, 'Physics Lab Report', 'Write a report on the pendulum experiment.', 'Science', '2026-06-20', 'Medium'),
  (3, 'Essay on Shakespeare', 'Write a 1000-word essay on Hamlet.', 'English', '2026-06-25', 'High');

-- Notes
INSERT INTO notes (teacher_id, title, content, course, category) VALUES
  (1, 'Introduction to Algebra', 'Algebra is the study of mathematical symbols...', 'Mathematics', 'Lecture'),
  (2, 'Newton''s Laws', 'First law: An object at rest stays at rest...', 'Science', 'Summary'),
  (3, 'Shakespeare Overview', 'William Shakespeare was an English playwright...', 'English', 'Reference');

-- Attendance (updated to 2026)
INSERT INTO attendance (student_id, teacher_id, date, course, status, note) VALUES
  (1, 1, '2026-05-10', 'Mathematics', 'Present', 'On time'),
  (2, 2, '2026-05-10', 'Science', 'Present', 'Participated actively'),
  (3, 3, '2026-05-10', 'English', 'Late', 'Arrived 10 minutes late');

-- Messages
INSERT INTO messages (sender_id, receiver_id, content, is_read) VALUES
  (4, 1, 'Hello teacher, I have a question about the homework.', false),
  (1, 4, 'Sure, what''s your question?', true);