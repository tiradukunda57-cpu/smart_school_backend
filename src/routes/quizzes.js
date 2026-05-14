const express = require('express')
const router  = express.Router()
const { authenticate } = require('../middleware/auth')
const { roleCheck }    = require('../middleware/roleCheck')
const {
  createQuiz,
  getMyQuizzes,
  getQuizById,
  togglePublish,
  deleteQuiz,
  getAvailableQuizzes,
  startQuiz,
  answerQuestion,
  submitQuiz,
  getQuizProgress,
  getAnswerSheet,
} = require('../controllers/quizController')

router.use(authenticate)

// ── IMPORTANT: Specific routes BEFORE parameterized routes ────

// Student routes
router.get('/available',                    roleCheck('student'), getAvailableQuizzes)
router.post('/answer',                      roleCheck('student'), answerQuestion)
router.put('/sessions/:session_id/submit',  roleCheck('student'), submitQuiz)
router.post('/:id/start',                  roleCheck('student'), startQuiz)

// Teacher — specific paths before /:id
router.get('/my',                           roleCheck('teacher'), getMyQuizzes)
router.get('/sessions/:sessionId/answers',  roleCheck('teacher'), getAnswerSheet)

// Teacher — parameterized (MUST come after all specific routes)
router.post('/',                            roleCheck('teacher'), createQuiz)
router.get('/:id/progress',                roleCheck('teacher'), getQuizProgress)
router.put('/:id/publish',                 roleCheck('teacher'), togglePublish)
router.delete('/:id',                      roleCheck('teacher'), deleteQuiz)
router.get('/:id',                         roleCheck('teacher'), getQuizById)

module.exports = router