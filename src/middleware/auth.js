const jwt       = require('jsonwebtoken')
const { query } = require('../config/db')

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Access denied. No token provided.' })
    }

    const token = authHeader.split(' ')[1]

    let decoded
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET)
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Session expired. Please log in again.' })
      }
      return res.status(401).json({ message: 'Invalid token.' })
    }

    const result = await query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'User no longer exists.' })
    }

    const user = result.rows[0]

    if (!user.is_active) {
      return res.status(403).json({ message: 'Account is deactivated. Contact admin.' })
    }

    req.user = user
    next()
  } catch (err) {
    console.error('Auth middleware error:', err.message)
    res.status(500).json({ message: 'Authentication error.' })
  }
}

module.exports = { authenticate }