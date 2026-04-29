const express = require('express')
const router  = express.Router()
const {
  getAllTeachers,
  getTeacherById,
  updateTeacher,
} = require('../controllers/teacherController')
const { authenticate } = require('../middleware/auth')

// All authenticated users can view teachers
router.use(authenticate)

router.get('/',      getAllTeachers)
router.get('/:id',   getTeacherById)
router.put('/:id',   updateTeacher)   // teacher can only update own profile (enforced in controller)

module.exports = router