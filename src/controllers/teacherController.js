const { query } = require('../config/db')

// ── Get all teachers ──────────────────────────────────────────

const getAllTeachers = async (req, res, next) => {
  try {
    const { search = '', limit = 50, page = 1 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const params = []
    let where = ''

    if (search) {
      params.push(`%${search}%`)
      where = `WHERE (
        t.first_name ILIKE $1 OR
        t.last_name  ILIKE $1 OR
        t.course     ILIKE $1 OR
        CONCAT(t.first_name,' ',t.last_name) ILIKE $1
      )`
    }

    const countRes = await query(
      `SELECT COUNT(*) FROM teachers t JOIN users u ON u.id = t.user_id ${where}`,
      params
    )
    const total = parseInt(countRes.rows[0].count)

    const pIdx = params.length
    const dataParams = [...params, parseInt(limit), offset]

    const result = await query(
      `SELECT
         t.id, t.user_id,
         t.first_name, t.last_name,
         t.phone, t.course, t.qualification, t.bio,
         t.created_at, u.email
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY t.first_name ASC
       LIMIT $${pIdx + 1} OFFSET $${pIdx + 2}`,
      dataParams
    )

    return res.json({ teachers: result.rows, total })
  } catch (err) {
    next(err)
  }
}

// ── Get teacher by ID ─────────────────────────────────────────

const getTeacherById = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*, u.email, u.role, u.created_at AS user_created_at
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       WHERE t.id = $1`,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' })
    }

    return res.json({ teacher: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ── Update teacher (own profile only) ────────────────────────

const updateTeacher = async (req, res, next) => {
  try {
    const { id } = req.params
    // course is NOT updatable (UNIQUE constraint, identifies teacher)
    const { first_name, last_name, phone, qualification, bio } = req.body

    const existing = await query(
      'SELECT id, user_id FROM teachers WHERE id = $1',
      [id]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' })
    }
    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own profile.' })
    }

    const result = await query(
      `UPDATE teachers
       SET first_name    = COALESCE($1, first_name),
           last_name     = COALESCE($2, last_name),
           phone         = COALESCE($3, phone),
           qualification = COALESCE($4, qualification),
           bio           = COALESCE($5, bio)
       WHERE id = $6
       RETURNING *`,
      [first_name, last_name, phone, qualification, bio, id]
    )

    return res.json({ message: 'Profile updated.', teacher: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAllTeachers,
  getTeacherById,
  updateTeacher,
}