// ─── 404 Handler ──────────────────────────────────────────────────────────────
const notFound = (req, res, _next) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  })
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
const errorHandler = (err, req, res, _next) => {

  // ── Log error ──────────────────────────────────────────
  console.error('❌ Unhandled error:', {
    message: err.message,
    code:    err.code,
    url:     req.originalUrl,
    method:  req.method,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })

  // ── Already sent response guard ────────────────────────
  if (res.headersSent) return

  // ══════════════════════════════════════════════════════
  // PostgreSQL Error Codes
  // ══════════════════════════════════════════════════════

  // 23505 — Unique constraint violation
  if (err.code === '23505') {
    const match = err.detail?.match(/Key \((.+?)\)=\((.+?)\)/)
    const field  = match?.[1] || 'field'
    const value  = match?.[2] || ''

    return res.status(409).json({
      success: false,
      message: value
        ? `${capitalize(field)} "${value}" is already taken.`
        : `Duplicate entry: ${field} already exists.`,
    })
  }

  // 23503 — Foreign key violation
  if (err.code === '23503') {
    const match = err.detail?.match(/Key \((.+?)\)=\((.+?)\)/)
    const field  = match?.[1] || 'reference'

    return res.status(400).json({
      success: false,
      message: `Referenced ${field} does not exist.`,
    })
  }

  // 23502 — Not null violation
  if (err.code === '23502') {
    const field = err.column || 'field'
    return res.status(400).json({
      success: false,
      message: `Required field is missing: ${field}.`,
    })
  }

  // 23514 — Check constraint violation
  if (err.code === '23514') {
    const constraint = err.constraint || 'value'
    return res.status(400).json({
      success: false,
      message: `Invalid value: violates constraint "${constraint}".`,
    })
  }

  // 22P02 — Invalid input syntax (e.g. non-integer where int expected)
  if (err.code === '22P02') {
    return res.status(400).json({
      success: false,
      message: 'Invalid data format. Please check your input.',
    })
  }

  // 22001 — String too long
  if (err.code === '22001') {
    return res.status(400).json({
      success: false,
      message: 'One or more fields exceed the maximum allowed length.',
    })
  }

  // 42P01 — Undefined table (relation does not exist)
  if (err.code === '42P01') {
    console.error('🔴 Database table missing! Run: npm run db:init')
    return res.status(503).json({
      success: false,
      message: 'Database not initialized. Please contact support.',
    })
  }

  // 42703 — Undefined column
  if (err.code === '42703') {
    console.error('🔴 Unknown column in query:', err.message)
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    })
  }

  // ECONNREFUSED — Database connection refused
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      message: 'Database connection failed. Please try again later.',
    })
  }

  // 57014 — Query cancelled
  if (err.code === '57014') {
    return res.status(503).json({
      success: false,
      message: 'Request timed out. Please try again.',
    })
  }

  // ══════════════════════════════════════════════════════
  // JWT Errors
  // ══════════════════════════════════════════════════════

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token. Please login again.',
    })
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Session expired. Please login again.',
    })
  }

  if (err.name === 'NotBeforeError') {
    return res.status(401).json({
      success: false,
      message: 'Token not yet active.',
    })
  }

  // ══════════════════════════════════════════════════════
  // Validation / Syntax Errors
  // ══════════════════════════════════════════════════════

  // Body parser error (malformed JSON)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON in request body.',
    })
  }

  // Payload too large
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request body too large.',
    })
  }

  // ══════════════════════════════════════════════════════
  // Custom App Errors
  // ══════════════════════════════════════════════════════

  // Support throwing: const err = new Error('msg'); err.statusCode = 403
  if (err.statusCode || err.status) {
    const statusCode = err.statusCode || err.status
    return res.status(statusCode).json({
      success: false,
      message: err.message || 'An error occurred.',
    })
  }

  // ══════════════════════════════════════════════════════
  // Default 500
  // ══════════════════════════════════════════════════════

  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message || 'Internal server error.',
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      code:  err.code,
    }),
  })
}

// ─── Helper ───────────────────────────────────────────────────────────────────
const capitalize = (str) =>
  str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : str

module.exports = { notFound, errorHandler }