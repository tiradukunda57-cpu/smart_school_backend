const { query } = require('../config/db')

// ── Get all notes ─────────────────────────────────────────────

const getAllNotes = async (req, res, next) => {
  try {
    const {
      search   = '',
      category = '',
      page     = 1,
      limit    = 50,
    } = req.query

    const conditions = []
    const params     = []
    let   pIdx       = 1

    if (search) {
      conditions.push(`(
        n.title   ILIKE $${pIdx} OR
        n.course  ILIKE $${pIdx} OR
        n.content ILIKE $${pIdx}
      )`)
      params.push(`%${search}%`)
      pIdx++
    }

    if (category) {
      conditions.push(`n.category = $${pIdx}`)
      params.push(category)
      pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await query(
      `SELECT COUNT(*) FROM notes n ${where}`,
      params
    )
    const total  = parseInt(countRes.rows[0].count)
    const offset = (parseInt(page) - 1) * parseInt(limit)

    params.push(parseInt(limit))
    params.push(offset)

    const result = await query(
      `SELECT
         n.id, n.title, n.content, n.course, n.category,
         n.created_at, n.updated_at,
         CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
         t.course AS teacher_course
       FROM notes n
       JOIN teachers t ON t.id = n.teacher_id
       ${where}
       ORDER BY n.created_at DESC
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params
    )

    return res.json({ notes: result.rows, total })
  } catch (err) {
    next(err)
  }
}

// ── Get by ID ─────────────────────────────────────────────────

const getNoteById = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT n.*,
              CONCAT(t.first_name,' ',t.last_name) AS teacher_name
       FROM notes n
       JOIN teachers t ON t.id = n.teacher_id
       WHERE n.id = $1`,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Note not found.' })
    }

    return res.json({ note: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ── Create ────────────────────────────────────────────────────

const createNote = async (req, res, next) => {
  try {
    const { title, content, course, category = 'Lecture' } = req.body

    if (!title || !content) {
      return res.status(400).json({
        message: 'Title and content are required.'
      })
    }

    const tRes = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    )
    if (tRes.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const result = await query(
      `INSERT INTO notes (teacher_id, title, content, course, category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tRes.rows[0].id, title.trim(), content.trim(), course || null, category]
    )

    return res.status(201).json({
      message: 'Note published to all students.',
      note: result.rows[0],
    })
  } catch (err) {
    next(err)
  }
}

// ── Update ────────────────────────────────────────────────────

const updateNote = async (req, res, next) => {
  try {
    const { id } = req.params
    const { title, content, course, category } = req.body

    const tRes = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    )
    if (tRes.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const existing = await query(
      'SELECT id FROM notes WHERE id = $1 AND teacher_id = $2',
      [id, tRes.rows[0].id]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Note not found or access denied.' })
    }

    const result = await query(
      `UPDATE notes
       SET title    = COALESCE($1, title),
           content  = COALESCE($2, content),
           course   = COALESCE($3, course),
           category = COALESCE($4, category)
       WHERE id = $5
       RETURNING *`,
      [title, content, course, category, id]
    )

    return res.json({ message: 'Note updated.', note: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ── Delete ────────────────────────────────────────────────────

const deleteNote = async (req, res, next) => {
  try {
    const { id } = req.params

    const tRes = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    )
    if (tRes.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const result = await query(
      'DELETE FROM notes WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [id, tRes.rows[0].id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Note not found or access denied.' })
    }

    return res.json({ message: 'Note deleted.' })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
}