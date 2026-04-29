const express = require('express')
const router  = express.Router()
const {
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
} = require('../controllers/noteController')
const { authenticate } = require('../middleware/auth')
const { roleCheck }    = require('../middleware/roleCheck')

router.use(authenticate)

// Both roles — read
router.get('/',       getAllNotes)
router.get('/:id',    getNoteById)

// Teacher only — write
router.post('/',      roleCheck('teacher'), createNote)
router.put('/:id',    roleCheck('teacher'), updateNote)
router.delete('/:id', roleCheck('teacher'), deleteNote)

module.exports = router