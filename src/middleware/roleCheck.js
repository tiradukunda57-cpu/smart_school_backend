const { query } = require('../config/db')

const roleCheck = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated.' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Required role: ${roles.join(' or ')}.`,
      })
    }
    next()
  }
}

const approvedTeacher = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated.' })
  }
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Teacher access required.' })
  }

  try {
    const result = await query(
      'SELECT id, status, rejection_note FROM teachers WHERE user_id = $1',
      [req.user.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found.' })
    }

    const teacher = result.rows[0]

    if (teacher.status === 'pending') {
      return res.status(403).json({
        message: 'Your account is pending admin approval. You cannot perform this action yet.',
        status: 'pending',
        code: 'TEACHER_PENDING',
      })
    }
    if (teacher.status === 'rejected') {
      return res.status(403).json({
        message: 'Your teaching request was rejected.',
        status: 'rejected',
        note: teacher.rejection_note,
        code: 'TEACHER_REJECTED',
      })
    }
    if (teacher.status === 'suspended') {
      return res.status(403).json({
        message: 'Your account has been suspended. Contact admin.',
        status: 'suspended',
        code: 'TEACHER_SUSPENDED',
      })
    }
    if (teacher.status !== 'approved') {
      return res.status(403).json({ message: 'Account not approved.' })
    }

    req.teacherId = teacher.id
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { roleCheck, approvedTeacher }