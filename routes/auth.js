const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const registerValidation = [
    body('first_name').trim().notEmpty().withMessage('First name is required'),
    body('last_name').trim().notEmpty().withMessage('Last name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('date_of_birth').notEmpty().withMessage('Date of birth is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('country').notEmpty().withMessage('Please select a country'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirm_password').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Passwords do not match');
        }
        return true;
    })
];

// Registration
router.get('/register', authController.getRegister);
router.post('/register', registerValidation, authController.postRegister);

// Resend Verification
router.get('/resend-verification', authController.getResendVerification);
router.post('/resend-verification', authController.postResendVerification);

// Email Verification
router.get('/verify-email', authController.verifyEmail);

// Authentication
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/logout', authController.logout);

// ── ADD THESE — they exist in your controller but are missing from routes ──
router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.postForgotPassword);
router.get('/reset-password', authController.getResetPassword);   // reads ?token= from query
router.post('/reset-password', authController.postResetPassword);

// PIN Security (requireAuth is correct — user has JWT cookie but hasn't entered PIN yet)
router.get('/pin-entry', requireAuth, authController.getPinEntry);
router.post('/pin-entry', requireAuth, authController.postPinEntry);
router.get('/set-pin', requireAuth, authController.getSetPin);
router.post('/set-pin', requireAuth, authController.postSetPin);

module.exports = router;