// API Routes - RESTful endpoints
const express = require('express');
const userController = require('../controllers/userController');
const adminController = require('../controllers/adminController');
const kycController = require('../controllers/kycController');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// Public API endpoints
router.get('/health', (req, res) => {
  res.status(200).json({ message: 'Server is running' });
});

// User API endpoints
router.get('/user/profile', verifyToken, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.userId);
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching profile' });
  }
});

router.get('/user/account', verifyToken, async (req, res) => {
  try {
    const Account = require('../models/Account');
    const account = await Account.getAccount(req.userId);
    res.json(account);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching account' });
  }
});

// Admin API endpoints
router.get('/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const User = require('../models/User');
    const Transaction = require('../models/Transaction');
    
    const [users] = await require('../config/database').query('SELECT COUNT(*) as count FROM users');
    const [transactions] = await require('../config/database').query('SELECT COUNT(*) as count FROM transactions');

    res.json({
      totalUsers: users[0].count,
      totalTransactions: transactions[0].count
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching stats' });
  }
});

module.exports = router;
