const { query } = require('../config/db')

// ── Student/Teacher submits password recovery request ─────────
const submitRecoveryRequest = async (req, res, next) => {
  try {
    const { message } = req.body

    if (!message || !message.trim()) {
      return res.status(400).json({
        message: 'Please describe your issue and include the new password you want.',
      })
    }

    // Check for existing pending request
    const existing = await query(
      "SELECT id FROM recovery_requests WHERE user_id=$1 AND status='pending'",
      [req.user.id]
    )

    if (existing.rows.length > 0) {
      return res.status(400).json({
        message: 'You already have a pending recovery request. Please wait for admin response.',
      })
    }

    const result = await query(
      `INSERT INTO recovery_requests (user_id, message)
       VALUES ($1, $2) RETURNING *`,
      [req.user.id, message.trim()]
    )

    return res.status(201).json({
      message: 'Recovery request submitted. Admin will review it shortly.',
      request: result.rows[0],
    })
  } catch (err) { next(err) }
}

// ── Get my recovery requests ──────────────────────────────────
const getMyRecoveryRequests = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM recovery_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    )

    return res.json({ requests: result.rows })
  } catch (err) { next(err) }
}

module.exports = { submitRecoveryRequest, getMyRecoveryRequests }