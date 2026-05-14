const express = require('express')
const router  = express.Router()
const {
  getAllAssignments,
  getAssignmentById,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} = require('../controllers/assignmentController')
const { authenticate }                     = require('../middleware/auth')
const { roleCheck, approvedTeacher }       = require('../middleware/roleCheck')
const { upload, uploadAssignment: setDir } = require('../middleware/upload')

router.use(authenticate)

// Both roles can read assignments
router.get('/',       getAllAssignments)
router.get('/:id',    getAssignmentById)

// Teachers write — only APPROVED teachers can post assignments to students
router.post('/',      approvedTeacher, setDir, upload.array('files', 10), createAssignment)
router.put('/:id',    approvedTeacher, updateAssignment)
router.delete('/:id', approvedTeacher, deleteAssignment)

module.exports = router