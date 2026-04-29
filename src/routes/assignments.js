const express = require('express')
const router  = express.Router()
const {
  getAllAssignments,
  getAssignmentById,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} = require('../controllers/assignmentController')
const { authenticate } = require('../middleware/auth')
const { roleCheck }    = require('../middleware/roleCheck')

router.use(authenticate)

// Both roles — read
router.get('/',       getAllAssignments)
router.get('/:id',    getAssignmentById)

// Teacher only — write
router.post('/',      roleCheck('teacher'), createAssignment)
router.put('/:id',    roleCheck('teacher'), updateAssignment)
router.delete('/:id', roleCheck('teacher'), deleteAssignment)

module.exports = router