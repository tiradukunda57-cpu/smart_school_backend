const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const { query } = require('../config/db')

// ─── Helpers ──────────────────────────────────────────────

const generateToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

const hashPassword = (password) => bcrypt.hash(password, 12)

const comparePassword = (password, hash) => bcrypt.compare(password, hash)

// ─── Student Register ──────────────────────────────────────

const registerStudent = async (req, res, next) => {
  try {
    const {
      first_name, last_name, email, password,
      phone, grade, date_of_birth, address
    } = req.body

    // Validate required fields
    if (!first_name || !last_name || !email || !password || !grade) {
      return res.status(400).json({ message: 'First name, last name, email, password, and grade are required.' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' })
    }

    // Check email uniqueness
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' })
    }

    const password_hash = await hashPassword(password)

    // Insert user + student in a transaction
    const client = await require('../config/db').getClient()
    try {
      await client.query('BEGIN')

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'student')
         RETURNING id, email, role, created_at`,
        [email.toLowerCase(), password_hash]
      )
      const user = userRes.rows[0]

      const studentRes = await client.query(
        `INSERT INTO students (user_id, first_name, last_name, phone, grade, date_of_birth, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, first_name, last_name, grade`,
        [
          user.id,
          first_name.trim(),
          last_name.trim(),
          phone || null,
          grade,
          date_of_birth || null,
          address || null,
        ]
      )
      const student = studentRes.rows[0]

      await client.query('COMMIT')

      const token = generateToken(user)

      return res.status(201).json({
        message: 'Student account created successfully.',
        token,
        user: {
          id: student.id,
          user_id: user.id,
          email: user.email,
          role: user.role,
          first_name: student.first_name,
          last_name: student.last_name,
          grade: student.grade,
          created_at: user.created_at,
        }
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
}

// ─── Teacher Register ──────────────────────────────────────

const registerTeacher = async (req, res, next) => {
  try {
    const {
      first_name, last_name, email, password,
      phone, subject, qualification, bio
    } = req.body

    if (!first_name || !last_name || !email || !password || !subject) {
      return res.status(400).json({ message: 'First name, last name, email, password, and subject are required.' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' })
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' })
    }

    const password_hash = await hashPassword(password)

    const client = await require('../config/db').getClient()
    try {
      await client.query('BEGIN')

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'teacher')
         RETURNING id, email, role, created_at`,
        [email.toLowerCase(), password_hash]
      )
      const user = userRes.rows[0]

      const teacherRes = await client.query(
        `INSERT INTO teachers (user_id, first_name, last_name, phone, subject, qualification, bio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, first_name, last_name, subject, qualification`,
        [
          user.id,
          first_name.trim(),
          last_name.trim(),
          phone || null,
          subject,
          qualification || null,
          bio || null,
        ]
      )
      const teacher = teacherRes.rows[0]

      await client.query('COMMIT')

      const token = generateToken(user)

      return res.status(201).json({
        message: 'Teacher account created successfully.',
        token,
        user: {
          id: teacher.id,
          user_id: user.id,
          email: user.email,
          role: user.role,
          first_name: teacher.first_name,
          last_name: teacher.last_name,
          subject: teacher.subject,
          qualification: teacher.qualification,
          created_at: user.created_at,
        }
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
}

// ─── Login (both roles) ────────────────────────────────────

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body
    const { role } = req.params // 'student' or 'teacher'

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }

    // Get user
    const userRes = await query(
      'SELECT id, email, password_hash, role, created_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    )

    if (userRes.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const user = userRes.rows[0]

    if (user.role !== role) {
      return res.status(403).json({
        message: `This account is registered as a ${user.role}. Please use the correct login.`
      })
    }

    const passwordMatch = await comparePassword(password, user.password_hash)
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    // Get role-specific profile
    let profile
    if (role === 'teacher') {
      const tRes = await query(
        `SELECT id, first_name, last_name, phone, subject, qualification, bio
         FROM teachers WHERE user_id = $1`,
        [user.id]
      )
      profile = tRes.rows[0]
    } else {
      const sRes = await query(
        `SELECT id, first_name, last_name, phone, grade, date_of_birth, address
         FROM students WHERE user_id = $1`,
        [user.id]
      )
      profile = sRes.rows[0]
    }

    if (!profile) {
      return res.status(500).json({ message: 'Profile not found. Please contact support.' })
    }

    const token = generateToken(user)

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id: profile.id,
        user_id: user.id,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        ...profile,
      }
    })
  } catch (err) {
    next(err)
  }
}

// ─── Get Profile ───────────────────────────────────────────

const getProfile = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user

    if (role === 'teacher') {
      const result = await query(
        `SELECT t.*, u.email, u.role, u.created_at AS user_created_at
         FROM teachers t
         JOIN users u ON u.id = t.user_id
         WHERE t.user_id = $1`,
        [userId]
      )
      if (result.rows.length === 0) return res.status(404).json({ message: 'Profile not found.' })
      return res.json({ user: result.rows[0] })
    } else {
      const result = await query(
        `SELECT s.*, u.email, u.role, u.created_at AS user_created_at
         FROM students s
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = $1`,
        [userId]
      )
      if (result.rows.length === 0) return res.status(404).json({ message: 'Profile not found.' })
      return res.json({ user: result.rows[0] })
    }
  } catch (err) {
    next(err)
  }
}

// ─── Update Profile ────────────────────────────────────────

const updateProfile = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user

    if (role === 'teacher') {
      const { first_name, last_name, phone, subject, qualification, bio } = req.body

      const result = await query(
        `UPDATE teachers
         SET first_name = COALESCE($1, first_name),
             last_name  = COALESCE($2, last_name),
             phone      = COALESCE($3, phone),
             subject    = COALESCE($4, subject),
             qualification = COALESCE($5, qualification),
             bio        = COALESCE($6, bio)
         WHERE user_id = $7
         RETURNING *`,
        [first_name, last_name, phone, subject, qualification, bio, userId]
      )

      if (result.rows.length === 0) return res.status(404).json({ message: 'Profile not found.' })
      return res.json({ message: 'Profile updated.', user: result.rows[0] })
    } else {
      const { first_name, last_name, phone, grade, address } = req.body

      const result = await query(
        `UPDATE students
         SET first_name = COALESCE($1, first_name),
             last_name  = COALESCE($2, last_name),
             phone      = COALESCE($3, phone),
             grade      = COALESCE($4, grade),
             address    = COALESCE($5, address)
         WHERE user_id = $6
         RETURNING *`,
        [first_name, last_name, phone, grade, address, userId]
      )

      if (result.rows.length === 0) return res.status(404).json({ message: 'Profile not found.' })
      return res.json({ message: 'Profile updated.', user: result.rows[0] })
    }
  } catch (err) {
    next(err)
  }
}

module.exports = {
  registerStudent,
  registerTeacher,
  login,
  getProfile,
  updateProfile,
}