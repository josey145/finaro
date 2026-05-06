// 4-Digit PIN Verification Middleware
const User = require('../models/User');
const bcrypt = require('bcrypt');

const verifyPIN = async (req, res, next) => {
  try {
    const { pin } = req.body;
    
    if (!pin || pin.length !== 4 || isNaN(pin)) {
      return res.status(400).json({ message: 'Invalid PIN format. Must be 4 digits' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isPINValid = await bcrypt.compare(pin, user.pin);
    if (!isPINValid) {
      return res.status(401).json({ message: 'Invalid PIN' });
    }

    next();
  } catch (err) {
    res.status(500).json({ message: 'PIN verification failed', error: err.message });
  }
};

module.exports = { verifyPIN };
