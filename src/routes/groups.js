const express = require('express')
const router  = express.Router()
const { authenticate }       = require('../middleware/auth')
const { roleCheck }          = require('../middleware/roleCheck')
const { upload, uploadChat } = require('../middleware/upload')
const {
  createGroup, getMyGroups, getGroupById,
  getGroupMessages, sendGroupMessage,
  addMember, removeMember,
} = require('../controllers/groupController')

router.use(authenticate)

router.get('/',              getMyGroups)
router.get('/:id',           getGroupById)
router.get('/:id/messages',  getGroupMessages)
router.post('/:id/messages', uploadChat, upload.array('files', 5), sendGroupMessage)

// Admin only
router.post('/',                        roleCheck('admin'), createGroup)
router.post('/:id/members',            roleCheck('admin'), addMember)
router.delete('/:id/members/:userId',  roleCheck('admin'), removeMember)

module.exports = router