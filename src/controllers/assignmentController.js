const { query } = require('../config/db')

const getAllAssignments = async (req, res, next) => {
  try {
    const { search = '', priority = '', type = '', page = 1, limit = 50 } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (search) {
      conditions.push(`(a.title ILIKE $${pIdx} OR a.course ILIKE $${pIdx} OR a.description ILIKE $${pIdx})`)
      params.push(`%${search}%`); pIdx++
    }
    if (priority) { conditions.push(`a.priority=$${pIdx}`); params.push(priority); pIdx++ }
    if (type) { conditions.push(`a.type=$${pIdx}`); params.push(type); pIdx++ }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (parseInt(page)-1)*parseInt(limit)
    params.push(parseInt(limit)); params.push(offset)

    const countRes = await query(`SELECT COUNT(*) FROM assignments a ${where}`, params.slice(0,-2))

    const result = await query(
      `SELECT a.*,
              t.first_name AS teacher_first_name,
              t.last_name AS teacher_last_name,
              t.course AS teacher_course,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id',af.id,'file_name',af.file_name,
                  'file_path',af.file_path,'file_size',af.file_size,
                  'mime_type',af.mime_type
                )) FROM assignment_files af WHERE af.assignment_id = a.id),
                '[]'
              ) AS files
       FROM assignments a
       JOIN teachers t ON t.id = a.teacher_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${pIdx} OFFSET $${pIdx+1}`,
      params
    )

    return res.json({
      assignments: result.rows,
      total: parseInt(countRes.rows[0].count),
    })
  } catch (err) { next(err) }
}

const getAssignmentById = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*, t.first_name AS teacher_first_name, t.last_name AS teacher_last_name
       FROM assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.id=$1`,
      [req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Not found.' })

    const files = await query('SELECT * FROM assignment_files WHERE assignment_id=$1', [req.params.id])
    const submissions = await query(
      `SELECT asub.*, s.first_name, s.last_name
       FROM assignment_submissions asub
       JOIN students s ON s.id = asub.student_id
       WHERE asub.assignment_id = $1
       ORDER BY asub.submitted_at DESC`,
      [req.params.id]
    )

    return res.json({
      assignment: { ...result.rows[0], files: files.rows, submissions: submissions.rows },
    })
  } catch (err) { next(err) }
}

const createAssignment = async (req, res, next) => {
  try {
    const {
      title, description, course, due_date,
      type = 'homework', priority = 'Medium',
      max_score = 100, allow_late = false,
    } = req.body

    if (!title || !description)
      return res.status(400).json({ message: 'Title and description required.' })

    const result = await query(
      `INSERT INTO assignments
         (teacher_id, title, description, course, due_date, type, priority, max_score, allow_late)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.teacherId, title.trim(), description.trim(), course||null,
       due_date||null, type, priority, max_score, allow_late]
    )
    const assignment = result.rows[0]

    // Handle uploaded files
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await query(
          `INSERT INTO assignment_files
             (assignment_id, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [assignment.id, file.originalname, file.path, file.size, file.mimetype, req.user.id]
        )
      }
    }

    return res.status(201).json({ message: 'Assignment created.', assignment })
  } catch (err) { next(err) }
}

const updateAssignment = async (req, res, next) => {
  try {
    const { id } = req.params
    const { title, description, course, due_date, priority, type, max_score, allow_late } = req.body

    const existing = await query(
      'SELECT id FROM assignments WHERE id=$1 AND teacher_id=$2', [id, req.teacherId]
    )
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Not found.' })

    const result = await query(
      `UPDATE assignments SET
         title=COALESCE($1,title), description=COALESCE($2,description),
         course=COALESCE($3,course), due_date=COALESCE($4,due_date),
         priority=COALESCE($5,priority), type=COALESCE($6,type),
         max_score=COALESCE($7,max_score), allow_late=COALESCE($8,allow_late)
       WHERE id=$9 RETURNING *`,
      [title, description, course, due_date, priority, type, max_score, allow_late, id]
    )
    return res.json({ message: 'Updated.', assignment: result.rows[0] })
  } catch (err) { next(err) }
}

const deleteAssignment = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM assignments WHERE id=$1 AND teacher_id=$2 RETURNING id',
      [req.params.id, req.teacherId]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Not found.' })
    return res.json({ message: 'Deleted.' })
  } catch (err) { next(err) }
}

module.exports = { getAllAssignments, getAssignmentById, createAssignment, updateAssignment, deleteAssignment }