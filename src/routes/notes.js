const express = require('express')
const router  = express.Router()
const {
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
} = require('../controllers/noteController')
const { authenticate }            = require('../middleware/auth')
const { approvedTeacher }         = require('../middleware/roleCheck')

router.use(authenticate)

// Both roles read
router.get('/',       getAllNotes)
router.get('/:id',    getNoteById)

// Only approved teachers write
router.post('/',      approvedTeacher, createNote)
router.put('/:id',    approvedTeacher, updateNote)
router.delete('/:id', approvedTeacher, deleteNote)

module.exports = router