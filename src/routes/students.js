const express = require('express')
const router  = express.Router()
const {
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentStats,
} = require('../controllers/studentController')
const { authenticate } = require('../middleware/auth')
const { roleCheck }    = require('../middleware/roleCheck')

// All routes require authentication
router.use(authenticate)

// Teacher only
router.get('/',            roleCheck('teacher'), getAllStudents)
router.get('/stats',       roleCheck('teacher'), getStudentStats)
router.get('/:id',         roleCheck('teacher'), getStudentById)
router.put('/:id',         roleCheck('teacher'), updateStudent)
router.delete('/:id',      roleCheck('teacher'), deleteStudent)

module.exports = router