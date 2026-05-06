const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { generateToken } = require('../middleware/auth');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');
const { getSymbol } = require('../utils/currencyConverter'); // ← same helper as userController
const { 
    generateVerificationToken, 
    hashPin, 
    verifyPin,
    generateAccountNumber
} = require('../utils/helpers');

const PUBLIC_URL = 'https://choreal-pseudoregal-wynona.ngrok-free.dev';

// ─── applyUserPrefs ───────────────────────────────────────────────────────────
// Mirrors userController exactly: reads lang, currency, theme from DB (when
// logged in) or falls back to session → hard defaults. Writes to res.locals
// AND req.session so every subsequent request stays in sync.
async function applyUserPrefs(req, res) {
    // ── Defaults ──────────────────────────────────────────────────────────────
    let lang     = req.session?.lang     || 'en';
    let theme    = req.session?.theme    || 'light';
    let currency = req.session?.currency || 'USD';
    let symbol   = getSymbol(currency);

    // ── Override from DB when the user is already authenticated ───────────────
    if (req.user?.id) {
        try {
            const [[prefs]] = await pool.execute(
                `SELECT preferred_language, preferred_currency, preferred_theme
                 FROM users WHERE id = ?`,
                [req.user.id]
            );
            if (prefs) {
                lang     = prefs.preferred_language || lang;
                theme    = prefs.preferred_theme    || theme;
                currency = prefs.preferred_currency || currency;
                symbol   = getSymbol(currency);
            }
        } catch (err) {
            console.error('applyUserPrefs DB error:', err.message);
        }
    }

    // ── Persist to res.locals (EJS reads these) ───────────────────────────────
    res.locals.lang           = lang;
    res.locals.theme          = theme;
    res.locals.currency       = currency;
    res.locals.currencySymbol = symbol;
    res.locals.symbol         = symbol;
    // underscore aliases kept for templates that use _lang / _theme / _symbol
    res.locals._lang          = lang;
    res.locals._theme         = theme;
    res.locals._currency      = currency;
    res.locals._symbol        = symbol;

    // ── Persist to session ────────────────────────────────────────────────────
    if (req.session) {
        req.session.lang     = lang;
        req.session.theme    = theme;
        req.session.currency = currency;
    }

    return { lang, theme, currency, symbol };
}

// ─── authLocals ───────────────────────────────────────────────────────────────
// Builds the base locals object passed to every res.render() call.
// Now includes currency + symbol to match the user controller pattern.
function authLocals(req, res, extra = {}) {
    const lang     = res.locals.lang     || req.session?.lang     || 'en';
    const theme    = res.locals.theme    || req.session?.theme    || 'light';
    const currency = res.locals.currency || req.session?.currency || 'USD';
    const symbol   = res.locals.symbol   || res.locals._symbol    || '$';

    return {
        title:          extra.title || 'Finora Bank',
        lang,
        theme,
        currency,
        currencySymbol: symbol,
        symbol,
        // underscore aliases
        _lang:     lang,
        _theme:    theme,
        _currency: currency,
        _symbol:   symbol,
        user:      req.user || null,
        req,               // EJS templates that reference req.session directly
        errors:    extra.errors    || [],
        formData:  extra.formData  || {},
        ...extra,
    };
}

// ─── GET register ─────────────────────────────────────────────────────────────
exports.getRegister = async (req, res) => {
    await applyUserPrefs(req, res);
    res.render('auth/register', authLocals(req, res, { title: 'Register' }));
};

// ─── POST register ────────────────────────────────────────────────────────────
exports.postRegister = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await applyUserPrefs(req, res);
            return res.render('auth/register', authLocals(req, res, {
                title:    'Register',
                errors:   errors.array(),
                formData: req.body,
            }));
        }

        const {
            first_name, last_name, email, phone,
            date_of_birth, address, city, country, password,
        } = req.body;

        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );
        if (existing.length > 0) {
            await applyUserPrefs(req, res);
            return res.render('auth/register', authLocals(req, res, {
                title:    'Register',
                errors:   [{ msg: 'Email already registered', param: 'email' }],
                formData: req.body,
            }));
        }

        const salt              = await bcrypt.genSalt(12);
        const hashedPassword    = await bcrypt.hash(password, salt);
        const verificationToken = generateVerificationToken();

        const [result] = await pool.execute(
            `INSERT INTO users
                (email, password, first_name, last_name, phone, date_of_birth,
                 address, city, country, email_verification_token, kyc_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_submitted')`,
            [email, hashedPassword, first_name, last_name, phone,
             date_of_birth, address, city, country, verificationToken]
        );

        const accountNumber = generateAccountNumber();
        await pool.execute(
            `INSERT INTO accounts
                (user_id, account_type, account_number, balance, currency, status)
             VALUES (?, 'checking', ?, 0.00, 'USD', 'active')`,
            [result.insertId, accountNumber]
        );

        await sendVerificationEmail(email, verificationToken, `${first_name} ${last_name}`);

        req.flash('success', 'Registration successful! Check your email to verify your account.');
        res.redirect('/auth/login');

    } catch (error) {
        console.error('Registration error:', error);
        req.flash('error', 'Registration failed. Please try again.');
        res.redirect('/auth/register');
    }
};

// ─── GET resend verification ──────────────────────────────────────────────────
exports.getResendVerification = async (req, res) => {
    await applyUserPrefs(req, res);
    res.render('auth/resend-verification', authLocals(req, res, {
        title: 'Resend Verification',
    }));
};

// ─── POST resend verification ─────────────────────────────────────────────────
exports.postResendVerification = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            req.flash('error', 'Email is required');
            return res.redirect('/auth/resend-verification');
        }

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            req.flash('info', 'If this email is registered, a new verification link has been sent.');
            return res.redirect('/auth/resend-verification');
        }

        const user = users[0];

        if (user.email_verified) {
            req.flash('info', 'This email is already verified. Please login.');
            return res.redirect('/auth/login');
        }

        const newToken = generateVerificationToken();
        await pool.execute(
            'UPDATE users SET email_verification_token = ? WHERE id = ?',
            [newToken, user.id]
        );
        await sendVerificationEmail(email, newToken, `${user.first_name} ${user.last_name}`);

        req.flash('success', 'A new verification email has been sent. Please check your inbox.');
        res.redirect('/auth/resend-verification');

    } catch (error) {
        console.error('Resend verification error:', error);
        req.flash('error', 'Failed to resend verification email. Please try again.');
        res.redirect('/auth/resend-verification');
    }
};

// ─── Verify email ─────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
    try {
        const { token } = req.query;

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email_verification_token = ?',
            [token]
        );
        if (users.length === 0) {
            req.flash('error', 'Invalid or expired verification link');
            return res.redirect('/auth/login');
        }

        const user = users[0];
        await pool.execute(
            'UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE id = ?',
            [user.id]
        );
        await sendWelcomeEmail(user.email, `${user.first_name} ${user.last_name}`);

        req.flash('success', 'Email verified! Welcome to Finora Bank. You can now log in.');
        res.redirect('/auth/login');

    } catch (error) {
        console.error('Verification error:', error);
        req.flash('error', 'Verification failed');
        res.redirect('/auth/login');
    }
};

// ─── GET login ────────────────────────────────────────────────────────────────
exports.getLogin = async (req, res) => {
    await applyUserPrefs(req, res);
    res.render('auth/login', authLocals(req, res, { title: 'Login' }));
};

// ─── POST login ───────────────────────────────────────────────────────────────
exports.postLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        if (users.length === 0) {
            req.flash('error', 'Invalid credentials');
            return res.redirect('/auth/login');
        }

        const user = users[0];

        if (!user.email_verified) {
            req.flash('error', 'Please verify your email first. Check your inbox or request a new link.');
            return res.redirect('/auth/resend-verification');
        }

        if (user.is_suspended) {
            req.flash('error', 'Account suspended. Contact support.');
            return res.redirect('/auth/login');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            req.flash('error', 'Invalid credentials');
            return res.redirect('/auth/login');
        }

        const token = generateToken(user);
        res.cookie('token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });

        // Set req.user BEFORE applyUserPrefs so DB prefs are read for this user
        req.user = user;
        const { theme, lang, currency } = await applyUserPrefs(req, res);

        // Persist prefs as JS-readable cookies so auth pages (login, pin, set-pin)
        // can read the correct theme/lang without a DB call or active session
        const prefCookieOpts = { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' };
        res.cookie('finora_theme',    theme,    prefCookieOpts);
        res.cookie('finora_lang',     lang,     prefCookieOpts);
        res.cookie('finora_currency', currency, prefCookieOpts);

        if (user.is_admin) return res.redirect('/admin/dashboard');
        if (!user.pin)     return res.redirect('/auth/set-pin');

        res.redirect('/auth/pin-entry');

    } catch (error) {
        console.error('Login error:', error);
        req.flash('error', 'Login failed');
        res.redirect('/auth/login');
    }
};

// ─── GET forgot password ──────────────────────────────────────────────────────
exports.getForgotPassword = async (req, res) => {
    await applyUserPrefs(req, res);
    res.render('auth/forgot-password', authLocals(req, res, { title: 'Reset Password' }));
};

// ─── POST forgot password ─────────────────────────────────────────────────────
exports.postForgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            req.flash('error', 'Email is required');
            return res.redirect('/auth/forgot-password');
        }

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            req.flash('info', 'If this email is registered, you will receive a reset link shortly.');
            return res.redirect('/auth/forgot-password');
        }

        const user       = users[0];
        const resetToken = generateVerificationToken();
        const expiry     = new Date(Date.now() + 60 * 60 * 1000);

        await pool.execute(
            'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
            [resetToken, expiry, user.id]
        );

        await sendPasswordResetEmail(email, resetToken, `${user.first_name} ${user.last_name}`);

        req.flash('success', 'Password reset link sent! Check your email.');
        res.redirect('/auth/login');

    } catch (error) {
        console.error('Forgot password error:', error);
        req.flash('error', 'Failed to send reset link. Please try again.');
        res.redirect('/auth/forgot-password');
    }
};

// ─── GET reset password ───────────────────────────────────────────────────────
exports.getResetPassword = async (req, res) => {
    try {
        const { token } = req.query;

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
            [token]
        );

        if (users.length === 0) {
            req.flash('error', 'Invalid or expired reset link');
            return res.redirect('/auth/forgot-password');
        }

        // Attach user so applyUserPrefs can load their stored prefs
        req.user = users[0];
        await applyUserPrefs(req, res);

        res.render('auth/reset-password', authLocals(req, res, {
            title: 'New Password',
            token,
        }));

    } catch (error) {
        console.error('Reset password page error:', error);
        req.flash('error', 'Something went wrong');
        res.redirect('/auth/forgot-password');
    }
};

// ─── POST reset password ──────────────────────────────────────────────────────
exports.postResetPassword = async (req, res) => {
    try {
        const { token, password, confirm_password } = req.body;

        if (password !== confirm_password) {
            req.flash('error', 'Passwords do not match');
            return res.redirect(`/auth/reset-password?token=${token}`);
        }

        if (password.length < 8) {
            req.flash('error', 'Password must be at least 8 characters');
            return res.redirect(`/auth/reset-password?token=${token}`);
        }

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
            [token]
        );

        if (users.length === 0) {
            req.flash('error', 'Invalid or expired reset link');
            return res.redirect('/auth/forgot-password');
        }

        const salt           = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);

        await pool.execute(
            'UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
            [hashedPassword, users[0].id]
        );

        req.flash('success', 'Password updated successfully! Please log in.');
        res.redirect('/auth/login');

    } catch (error) {
        console.error('Reset password error:', error);
        req.flash('error', 'Failed to reset password');
        res.redirect('/auth/forgot-password');
    }
};

// ─── GET pin entry ────────────────────────────────────────────────────────────
exports.getPinEntry = async (req, res) => {
    await applyUserPrefs(req, res);
    res.render('auth/pin-entry', authLocals(req, res, { title: 'Enter PIN' }));
};

// ─── POST pin entry ───────────────────────────────────────────────────────────
exports.postPinEntry = async (req, res) => {
    try {
        const { pin } = req.body;

        const [[user]] = await pool.execute(
            'SELECT * FROM users WHERE id = ?',
            [req.user.id]
        );

        const isValid = await verifyPin(pin, user.pin);
        if (!isValid) {
            req.flash('error', 'Invalid PIN');
            return res.redirect('/auth/pin-entry');
        }

        req.session.pinVerified   = true;
        req.session.pinVerifiedAt = Date.now();

        if (user.is_admin) return res.redirect('/admin/dashboard');
        res.redirect('/user/dashboard');

    } catch (error) {
        console.error('PIN error:', error);
        req.flash('error', 'PIN verification failed');
        res.redirect('/auth/pin-entry');
    }
};

// ─── GET set pin ──────────────────────────────────────────────────────────────
exports.getSetPin = async (req, res) => {
    await applyUserPrefs(req, res);
    res.render('auth/set-pin', authLocals(req, res, { title: 'Set 4-Digit PIN' }));
};

// ─── POST set pin ─────────────────────────────────────────────────────────────
exports.postSetPin = async (req, res) => {
    try {
        const { pin, confirm_pin } = req.body;

        if (!/^\d{4}$/.test(pin)) {
            req.flash('error', 'PIN must be exactly 4 digits');
            return res.redirect('/auth/set-pin');
        }

        if (pin !== confirm_pin) {
            req.flash('error', 'PINs do not match');
            return res.redirect('/auth/set-pin');
        }

        const hashedPin = await hashPin(pin);
        await pool.execute(
            'UPDATE users SET pin = ? WHERE id = ?',
            [hashedPin, req.user.id]
        );

        req.flash('success', 'PIN set successfully');
        res.redirect('/auth/pin-entry');

    } catch (error) {
        console.error('Set PIN error:', error);
        req.flash('error', 'Failed to set PIN');
        res.redirect('/auth/set-pin');
    }
};

// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
    res.clearCookie('token');
    req.session.destroy();
    res.redirect('/auth/login');
};

// ─── Named exports for middleware use ─────────────────────────────────────────
exports.applyUserPrefs = applyUserPrefs;
exports.authLocals     = authLocals;