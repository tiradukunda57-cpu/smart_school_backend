const express = require('express')
const router  = express.Router()
const { registerStudent, registerTeacher, login, getProfile, updateProfile } = require('../controllers/authController')
const { authenticate } = require('../middleware/auth')

router.post('/student/register', registerStudent)
router.post('/teacher/register', registerTeacher)
router.post('/:role/login', login) // student | teacher | admin

router.get('/profile', authenticate, getProfile)
router.put('/profile', authenticate, updateProfile)

module.exports = router