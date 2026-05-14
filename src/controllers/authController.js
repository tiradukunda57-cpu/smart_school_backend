const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const generateToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

const hashPassword = (pw) => bcrypt.hash(pw, 12);
const comparePassword = (pw, hash) => bcrypt.compare(pw, hash);

// ── Student Register ──────────────────────────────────────────
const registerStudent = async (req, res, next) => {
  const client = await require('../config/db').getClient()
  try {
    const {
      first_name, last_name, email, password,
      phone, level, date_of_birth, address
    } = req.body

    if (process.env.NODE_ENV === 'development') {
      console.log('📝 Student register attempt:', {
        first_name: first_name || '(missing)',
        last_name:  last_name  || '(missing)',
        email:      email      || '(missing)',
        password:   password   ? `(${password?.length} chars)` : '(missing)',
        level:      level      || '(missing)',
      })
    }

    const missing = []
    if (!first_name || !String(first_name).trim()) missing.push('first_name')
    if (!last_name  || !String(last_name).trim())  missing.push('last_name')
    if (!email      || !String(email).trim())       missing.push('email')
    if (!password   || !String(password).trim())    missing.push('password')
    if (!level      || !String(level).trim())       missing.push('level')

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missing.join(', ')}`,
        missing,
      })
    }

    if (!['5', '4', '3'].includes(String(level))) {
      return res.status(400).json({ message: 'Level must be 5, 4, or 3.' })
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format.' })
    }

    const exists = await query(
      'SELECT id FROM users WHERE email = $1',
      [String(email).toLowerCase().trim()]
    )
    if (exists.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered.' })
    }

    const pw = await hashPassword(String(password))

    await client.query('BEGIN')

    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'student')
       RETURNING id, email, role, created_at`,
      [String(email).toLowerCase().trim(), pw]
    )
    const user = userRes.rows[0]

    const stuRes = await client.query(
      `INSERT INTO students
         (user_id, first_name, last_name, phone, level, date_of_birth, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        user.id,
        String(first_name).trim(),
        String(last_name).trim(),
        phone         ? String(phone).trim()  : null,
        String(level),
        date_of_birth || null,
        address       ? String(address).trim() : null,
      ]
    )

    await client.query('COMMIT')

    const token = generateToken(user)

    return res.status(201).json({
      message: 'Student account created.',
      token,
      user: {
        ...stuRes.rows[0],
        email:   user.email,
        role:    user.role,
        user_id: user.id,
      },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ── Teacher Register (pending approval) ───────────────────────
const registerTeacher = async (req, res, next) => {
  const client = await require('../config/db').getClient()
  try {
    const {
      first_name, last_name, email, password,
      phone, course, qualification, bio
    } = req.body

    // Debug log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('📝 Teacher register attempt:', {
        first_name: first_name || '(missing)',
        last_name:  last_name  || '(missing)',
        email:      email      || '(missing)',
        password:   password   ? `(${password.length} chars)` : '(missing)',
        course:     course     || '(missing)',
      })
    }

    // Detailed validation with specific field errors
    const missing = []
    if (!first_name || !String(first_name).trim()) missing.push('first_name')
    if (!last_name  || !String(last_name).trim())  missing.push('last_name')
    if (!email      || !String(email).trim())       missing.push('email')
    if (!password   || !String(password).trim())    missing.push('password')
    if (!course     || !String(course).trim())      missing.push('course')

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missing.join(', ')}`,
        missing,
      })
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters.',
      })
    }

    // Email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format.' })
    }

    // Check email uniqueness
    const emailCheck = await query(
      'SELECT id FROM users WHERE email = $1',
      [String(email).toLowerCase().trim()]
    )
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({
        message: 'An account with this email already exists.',
      })
    }

    // Check course uniqueness
    const courseCheck = await query(
      'SELECT id FROM teachers WHERE course = $1',
      [String(course).trim()]
    )
    if (courseCheck.rows.length > 0) {
      return res.status(409).json({
        message: `A teacher for "${course}" already exists. Each course must have one teacher.`,
      })
    }

    const pw = await hashPassword(String(password))

    await client.query('BEGIN')

    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'teacher')
       RETURNING id, email, role, created_at`,
      [String(email).toLowerCase().trim(), pw]
    )
    const user = userRes.rows[0]

    const tchRes = await client.query(
      `INSERT INTO teachers
         (user_id, first_name, last_name, phone, course, qualification, bio, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [
        user.id,
        String(first_name).trim(),
        String(last_name).trim(),
        phone         ? String(phone).trim()         : null,
        String(course).trim(),
        qualification ? String(qualification).trim() : null,
        bio           ? String(bio).trim()           : null,
      ]
    )

    await client.query('COMMIT')

    const token = generateToken(user)

    return res.status(201).json({
      message: 'Teacher account created. Waiting for admin approval.',
      token,
      user: {
        ...tchRes.rows[0],
        email:   user.email,
        role:    user.role,
        user_id: user.id,
      },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ── Login (all roles including admin) ────────────────────────
// ── Login (all roles including admin) ────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body
    const { role }            = req.params // 'student' | 'teacher' | 'admin'

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }

    // NO password length validation on login — only on registration
    // This allows admin password "123" to work

    const userRes = await query(
      'SELECT id, email, password_hash, role, is_active, created_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    )

    if (userRes.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const user = userRes.rows[0]

    if (!user.is_active) {
      return res.status(403).json({ message: 'Account is deactivated. Contact admin.' })
    }

    if (user.role !== role) {
      return res.status(403).json({
        message: `This account is registered as "${user.role}". Please use the correct login portal.`
      })
    }

    const passwordMatch = await comparePassword(password, user.password_hash)
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    // Update last_login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

    // Get role-specific profile
    let profile = {}

    if (role === 'teacher') {
      const r = await query(
        'SELECT * FROM teachers WHERE user_id = $1',
        [user.id]
      )
      profile = r.rows[0] || {}
    } else if (role === 'student') {
      const r = await query(
        'SELECT * FROM students WHERE user_id = $1',
        [user.id]
      )
      profile = r.rows[0] || {}
    } else if (role === 'admin') {
      // Admin has no separate profile table
      profile = {
        id: user.id,
        first_name: 'Admin',
        last_name: 'User',
      }
    }

    const token = generateToken(user)

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id:         profile.id || user.id,
        user_id:    user.id,
        email:      user.email,
        role:       user.role,
        created_at: user.created_at,
        ...profile,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── Get / Update Profile ─────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const { id, role } = req.user;

    if (role === "teacher") {
      const r = await query(
        `SELECT t.*, u.email, u.role FROM teachers t
         JOIN users u ON u.id = t.user_id WHERE t.user_id = $1`,
        [id],
      );
      return res.json({ user: r.rows[0] || null });
    } else if (role === "student") {
      const r = await query(
        `SELECT s.*, u.email, u.role FROM students s
         JOIN users u ON u.id = s.user_id WHERE s.user_id = $1`,
        [id],
      );
      return res.json({ user: r.rows[0] || null });
    } else {
      return res.json({
        user: {
          user_id: id,
          email: req.user.email,
          role: "admin",
          first_name: "Admin",
          last_name: "User",
        },
      });
    }
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { id, role } = req.user;

    if (role === "teacher") {
      const { first_name, last_name, phone, qualification, bio } = req.body;
      const r = await query(
        `UPDATE teachers SET
           first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
           phone=COALESCE($3,phone), qualification=COALESCE($4,qualification), bio=COALESCE($5,bio)
         WHERE user_id=$6 RETURNING *`,
        [first_name, last_name, phone, qualification, bio, id],
      );
      return res.json({ message: "Profile updated.", user: r.rows[0] });
    } else if (role === "student") {
      const { first_name, last_name, phone, address } = req.body;
      const r = await query(
        `UPDATE students SET
           first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
           phone=COALESCE($3,phone), address=COALESCE($4,address)
         WHERE user_id=$5 RETURNING *`,
        [first_name, last_name, phone, address, id],
      );
      return res.json({ message: "Profile updated.", user: r.rows[0] });
    }
    return res.json({ message: "Admin profile cannot be updated here." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  registerStudent,
  registerTeacher,
  login,
  getProfile,
  updateProfile,
};
