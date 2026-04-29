/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Unhandled error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
  })

  // PostgreSQL specific errors
  if (err.code === '23505') {
    const field = err.detail?.match(/\(([^)]+)\)/)?.[1] || 'field'
    return res.status(409).json({
      message: `A record with this ${field} already exists.`
    })
  }

  if (err.code === '23503') {
    return res.status(400).json({ message: 'Referenced record does not exist.' })
  }

  if (err.code === '23502') {
    return res.status(400).json({ message: 'Required field is missing.' })
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Invalid token.' })
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Token expired.' })
  }

  // Validation errors
  if (err.type === 'validation') {
    return res.status(400).json({ message: err.message, errors: err.errors })
  }

  // Default
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
}

/**
 * 404 handler
 */
const notFound = (req, res) => {
  res.status(404).json({
    message: `Route ${req.method} ${req.url} not found.`
  })
}

module.exports = { errorHandler, notFound }