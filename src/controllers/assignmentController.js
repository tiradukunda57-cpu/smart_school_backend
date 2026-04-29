const { query } = require('../config/db')

// ─── Get all assignments (both roles — visible to all) ─────

const getAllAssignments = async (req, res, next) => {
  try {
    const {
      search   = '',
      priority = '',
      page     = 1,
      limit    = 50,
    } = req.query

    const conditions = []
    const params     = []
    let   pIdx       = 1

    if (search) {
      conditions.push(`(
        a.title   ILIKE $${pIdx} OR
        a.subject ILIKE $${pIdx} OR
        a.description ILIKE $${pIdx}
      )`)
      params.push(`%${search}%`)
      pIdx++
    }

    if (priority) {
      conditions.push(`a.priority = $${pIdx}`)
      params.push(priority)
      pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await query(
      `SELECT COUNT(*) FROM assignments a ${where}`,
      params
    )
    const total = parseInt(countRes.rows[0].count)

    const offset = (parseInt(page) - 1) * parseInt(limit)
    params.push(parseInt(limit))
    params.push(offset)

    const result = await query(
      `SELECT
         a.id, a.title, a.description, a.subject,
         a.due_date, a.priority, a.created_at, a.updated_at,
         t.first_name AS teacher_first_name,
         t.last_name  AS teacher_last_name,
         t.subject    AS teacher_subject
       FROM assignments a
       JOIN teachers t ON t.id = a.teacher_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params
    )

    return res.json({ assignments: result.rows, total })
  } catch (err) {
    next(err)
  }
}

// ─── Get single assignment ─────────────────────────────────

const getAssignmentById = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         a.*,
         t.first_name AS teacher_first_name,
         t.last_name  AS teacher_last_name
       FROM assignments a
       JOIN teachers t ON t.id = a.teacher_id
       WHERE a.id = $1`,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Assignment not found.' })
    }

    return res.json({ assignment: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Create assignment (teacher only) ─────────────────────

const createAssignment = async (req, res, next) => {
  try {
    const { title, description, subject, due_date, priority = 'Medium' } = req.body

    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required.' })
    }

    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })

    const result = await query(
      `INSERT INTO assignments (teacher_id, title, description, subject, due_date, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tRes.rows[0].id, title.trim(), description.trim(), subject || null, due_date || null, priority]
    )

    return res.status(201).json({
      message: 'Assignment created and broadcast to all students.',
      assignment: result.rows[0],
    })
  } catch (err) {
    next(err)
  }
}

// ─── Update assignment (teacher who owns it) ───────────────

const updateAssignment = async (req, res, next) => {
  try {
    const { id } = req.params
    const { title, description, subject, due_date, priority } = req.body

    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })

    const existing = await query(
      'SELECT id FROM assignments WHERE id = $1 AND teacher_id = $2',
      [id, tRes.rows[0].id]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Assignment not found or access denied.' })
    }

    const result = await query(
      `UPDATE assignments
       SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         subject     = COALESCE($3, subject),
         due_date    = COALESCE($4, due_date),
         priority    = COALESCE($5, priority)
       WHERE id = $6
       RETURNING *`,
      [title, description, subject, due_date, priority, id]
    )

    return res.json({ message: 'Assignment updated.', assignment: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Delete assignment (teacher who owns it) ───────────────

const deleteAssignment = async (req, res, next) => {
  try {
    const { id } = req.params

    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })

    const result = await query(
      'DELETE FROM assignments WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [id, tRes.rows[0].id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Assignment not found or access denied.' })
    }

    return res.json({ message: 'Assignment deleted.' })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAllAssignments,
  getAssignmentById,
  createAssignment,
  updateAssignment,
  deleteAssignment,
}