// controllers/settingsController.js
// ─────────────────────────────────────────────────────────────────────────────
// Handles all user settings: preferences, password, PIN
// ─────────────────────────────────────────────────────────────────────────────

const pool   = require('../config/database');
const bcrypt = require('bcryptjs');

// ─── Settings Page ────────────────────────────────────────────────────────────

exports.getSettings = async (req, res) => {
    try {
        const [[user]] = await pool.execute(
            `SELECT id, first_name, last_name, email, phone,
                    preferred_language, preferred_currency, preferred_theme,
                    notif_email, notif_sms, notif_push
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        res.render('user/settings', {
            title:       'Settings',
            user:        user || req.user,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error('Settings page error:', error);
        req.flash('error', 'Failed to load settings');
        res.redirect('/user/dashboard');
    }
};

// ─── Save Preferences ─────────────────────────────────────────────────────────
// Handles language, currency, theme, and notification toggles in one POST.
// Each tab sends a hidden _tab field so we redirect back to the right tab.

exports.savePreferences = async (req, res) => {
    const {
        preferred_language,
        preferred_currency,
        preferred_theme,
        notif_email,
        notif_sms,
        notif_push,
        _tab,
    } = req.body;

    try {
        await pool.execute(
            `UPDATE users SET
                preferred_language = ?,
                preferred_currency = ?,
                preferred_theme    = ?,
                notif_email        = ?,
                notif_sms          = ?,
                notif_push         = ?
             WHERE id = ?`,
            [
                preferred_language || 'en',
                preferred_currency || 'USD',
                preferred_theme    || 'light',
                notif_email === '1' ? 1 : 0,
                notif_sms   === '1' ? 1 : 0,
                notif_push  === '1' ? 1 : 0,
                req.user.id,
            ]
        );

        // Patch req.user (existing - keeps user pages working)
        Object.assign(req.user, {
            preferred_language: preferred_language || 'en',
            preferred_currency: preferred_currency || 'USD',
            preferred_theme:    preferred_theme    || 'light',
            notif_email:        notif_email === '1',
            notif_sms:          notif_sms   === '1',
            notif_push:         notif_push  === '1',
        });

        // ADD THESE 3 LINES — makes auth pages work too
        req.session.lang = preferred_language || 'en';
        req.session.currency = preferred_currency || 'USD';
        req.session.theme = preferred_theme || 'light';

        req.flash('success', 'Preferences saved');
        res.redirect('/user/settings#' + (_tab || 'preferences'));
    } catch (error) {
        console.error('Save preferences error:', error);
        req.flash('error', 'Failed to save preferences');
        res.redirect('/user/settings');
    }
};// ─── Change Password ──────────────────────────────────────────────────────────

exports.changePassword = async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;

    try {
        if (!current_password || !new_password || !confirm_password) {
            req.flash('error', 'All password fields are required');
            return res.redirect('/user/settings#security');
        }

        if (new_password !== confirm_password) {
            req.flash('error', 'New passwords do not match');
            return res.redirect('/user/settings#security');
        }

        if (new_password.length < 8) {
            req.flash('error', 'New password must be at least 8 characters');
            return res.redirect('/user/settings#security');
        }

        const [[user]] = await pool.execute(
            'SELECT password FROM users WHERE id = ?',
            [req.user.id]
        );

        const isValid = await bcrypt.compare(current_password, user.password);
        if (!isValid) {
            req.flash('error', 'Current password is incorrect');
            return res.redirect('/user/settings#security');
        }

        const hashed = await bcrypt.hash(new_password, 12);

        await pool.execute(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashed, req.user.id]
        );

        req.flash('success', 'Password updated successfully');
        res.redirect('/user/settings#security');
    } catch (error) {
        console.error('Change password error:', error);
        req.flash('error', 'Failed to update password');
        res.redirect('/user/settings#security');
    }
};

// ─── Change PIN ───────────────────────────────────────────────────────────────

exports.changePin = async (req, res) => {
    const { current_pin, new_pin, confirm_pin } = req.body;

    try {
        if (!current_pin || !new_pin || !confirm_pin) {
            req.flash('error', 'All PIN fields are required');
            return res.redirect('/user/settings#security');
        }

        if (new_pin !== confirm_pin) {
            req.flash('error', 'New PINs do not match');
            return res.redirect('/user/settings#security');
        }

        if (!/^\d{4}$/.test(new_pin)) {
            req.flash('error', 'PIN must be exactly 4 digits');
            return res.redirect('/user/settings#security');
        }

        const [[user]] = await pool.execute(
            'SELECT pin FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!user.pin) {
            req.flash('error', 'No PIN set on this account. Please contact support.');
            return res.redirect('/user/settings#security');
        }

        const isValid = await bcrypt.compare(current_pin, user.pin);
        if (!isValid) {
            req.flash('error', 'Current PIN is incorrect');
            return res.redirect('/user/settings#security');
        }

        const hashed = await bcrypt.hash(new_pin, 10);

        await pool.execute(
            'UPDATE users SET pin = ? WHERE id = ?',
            [hashed, req.user.id]
        );

        req.flash('success', 'PIN updated successfully');
        res.redirect('/user/settings#security');
    } catch (error) {
        console.error('Change PIN error:', error);
        req.flash('error', 'Failed to update PIN');
        res.redirect('/user/settings#security');
    }
};