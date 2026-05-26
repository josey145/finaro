const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { generateAccountNumber } = require('../utils/helpers');
const { sendTransactionEmail } = require('../utils/email');
const { sendSMS }              = require('../utils/sms');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jsonError = (res, error, message = 'Action failed') => {
    console.error(error);
    return res.status(500).json({ success: false, message });
};

const jsonSuccess = (res, message) => res.json({ success: true, message });

// ─── Dashboard ────────────────────────────────────────────────────────────────
// balance lives on the accounts table (user_id FK), not on users directly

exports.getDashboard = async (req, res) => {
    try {
        // Total non-admin users
        const [[{ count: users }]] = await pool.execute(
            "SELECT COUNT(*) as count FROM users WHERE is_admin = 0"
        );

        // Pending KYC
        const [[{ count: pendingKYC }]] = await pool.execute(
            "SELECT COUNT(*) as count FROM users WHERE kyc_status = 'pending' AND is_admin = 0"
        );

        // Total balance — lives in accounts table
        const [[{ total: totalBalance }]] = await pool.execute(
            "SELECT COALESCE(SUM(a.balance), 0) as total FROM accounts a JOIN users u ON a.user_id = u.id WHERE u.is_admin = 0"
        );

        // Today's transactions
        const [[{ count: todayTransactions }]] = await pool.execute(
            "SELECT COUNT(*) as count FROM transactions WHERE DATE(created_at) = CURDATE()"
        );

        // Pending withdrawals count (for badge)
        const [[{ count: pendingWithdrawals }]] = await pool.execute(
            "SELECT COUNT(*) as count FROM transactions WHERE type = 'withdrawal' AND status = 'pending'"
        );

        // Support requests — unread admin notifications
        const [[{ count: supportRequests }]] = await pool.execute(
            "SELECT COUNT(*) as count FROM notifications WHERE user_id IS NULL AND is_read = 0"
        ).catch(() => [[{ count: 0 }]]);

        // Recent 5 users — join accounts for balance
        const [recentUsers] = await pool.execute(
            `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) as username, u.email, u.kyc_status, u.is_admin,
                    COALESCE(a.balance, 0) as balance, COALESCE(a.currency, 'USD') as balance_currency,
                    u.created_at
             FROM users u
             LEFT JOIN accounts a ON a.user_id = u.id
             WHERE u.is_admin = 0
             ORDER BY u.created_at DESC LIMIT 5`
        );

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            stats: {
                users,
                pendingKYC,
                totalBalance:       totalBalance || 0,
                todayTransactions,
                pendingWithdrawals,
                supportRequests,
            },
            recentUsers,
        });
    } catch (error) {
        console.error('[getDashboard]', error);
        res.status(500).render('errors/500');
    }
};

// ─── User Management ─────────────────────────────────────────────────────────

exports.getUsers = async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) as username, u.email, u.phone, u.is_admin, u.kyc_status,
                    COALESCE(a.balance, 0) as balance,
                    COALESCE(a.currency, 'USD') as balance_currency,
                    a.account_number, a.account_type,
                    u.is_suspended, u.email_verified,
                    u.created_at
             FROM users u
             LEFT JOIN accounts a ON a.user_id = u.id
             ORDER BY u.created_at DESC`
        );
        res.render('admin/users', { title: 'Manage Users', users });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.getUser = async (req, res) => {
    const { userId } = req.params;
    try {
        const [[user]] = await pool.execute(
            `SELECT id, CONCAT(first_name, ' ', last_name) as username, email, phone, date_of_birth as dob, preferred_currency as currency, country, city, address,
                    email_verified, kyc_status, preferred_currency as balance_currency,
                    is_admin, is_suspended, withdrawal_steps_required,
                    created_at, updated_at
             FROM users WHERE id = ?`,
            [userId]
        );

        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/admin/users');
        }

        // Get account info separately
        const [[account]] = await pool.execute(
            `SELECT account_number, account_type, balance, currency, status 
             FROM accounts WHERE user_id = ?`,
            [userId]
        );
        if (account) {
            user.account_number = account.account_number;
            user.account_type = account.account_type;
            user.balance = account.balance;
            user.balance_currency = account.currency;
            user.account_status = account.status;
        } else {
            user.balance = 0;
            user.balance_currency = user.preferred_currency || 'USD';
        }

        const [transactions] = await pool.execute(
            'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
            [userId]
        );

        res.render('admin/user-detail', {
            title:       `${user.username} — Detail`,
            user,
            transactions,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load user');
        res.redirect('/admin/users');
    }
};

exports.getCreateUser = async (req, res) => {
    res.render('admin/create-user', { title: 'Create User' });
};

exports.createUser = async (req, res) => {
    const {
        first_name, last_name, email, phone, password,
        initial_balance, preferred_currency, country, role
    } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const hashedPin = req.body.pin ? await bcrypt.hash(req.body.pin, 12) : null;

        const [userResult] = await pool.execute(
            `INSERT INTO users
                (first_name, last_name, email, password, phone, is_admin, email_verified,
                 kyc_status, preferred_currency, country, pin)
             VALUES (?, ?, ?, ?, ?, ?, 1, 'approved', ?, ?, ?)`,
            [
                first_name || '',
                last_name || '',
                email,
                hashedPassword,
                phone || null,
                role === 'admin' ? 1 : 0,
                preferred_currency || 'USD',
                country || null,
                hashedPin,
            ]
        );

        // Create account record
        await pool.execute(
            `INSERT INTO accounts (user_id, account_type, account_number, balance, currency, status)
             VALUES (?, 'checking', ?, ?, ?, 'active')`,
            [userResult.insertId, generateAccountNumber(), parseFloat(initial_balance) || 0, preferred_currency || 'USD']
        );

        req.flash('success', 'User created successfully');
        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to create user: ' + error.message);
        res.redirect('/admin/users/create');
    }
};

exports.getEditUser = async (req, res) => {
    const { userId } = req.params;
    try {
        const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/admin/users');
        }
        res.render('admin/edit-user', {
            title:       `Edit ${user.first_name} ${user.last_name}`,
            user,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load user');
        res.redirect('/admin/users');
    }
};

exports.postEditUser = async (req, res) => {
    const { userId } = req.params;
    const {
        first_name, last_name, email, phone, date_of_birth, preferred_currency, country, city, address,
        email_verified, kyc_status, is_suspended, withdrawal_steps_required,
    } = req.body;

    try {
        await pool.execute(
            `UPDATE users SET
                first_name                = ?,
                last_name                 = ?,
                email                     = ?,
                phone                     = ?,
                date_of_birth             = ?,
                preferred_currency        = ?,
                country                   = ?,
                city                      = ?,
                address                   = ?,
                email_verified            = ?,
                kyc_status                = ?,
                is_suspended              = ?,
                withdrawal_steps_required = ?,
                updated_at                = NOW()
             WHERE id = ?`,
            [
                first_name || '',
                last_name || '',
                email,
                phone || null,
                date_of_birth || null,
                preferred_currency || 'USD',
                country || null,
                city || null,
                address || null,
                email_verified === 'on' || email_verified === '1' ? 1 : 0,
                kyc_status || 'not_submitted',
                is_suspended === 'on' || is_suspended === '1' ? 1 : 0,
                withdrawal_steps_required === 'on' || withdrawal_steps_required === '1' ? 1 : 0,
                userId,
            ]
        );

        req.flash('success', 'User profile updated successfully');
        res.redirect(`/admin/users/${userId}/edit`);
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update user: ' + error.message);
        res.redirect(`/admin/users/${userId}/edit`);
    }
};

exports.changeUserEmail = async (req, res) => {
    const { userId } = req.params;
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    try {
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]
        );
        if (existing.length) {
            return res.status(409).json({ success: false, message: 'Email already in use.' });
        }
        await pool.execute(
            'UPDATE users SET email = ?, updated_at = NOW() WHERE id = ?',
            [email, userId]
        );
        return jsonSuccess(res, 'Email updated successfully.');
    } catch (error) {
        return jsonError(res, error, 'Failed to update email.');
    }
};

exports.changeUserPassword = async (req, res) => {
    const { userId } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    try {
        const hashed = await bcrypt.hash(password, 12);
        await pool.execute(
            'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashed, userId]
        );
        return jsonSuccess(res, 'Password updated successfully.');
    } catch (error) {
        return jsonError(res, error, 'Failed to update password.');
    }
};


// ─── Admin Profile / Self Management ───────────────────────────────────────────

exports.getAdminProfile = async (req, res) => {
    try {
        const [[admin]] = await pool.execute(
            `SELECT id, first_name, last_name, email, phone, date_of_birth, address, city, country,
                    preferred_currency, preferred_language, preferred_theme,
                    notif_email, notif_sms, notif_push,
                    email_verified, kyc_status, is_admin, is_suspended,
                    created_at, updated_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (!admin) {
            req.flash('error', 'Admin not found');
            return res.redirect('/admin/dashboard');
        }

        res.render('admin/profile', {
            title: 'My Profile',
            admin,
            success_msg: req.flash('success'),
            error_msg: req.flash('error'),
        });
    } catch (error) {
        console.error('[getAdminProfile]', error);
        req.flash('error', 'Failed to load profile');
        res.redirect('/admin/dashboard');
    }
};

exports.updateAdminProfile = async (req, res) => {
    const { first_name, last_name, email, phone, address, city, country } = req.body;

    try {
        // Check if email is taken by another user
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?',
            [email, req.user.id]
        );
        if (existing.length) {
            req.flash('error', 'Email already in use by another account');
            return res.redirect('/admin/profile');
        }

        await pool.execute(
            `UPDATE users SET
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                address = ?,
                city = ?,
                country = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [first_name, last_name, email, phone || null, address || null, city || null, country || null, req.user.id]
        );

        req.flash('success', 'Profile updated successfully');
        res.redirect('/admin/profile');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update profile: ' + error.message);
        res.redirect('/admin/profile');
    }
};

exports.changeAdminPassword = async (req, res) => {
    const { current_password, new_password } = req.body;

    try {
        const [[admin]] = await pool.execute(
            'SELECT password FROM users WHERE id = ?',
            [req.user.id]
        );

        const match = await bcrypt.compare(current_password, admin.password);
        if (!match) {
            req.flash('error', 'Current password is incorrect');
            return res.redirect('/admin/profile');
        }

        if (new_password.length < 8) {
            req.flash('error', 'New password must be at least 8 characters');
            return res.redirect('/admin/profile');
        }

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.execute(
            'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashed, req.user.id]
        );

        req.flash('success', 'Password changed successfully');
        res.redirect('/admin/profile');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to change password');
        res.redirect('/admin/profile');
    }
};

exports.changeAdminEmail = async (req, res) => {
    const { new_email } = req.body;

    if (!new_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
        req.flash('error', 'Invalid email address');
        return res.redirect('/admin/profile');
    }

    try {
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?',
            [new_email, req.user.id]
        );
        if (existing.length) {
            req.flash('error', 'Email already in use');
            return res.redirect('/admin/profile');
        }

        await pool.execute(
            'UPDATE users SET email = ?, updated_at = NOW() WHERE id = ?',
            [new_email, req.user.id]
        );

        req.flash('success', 'Email updated successfully. Please log in again with your new email.');
        res.redirect('/admin/profile');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update email');
        res.redirect('/admin/profile');
    }
};

// ─── Admin Profile / Self Management ───────────────────────────────────────────

exports.getAdminProfile = async (req, res) => {
    try {
        const [[admin]] = await pool.execute(
            `SELECT id, first_name, last_name, email, phone, date_of_birth, address, city, country,
                    preferred_currency, preferred_language, preferred_theme,
                    notif_email, notif_sms, notif_push,
                    email_verified, kyc_status, is_admin, is_suspended,
                    created_at, updated_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (!admin) {
            req.flash('error', 'Admin not found');
            return res.redirect('/admin/dashboard');
        }

        res.render('admin/profile', {
            title: 'My Profile',
            admin,
            success_msg: req.flash('success'),
            error_msg: req.flash('error'),
        });
    } catch (error) {
        console.error('[getAdminProfile]', error);
        req.flash('error', 'Failed to load profile');
        res.redirect('/admin/dashboard');
    }
};

exports.updateAdminProfile = async (req, res) => {
    const { first_name, last_name, email, phone, address, city, country } = req.body;

    try {
        // Check if email is taken by another user
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?',
            [email, req.user.id]
        );
        if (existing.length) {
            req.flash('error', 'Email already in use by another account');
            return res.redirect('/admin/profile');
        }

        await pool.execute(
            `UPDATE users SET
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                address = ?,
                city = ?,
                country = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [first_name, last_name, email, phone || null, address || null, city || null, country || null, req.user.id]
        );

        req.flash('success', 'Profile updated successfully');
        res.redirect('/admin/profile');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update profile: ' + error.message);
        res.redirect('/admin/profile');
    }
};

exports.changeAdminPassword = async (req, res) => {
    const { current_password, new_password } = req.body;

    try {
        const [[admin]] = await pool.execute(
            'SELECT password FROM users WHERE id = ?',
            [req.user.id]
        );

        const match = await bcrypt.compare(current_password, admin.password);
        if (!match) {
            req.flash('error', 'Current password is incorrect');
            return res.redirect('/admin/profile');
        }

        if (new_password.length < 8) {
            req.flash('error', 'New password must be at least 8 characters');
            return res.redirect('/admin/profile');
        }

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.execute(
            'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashed, req.user.id]
        );

        req.flash('success', 'Password changed successfully');
        res.redirect('/admin/profile');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to change password');
        res.redirect('/admin/profile');
    }
};

exports.changeAdminEmail = async (req, res) => {
    const { new_email } = req.body;

    if (!new_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
        req.flash('error', 'Invalid email address');
        return res.redirect('/admin/profile');
    }

    try {
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?',
            [new_email, req.user.id]
        );
        if (existing.length) {
            req.flash('error', 'Email already in use');
            return res.redirect('/admin/profile');
        }

        await pool.execute(
            'UPDATE users SET email = ?, updated_at = NOW() WHERE id = ?',
            [new_email, req.user.id]
        );

        req.flash('success', 'Email updated successfully. Please log in again with your new email.');
        res.redirect('/admin/profile');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update email');
        res.redirect('/admin/profile');
    }
};

exports.changeUserRole = async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role.' });
    }
    if (String(userId) === String(req.user.id) && role !== 'admin') {
        return res.status(403).json({ success: false, message: 'You cannot demote yourself.' });
    }

    try {
        await pool.execute(
            'UPDATE users SET is_admin = ?, updated_at = NOW() WHERE id = ?',
            [role === 'admin' ? 1 : 0, userId]
        );
        return jsonSuccess(res, `User ${role === 'admin' ? 'promoted to Admin' : 'demoted to User'}.`);
    } catch (error) {
        return jsonError(res, error, 'Failed to change role.');
    }
};

exports.blockUser = async (req, res) => {
    const { userId } = req.params;
    const { action } = req.body;

    try {
        await pool.execute(
            'UPDATE users SET is_suspended = ?, updated_at = NOW() WHERE id = ?',
            [action === 'block' ? 1 : 0, userId]
        );
        return jsonSuccess(res, `User ${action === 'block' ? 'suspended' : 'unsuspended'}.`);
    } catch (error) {
        return jsonError(res, error);
    }
};

exports.suspendUser = async (req, res) => {
    const { userId } = req.params;
    const { action } = req.body;

    try {
        await pool.execute(
            'UPDATE users SET is_suspended = ?, updated_at = NOW() WHERE id = ?',
            [action === 'suspend' ? 1 : 0, userId]
        );
        return jsonSuccess(res, `User ${action === 'suspend' ? 'suspended' : 'unsuspended'}.`);
    } catch (error) {
        return jsonError(res, error);
    }
};

exports.verifyUser = async (req, res) => {
    const { userId } = req.params;
    const { field } = req.body;

    if (!['email_verified'].includes(field)) {
        return res.status(400).json({ success: false, message: 'Invalid field.' });
    }

    try {
        await pool.execute(
            `UPDATE users SET ${field} = 1, updated_at = NOW() WHERE id = ?`,
            [userId]
        );
        return jsonSuccess(res, 'Email verified.');
    } catch (error) {
        return jsonError(res, error);
    }
};

exports.deleteUser = async (req, res) => {
    const { userId } = req.params;

    if (String(userId) === String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'You cannot delete your own account.' });
    }

    try {
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        return jsonSuccess(res, 'User deleted.');
    } catch (error) {
        return jsonError(res, error, 'Delete failed.');
    }
};

// ─── KYC Management ──────────────────────────────────────────────────────────

exports.getKYCReview = async (req, res) => {
    try {
        const [documents] = await pool.execute(
            `SELECT 
                u.id AS user_id,
                u.first_name,
                u.last_name,
                CONCAT(u.first_name, ' ', u.last_name) as username,
                u.email,
                u.kyc_status,
                k.id AS kyc_id,
                k.document_type,
                k.document_number,
                k.file_path,
                k.file_path_back,
                k.file_name,
                k.status,
                k.admin_notes,
                k.submitted_at,
                k.reviewed_at,
                k.reviewed_by,
                u.created_at
             FROM users u
             LEFT JOIN kyc_documents k ON k.user_id = u.id
             WHERE u.kyc_status IN ('pending', 'not_submitted', 'submitted') 
               AND u.is_admin = 0
             ORDER BY k.submitted_at DESC`
        );
        res.render('admin/kyc-review', { title: 'KYC Review', documents });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.approveKYC = async (req, res) => {
    const { documentId } = req.params;
    const { action, notes } = req.body;

    if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    try {
        // Get the KYC document to find the user
        const [[kycDoc]] = await pool.execute(
            'SELECT user_id FROM kyc_documents WHERE id = ?',
            [documentId]
        );

        if (!kycDoc) {
            return res.status(404).json({ success: false, message: 'KYC document not found.' });
        }

        const userId = kycDoc.user_id;

        // Update users table
        await pool.execute(
            'UPDATE users SET kyc_status = ?, updated_at = NOW() WHERE id = ?',
            [action, userId]
        );

        // Update specific kyc_documents record
        await pool.execute(
            `UPDATE kyc_documents 
             SET status = ?, admin_notes = ?, reviewed_at = NOW(), reviewed_by = ? 
             WHERE id = ?`,
            [action, notes || null, req.user.id, documentId]
        );

        return jsonSuccess(res, `KYC ${action}.`);
    } catch (error) {
        return jsonError(res, error);
    }
};

exports.toggleKYCRequirement = async (req, res) => {
    const { userId } = req.params;
    const { enabled } = req.body;

    try {
        await pool.execute(
            'UPDATE users SET kyc_enabled = ?, updated_at = NOW() WHERE id = ?',
            [enabled, userId]
        );
        return jsonSuccess(res, 'KYC requirement updated.');
    } catch (error) {
        return jsonError(res, error);
    }
};

// ─── Account / Balance Control ────────────────────────────────────────────────

exports.getFundPage = async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) as username, u.email,
                    COALESCE(a.balance, 0) as balance,
                    COALESCE(a.currency, 'USD') as balance_currency,
                    a.account_number
             FROM users u
             LEFT JOIN accounts a ON a.user_id = u.id
             WHERE u.is_admin = 0 ORDER BY u.first_name ASC`
        );
        res.render('admin/fund', {
            title:       'Fund / Deduct Account',
            users,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.fundAccount = async (req, res) => {
    const { userId, amount, description } = req.body;

    try {
        if (!userId) {
            req.flash('error', 'Please select a user first');
            return res.redirect('/admin/fund');
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            req.flash('error', 'Invalid amount');
            return res.redirect('/admin/fund');
        }

        await pool.execute(
            'UPDATE accounts SET balance = balance + ? WHERE user_id = ?',
            [parsedAmount, userId]
        );
        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, status, description)
             VALUES (?, 'admin_credit', ?, 'completed', ?)`,
            [userId, parsedAmount, description || 'Admin credit']
        );

        const [[user]] = await pool.execute(
            "SELECT CONCAT(first_name, ' ', last_name) as username, email, phone FROM users WHERE id = ?", [userId]
        );
        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
        const formatted = parsedAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        if (settings.alert_email_enabled === 'true' && user?.email) {
            await sendTransactionEmail(user.email, user.username, 'deposit', parsedAmount, description || 'Account credit');
        }
        if (settings.alert_sms_enabled === 'true' && user?.phone) {
            await sendSMS(
                user.phone,
                `💰 Your account has been credited ${formatted}. Ref: ${description || 'Account credit'}. If unauthorized, contact support.`
            );
        }

        req.flash('success', `Account funded with ${formatted}`);
        res.redirect('/admin/fund');
    } catch (error) {
        console.error('Fund error:', error);
        req.flash('error', 'Funding failed: ' + error.message);
        res.redirect('/admin/fund');
    }
};

exports.deductAccount = async (req, res) => {
    const { userId, amount, description } = req.body;

    try {
        if (!userId) {
            req.flash('error', 'Please select a user first');
            return res.redirect('/admin/fund');
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            req.flash('error', 'Invalid amount');
            return res.redirect('/admin/fund');
        }

        const [[user]] = await pool.execute(
            "SELECT CONCAT(u.first_name, ' ', u.last_name) as username, u.email, u.phone, COALESCE(a.balance,0) as balance FROM users u LEFT JOIN accounts a ON a.user_id = u.id WHERE u.id = ?", [userId]
        );
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/admin/fund');
        }
        if (parseFloat(user.balance) < parsedAmount) {
            req.flash('error', `Insufficient balance. Current: $${parseFloat(user.balance).toFixed(2)}`);
            return res.redirect('/admin/fund');
        }

        await pool.execute(
            'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
            [parsedAmount, userId]
        );
        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, status, description)
             VALUES (?, 'admin_debit', ?, 'completed', ?)`,
            [userId, parsedAmount, description || 'Admin debit']
        );

        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
        const formatted = parsedAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        if (settings.alert_email_enabled === 'true' && user?.email) {
            await sendTransactionEmail(user.email, user.username, 'withdrawal', parsedAmount, description || 'Account debit');
        }
        if (settings.alert_sms_enabled === 'true' && user?.phone) {
            await sendSMS(
                user.phone,
                `💸 ${formatted} has been deducted from your account. Ref: ${description || 'Account debit'}. Contact support if unauthorized.`
            );
        }

        req.flash('success', `$${parsedAmount.toFixed(2)} deducted successfully`);
        res.redirect('/admin/fund');
    } catch (error) {
        console.error('Deduct error:', error);
        req.flash('error', 'Deduction failed: ' + error.message);
        res.redirect('/admin/fund');
    }
};

// ─── Transactions ─────────────────────────────────────────────────────────────

exports.getTransactions = async (req, res) => {
    try {
        const [transactions] = await pool.execute(
            `SELECT t.*, CONCAT(u.first_name, ' ', u.last_name) as username, u.email
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             ORDER BY t.created_at DESC LIMIT 100`
        );
        res.render('admin/transactions', { title: 'Transactions', transactions });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.getEditTransaction = async (req, res) => {
    const { transactionId } = req.params;
    try {
        const [[transaction]] = await pool.execute(
            `SELECT t.*, CONCAT(u.first_name, ' ', u.last_name) as username, u.email
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE t.id = ?`,
            [transactionId]
        );
        if (!transaction) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/admin/transactions');
        }
        res.render('admin/edit-transaction', {
            title:       'Edit Transaction',
            transaction,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load transaction');
        res.redirect('/admin/transactions');
    }
};

exports.postEditTransaction = async (req, res) => {
    const { transactionId } = req.params;
    const { created_at, description, amount, status } = req.body;

    try {
        if (!created_at) {
            req.flash('error', 'Date is required.');
            return res.redirect(`/admin/transactions/${transactionId}/edit`);
        }
        await pool.execute(
            `UPDATE transactions SET created_at = ?, description = ?, amount = ?, status = ? WHERE id = ?`,
            [created_at, description, parseFloat(amount), status, transactionId]
        );
        req.flash('success', 'Transaction updated successfully.');
        res.redirect(`/admin/transactions/${transactionId}/edit`);
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update transaction.');
        res.redirect(`/admin/transactions/${transactionId}/edit`);
    }
};

// ─── Withdrawal Steps Toggle ──────────────────────────────────────────────────

exports.toggleWithdrawalSteps = async (req, res) => {
    const { scope, userId } = req.body;

    try {
        if (scope === 'global') {
            const [[row]] = await pool.execute(
                "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
            );
            const newValue = row?.setting_value === 'true' ? 'false' : 'true';
            await pool.execute(
                "UPDATE settings SET setting_value = ? WHERE setting_key = 'global_withdrawal_steps_required'",
                [newValue]
            );
        } else {
            const [[user]] = await pool.execute(
                'SELECT withdrawal_steps_required FROM users WHERE id = ?', [userId]
            );
            await pool.execute(
                'UPDATE users SET withdrawal_steps_required = ?, updated_at = NOW() WHERE id = ?',
                [user.withdrawal_steps_required ? 0 : 1, userId]
            );
        }
        return jsonSuccess(res, 'Withdrawal steps toggled.');
    } catch (error) {
        return jsonError(res, error);
    }
};

// ─── Pending Withdrawals ──────────────────────────────────────────────────────

exports.getPendingWithdrawals = async (req, res) => {
    try {
        const [transactions] = await pool.execute(`
            SELECT t.id, t.user_id, t.amount, t.status, t.description,
                   t.recipient_account, t.withdrawal_step, t.created_at,
                   CONCAT(u.first_name, ' ', u.last_name) as username, u.email, u.phone,
                   COALESCE(a.balance, 0) AS user_balance,
                   (SELECT COUNT(*) FROM withdrawal_step_configs WHERE is_active = TRUE) AS total_steps
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN accounts a ON a.user_id = u.id
            WHERE t.type = 'withdrawal' AND t.status = 'pending'
            ORDER BY t.created_at ASC
        `);

        for (const tx of transactions) {
            const [steps] = await pool.execute(`
                SELECT tsl.id AS log_id, tsl.step_number, tsl.step_code, tsl.status,
                       tsl.completed_at, tsl.admin_otp_code, tsl.otp_set_at,
                       tsl.otp_consumed, tsl.otp_attempts, tsl.otp_locked_until, tsl.otp_set_by,
                       wsc.step_name, wsc.validation_rules, wsc.is_required
                FROM transaction_step_logs tsl
                LEFT JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
                WHERE tsl.transaction_id = ?
                ORDER BY tsl.step_number ASC
            `, [tx.id]);

            for (const step of steps) {
                let rules = {};
                try {
                    rules = typeof step.validation_rules === 'string'
                        ? JSON.parse(step.validation_rules)
                        : (step.validation_rules || {});
                } catch (e) { rules = {}; }

                step.requires_otp       = rules.requires_otp === true || rules.requires_otp === 1;
                step.requires_document  = rules.requires_document === true || rules.requires_document === 1;
                step.otp_is_set         = !!step.admin_otp_code;
                step.otp_consumed_bool  = step.otp_consumed === 1 || step.otp_consumed === true;
                step.is_locked          = !!(step.otp_locked_until && new Date(step.otp_locked_until) > new Date());
                delete step.admin_otp_code;
                delete step.validation_rules;
            }
            tx.steps = steps;
        }

        res.render('admin/pending-withdrawals', {
            title:              'Pending Withdrawals',
            pendingWithdrawals: transactions,
            success_msg:        req.flash('success'),
            error_msg:          req.flash('error'),
        });
    } catch (error) {
        console.error('getPendingWithdrawals error:', error);
        req.flash('error', 'Failed to load pending withdrawals');
        res.redirect('/admin/dashboard');
    }
};

// ─── OTP Management ───────────────────────────────────────────────────────────

exports.setWithdrawalOtp = async (req, res) => {
    const { transactionId, stepNumber } = req.params;
    const { otp } = req.body;

    if (!otp || !/^\d{4,8}$/.test(otp)) {
        return res.status(400).json({ success: false, message: 'OTP must be 4–8 digits.' });
    }

    try {
        const [[transaction]] = await pool.execute(
            "SELECT id, amount, user_id FROM transactions WHERE id = ? AND type = 'withdrawal'",
            [transactionId]
        );
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found.' });
        }

        const [[stepLog]] = await pool.execute(
            'SELECT id, step_code FROM transaction_step_logs WHERE transaction_id = ? AND step_number = ?',
            [transactionId, stepNumber]
        );
        if (!stepLog) {
            return res.status(404).json({ success: false, message: 'Step log not found.' });
        }

        const hashedOtp = await bcrypt.hash(otp, 10);

        await pool.execute(
            `UPDATE transaction_step_logs
             SET admin_otp_code = ?, otp_set_by = ?, otp_set_at = NOW(),
                 otp_consumed = 0, otp_attempts = 0, otp_locked_until = NULL
             WHERE id = ?`,
            [hashedOtp, req.user.id, stepLog.id]
        );

        const [[user]] = await pool.execute(
            "SELECT CONCAT(first_name, ' ', last_name) as username, email, phone FROM users WHERE id = ?", [transaction.user_id]
        );
        const [settingRows] = await pool.execute(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('alert_email_enabled','alert_sms_enabled')"
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
        const formatted = parseFloat(transaction.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        if (settings.alert_email_enabled === 'true' && user?.email) {
            await sendTransactionEmail(
                user.email, user.username, 'withdrawal_otp', transaction.amount,
                `Your withdrawal verification code is: ${otp}. Use it to complete your withdrawal of ${formatted}.`
            );
        }
        if (settings.alert_sms_enabled === 'true' && user?.phone) {
            await sendSMS(
                user.phone,
                `🔐 Your withdrawal code is ${otp}. Use it to complete your withdrawal of ${formatted}. Do not share this code.`
            );
        }

        await pool.execute(
            `INSERT INTO notifications (user_id, title, message, type, is_read)
             VALUES (?, 'Verification Code Ready', ?, 'info', 0)`,
            [transaction.user_id,
             `Your verification code for withdrawal #${transactionId} (${formatted}) is ready. Return to your withdrawal to enter it.`]
        ).catch(() => {});

        res.json({ success: true, message: `Code set and sent for transaction #${transactionId}.` });
    } catch (error) {
        console.error('[setWithdrawalOtp]', error);
        res.status(500).json({ success: false, message: 'Failed to set OTP: ' + error.message });
    }
};

exports.clearWithdrawalOtp = async (req, res) => {
    const { transactionId, stepNumber } = req.params;

    try {
        const [[stepLog]] = await pool.execute(
            'SELECT id FROM transaction_step_logs WHERE transaction_id = ? AND step_number = ?',
            [transactionId, stepNumber]
        );
        if (!stepLog) {
            return res.status(404).json({ success: false, message: 'Step log not found.' });
        }

        await pool.execute(
            `UPDATE transaction_step_logs
             SET admin_otp_code = NULL, otp_set_by = NULL, otp_set_at = NULL,
                 otp_consumed = 0, otp_attempts = 0, otp_locked_until = NULL
             WHERE id = ?`,
            [stepLog.id]
        );
        res.json({ success: true, message: 'OTP cleared.' });
    } catch (error) {
        console.error('[clearWithdrawalOtp]', error);
        res.status(500).json({ success: false, message: 'Failed to clear OTP: ' + error.message });
    }
};

// ─── Approve / Reject Withdrawal ─────────────────────────────────────────────

exports.approveWithdrawal = async (req, res) => {
    const { transactionId } = req.params;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const [[tx]] = await conn.execute(
            `SELECT t.*, COALESCE(a.balance, 0) AS user_balance
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             LEFT JOIN accounts a ON a.user_id = u.id
             WHERE t.id = ? AND t.type = 'withdrawal' AND t.status = 'pending'`,
            [transactionId]
        );
        if (!tx) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'Not found or already processed' });
        }
        if (parseFloat(tx.user_balance) < parseFloat(tx.amount)) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }

        await conn.execute(
            'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
            [tx.amount, tx.user_id]
        );
        await conn.execute(
            `UPDATE transactions SET status = 'completed', withdrawal_step = NULL,
             description = COALESCE(NULLIF(TRIM(description),''), 'Withdrawal processed')
             WHERE id = ?`,
            [transactionId]
        );
        await conn.execute(
            "UPDATE transaction_step_logs SET status = 'completed', completed_at = NOW() WHERE transaction_id = ?",
            [transactionId]
        );
        await conn.commit();

        const [[user]] = await pool.execute(
            "SELECT CONCAT(first_name, ' ', last_name) as username, email, phone FROM users WHERE id = ?", [tx.user_id]
        );
        const [settingRows] = await pool.execute(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('alert_email_enabled','alert_sms_enabled')"
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
        const formatted = parseFloat(tx.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        if (settings.alert_email_enabled === 'true' && user?.email) {
            await sendTransactionEmail(user.email, user.username, 'withdrawal', tx.amount,
                `Your withdrawal of ${formatted} has been processed successfully.`);
        }
        if (settings.alert_sms_enabled === 'true' && user?.phone) {
            await sendSMS(user.phone, `💸 Your withdrawal of ${formatted} has been processed. Thank you.`);
        }

        res.json({ success: true, message: 'Withdrawal approved and processed' });
    } catch (error) {
        await conn.rollback();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        conn.release();
    }
};

exports.rejectWithdrawal = async (req, res) => {
    const { transactionId } = req.params;
    const { reason } = req.body;

    try {
        const [[tx]] = await pool.execute(
            'SELECT user_id, amount FROM transactions WHERE id = ?', [transactionId]
        );

        await pool.execute(
            `UPDATE transactions SET status = 'rejected',
             description = COALESCE(NULLIF(TRIM(description),''), 'Withdrawal declined')
             WHERE id = ?`,
            [transactionId]
        );
        await pool.execute(
            "UPDATE transaction_step_logs SET status = 'rejected' WHERE transaction_id = ?",
            [transactionId]
        );

        if (tx) {
            const [[user]] = await pool.execute(
                "SELECT CONCAT(first_name, ' ', last_name) as username, email, phone FROM users WHERE id = ?", [tx.user_id]
            );
            const [settingRows] = await pool.execute(
                "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('alert_email_enabled','alert_sms_enabled')"
            );
            const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
            const formatted = parseFloat(tx.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

            if (settings.alert_email_enabled === 'true' && user?.email) {
                await sendTransactionEmail(user.email, user.username, 'withdrawal_failed', tx.amount,
                    `Your withdrawal of ${formatted} was declined. ${reason ? 'Reason: ' + reason : 'Contact support for more info.'}`);
            }
            if (settings.alert_sms_enabled === 'true' && user?.phone) {
                await sendSMS(user.phone, `⚠️ Your withdrawal of ${formatted} was unsuccessful. Contact support.`);
            }
        }

        res.json({ success: true, message: 'Withdrawal rejected' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Withdrawal Step Configs ──────────────────────────────────────────────────

exports.getWithdrawalSteps = async (req, res) => {
    try {
        const [steps] = await pool.execute('SELECT * FROM withdrawal_step_configs ORDER BY step_number ASC');
        res.render('admin/withdrawal-steps', {
            title:       'Withdrawal Steps Configuration',
            steps,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load step configuration');
        res.redirect('/admin/dashboard');
    }
};

exports.updateWithdrawalStep = async (req, res) => {
    const { id } = req.params;
    const { step_code, step_name, description, is_required, validation_rules, rejection_reasons } = req.body;

    try {
        let parsedRules   = {};
        let parsedReasons = [];
        try { parsedRules   = validation_rules ? JSON.parse(validation_rules) : {}; }
        catch (e) { parsedRules = { custom_text: validation_rules }; }
        try { parsedReasons = rejection_reasons ? JSON.parse(rejection_reasons) : []; }
        catch (e) { parsedReasons = rejection_reasons ? rejection_reasons.split('\n').filter(r => r.trim()) : []; }

        await pool.execute(
            `UPDATE withdrawal_step_configs
             SET step_code=?, step_name=?, description=?, is_required=?,
                 validation_rules=?, rejection_reasons=?
             WHERE id=?`,
            [step_code, step_name, description, is_required === 'on' ? 1 : 0,
             JSON.stringify(parsedRules), JSON.stringify(parsedReasons), id]
        );
        req.flash('success', `Step "${step_name}" updated.`);
        res.redirect('/admin/withdrawal-steps');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update step.');
        res.redirect('/admin/withdrawal-steps');
    }
};

exports.toggleStepStatus = async (req, res) => {
    const { id } = req.params;
    const { active } = req.body;

    try {
        await pool.execute(
            'UPDATE withdrawal_step_configs SET is_active = ? WHERE id = ?',
            [active === 'true' ? 1 : 0, id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to toggle step' });
    }
};

// ─── Pending Step Reviews ─────────────────────────────────────────────────────

exports.getPendingStepReviews = async (req, res) => {
    try {
        const [pending] = await pool.execute(`
            SELECT tsl.*, t.amount, t.user_id, CONCAT(u.first_name, ' ', u.last_name) as username, u.email, wsc.step_name, wsc.step_code
            FROM transaction_step_logs tsl
            JOIN transactions t ON tsl.transaction_id = t.id
            JOIN users u ON t.user_id = u.id
            JOIN withdrawal_step_configs wsc ON tsl.step_number = wsc.step_number
            WHERE tsl.status = 'pending' AND wsc.step_code = 'ADMIN_APPROVE'
            ORDER BY tsl.created_at ASC
        `);
        res.render('admin/pending-reviews', {
            title:       'Pending Withdrawal Reviews',
            pending,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load pending reviews');
        res.redirect('/admin/dashboard');
    }
};

exports.reviewStep = async (req, res) => {
    const { logId } = req.params;
    const { action, admin_notes } = req.body;

    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[log]] = await conn.execute(`
            SELECT tsl.*, t.user_id, t.amount, t.id as transaction_id, t.status as tx_status,
                   wsc.step_number, wsc.step_code, wsc.step_name
            FROM transaction_step_logs tsl
            JOIN transactions t ON tsl.transaction_id = t.id
            JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
            WHERE tsl.id = ? FOR UPDATE
        `, [logId]);

        if (!log) throw new Error('Step log not found');
        if (log.step_code !== 'ADMIN_APPROVE') throw new Error('This step does not require admin review');
        if (log.tx_status !== 'pending') throw new Error(`Transaction is already ${log.tx_status}`);
        if (log.status !== 'pending') throw new Error(`Step is already ${log.status}`);

        const newStatus = action === 'approve' ? 'completed' : 'rejected';
        await conn.execute(
            'UPDATE transaction_step_logs SET status=?, admin_notes=?, completed_at=NOW(), reviewed_by=? WHERE id=?',
            [newStatus, admin_notes || null, req.user.id, logId]
        );

        if (action === 'reject') {
            await conn.execute(
                `UPDATE transactions SET status='rejected',
                 description = CONCAT(COALESCE(description,''), ' | Rejected by admin: ', ?)
                 WHERE id=?`,
                [admin_notes || 'No reason provided', log.transaction_id]
            );
        } else {
            const [[{ count }]] = await conn.execute(
                "SELECT COUNT(*) as count FROM transaction_step_logs WHERE transaction_id=? AND status != 'completed'",
                [log.transaction_id]
            );
            if (count === 0) {
                await conn.execute(
                    'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
                    [log.amount, log.user_id]
                );
                await conn.execute(
                    "UPDATE transactions SET status='completed', withdrawal_step=? WHERE id=?",
                    [log.step_number, log.transaction_id]
                );
            } else {
                const [[nextStep]] = await conn.execute(
                    "SELECT step_number FROM transaction_step_logs WHERE transaction_id=? AND status!='completed' ORDER BY step_number ASC LIMIT 1",
                    [log.transaction_id]
                );
                if (nextStep) {
                    await conn.execute(
                        'UPDATE transactions SET withdrawal_step=? WHERE id=?',
                        [nextStep.step_number, log.transaction_id]
                    );
                }
            }
        }

        await conn.commit();
        req.flash('success', `Step ${action === 'approve' ? 'approved' : 'rejected'} successfully`);
        res.redirect('/admin/pending-reviews');
    } catch (error) {
        await conn.rollback();
        console.error(error);
        req.flash('error', error.message || 'Failed to process review');
        res.redirect('/admin/pending-reviews');
    } finally {
        conn.release();
    }
};

// ─── Support Requests ────────────────────────────────────────────────────────────

exports.getSupportRequests = async (req, res) => {
    try {
        const [requests] = await pool.execute(
            `SELECT n.*, CONCAT(u.first_name, ' ', u.last_name) as username, u.email
             FROM notifications n
             LEFT JOIN users u ON n.user_id = u.id
             WHERE n.user_id IS NULL AND n.type IN ('otp_request', 'support')
             ORDER BY n.created_at DESC LIMIT 100`
        );
        res.render('admin/support-requests', {
            title:       'Support Requests',
            requests,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load support requests');
        res.redirect('/admin/dashboard');
    }
};

// ─── Notifications ────────────────────────────────────────────────────────────

exports.getNotificationsPage = async (req, res) => {
    try {
        const [users] = await pool.execute(
            "SELECT id, CONCAT(first_name, ' ', last_name) as username, email FROM users WHERE is_admin = 0 ORDER BY first_name ASC"
        );
        const [notifications] = await pool.execute(
            `SELECT n.*, COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'All Users') AS recipient_name
             FROM notifications n LEFT JOIN users u ON n.user_id = u.id
             ORDER BY n.created_at DESC LIMIT 50`
        );
        res.render('admin/notifications', {
            title:       'Notifications',
            users,
            notifications,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.sendGeneralNotification = async (req, res) => {
    const { title, message } = req.body;
    try {
        if (!title || !message) {
            req.flash('error', 'Title and message are required.');
            return res.redirect('/admin/notifications');
        }
        await pool.execute(
            "INSERT INTO notifications (user_id, title, message, type) VALUES (NULL, ?, ?, 'general')",
            [title, message]
        );
        req.flash('success', 'General notification sent to all users.');
        res.redirect('/admin/notifications');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to send notification.');
        res.redirect('/admin/notifications');
    }
};

exports.sendPersonalNotification = async (req, res) => {
    const { user_id, title, message } = req.body;
    try {
        if (!user_id || !title || !message) {
            req.flash('error', 'User, title, and message are required.');
            return res.redirect('/admin/notifications');
        }
        await pool.execute(
            "INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'personal')",
            [user_id, title, message]
        );
        req.flash('success', 'Personal notification sent.');
        res.redirect('/admin/notifications');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to send notification.');
        res.redirect('/admin/notifications');
    }
};

exports.deleteNotification = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.execute('DELETE FROM notifications WHERE id = ?', [id]);
        req.flash('success', 'Notification deleted.');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Could not delete notification.');
    }
    res.redirect('/admin/notifications');
};

// ─── Site Settings ────────────────────────────────────────────────────────────

exports.getSettings = async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM settings');
        const settings = rows.reduce((map, row) => {
            map[row.setting_key] = row.setting_value; return map;
        }, {});
        res.render('admin/settings', {
            title:       'Admin Settings',
            settings,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load settings');
        res.redirect('/admin/dashboard');
    }
};


// In adminController.js - getSelectUser

exports.getSelectUser = async (req, res) => {
    try {
        const { q } = req.query;
        let users = [];
        let query = q || '';
        
        let sql = `
            SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) as username, 
                   u.email, u.phone, u.kyc_status, u.is_suspended, u.is_admin,
                   a.balance, a.currency as balance_currency
            FROM users u
            LEFT JOIN accounts a ON a.user_id = u.id
        `;
        
        let params = [];
        
        if (query) {
            const searchTerm = `%${query}%`;
            sql += ` WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
            params = [searchTerm, searchTerm, searchTerm, searchTerm];
        }
        
        sql += ` ORDER BY u.is_admin DESC, u.first_name ASC LIMIT 50`;
        
        const [rows] = await pool.execute(sql, params);
        
        // Handle case where users have multiple accounts - keep first one or aggregate
        const userMap = new Map();
        for (const row of rows) {
            if (!userMap.has(row.id)) {
                userMap.set(row.id, {
                    ...row,
                    balance: row.balance || 0,
                    balance_currency: row.balance_currency || 'USD'
                });
            }
        }
        users = Array.from(userMap.values());

        res.render('admin/select-user', {
            title: 'Select User',
            users,
            query,
            currentAdminId: req.user.id,
            success_msg: req.flash('success'),
            error_msg: req.flash('error'),
        });
    } catch (error) {
        console.error('[getSelectUser]', error);
        req.flash('error', 'Failed to load users');
        res.redirect('/admin/dashboard');
    }
};

exports.updateSettings = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const {
            site_name, theme_primary_color, maintenance_mode,
            alert_email_enabled, alert_sms_enabled, global_withdrawal_steps_required,
        } = req.body;

        const updates = [
            ['site_name',                        site_name || 'Finora Bank'],
            ['theme_primary_color',              theme_primary_color || '#0F6E56'],
            ['maintenance_mode',                 maintenance_mode === 'on' ? 'true' : 'false'],
            ['alert_email_enabled',              alert_email_enabled === 'on' ? 'true' : 'false'],
            ['alert_sms_enabled',                alert_sms_enabled === 'on' ? 'true' : 'false'],
            ['global_withdrawal_steps_required', global_withdrawal_steps_required === 'on' ? 'true' : 'false'],
        ];

        for (const [key, value] of updates) {
            await conn.execute(
                'INSERT INTO settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?',
                [key, value, value]
            );
        }

        if (req.file) {
            await conn.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('site_logo',?) ON DUPLICATE KEY UPDATE setting_value=?",
                [`/uploads/logos/${req.file.filename}`, `/uploads/logos/${req.file.filename}`]
            );
        }

        req.flash('success', 'Settings updated successfully');
        res.redirect('/admin/settings');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to update settings');
        res.redirect('/admin/settings');
    } finally {
        conn.release();
    }
};

// ─── Debug (remove in production) ────────────────────────────────────────────

exports.debugStepLog = async (req, res) => {
    const { transactionId, stepNumber } = req.params;
    try {
        const [[stepLog]] = await pool.execute(
            `SELECT tsl.*, t.status as tx_status, t.withdrawal_step as tx_current_step
             FROM transaction_step_logs tsl
             JOIN transactions t ON tsl.transaction_id = t.id
             WHERE tsl.transaction_id = ? AND tsl.step_number = ?`,
            [transactionId, stepNumber]
        );
        if (!stepLog) return res.json({ found: false, transactionId, stepNumber });

        res.json({
            found:           true,
            log_row_id:      stepLog.id,
            transaction_id:  stepLog.transaction_id,
            step_number:     stepLog.step_number,
            step_code:       stepLog.step_code,
            status:          stepLog.status,
            tx_status:       stepLog.tx_status,
            tx_current_step: stepLog.tx_current_step,
            has_otp:         !!stepLog.admin_otp_code,
            otp_consumed:    stepLog.otp_consumed,
            otp_attempts:    stepLog.otp_attempts,
            otp_locked_until: stepLog.otp_locked_until,
            otp_set_at:      stepLog.otp_set_at,
            otp_set_by:      stepLog.otp_set_by,
            created_at:      stepLog.created_at,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};