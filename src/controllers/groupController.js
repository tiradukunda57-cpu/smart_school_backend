const { query } = require('../config/db')

// ── Create group (admin only) ─────────────────────────────────
const createGroup = async (req, res, next) => {
  try {
    const { name, description, type = 'custom', member_ids = [] } = req.body

    if (!name) return res.status(400).json({ message: 'Group name is required.' })

    const client = await require('../config/db').getClient()
    try {
      await client.query('BEGIN')

      const groupRes = await client.query(
        `INSERT INTO groups (name, description, type, created_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [name.trim(), description||null, type, req.user.id]
      )
      const group = groupRes.rows[0]

      // Add creator as admin
      await client.query(
        `INSERT INTO group_members (group_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [group.id, req.user.id]
      )

      // Add members
      for (const uid of member_ids) {
        if (uid === req.user.id) continue

        // Validate user role against group type
        const userRes = await client.query('SELECT role FROM users WHERE id=$1', [uid])
        if (userRes.rows.length === 0) continue

        const userRole = userRes.rows[0].role
        if (type === 'teachers_only' && userRole !== 'teacher') continue
        if (type === 'students_only' && userRole !== 'student') continue

        await client.query(
          `INSERT INTO group_members (group_id, user_id, role)
           VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
          [group.id, uid]
        )
      }

      await client.query('COMMIT')

      return res.status(201).json({ message: 'Group created.', group })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally { client.release() }
  } catch (err) { next(err) }
}

// ── Get my groups ─────────────────────────────────────────────
const getMyGroups = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT g.*, gm.role AS my_role,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
              (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) AS last_at
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND g.is_active = TRUE
       ORDER BY last_at DESC NULLS LAST`,
      [req.user.id]
    )
    return res.json({ groups: result.rows })
  } catch (err) { next(err) }
}

// ── Get group details with members ────────────────────────────
const getGroupById = async (req, res, next) => {
  try {
    // Verify membership
    const memberCheck = await query(
      'SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    if (memberCheck.rows.length === 0 && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not a member of this group.' })

    const groupRes = await query('SELECT * FROM groups WHERE id=$1', [req.params.id])
    if (groupRes.rows.length === 0) return res.status(404).json({ message: 'Group not found.' })

    const membersRes = await query(
      `SELECT gm.*, u.email, u.role AS user_role,
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
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.role, gm.joined_at`,
      [req.params.id]
    )

    return res.json({
      group: groupRes.rows[0],
      members: membersRes.rows,
    })
  } catch (err) { next(err) }
}

// ── Get group messages ────────────────────────────────────────
const getGroupMessages = async (req, res, next) => {
  try {
    const { id } = req.params

    // Verify membership
    const check = await query(
      'SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2',
      [id, req.user.id]
    )
    if (check.rows.length === 0 && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not a member.' })

    const result = await query(
      `SELECT gm.*,
              u.role AS user_role,
              CASE
                WHEN u.role='teacher' THEN (SELECT first_name FROM teachers WHERE user_id=u.id)
                WHEN u.role='student' THEN (SELECT first_name FROM students WHERE user_id=u.id)
                ELSE 'Admin'
              END AS first_name,
              CASE
                WHEN u.role='teacher' THEN (SELECT last_name FROM teachers WHERE user_id=u.id)
                WHEN u.role='student' THEN (SELECT last_name FROM students WHERE user_id=u.id)
                ELSE 'User'
              END AS last_name,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', ca.id, 'file_name', ca.file_name,
                  'file_path', ca.file_path, 'file_size', ca.file_size,
                  'mime_type', ca.mime_type
                )) FROM chat_attachments ca WHERE ca.group_message_id = gm.id),
                '[]'
              ) AS attachments
       FROM group_messages gm
       JOIN users u ON u.id = gm.sender_id
       WHERE gm.group_id = $1
       ORDER BY gm.created_at ASC`,
      [id]
    )

    return res.json({ messages: result.rows })
  } catch (err) { next(err) }
}

// ── Send group message ────────────────────────────────────────
const sendGroupMessage = async (req, res, next) => {
  try {
    const { id } = req.params
    const { content } = req.body

    // Verify membership
    const check = await query(
      'SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2',
      [id, req.user.id]
    )
    if (check.rows.length === 0 && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not a member.' })

    if (!content?.trim() && (!req.files || req.files.length === 0))
      return res.status(400).json({ message: 'Message content or attachment required.' })

    const msgRes = await query(
      `INSERT INTO group_messages (group_id, sender_id, content)
       VALUES ($1,$2,$3) RETURNING *`,
      [id, req.user.id, content?.trim() || null]
    )
    const msg = msgRes.rows[0]

    // Handle attachments
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await query(
          `INSERT INTO chat_attachments
             (group_message_id, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [msg.id, file.originalname, file.path, file.size, file.mimetype, req.user.id]
        )
      }
    }

    return res.status(201).json({ message: 'Sent.', data: msg })
  } catch (err) { next(err) }
}

// ── Add/remove members (admin only) ──────────────────────────
const addMember = async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_id, role = 'member' } = req.body

    // Check group type restrictions
    const groupRes = await query('SELECT type FROM groups WHERE id=$1', [id])
    if (groupRes.rows.length === 0) return res.status(404).json({ message: 'Group not found.' })

    const userRes = await query('SELECT role FROM users WHERE id=$1', [user_id])
    if (userRes.rows.length === 0) return res.status(404).json({ message: 'User not found.' })

    const gType = groupRes.rows[0].type
    const uRole = userRes.rows[0].role
    if (gType === 'teachers_only' && uRole !== 'teacher' && uRole !== 'admin')
      return res.status(400).json({ message: 'This group is for teachers only.' })
    if (gType === 'students_only' && uRole !== 'student' && uRole !== 'admin')
      return res.status(400).json({ message: 'This group is for students only.' })

    await query(
      `INSERT INTO group_members (group_id, user_id, role)
       VALUES ($1,$2,$3) ON CONFLICT (group_id, user_id) DO UPDATE SET role=$3`,
      [id, user_id, role]
    )

    return res.json({ message: 'Member added.' })
  } catch (err) { next(err) }
}

const removeMember = async (req, res, next) => {
  try {
    const { id, userId } = req.params

    if (parseInt(userId) === req.user.id)
      return res.status(400).json({ message: 'Cannot remove yourself.' })

    await query(
      'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
      [id, userId]
    )
    return res.json({ message: 'Member removed.' })
  } catch (err) { next(err) }
}

module.exports = {
  createGroup, getMyGroups, getGroupById,
  getGroupMessages, sendGroupMessage,
  addMember, removeMember,
}