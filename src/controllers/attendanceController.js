const { query, getClient } = require('../config/db')

// ─── Get all attendance (teacher) ─────────────────────────

const getAllAttendance = async (req, res, next) => {
  try {
    const {
      search = '', status = '',
      date = '', subject = '',
      page = 1, limit = 50,
    } = req.query

    const conditions = [`a.teacher_id = $1`]
    const params     = []

    // Get teacher id from user
    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })
    params.push(tRes.rows[0].id)

    let pIdx = 2

    if (search) {
      conditions.push(`(
        s.first_name ILIKE $${pIdx} OR
        s.last_name  ILIKE $${pIdx} OR
        CONCAT(s.first_name,' ',s.last_name) ILIKE $${pIdx}
      )`)
      params.push(`%${search}%`)
      pIdx++
    }
    if (status) {
      conditions.push(`a.status = $${pIdx}`)
      params.push(status)
      pIdx++
    }
    if (date) {
      conditions.push(`a.date = $${pIdx}`)
      params.push(date)
      pIdx++
    }
    if (subject) {
      conditions.push(`a.subject ILIKE $${pIdx}`)
      params.push(`%${subject}%`)
      pIdx++
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM attendance a
       JOIN students s ON s.id = a.student_id
       ${where}`,
      params
    )
    const total = parseInt(countRes.rows[0].count)

    const offset = (parseInt(page) - 1) * parseInt(limit)
    params.push(parseInt(limit))
    params.push(offset)

    const result = await query(
      `SELECT
         a.id, a.date, a.subject, a.status, a.note,
         a.created_at, a.updated_at,
         s.id   AS student_id,
         s.first_name, s.last_name, s.grade
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       ${where}
       ORDER BY a.date DESC, s.first_name ASC
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params
    )

    return res.json({ records: result.rows, total })
  } catch (err) {
    next(err)
  }
}

// ─── Get my attendance (student) ──────────────────────────

const getMyAttendance = async (req, res, next) => {
  try {
    const { status = '', date = '' } = req.query

    const sRes = await query('SELECT id FROM students WHERE user_id = $1', [req.user.id])
    if (sRes.rows.length === 0) return res.status(404).json({ message: 'Student profile not found.' })
    const studentId = sRes.rows[0].id

    const conditions = [`a.student_id = $1`]
    const params     = [studentId]
    let   pIdx       = 2

    if (status) {
      conditions.push(`a.status = $${pIdx}`)
      params.push(status)
      pIdx++
    }
    if (date) {
      conditions.push(`a.date = $${pIdx}`)
      params.push(date)
      pIdx++
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    const result = await query(
      `SELECT
         a.id, a.date, a.subject, a.status, a.note, a.created_at
       FROM attendance a
       ${where}
       ORDER BY a.date DESC`,
      params
    )

    return res.json({ records: result.rows, total: result.rows.length })
  } catch (err) {
    next(err)
  }
}

// ─── Bulk create attendance (teacher) ─────────────────────

const bulkCreateAttendance = async (req, res, next) => {
  const client = await getClient()
  try {
    const { records } = req.body

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: 'Records array is required.' })
    }

    // Get teacher ID
    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })
    const teacherId = tRes.rows[0].id

    await client.query('BEGIN')

    const inserted = []
    for (const rec of records) {
      const { student_id, status, date, subject, note } = rec

      if (!student_id || !status || !date) continue

      const result = await client.query(
        `INSERT INTO attendance (student_id, teacher_id, date, subject, status, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, date, subject)
           DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = NOW()
         RETURNING *`,
        [student_id, teacherId, date, subject || null, status, note || null]
      )
      inserted.push(result.rows[0])
    }

    await client.query('COMMIT')
    return res.status(201).json({
      message: `${inserted.length} attendance record(s) saved.`,
      records: inserted,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ─── Create single attendance ──────────────────────────────

const createAttendance = async (req, res, next) => {
  try {
    const { student_id, status, date, subject, note } = req.body

    if (!student_id || !status || !date) {
      return res.status(400).json({ message: 'student_id, status, and date are required.' })
    }

    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })

    const result = await query(
      `INSERT INTO attendance (student_id, teacher_id, date, subject, status, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [student_id, tRes.rows[0].id, date, subject || null, status, note || null]
    )

    return res.status(201).json({ message: 'Attendance recorded.', record: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Update attendance (teacher) ──────────────────────────

const updateAttendance = async (req, res, next) => {
  try {
    const { id } = req.params
    const { status, note } = req.body

    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })

    const existing = await query(
      'SELECT id FROM attendance WHERE id = $1 AND teacher_id = $2',
      [id, tRes.rows[0].id]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Attendance record not found.' })
    }

    const result = await query(
      `UPDATE attendance
       SET status = COALESCE($1, status), note = COALESCE($2, note)
       WHERE id = $3
       RETURNING *`,
      [status, note, id]
    )

    return res.json({ message: 'Attendance updated.', record: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

// ─── Delete attendance (teacher) ──────────────────────────

const deleteAttendance = async (req, res, next) => {
  try {
    const { id } = req.params

    const tRes = await query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])
    if (tRes.rows.length === 0) return res.status(404).json({ message: 'Teacher profile not found.' })

    const result = await query(
      'DELETE FROM attendance WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [id, tRes.rows[0].id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Record not found or access denied.' })
    }

    return res.json({ message: 'Attendance record deleted.' })
  } catch (err) {
    next(err)
  }
}

// ─── Get attendance summary for a student ─────────────────

const getAttendanceSummary = async (req, res, next) => {
  try {
    const { studentId } = req.params

    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'Present')  AS present,
         COUNT(*) FILTER (WHERE status = 'Absent')   AS absent,
         COUNT(*) FILTER (WHERE status = 'Late')     AS late,
         COUNT(*) FILTER (WHERE status = 'Excused')  AS excused,
         COUNT(*) AS total
       FROM attendance
       WHERE student_id = $1`,
      [studentId]
    )

    return res.json({ summary: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getAllAttendance,
  getMyAttendance,
  bulkCreateAttendance,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceSummary,
}