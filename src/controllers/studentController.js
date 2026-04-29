const { query } = require('../config/db')

// ─── Get all students (teacher only) ──────────────────────

const getAllStudents = async (req, res, next) => {
  try {
    const {
      search = '',
      grade  = '',
      page   = 1,
      limit  = 12,
    } = req.query

    const offset = (parseInt(page) - 1) * parseInt(limit)
    const conditions = []
    const params     = []
    let   paramIdx   = 1

    if (search) {
      conditions.push(`(
        s.first_name ILIKE $${paramIdx} OR
        s.last_name  ILIKE $${paramIdx} OR
        u.email      ILIKE $${paramIdx} OR
        CONCAT(s.first_name,' ',s.last_name) ILIKE $${paramIdx}
      )`)
      params.push(`%${search}%`)
      paramIdx++
    }

    if (grade) {
      conditions.push(`s.grade = $${paramIdx}`)
      params.push(grade)
      paramIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM students s JOIN users u ON u.id = s.user_id ${where}`,
      params
    )
    const total = parseInt(countRes.rows[0].count)

    // Data
    params.push(parseInt(limit))
    params.push(offset)

    const result = await query(
      `SELECT
         s.id, s.user_id, s.first_name, s.last_name,
         s.phone, s.grade, s.date_of_birth, s.address,
         s.created_at, s.updated_at,
         u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    )

    return res.json({
      students: result.rows,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    })
  } catch (err) {
    next(err)
  }
}

// ─── Get student by ID ─────────────────────────────────────

const getStudentById = async (req, res, next) => {
  try {
    const { id } = req.params

    const result = await query(
      `SELECT s.*, u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' })
    }

    return res.json({ student: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Update student (teacher only) ────────────────────────

const updateStudent = async (req, res, next) => {
  try {
    const { id } = req.params
    const { first_name, last_name, phone, grade, address, email } = req.body

    // Check student exists
    const existing = await query('SELECT id, user_id FROM students WHERE id = $1', [id])
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
        return res.status(409).json({ message: 'Email is already in use.' })
      }
      await query(
        'UPDATE users SET email = $1 WHERE id = $2',
        [email.toLowerCase(), student.user_id]
      )
    }

    const result = await query(
      `UPDATE students
       SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         phone      = COALESCE($3, phone),
         grade      = COALESCE($4, grade),
         address    = COALESCE($5, address)
       WHERE id = $6
       RETURNING *`,
      [first_name, last_name, phone, grade, address, id]
    )

    return res.json({ message: 'Student updated.', student: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Delete student (teacher only) ────────────────────────

const deleteStudent = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await query('SELECT id, user_id FROM students WHERE id = $1', [id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' })
    }

    // Deleting user cascades to students
    await query('DELETE FROM users WHERE id = $1', [existing.rows[0].user_id])

    return res.json({ message: 'Student deleted successfully.' })
  } catch (err) {
    next(err)
  }
}

// ─── Get student stats ────────────────────────────────────

const getStudentStats = async (req, res, next) => {
  try {
    const [totalRes, gradeRes] = await Promise.all([
      query('SELECT COUNT(*) FROM students'),
      query('SELECT grade, COUNT(*) as count FROM students GROUP BY grade ORDER BY grade'),
    ])

    return res.json({
      total: parseInt(totalRes.rows[0].count),
      byGrade: gradeRes.rows,
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