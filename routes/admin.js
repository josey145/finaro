const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requirePin, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

// DEBUG
console.log('Admin Controller exports:', Object.keys(adminController));

router.use(requireAuth, requirePin, requireAdmin);

router.get('/dashboard', adminController.getDashboard);

router.get('/users',         adminController.getUsers);
router.get('/users/create',  adminController.getCreateUser);
router.post('/users/create', adminController.createUser);

// Admin Profile (self-management)
router.get('/profile', adminController.getAdminProfile);
router.post('/profile/update', adminController.updateAdminProfile);
router.post('/profile/change-password', adminController.changeAdminPassword);
router.post('/profile/change-email', adminController.changeAdminEmail);


// Add this BEFORE the /users/create route
router.get('/users/select', adminController.getSelectUser);

router.get('/users/:userId/edit',             adminController.getEditUser);
router.post('/users/:userId/edit',            adminController.postEditUser);
router.post('/users/:userId/change-email',    adminController.changeUserEmail);
router.post('/users/:userId/change-password', adminController.changeUserPassword);
router.post('/users/:userId/change-role',     adminController.changeUserRole);
router.post('/users/:userId/block',           adminController.blockUser);
router.post('/users/:userId/suspend',         adminController.suspendUser);
router.post('/users/:userId/verify',          adminController.verifyUser);
// REMOVED: router.post('/users/:userId/trading-status',  adminController.setTradingStatus);
router.delete('/users/:userId',               adminController.deleteUser);
router.post('/users/:userId/delete',          adminController.deleteUser);
router.get('/users/:userId',                  adminController.getUser);

router.get('/kyc',                     adminController.getKYCReview);
router.get('/kyc-review',              adminController.getKYCReview);
router.post('/kyc/:documentId',        adminController.approveKYC);
router.post('/kyc/toggle/:userId',     adminController.toggleKYCRequirement);

router.get('/fund',    adminController.getFundPage);
router.post('/fund',   adminController.fundAccount);
router.post('/deduct', adminController.deductAccount);

router.get('/notifications',              adminController.getNotificationsPage);
router.post('/notifications/general',     adminController.sendGeneralNotification);
router.post('/notifications/personal',    adminController.sendPersonalNotification);
router.post('/notifications/delete/:id',  adminController.deleteNotification);

router.get('/transactions',                      adminController.getTransactions);
router.get('/transactions/:transactionId/edit',  adminController.getEditTransaction);
router.post('/transactions/:transactionId/edit', adminController.postEditTransaction);

router.get('/withdrawal-steps',             adminController.getWithdrawalSteps);
router.post('/withdrawal-steps/:id',        adminController.updateWithdrawalStep);
router.post('/withdrawal-steps/:id/toggle', adminController.toggleStepStatus);

router.post('/withdrawal-settings', adminController.toggleWithdrawalSteps);

router.get('/pending-withdrawals', adminController.getPendingWithdrawals);
router.post('/transactions/:transactionId/steps/:stepNumber/set-otp',   adminController.setWithdrawalOtp);
router.post('/transactions/:transactionId/steps/:stepNumber/clear-otp', adminController.clearWithdrawalOtp);
router.post('/transactions/:transactionId/approve', adminController.approveWithdrawal);
router.post('/transactions/:transactionId/reject',  adminController.rejectWithdrawal);


router.get('/pending-reviews',         adminController.getPendingStepReviews);
router.post('/pending-reviews/:logId', adminController.reviewStep);

router.get('/settings',         adminController.getSettings);
router.post('/settings/update', upload.single('site_logo'), adminController.updateSettings);

module.exports = router;