const multer = require('multer')
const path   = require('path')
const fs     = require('fs')
const crypto = require('crypto')

// Ensure upload directories exist
const dirs = ['uploads', 'uploads/assignments', 'uploads/submissions', 'uploads/messages', 'uploads/chat']
dirs.forEach(dir => {
  const full = path.join(__dirname, '../../', dir)
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true })
})

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.uploadType || 'assignments'
    cb(null, path.join(__dirname, '../../uploads/', type))
  },
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex')
    const ext    = path.extname(file.originalname)
    cb(null, `${Date.now()}_${unique}${ext}`)
  },
})

// File filter
const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/zip',
    'application/x-rar-compressed',
    'video/mp4',
    'audio/mpeg',
    'audio/mp3',
  ]

  if (allowed.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed.`), false)
  }
}

const uploadAssignment = (req, res, next) => {
  req.uploadType = 'assignments'
  next()
}

const uploadSubmission = (req, res, next) => {
  req.uploadType = 'submissions'
  next()
}

const uploadMessage = (req, res, next) => {
  req.uploadType = 'messages'
  next()
}

const uploadChat = (req, res, next) => {
  req.uploadType = 'chat'
  next()
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
})

module.exports = {
  upload,
  uploadAssignment,
  uploadSubmission,
  uploadMessage,
  uploadChat,
}