const { query } = require('../config/db')

// ── Get all conversations for current user ─────────────────────
const getConversations = async (req, res, next) => {
  try {
    const userId = req.user.id

    const result = await query(
      `WITH msg_pairs AS (
         SELECT
           CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_user_id,
           MAX(created_at) AS last_at
         FROM messages
         WHERE sender_id = $1 OR receiver_id = $1
         GROUP BY
           CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END
       )
       SELECT
         mp.other_user_id,
         u.role,
         COALESCE(t.first_name, s.first_name, 'Admin')  AS first_name,
         COALESCE(t.last_name,  s.last_name,  'User')   AS last_name,
         mp.last_at,
         (
           SELECT content FROM messages
           WHERE (sender_id = $1 AND receiver_id = mp.other_user_id)
              OR (sender_id = mp.other_user_id AND receiver_id = $1)
           ORDER BY created_at DESC LIMIT 1
         ) AS last_message,
         (
           SELECT COUNT(*) FROM messages
           WHERE sender_id = mp.other_user_id
             AND receiver_id = $1
             AND is_read = FALSE
         ) AS unread_count
       FROM msg_pairs mp
       JOIN users u ON u.id = mp.other_user_id
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       ORDER BY mp.last_at DESC NULLS LAST`,
      [userId]
    )

    return res.json({ conversations: result.rows })
  } catch (err) {
    next(err)
  }
}

// ── Get messages with a specific user ─────────────────────────
const getMessages = async (req, res, next) => {
  try {
    const userId      = req.user.id
    const otherUserId = parseInt(req.params.userId)

    if (!otherUserId || isNaN(otherUserId)) {
      return res.status(400).json({ message: 'Valid user ID is required.' })
    }

    // Verify other user exists
    const otherUserRes = await query(
      'SELECT id, role FROM users WHERE id = $1',
      [otherUserId]
    )
    if (otherUserRes.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' })
    }

    // Mark incoming messages from otherUser as read
    await query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE`,
      [otherUserId, userId]
    )

    // Fetch full message history
    const result = await query(
      `SELECT
         m.id,
         m.sender_id,
         m.receiver_id,
         m.content,
         m.is_read,
         m.created_at,
         CASE WHEN m.sender_id = $1 THEN 'me' ELSE 'other' END AS direction
       FROM messages m
       WHERE (m.sender_id = $1 AND m.receiver_id = $2)
          OR (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at ASC`,
      [userId, otherUserId]
    )

    return res.json({ messages: result.rows })
  } catch (err) {
    next(err)
  }
}

// ── Send message ───────────────────────────────────────────────
const sendMessage = async (req, res, next) => {
  try {
    const senderId              = req.user.id
    const { receiver_id, content } = req.body

    if (!receiver_id) {
      return res.status(400).json({ message: 'receiver_id is required.' })
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required.' })
    }

    const receiverId = parseInt(receiver_id)
    if (isNaN(receiverId)) {
      return res.status(400).json({ message: 'Invalid receiver_id.' })
    }

    if (receiverId === senderId) {
      return res.status(400).json({ message: 'You cannot message yourself.' })
    }

    // Verify receiver exists
    const receiverRes = await query(
      'SELECT id, role FROM users WHERE id = $1 AND is_active = TRUE',
      [receiverId]
    )
    if (receiverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Receiver not found or inactive.' })
    }

    const receiverRole = receiverRes.rows[0].role
    const senderRole   = req.user.role

    // Rules:
    // Students  → can message teachers and admin
    // Teachers  → can message students, other teachers, and admin
    // Admin     → can message anyone
    if (senderRole === 'student') {
      if (receiverRole === 'student') {
        return res.status(403).json({
          message: 'Students can only message teachers or admin.',
        })
      }
    }

    const result = await query(
      `INSERT INTO messages (sender_id, receiver_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [senderId, receiverId, content.trim()]
    )

    return res.status(201).json({
      message: 'Message sent.',
      data: result.rows[0],
    })
  } catch (err) {
    next(err)
  }
}

// ── Mark message as read ────────────────────────────────────────
const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params

    await query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE id = $1 AND receiver_id = $2`,
      [id, req.user.id]
    )

    return res.json({ message: 'Marked as read.' })
  } catch (err) {
    next(err)
  }
}

// ── Get unread count ────────────────────────────────────────────
const getUnreadCount = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT COUNT(*) FROM messages
       WHERE receiver_id = $1 AND is_read = FALSE`,
      [req.user.id]
    )
    return res.json({ count: parseInt(result.rows[0].count) })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
}