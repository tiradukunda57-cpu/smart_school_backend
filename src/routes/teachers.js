const express = require('express')
const router  = express.Router()
const {
  getAllTeachers,
  getTeacherById,
  updateTeacher,
} = require('../controllers/teacherController')
const { authenticate } = require('../middleware/auth')

router.use(authenticate)

router.get('/',      getAllTeachers)
router.get('/:id',   getTeacherById)
router.put('/:id',   updateTeacher)

module.exports = router