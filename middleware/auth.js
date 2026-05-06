const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, is_admin: user.is_admin },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

const requireAuth = async (req, res, next) => {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.redirect('/auth/login');
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE id = ? AND is_suspended = FALSE',
            [decoded.id]
        );
        
        if (users.length === 0) {
            res.clearCookie('token');
            return res.redirect('/auth/login');
        }
        
        req.user = users[0];
        next();
    } catch (error) {
        res.clearCookie('token');
        return res.redirect('/auth/login');
    }
};

const requirePin = async (req, res, next) => {
    if (!req.session?.pinVerified) {
        return res.redirect('/auth/pin-entry');
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.user?.is_admin) {
        return res.status(403).render('errors/403');
    }
    next();
};

const requireKYC = async (req, res, next) => {
    if (req.user.kyc_status !== 'approved') {
        req.flash('error', 'KYC verification required');
        return res.redirect('/user/kyc-submit');
    }
    next();
};

module.exports = {
    generateToken,
    requireAuth,
    requirePin,
    requireAdmin,
    requireKYC,
    JWT_SECRET
};