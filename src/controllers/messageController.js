const { query } = require('../config/db')

// ─── Get all conversations for current user ────────────────

const getConversations = async (req, res, next) => {
  try {
    const userId = req.user.id

    // Get last message per conversation partner with unread count
    const result = await query(
      `WITH conversation_partners AS (
         SELECT DISTINCT
           CASE
             WHEN sender_id   = $1 THEN receiver_id
             WHEN receiver_id = $1 THEN sender_id
           END AS other_user_id
         FROM messages
         WHERE sender_id = $1 OR receiver_id = $1
       ),
       last_messages AS (
         SELECT DISTINCT ON (
           CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END
         )
           CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_user_id,
           content AS last_message,
           created_at AS last_at
         FROM messages
         WHERE sender_id = $1 OR receiver_id = $1
         ORDER BY
           CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END,
           created_at DESC
       ),
       unread_counts AS (
         SELECT sender_id AS other_user_id, COUNT(*) AS unread_count
         FROM messages
         WHERE receiver_id = $1 AND is_read = FALSE
         GROUP BY sender_id
       )
       SELECT
         cp.other_user_id,
         u.role,
         CASE
           WHEN u.role = 'teacher' THEN t.first_name
           WHEN u.role = 'student' THEN s.first_name
         END AS first_name,
         CASE
           WHEN u.role = 'teacher' THEN t.last_name
           WHEN u.role = 'student' THEN s.last_name
         END AS last_name,
         lm.last_message,
         lm.last_at,
         COALESCE(uc.unread_count, 0) AS unread_count
       FROM conversation_partners cp
       JOIN users u ON u.id = cp.other_user_id
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN last_messages lm ON lm.other_user_id = cp.other_user_id
       LEFT JOIN unread_counts uc ON uc.other_user_id = cp.other_user_id
       ORDER BY lm.last_at DESC NULLS LAST`,
      [userId]
    )

    return res.json({ conversations: result.rows })
  } catch (err) {
    next(err)
  }
}

// ─── Get messages with a specific user ────────────────────

const getMessages = async (req, res, next) => {
  try {
    const userId      = req.user.id
    const otherUserId = parseInt(req.params.userId)

    if (!otherUserId) {
      return res.status(400).json({ message: 'User ID is required.' })
    }

    // Mark messages from other user as read
    await query(
      `UPDATE messages SET is_read = TRUE
       WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE`,
      [otherUserId, userId]
    )

    const result = await query(
      `SELECT
         m.id, m.sender_id, m.receiver_id,
         m.content, m.is_read, m.created_at,
         CASE
           WHEN m.sender_id = $1 THEN 'me'
           ELSE 'other'
         END AS direction
       FROM messages m
       WHERE
         (m.sender_id = $1 AND m.receiver_id = $2) OR
         (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at ASC`,
      [userId, otherUserId]
    )

    return res.json({ messages: result.rows })
  } catch (err) {
    next(err)
  }
}

// ─── Send a message ───────────────────────────────────────

const sendMessage = async (req, res, next) => {
  try {
    const senderId    = req.user.id
    const { receiver_id, content } = req.body

    if (!receiver_id || !content?.trim()) {
      return res.status(400).json({ message: 'receiver_id and content are required.' })
    }

    if (parseInt(receiver_id) === senderId) {
      return res.status(400).json({ message: 'You cannot message yourself.' })
    }

    // Verify receiver exists
    const receiverRes = await query(
      'SELECT id, role FROM users WHERE id = $1',
      [receiver_id]
    )
    if (receiverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Receiver not found.' })
    }

    // Students can only message teachers
    if (req.user.role === 'student' && receiverRes.rows[0].role !== 'teacher') {
      return res.status(403).json({ message: 'Students can only message teachers.' })
    }

    const result = await query(
      `INSERT INTO messages (sender_id, receiver_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [senderId, receiver_id, content.trim()]
    )

    return res.status(201).json({
      message: 'Message sent.',
      data: result.rows[0],
    })
  } catch (err) {
    next(err)
  }
}

// ─── Mark message as read ─────────────────────────────────

const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params

    await query(
      'UPDATE messages SET is_read = TRUE WHERE id = $1 AND receiver_id = $2',
      [id, req.user.id]
    )

    return res.json({ message: 'Message marked as read.' })
  } catch (err) {
    next(err)
  }
}

// ─── Get unread count ─────────────────────────────────────

const getUnreadCount = async (req, res, next) => {
  try {
    const result = await query(
      'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND is_read = FALSE',
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