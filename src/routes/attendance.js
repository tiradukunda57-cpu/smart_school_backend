const express = require('express')
const router  = express.Router()
const {
  getAllAttendance,
  getMyAttendance,
  bulkCreateAttendance,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceSummary,
} = require('../controllers/attendanceController')
const { authenticate } = require('../middleware/auth')
const { roleCheck }    = require('../middleware/roleCheck')

router.use(authenticate)

// Student routes
router.get('/my',                    roleCheck('student'), getMyAttendance)

// Teacher routes
router.get('/',                      roleCheck('teacher'), getAllAttendance)
router.post('/',                     roleCheck('teacher'), createAttendance)
router.post('/bulk',                 roleCheck('teacher'), bulkCreateAttendance)
router.put('/:id',                   roleCheck('teacher'), updateAttendance)
router.delete('/:id',                roleCheck('teacher'), deleteAttendance)

// Both
router.get('/summary/:studentId',    authenticate,         getAttendanceSummary)

module.exports = router