const express = require('express')
const router  = express.Router()
const {
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentStats,
} = require('../controllers/studentController')
const { authenticate }            = require('../middleware/auth')
const { approvedTeacher }         = require('../middleware/roleCheck')

router.use(authenticate)

// All teacher routes require approved status
router.get('/',       approvedTeacher, getAllStudents)
router.get('/stats',  approvedTeacher, getStudentStats)
router.get('/:id',    approvedTeacher, getStudentById)
router.put('/:id',    approvedTeacher, updateStudent)
router.delete('/:id', approvedTeacher, deleteStudent)

module.exports = router