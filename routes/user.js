const express            = require('express');
const router             = express.Router();
const multer             = require('multer');
const userController     = require('../controllers/userController');
const kycController      = require('../controllers/kycController');
const settingsController = require('../controllers/settingsController');
const { uploadKYC, uploadWithdrawal } = require('../middleware/upload');
const { requireAuth, requirePin }     = require('../middleware/auth');
const preferences                     = require('../middleware/preferences');


// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD ERROR HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

const handleKYCUpload = (req, res, next) => {
    uploadKYC(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            req.flash('error', err.code === 'LIMIT_FILE_SIZE'
                ? 'File too large. Max 5MB allowed.'
                : 'Upload error: ' + err.message);
            return res.redirect('/user/kyc-submit');
        } else if (err) {
            req.flash('error', err.message);
            return res.redirect('/user/kyc-submit');
        }
        next();
    });
};

const handleWithdrawalUpload = (req, res, next) => {
    uploadWithdrawal(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({
                success: false,
                message: err.code === 'LIMIT_FILE_SIZE'
                    ? 'File too large. Max 10MB allowed.'
                    : 'Upload error: ' + err.message
            });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
};


// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

router.use(requireAuth, requirePin, preferences);


// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/dashboard', userController.getDashboard);


// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/open-account',        userController.getOpenAccount);
router.post('/open-account',       userController.postOpenAccount);
router.post('/set-active-account', userController.setActiveAccount);
router.get('/account-details/:id', userController.getAccountDetails);


// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/profile',         userController.getProfile);
router.post('/profile/update', userController.updateProfile);


// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/settings',                  settingsController.getSettings);
router.post('/settings/preferences',     settingsController.savePreferences);
router.post('/settings/change-password', settingsController.changePassword);
router.post('/settings/change-pin',      settingsController.changePin);

// ── Navbar theme/language persistence (called by navbar JS) ──
router.post('/settings/theme',    userController.saveTheme);
router.post('/settings/language', userController.saveLanguage);


// ═══════════════════════════════════════════════════════════════════════════════
// DEPOSIT
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/deposit',  userController.getDeposit);   // ← was missing, now added
router.post('/deposit', userController.postDeposit);


// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFER
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/transfer/lookup', userController.lookupAccount);
router.get('/transfer',        userController.getTransfer);
router.post('/transfer',       userController.postTransfer);


// ═══════════════════════════════════════════════════════════════════════════════
// MOVE MONEY
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/move-money',  userController.getMoveMoney);
router.post('/move-money', userController.postMoveMoney);


// ═══════════════════════════════════════════════════════════════════════════════
// WITHDRAWAL
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// WITHDRAWAL ROUTES — Clean Structure
// ═══════════════════════════════════════════════════════════════════════════════

// Main withdraw page (list/form to start)
router.get('/withdraw', userController.getWithdraw);

// Initiate new withdrawal (creates transaction + step logs)
router.post('/withdraw/initiate', userController.initiateWithdrawal);

// Cancel a pending withdrawal (cleanup)
router.post('/withdraw/cancel/:transactionId', userController.cancelWithdrawal);

// Step processing — GET shows form, POST submits step
router.get('/withdraw/steps/:transactionId', userController.getWithdrawSteps);
router.post('/withdraw/steps/:transactionId', handleWithdrawalUpload, userController.processWithdrawStep);

// Request OTP code
router.get('/withdraw/code', userController.requestWithdrawalCode);


// Add these two routes wherever your user routes are defined:
router.get('/pending-withdrawals',  userController.getPendingWithdrawals);
router.get('/network-error',        userController.getNetworkError);


router.get ('/contact-support',  userController.getContactSupport);
router.post('/contact-support',  userController.postContactSupport);


// ═══════════════════════════════════════════════════════════════════════════════
// KYC
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/kyc-submit',    kycController.getKYCPage);
router.post('/kyc-submit',   handleKYCUpload, kycController.submitKYC);
router.post('/kyc-reupload', handleKYCUpload, kycController.reuploadKYC);
router.get('/kyc-status',    kycController.getKYCStatus);


// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/notifications',       userController.getNotifications);
router.get('/notifications/count', userController.getUnreadCount);


// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/transactions', userController.getTransactions);


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;