const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requirePin, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

// ✅ Protects ALL routes below — no need to repeat middleware on each route
router.use(requireAuth, requirePin, requireAdmin);

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Users
router.get('/users',              adminController.getUsers);
router.get('/users/create',       adminController.getCreateUser);
router.post('/users/create',      adminController.createUser);
router.post('/users/:userId/suspend', adminController.suspendUser);
router.delete('/users/:userId',   adminController.deleteUser);
router.get('/users/:userId',      adminController.getUser);

// KYC
router.get('/kyc',                       adminController.getKYCReview);
router.get('/kyc-review',                adminController.getKYCReview);
router.post('/kyc/:documentId',          adminController.approveKYC);
router.post('/kyc/toggle/:userId',       adminController.toggleKYCRequirement);

// Fund / Deduct
router.get('/fund',    adminController.getFundPage);
router.post('/fund',   adminController.fundAccount);
router.post('/deduct', adminController.deductAccount);

// Notifications
router.get('/notifications',                  adminController.getNotificationsPage);
router.post('/notifications/general',         adminController.sendGeneralNotification);
router.post('/notifications/personal',        adminController.sendPersonalNotification);
router.post('/notifications/delete/:id',      adminController.deleteNotification);

// Transactions
router.get('/transactions',                          adminController.getTransactions);
router.get('/transactions/:transactionId/edit',      adminController.getEditTransaction);
router.post('/transactions/:transactionId/edit',     adminController.postEditTransaction);

// Withdrawal steps configuration
router.get('/withdrawal-steps',              adminController.getWithdrawalSteps);
router.post('/withdrawal-steps/:id',         adminController.updateWithdrawalStep);
router.post('/withdrawal-steps/:id/toggle',  adminController.toggleStepStatus);

// Withdrawal settings (global toggle)
router.post('/withdrawal-settings', adminController.toggleWithdrawalSteps);

// Pending withdrawals — admin sets / clears OTP per transaction step
router.get('/pending-withdrawals',                                             adminController.getPendingWithdrawals);
router.post('/transactions/:transactionId/steps/:stepNumber/set-otp',          adminController.setWithdrawalOtp);
router.post('/transactions/:transactionId/steps/:stepNumber/clear-otp',        adminController.clearWithdrawalOtp);

// Direct Approve / Reject — REMOVED isAdmin since requireAdmin already protects all routes
router.post('/transactions/:transactionId/approve', adminController.approveWithdrawal);
router.post('/transactions/:transactionId/reject', adminController.rejectWithdrawal);

// Pending step reviews (ADMIN_APPROVE steps)
router.get('/pending-reviews',         adminController.getPendingStepReviews);
router.post('/pending-reviews/:logId', adminController.reviewStep);

// Settings
router.get('/settings',          adminController.getSettings);
router.post('/settings/update',  upload.single('site_logo'), adminController.updateSettings);

module.exports = router;