const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const kycController = require('../controllers/kycController');
const { uploadKYC }  = require('../middleware/upload');
const { requireAuth, requirePin } = require('../middleware/auth');

// Apply auth to all routes
router.use(requireAuth, requirePin);

// KYC upload error handler
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

router.get('/kyc-submit',    kycController.getKYCPage);
router.post('/kyc-submit',   handleKYCUpload, kycController.submitKYC);
router.post('/kyc-reupload', handleKYCUpload, kycController.reuploadKYC);
router.get('/kyc-status',    kycController.getKYCStatus);

module.exports = router;