const express = require('express')
const router  = express.Router()
const { authenticate } = require('../middleware/auth')
const { submitRecoveryRequest, getMyRecoveryRequests } = require('../controllers/recoveryController')

router.use(authenticate)

router.post('/', submitRecoveryRequest)
router.get('/my', getMyRecoveryRequests)

module.exports = router