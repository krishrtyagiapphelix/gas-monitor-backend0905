const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authController');
 
// Registration route
router.post('/register', registerUser);
 
// Login route
router.post('/login', loginUser);
 
module.exports = router;