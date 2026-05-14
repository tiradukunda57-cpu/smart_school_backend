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
const { authenticate }            = require('../middleware/auth')
const { roleCheck, approvedTeacher } = require('../middleware/roleCheck')

router.use(authenticate)

// Student — view own attendance
router.get('/my',                 roleCheck('student'), getMyAttendance)

// Shared — summary
router.get('/summary/:studentId', getAttendanceSummary)

// Teacher — all require approved status
router.get('/',                   approvedTeacher, getAllAttendance)
router.post('/bulk',              approvedTeacher, bulkCreateAttendance)
router.post('/',                  approvedTeacher, createAttendance)
router.put('/:id',                approvedTeacher, updateAttendance)
router.delete('/:id',             approvedTeacher, deleteAttendance)

module.exports = router