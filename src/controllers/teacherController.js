const { query } = require('../config/db')

// ─── Get all teachers (public within app) ─────────────────

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
        t.subject    ILIKE $1 OR
        CONCAT(t.first_name,' ',t.last_name) ILIKE $1
      )`
    }

    const countRes = await query(
      `SELECT COUNT(*) FROM teachers t JOIN users u ON u.id = t.user_id ${where}`,
      params
    )
    const total = parseInt(countRes.rows[0].count)

    const dataParams = [...params, parseInt(limit), offset]
    const pIdx = params.length

    const result = await query(
      `SELECT
         t.id, t.user_id, t.first_name, t.last_name,
         t.phone, t.subject, t.qualification, t.bio,
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

// ─── Get teacher by ID ─────────────────────────────────────

const getTeacherById = async (req, res, next) => {
  try {
    const { id } = req.params

    const result = await query(
      `SELECT t.*, u.email, u.role, u.created_at AS user_created_at
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       WHERE t.id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found.' })
    }

    return res.json({ teacher: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Update teacher (self only) ────────────────────────────

const updateTeacher = async (req, res, next) => {
  try {
    const { id } = req.params
    const { first_name, last_name, phone, subject, qualification, bio } = req.body

    // Verify ownership
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
       SET
         first_name    = COALESCE($1, first_name),
         last_name     = COALESCE($2, last_name),
         phone         = COALESCE($3, phone),
         subject       = COALESCE($4, subject),
         qualification = COALESCE($5, qualification),
         bio           = COALESCE($6, bio)
       WHERE id = $7
       RETURNING *`,
      [first_name, last_name, phone, subject, qualification, bio, id]
    )

    return res.json({ message: 'Teacher profile updated.', teacher: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAllTeachers,
  getTeacherById,
  updateTeacher,
}