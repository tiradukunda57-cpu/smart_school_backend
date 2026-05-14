const bcrypt    = require('bcryptjs')
const { query, getClient } = require('../config/db')

// ── Helper: Log activity ──────────────────────────────────────
const logActivity = async (userId, action, entityType, entityId, details, ip) => {
  try {
    await query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, action, entityType || null, entityId || null,
       details ? JSON.stringify(details) : null, ip || null]
    )
  } catch (err) {
    console.error('Activity log error:', err.message)
  }
}

// ── Dashboard stats ───────────────────────────────────────────
const getDashboardStats = async (req, res, next) => {
  try {
    const [users, approved, students, pending, rejected,
           assignments, quizzes, attendance, recovery] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query("SELECT COUNT(*) FROM teachers WHERE status='approved'"),
      query('SELECT COUNT(*) FROM students'),
      query("SELECT COUNT(*) FROM teachers WHERE status='pending'"),
      query("SELECT COUNT(*) FROM teachers WHERE status='rejected'"),
      query('SELECT COUNT(*) FROM assignments'),
      query('SELECT COUNT(*) FROM quizzes'),
      query('SELECT COUNT(*) FROM attendance'),
      query("SELECT COUNT(*) FROM recovery_requests WHERE status='pending'"),
    ])

    // Attendance breakdown
    const attBreakdown = await query(`
      SELECT status, COUNT(*) AS count
      FROM attendance
      GROUP BY status
    `)

    // Students per level
    const levelBreakdown = await query(`
      SELECT level, COUNT(*) AS count
      FROM students GROUP BY level ORDER BY level DESC
    `)

    // Recent activity count (last 24h)
    const recentActivity = await query(`
      SELECT COUNT(*) FROM activity_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `)

    return res.json({
      stats: {
        totalUsers:        parseInt(users.rows[0].count),
        approvedTeachers:  parseInt(approved.rows[0].count),
        totalStudents:     parseInt(students.rows[0].count),
        pendingTeachers:   parseInt(pending.rows[0].count),
        rejectedTeachers:  parseInt(rejected.rows[0].count),
        totalAssignments:  parseInt(assignments.rows[0].count),
        totalQuizzes:      parseInt(quizzes.rows[0].count),
        totalAttendance:   parseInt(attendance.rows[0].count),
        pendingRecovery:   parseInt(recovery.rows[0].count),
        recentActivity:    parseInt(recentActivity.rows[0].count),
        attendanceBreakdown: attBreakdown.rows,
        studentsByLevel:     levelBreakdown.rows,
      },
    })
  } catch (err) { next(err) }
}

// ── Get all users ─────────────────────────────────────────────
const getAllUsers = async (req, res, next) => {
  try {
    const { role = '', search = '', page = 1, limit = 50 } = req.query
    const conditions = []
    const params = []
    let pIdx = 1

    if (role) {
      conditions.push(`u.role = $${pIdx}`)
      params.push(role); pIdx++
    }
    if (search) {
      conditions.push(`u.email ILIKE $${pIdx}`)
      params.push(`%${search}%`); pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const result = await query(
      `SELECT u.id, u.email, u.role, u.is_active, u.last_login, u.created_at,
              u.password_hash
       FROM users u ${where}
       ORDER BY u.created_at DESC`,
      params
    )

    return res.json({ users: result.rows, total: result.rows.length })
  } catch (err) { next(err) }
}

// ── Get all teachers (any status) ─────────────────────────────
const getAllTeachersAdmin = async (req, res, next) => {
  try {
    const { status = '', search = '' } = req.query
    const conditions = []
    const params = []
    let pIdx = 1

    if (status) {
      conditions.push(`t.status = $${pIdx}`)
      params.push(status); pIdx++
    }
    if (search) {
      conditions.push(`(t.first_name ILIKE $${pIdx} OR t.last_name ILIKE $${pIdx} OR t.course ILIKE $${pIdx})`)
      params.push(`%${search}%`); pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const result = await query(
      `SELECT t.*, u.email, u.is_active, u.last_login
       FROM teachers t JOIN users u ON u.id = t.user_id
       ${where} ORDER BY
         CASE t.status
           WHEN 'pending' THEN 0
           WHEN 'approved' THEN 1
           WHEN 'rejected' THEN 2
           WHEN 'suspended' THEN 3
         END, t.created_at DESC`,
      params
    )

    return res.json({ teachers: result.rows, total: result.rows.length })
  } catch (err) { next(err) }
}

// ── Get pending teachers ──────────────────────────────────────
const getPendingTeachers = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*, u.email, u.created_at AS registered_at
       FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.status = 'pending'
       ORDER BY t.created_at ASC`
    )
    return res.json({ teachers: result.rows, total: result.rows.length })
  } catch (err) { next(err) }
}

// ── Approve teacher ───────────────────────────────────────────
const approveTeacher = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await query('SELECT id, status, user_id FROM teachers WHERE id = $1', [id])
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Teacher not found.' })

    if (existing.rows[0].status === 'approved')
      return res.status(400).json({ message: 'Already approved.' })

    const result = await query(
      `UPDATE teachers SET
         status='approved', approved_by=$1, approved_at=NOW(),
         rejection_note=NULL, delete_after=NULL
       WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )

    await logActivity(req.user.id, 'APPROVE_TEACHER', 'teachers', parseInt(id),
      { teacher_name: `${result.rows[0].first_name} ${result.rows[0].last_name}` },
      req.ip)

    return res.json({ message: 'Teacher approved.', teacher: result.rows[0] })
  } catch (err) { next(err) }
}

// ── Reject teacher (with reason + auto-delete in 24h) ─────────
const rejectTeacher = async (req, res, next) => {
  try {
    const { id }   = req.params
    const { note } = req.body

    if (!note || !note.trim()) {
      return res.status(400).json({
        message: 'A rejection reason is required so the teacher understands why.',
      })
    }

    const existing = await query('SELECT id, first_name, last_name FROM teachers WHERE id = $1', [id])
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Teacher not found.' })

    // Set delete_after to 24 hours from now
    const result = await query(
      `UPDATE teachers SET
         status='rejected',
         rejection_note=$1,
         approved_by=$2,
         approved_at=NOW(),
         delete_after=NOW() + INTERVAL '24 hours'
       WHERE id=$3 RETURNING *`,
      [note.trim(), req.user.id, id]
    )

    await logActivity(req.user.id, 'REJECT_TEACHER', 'teachers', parseInt(id),
      {
        teacher_name: `${existing.rows[0].first_name} ${existing.rows[0].last_name}`,
        reason: note.trim(),
        will_delete_at: result.rows[0].delete_after,
      },
      req.ip)

    return res.json({
      message: 'Teacher rejected. Account will be automatically deleted in 24 hours.',
      teacher: result.rows[0],
    })
  } catch (err) { next(err) }
}

// ── Suspend teacher ───────────────────────────────────────────
const suspendTeacher = async (req, res, next) => {
  try {
    const { id }   = req.params
    const { note } = req.body

    const result = await query(
      `UPDATE teachers SET status='suspended', rejection_note=$1
       WHERE id=$2 RETURNING *`,
      [note || null, id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Teacher not found.' })

    await logActivity(req.user.id, 'SUSPEND_TEACHER', 'teachers', parseInt(id),
      { reason: note }, req.ip)

    return res.json({ message: 'Teacher suspended.', teacher: result.rows[0] })
  } catch (err) { next(err) }
}

// ── Toggle user active ───────────────────────────────────────
const toggleUserActive = async (req, res, next) => {
  try {
    const { id }        = req.params
    const { is_active } = req.body

    if (parseInt(id) === req.user.id)
      return res.status(400).json({ message: 'Cannot deactivate your own account.' })

    const result = await query(
      'UPDATE users SET is_active=$1 WHERE id=$2 RETURNING id, email, role, is_active',
      [is_active, id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' })

    await logActivity(req.user.id,
      is_active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      'users', parseInt(id),
      { email: result.rows[0].email }, req.ip)

    return res.json({
      message: `User ${is_active ? 'activated' : 'deactivated'}.`,
      user: result.rows[0],
    })
  } catch (err) { next(err) }
}

// ── Change user password (admin emergency) ────────────────────
const changeUserPassword = async (req, res, next) => {
  try {
    const { id }             = req.params
    const { new_password }   = req.body

    if (!new_password || new_password.length < 1) {
      return res.status(400).json({ message: 'New password is required.' })
    }

    const userRes = await query('SELECT id, email FROM users WHERE id = $1', [id])
    if (userRes.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' })

    const hash = await bcrypt.hash(String(new_password), 12)

    await query(
      'UPDATE users SET password_hash=$1 WHERE id=$2',
      [hash, id]
    )

    await logActivity(req.user.id, 'CHANGE_PASSWORD', 'users', parseInt(id),
      { email: userRes.rows[0].email, by_admin: true }, req.ip)

    return res.json({
      message: `Password changed for ${userRes.rows[0].email}. User can now login with the new password.`,
    })
  } catch (err) { next(err) }
}

// ── View user password hash (emergency only) ──────────────────
const viewUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params

    const result = await query(
      'SELECT id, email, password_hash, role FROM users WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' })

    await logActivity(req.user.id, 'VIEW_PASSWORD_HASH', 'users', parseInt(id),
      { email: result.rows[0].email }, req.ip)

    return res.json({
      user: result.rows[0],
      note: 'Password is hashed with bcrypt and cannot be reversed. Use password reset instead.',
    })
  } catch (err) { next(err) }
}

// ── Recovery Requests ─────────────────────────────────────────
const getRecoveryRequests = async (req, res, next) => {
  try {
    const { status = '' } = req.query
    const where = status ? `WHERE rr.status = $1` : ''
    const params = status ? [status] : []

    const result = await query(
      `SELECT rr.*,
              u.email, u.role,
              CASE
                WHEN u.role='teacher' THEN (SELECT first_name FROM teachers WHERE user_id=u.id)
                WHEN u.role='student' THEN (SELECT first_name FROM students WHERE user_id=u.id)
                ELSE 'Admin'
              END AS first_name,
              CASE
                WHEN u.role='teacher' THEN (SELECT last_name FROM teachers WHERE user_id=u.id)
                WHEN u.role='student' THEN (SELECT last_name FROM students WHERE user_id=u.id)
                ELSE 'User'
              END AS last_name
       FROM recovery_requests rr
       JOIN users u ON u.id = rr.user_id
       ${where}
       ORDER BY rr.created_at DESC`,
      params
    )

    return res.json({ requests: result.rows, total: result.rows.length })
  } catch (err) { next(err) }
}

const handleRecoveryRequest = async (req, res, next) => {
  try {
    const { id }      = req.params
    const { action, new_password, admin_note } = req.body

    const reqRes = await query(
      `SELECT rr.*, u.email FROM recovery_requests rr
       JOIN users u ON u.id = rr.user_id
       WHERE rr.id = $1`,
      [id]
    )

    if (reqRes.rows.length === 0)
      return res.status(404).json({ message: 'Request not found.' })

    const request = reqRes.rows[0]

    if (action === 'approve') {
      if (!new_password || new_password.length < 1) {
        return res.status(400).json({ message: 'New password is required to approve.' })
      }

      const hash = await bcrypt.hash(String(new_password), 12)

      await query(
        'UPDATE users SET password_hash=$1 WHERE id=$2',
        [hash, request.user_id]
      )

      await query(
        `UPDATE recovery_requests SET
           status='approved', new_password=$1, admin_note=$2,
           handled_by=$3, handled_at=NOW()
         WHERE id=$4`,
        [new_password, admin_note || null, req.user.id, id]
      )

      await logActivity(req.user.id, 'APPROVE_RECOVERY', 'recovery_requests', parseInt(id),
        { email: request.email, new_password }, req.ip)

      return res.json({
        message: `Password reset approved for ${request.email}. New password: ${new_password}`,
      })
    } else if (action === 'reject') {
      await query(
        `UPDATE recovery_requests SET
           status='rejected', admin_note=$1,
           handled_by=$2, handled_at=NOW()
         WHERE id=$3`,
        [admin_note || 'Request rejected', req.user.id, id]
      )

      return res.json({ message: 'Recovery request rejected.' })
    }

    return res.status(400).json({ message: 'Action must be "approve" or "reject".' })
  } catch (err) { next(err) }
}

// ── Activity Logs ─────────────────────────────────────────────
const getActivityLogs = async (req, res, next) => {
  try {
    const { action = '', page = 1, limit = 50, date = '' } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (action) {
      conditions.push(`al.action = $${pIdx}`)
      params.push(action); pIdx++
    }
    if (date) {
      conditions.push(`al.created_at::date = $${pIdx}`)
      params.push(date); pIdx++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const countRes = await query(
      `SELECT COUNT(*) FROM activity_logs al ${where}`, params
    )

    params.push(parseInt(limit))
    params.push(offset)

    const result = await query(
      `SELECT al.*, u.email AS user_email, u.role AS user_role
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params
    )

    return res.json({
      logs:  result.rows,
      total: parseInt(countRes.rows[0].count),
      page:  parseInt(page),
    })
  } catch (err) { next(err) }
}

// ── Daily Report ──────────────────────────────────────────────
const getDailyReport = async (req, res, next) => {
  try {
    const { date } = req.params
    const reportDate = date || new Date().toISOString().split('T')[0]

    // Check archive first
    const archived = await query(
      'SELECT * FROM daily_reports WHERE report_date = $1',
      [reportDate]
    )

    if (archived.rows.length > 0) {
      return res.json({ report: archived.rows[0], source: 'archive' })
    }

    // Generate live report
    const [
      totalUsers, newUsersToday, totalTeachers, totalStudents,
      attToday, attBreakdown, assignToday, quizzesToday,
      messagesToday, logsToday,
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query('SELECT COUNT(*) FROM users WHERE created_at::date = $1', [reportDate]),
      query("SELECT COUNT(*) FROM teachers WHERE status='approved'"),
      query('SELECT COUNT(*) FROM students'),
      query('SELECT COUNT(*) FROM attendance WHERE date = $1', [reportDate]),
      query(`SELECT status, COUNT(*) AS count FROM attendance WHERE date = $1 GROUP BY status`, [reportDate]),
      query('SELECT COUNT(*) FROM assignments WHERE created_at::date = $1', [reportDate]),
      query('SELECT COUNT(*) FROM quizzes WHERE created_at::date = $1', [reportDate]),
      query('SELECT COUNT(*) FROM messages WHERE created_at::date = $1', [reportDate]),
      query('SELECT COUNT(*) FROM activity_logs WHERE created_at::date = $1', [reportDate]),
    ])

    const report = {
      report_date:     reportDate,
      totalUsers:      parseInt(totalUsers.rows[0].count),
      newUsersToday:   parseInt(newUsersToday.rows[0].count),
      totalTeachers:   parseInt(totalTeachers.rows[0].count),
      totalStudents:   parseInt(totalStudents.rows[0].count),
      attendanceToday: parseInt(attToday.rows[0].count),
      attendanceBreakdown: attBreakdown.rows,
      assignmentsToday:    parseInt(assignToday.rows[0].count),
      quizzesToday:        parseInt(quizzesToday.rows[0].count),
      messagesToday:       parseInt(messagesToday.rows[0].count),
      activityLogsToday:   parseInt(logsToday.rows[0].count),
    }

    return res.json({ report, source: 'live' })
  } catch (err) { next(err) }
}

// ── Save daily report to archive ──────────────────────────────
const archiveDailyReport = async (req, res, next) => {
  try {
    const reportDate = new Date().toISOString().split('T')[0]

    // Generate the report data
    const reportRes = await getDailyReportData(reportDate)

    await query(
      `INSERT INTO daily_reports (report_date, data)
       VALUES ($1, $2)
       ON CONFLICT (report_date) DO UPDATE SET data=$2, generated_at=NOW()`,
      [reportDate, JSON.stringify(reportRes)]
    )

    await logActivity(req.user.id, 'ARCHIVE_DAILY_REPORT', 'daily_reports', null,
      { date: reportDate }, req.ip)

    return res.json({ message: 'Daily report archived.', date: reportDate })
  } catch (err) { next(err) }
}

// Helper for generating report data
const getDailyReportData = async (reportDate) => {
  const [users, newUsers, teachers, students, att, attBreak,
         assign, quiz, msgs, logs] = await Promise.all([
    query('SELECT COUNT(*) FROM users'),
    query('SELECT COUNT(*) FROM users WHERE created_at::date = $1', [reportDate]),
    query("SELECT COUNT(*) FROM teachers WHERE status='approved'"),
    query('SELECT COUNT(*) FROM students'),
    query('SELECT COUNT(*) FROM attendance WHERE date = $1', [reportDate]),
    query('SELECT status, COUNT(*) FROM attendance WHERE date = $1 GROUP BY status', [reportDate]),
    query('SELECT COUNT(*) FROM assignments WHERE created_at::date = $1', [reportDate]),
    query('SELECT COUNT(*) FROM quizzes WHERE created_at::date = $1', [reportDate]),
    query('SELECT COUNT(*) FROM messages WHERE created_at::date = $1', [reportDate]),
    query('SELECT COUNT(*) FROM activity_logs WHERE created_at::date = $1', [reportDate]),
  ])

  return {
    totalUsers: parseInt(users.rows[0].count),
    newUsersToday: parseInt(newUsers.rows[0].count),
    totalTeachers: parseInt(teachers.rows[0].count),
    totalStudents: parseInt(students.rows[0].count),
    attendanceToday: parseInt(att.rows[0].count),
    attendanceBreakdown: attBreak.rows,
    assignmentsToday: parseInt(assign.rows[0].count),
    quizzesToday: parseInt(quiz.rows[0].count),
    messagesToday: parseInt(msgs.rows[0].count),
    activityLogsToday: parseInt(logs.rows[0].count),
  }
}

// ── Get report archive ────────────────────────────────────────
const getReportArchive = async (req, res, next) => {
  try {
    const { from_date, to_date } = req.query

    let where = ''
    const params = []

    if (from_date && to_date) {
      where = 'WHERE report_date BETWEEN $1 AND $2'
      params.push(from_date, to_date)
    } else if (from_date) {
      where = 'WHERE report_date >= $1'
      params.push(from_date)
    }

    const result = await query(
      `SELECT * FROM daily_reports ${where}
       ORDER BY report_date DESC LIMIT 90`,
      params
    )

    return res.json({ reports: result.rows })
  } catch (err) { next(err) }
}

// ── Cleanup rejected teachers (auto-delete after 24h) ─────────
const cleanupRejectedTeachers = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.id, t.user_id, t.first_name, t.last_name, u.email
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       WHERE t.status = 'rejected'
         AND t.delete_after IS NOT NULL
         AND t.delete_after <= NOW()`
    )

    const deleted = []
    for (const teacher of result.rows) {
      await query('DELETE FROM users WHERE id = $1', [teacher.user_id])
      deleted.push({ id: teacher.id, email: teacher.email, name: `${teacher.first_name} ${teacher.last_name}` })
    }

    if (deleted.length > 0) {
      await logActivity(req?.user?.id || null, 'AUTO_DELETE_REJECTED_TEACHERS',
        'teachers', null, { count: deleted.length, deleted }, null)
    }

    return res.json({
      message: `${deleted.length} rejected teacher(s) cleaned up.`,
      deleted,
    })
  } catch (err) { next(err) }
}

module.exports = {
  getDashboardStats,
  getAllUsers,
  getAllTeachersAdmin,
  getPendingTeachers,
  approveTeacher,
  rejectTeacher,
  suspendTeacher,
  toggleUserActive,
  changeUserPassword,
  viewUserPassword,
  getRecoveryRequests,
  handleRecoveryRequest,
  getActivityLogs,
  getDailyReport,
  archiveDailyReport,
  getReportArchive,
  cleanupRejectedTeachers,
  logActivity,
}