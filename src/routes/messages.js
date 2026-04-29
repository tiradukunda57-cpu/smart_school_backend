const express = require('express')
const router  = express.Router()
const {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
} = require('../controllers/messageController')
const { authenticate } = require('../middleware/auth')

router.use(authenticate)

router.get('/conversations',    getConversations)
router.get('/unread/count',     getUnreadCount)
router.get('/:userId',          getMessages)
router.post('/',                sendMessage)
router.put('/:id/read',         markAsRead)

module.exports = router