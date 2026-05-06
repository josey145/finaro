const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Ensure upload directories exist ──────────────────────────────────────────
const kycDir        = path.join(process.cwd(), 'public', 'uploads', 'kyc');
const logoDir       = path.join(process.cwd(), 'public', 'uploads', 'logos');
const withdrawalDir = path.join(process.cwd(), 'public', 'uploads', 'withdrawals');

[kycDir, logoDir, withdrawalDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Shared file filter ───────────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only PDF, JPG, and PNG files are allowed'), false);
    }
};

// ── KYC Storage ──────────────────────────────────────────────────────────────
const kycStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, kycDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `kyc-${req.user?.id || 'admin'}-${Date.now()}${ext}`);
    },
});

// ── Logo Storage ─────────────────────────────────────────────────────────────
const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `logo-${Date.now()}${ext}`);
    },
});

// ── Withdrawal Storage ───────────────────────────────────────────────────────
const withdrawalStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, withdrawalDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `withdrawal-${req.user?.id || 'user'}-${Date.now()}${ext}`);
    },
});

// ── Exports ──────────────────────────────────────────────────────────────────

// Single file upload (for logo etc.)
const upload = multer({
    storage: logoStorage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
});

// KYC front + back upload
const uploadKYC = multer({
    storage: kycStorage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
    { name: 'document_front', maxCount: 1 },
    { name: 'document_back',  maxCount: 1 },
]);

// ✅ Withdrawal document upload (NEW)
const uploadWithdrawal = multer({
    storage: withdrawalStorage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for withdrawal docs
}).single('document');

module.exports = { upload, uploadKYC, uploadWithdrawal };