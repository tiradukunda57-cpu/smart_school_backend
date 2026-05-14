const { query } = require('../config/db')

// ── Get all students ──────────────────────────────────────────

const getAllStudents = async (req, res, next) => {
  try {
    const {
      search = '',
      level  = '',
      page   = 1,
      limit  = 12,
    } = req.query

    const conditions = []
    const params     = []
    let   pIdx       = 1

    if (search) {
      conditions.push(`(
        s.first_name ILIKE $${pIdx} OR
        s.last_name  ILIKE $${pIdx} OR
        u.email      ILIKE $${pIdx} OR
        CONCAT(s.first_name,' ',s.last_name) ILIKE $${pIdx}
      )`)
      params.push(`%${search}%`)
      pIdx++
    }

    if (level) {
      conditions.push(`s.level = $${pIdx}`)
      params.push(String(level))
      pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    // Count
    const countRes = await query(
      `SELECT COUNT(*)
       FROM students s
       JOIN users u ON u.id = s.user_id
       ${where}`,
      params
    )
    const total = parseInt(countRes.rows[0].count)

    // Paginate
    const offset = (parseInt(page) - 1) * parseInt(limit)
    params.push(parseInt(limit))
    params.push(offset)

    const result = await query(
      `SELECT
         s.id, s.user_id,
         s.first_name, s.last_name,
         s.phone, s.level,
         s.date_of_birth, s.address,
         s.created_at, s.updated_at,
         u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params
    )

    return res.json({
      students:   result.rows,
      total,
      page:       parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    })
  } catch (err) {
    next(err)
  }
}

// ── Get student by ID ─────────────────────────────────────────

const getStudentById = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*, u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' })
    }

    return res.json({ student: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ── Update student ────────────────────────────────────────────

const updateStudent = async (req, res, next) => {
  try {
    const { id } = req.params
    const { first_name, last_name, phone, level, address, email } = req.body

    if (level && !['5', '4', '3'].includes(String(level))) {
      return res.status(400).json({ message: 'Level must be 5, 4, or 3.' })
    }

    const existing = await query(
      'SELECT id, user_id FROM students WHERE id = $1',
      [id]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' })
    }
    const student = existing.rows[0]

    // Update email if provided
    if (email) {
      const emailCheck = await query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email.toLowerCase(), student.user_id]
      )
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ message: 'Email already in use.' })
      }
      await query(
        'UPDATE users SET email = $1 WHERE id = $2',
        [email.toLowerCase(), student.user_id]
      )
    }

    const result = await query(
      `UPDATE students
       SET first_name = COALESCE($1, first_name),
           last_name  = COALESCE($2, last_name),
           phone      = COALESCE($3, phone),
           level      = COALESCE($4, level),
           address    = COALESCE($5, address)
       WHERE id = $6
       RETURNING *`,
      [first_name, last_name, phone, level ? String(level) : null, address, id]
    )

    return res.json({ message: 'Student updated.', student: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ── Delete student ────────────────────────────────────────────

const deleteStudent = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await query(
      'SELECT id, user_id FROM students WHERE id = $1',
      [id]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' })
    }

    // Cascade handles everything via FK
    await query('DELETE FROM users WHERE id = $1', [existing.rows[0].user_id])

    return res.json({ message: 'Student deleted successfully.' })
  } catch (err) {
    next(err)
  }
}

// ── Stats ─────────────────────────────────────────────────────

const getStudentStats = async (req, res, next) => {
  try {
    const [totalRes, levelRes] = await Promise.all([
      query('SELECT COUNT(*) FROM students'),
      query(`
        SELECT level, COUNT(*) AS count
        FROM students
        GROUP BY level
        ORDER BY level DESC
      `),
    ])

    return res.json({
      total:   parseInt(totalRes.rows[0].count),
      byLevel: levelRes.rows,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentStats,
}