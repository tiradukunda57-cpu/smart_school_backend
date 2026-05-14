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

// Specific routes BEFORE parameterized
router.get('/conversations', getConversations)
router.get('/unread/count',  getUnreadCount)
router.post('/',             sendMessage)
router.put('/:id/read',      markAsRead)

// Parameterized LAST
router.get('/:userId',       getMessages)

module.exports = router