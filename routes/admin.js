const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requirePin, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

console.log('Admin Controller exports:', Object.keys(adminController));

router.use(requireAuth, requirePin, requireAdmin);

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', adminController.getDashboard);

// ─── User Management ──────────────────────────────────────────────────────────
// IMPORTANT: specific paths like /users/create and /users/select must come
// BEFORE the /users/:userId wildcard — otherwise Express swallows them.
router.get('/users',                adminController.getUsers);
router.get('/users/create',         adminController.getCreateUser);
router.post('/users/create',        adminController.createUser);
router.get('/users/select',         adminController.getSelectUser);

router.get('/users/:userId',                  adminController.getUser);
router.get('/users/:userId/edit',             adminController.getEditUser);
router.post('/users/:userId/edit',            adminController.postEditUser);
router.post('/users/:userId/change-email',    adminController.changeUserEmail);
router.post('/users/:userId/change-password', adminController.changeUserPassword);
router.post('/users/:userId/change-role',     adminController.changeUserRole);
router.post('/users/:userId/block',           adminController.blockUser);
router.post('/users/:userId/suspend',         adminController.suspendUser);
router.post('/users/:userId/verify',          adminController.verifyUser);
router.delete('/users/:userId',               adminController.deleteUser);
router.post('/users/:userId/delete',          adminController.deleteUser);

// ─── KYC ──────────────────────────────────────────────────────────────────────
// FIX: static segments (/kyc/review, /kyc/toggle, /kyc/audit) MUST come before
//      the wildcard /kyc/:documentId, otherwise Express reads "toggle" and
//      "audit" as a documentId and routes break.

router.get('/kyc',                adminController.getKYCReview);   // main KYC list
router.get('/kyc-review',         adminController.getKYCReview);   // alias

// KYC approve / reject — POST /admin/kyc/:documentId/review  { action, notes }
// Using /review suffix avoids the conflict with /toggle
router.post('/kyc/:documentId/review',  adminController.approveKYC);

// KYC toggle requirement per user
router.post('/kyc/toggle/:userId',      adminController.toggleKYCRequirement);

// KYC audit log per user  (new)
router.get('/users/:userId/kyc-audit',  adminController.getKYCAuditLog);

// ─── Admin Profile ────────────────────────────────────────────────────────────
router.get('/profile',                    adminController.getAdminProfile);
router.post('/profile/update',            adminController.updateAdminProfile);
router.post('/profile/change-password',   adminController.changeAdminPassword);
router.post('/profile/change-email',      adminController.changeAdminEmail);

// ─── Fund / Deduct ────────────────────────────────────────────────────────────
router.get('/fund',    adminController.getFundPage);
router.post('/fund',   adminController.fundAccount);
router.post('/deduct', adminController.deductAccount);

// ─── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications',             adminController.getNotificationsPage);
router.post('/notifications/general',    adminController.sendGeneralNotification);
router.post('/notifications/personal',   adminController.sendPersonalNotification);
router.post('/notifications/delete/:id', adminController.deleteNotification);

// ─── Transactions ─────────────────────────────────────────────────────────────
router.get('/transactions',                      adminController.getTransactions);
router.get('/transactions/:transactionId/edit',  adminController.getEditTransaction);
router.post('/transactions/:transactionId/edit', adminController.postEditTransaction);

// ─── Withdrawal Steps Config ──────────────────────────────────────────────────
router.get('/withdrawal-steps',              adminController.getWithdrawalSteps);
router.post('/withdrawal-steps/:id',         adminController.updateWithdrawalStep);
router.post('/withdrawal-steps/:id/toggle',  adminController.toggleStepStatus);
router.post('/withdrawal-settings',          adminController.toggleWithdrawalSteps);

// ─── Pending Withdrawals ──────────────────────────────────────────────────────
router.get('/pending-withdrawals', adminController.getPendingWithdrawals);
router.post('/transactions/:transactionId/steps/:stepNumber/set-otp',   adminController.setWithdrawalOtp);
router.post('/transactions/:transactionId/steps/:stepNumber/clear-otp', adminController.clearWithdrawalOtp);
router.post('/transactions/:transactionId/approve', adminController.approveWithdrawal);
router.post('/transactions/:transactionId/reject',  adminController.rejectWithdrawal);

// ─── Pending Step Reviews ─────────────────────────────────────────────────────
router.get('/pending-reviews',          adminController.getPendingStepReviews);
router.post('/pending-reviews/:logId',  adminController.reviewStep);

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings',          adminController.getSettings);
router.post('/settings/update',  upload.single('site_logo'), adminController.updateSettings);

module.exports = router;