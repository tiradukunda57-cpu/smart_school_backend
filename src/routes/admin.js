const express = require('express')
const router  = express.Router()
const { authenticate }  = require('../middleware/auth')
const { roleCheck }     = require('../middleware/roleCheck')
const {
  getDashboardStats, getAllUsers, getAllTeachersAdmin,
  getPendingTeachers, approveTeacher, rejectTeacher,
  suspendTeacher, toggleUserActive,
  changeUserPassword, viewUserPassword,
  getRecoveryRequests, handleRecoveryRequest,
  getActivityLogs, getDailyReport,
  archiveDailyReport, getReportArchive,
  cleanupRejectedTeachers,
} = require('../controllers/adminController')

router.use(authenticate)
router.use(roleCheck('admin'))

// Dashboard
router.get('/stats', getDashboardStats)

// Users
router.get('/users', getAllUsers)
router.put('/users/:id/toggle', toggleUserActive)
router.put('/users/:id/password', changeUserPassword)
router.get('/users/:id/password', viewUserPassword)

// Teachers
router.get('/teachers', getAllTeachersAdmin)
router.get('/teachers/pending', getPendingTeachers)
router.put('/teachers/:id/approve', approveTeacher)
router.put('/teachers/:id/reject', rejectTeacher)
router.put('/teachers/:id/suspend', suspendTeacher)

// Recovery
router.get('/recovery', getRecoveryRequests)
router.put('/recovery/:id', handleRecoveryRequest)

// Activity logs
router.get('/activity', getActivityLogs)

// Reports
router.get('/reports/daily/:date?', getDailyReport)
router.post('/reports/archive', archiveDailyReport)
router.get('/reports/archive', getReportArchive)

// Cleanup
router.post('/cleanup/teachers', cleanupRejectedTeachers)

module.exports = router