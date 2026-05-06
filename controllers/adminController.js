const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { generateAccountNumber } = require('../utils/helpers');
const { sendTransactionEmail } = require('../utils/email');
const { sendSMS }              = require('../utils/sms');

// ─── Helpers ────────────────────────────────────────────────────────────────

const handleError = (res, error, redirectPath, message = 'Action failed') => {
    console.error(error);
    if (req.flash) {
        req.flash('error', message);
        return res.redirect(redirectPath);
    }
    return res.status(500).json({ success: false, message });
};

const jsonError = (res, error, message = 'Action failed') => {
    console.error(error);
    return res.status(500).json({ success: false, message });
};

const jsonSuccess = (res, message) => res.json({ success: true, message });

// ─── Dashboard ───────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
    try {
        const [[{ count: users }]]             = await pool.execute('SELECT COUNT(*) as count FROM users WHERE is_admin = FALSE');
        const [[{ count: pendingKYC }]]        = await pool.execute("SELECT COUNT(*) as count FROM kyc_documents WHERE status = 'pending'");
        const [[{ total: totalBalance }]]      = await pool.execute('SELECT SUM(balance) as total FROM accounts');
        const [[{ count: todayTransactions }]] = await pool.execute("SELECT COUNT(*) as count FROM transactions WHERE DATE(created_at) = CURDATE()");

        const [recentUsers] = await pool.execute(
            'SELECT id, first_name, last_name, email, kyc_status FROM users WHERE is_admin = FALSE ORDER BY created_at DESC LIMIT 5'
        );

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            stats: { users, pendingKYC, totalBalance: totalBalance || 0, todayTransactions },
            recentUsers
        });
    } catch (error) {
        console.error(error);
        res.status(500).render('errors/500');
    }
};

// ─── User Management ─────────────────────────────────────────────────────────

exports.getUsers = async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT u.*, a.balance, a.account_number
             FROM users u
             LEFT JOIN accounts a ON u.id = a.user_id
             WHERE u.is_admin = FALSE
             ORDER BY u.created_at DESC`
        );

        res.render('admin/users', { title: 'Manage Users', users });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.createUser = async (req, res) => {
    const { first_name, last_name, email, phone, password, initial_balance } = req.body;

    try {
        const salt           = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);

        const [result] = await pool.execute(
            `INSERT INTO users (email, password, first_name, last_name, phone, email_verified, kyc_status)
             VALUES (?, ?, ?, ?, ?, TRUE, 'approved')`,
            [email, hashedPassword, first_name, last_name, phone]
        );

        await pool.execute(
            'INSERT INTO accounts (user_id, account_number, balance) VALUES (?, ?, ?)',
            [result.insertId, generateAccountNumber(), initial_balance || 0]
        );

        req.flash('success', 'User created successfully');
        res.redirect('/admin/users');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to create user');
        res.redirect('/admin/users');
    }
};

exports.suspendUser = async (req, res) => {
    const { userId } = req.params;
    const { action } = req.body;

    try {
        await pool.execute(
            'UPDATE users SET is_suspended = ? WHERE id = ?',
            [action === 'suspend', userId]
        );

        jsonSuccess(res, `User ${action}ed`);
    } catch (error) {
        jsonError(res, error);
    }
};

exports.deleteUser = async (req, res) => {
    const { userId } = req.params;

    try {
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        jsonSuccess(res, 'User deleted');
    } catch (error) {
        jsonError(res, error, 'Delete failed');
    }
};

// ─── KYC Management ──────────────────────────────────────────────────────────

exports.getKYCReview = async (req, res) => {
    try {
        const [documents] = await pool.execute(
            `SELECT k.*, u.first_name, u.last_name, u.email
             FROM kyc_documents k
             JOIN users u ON k.user_id = u.id
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

    try {
        const [docs] = await pool.execute(
            'SELECT user_id FROM kyc_documents WHERE id = ?',
            [documentId]
        );

        await pool.execute(
            'UPDATE kyc_documents SET status = ?, admin_notes = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
            [action, notes, req.user.id, documentId]
        );

        await pool.execute(
            'UPDATE users SET kyc_status = ? WHERE id = ?',
            [action, docs[0].user_id]
        );

        jsonSuccess(res, `KYC ${action}`);
    } catch (error) {
        jsonError(res, error);
    }
};

exports.toggleKYCRequirement = async (req, res) => {
    const { userId } = req.params;
    const { enabled } = req.body;

    try {
        await pool.execute(
            'UPDATE users SET kyc_enabled = ? WHERE id = ?',
            [enabled, userId]
        );

        jsonSuccess(res);
    } catch (error) {
        jsonError(res, error);
    }
};

// ─── Account / Balance Control ───────────────────────────────────────────────

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

        const [accounts] = await pool.execute(
            'SELECT id, balance FROM accounts WHERE user_id = ?', [userId]
        );
        if (!accounts.length) {
            req.flash('error', 'Account not found for this user');
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
            'SELECT first_name, last_name, email, phone FROM users WHERE id = ?',
            [userId]
        );

        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
        );
        const settings = settingRows.reduce((m, r) => {
            m[r.setting_key] = r.setting_value; return m;
        }, {});

        const name = `${user.first_name} ${user.last_name}`;

        if (settings.alert_email_enabled === 'true') {
            await sendTransactionEmail(user.email, name, 'withdrawal', parsedAmount, description || 'Account debit');
            `💸 Finora Bank: ${formatted} has been deducted from your account. Ref: ${description || 'Account debit'}.`
        }

        if (settings.alert_sms_enabled === 'true' && user.phone) {
            const formatted = parsedAmount.toLocaleString('en-US', {
                style: 'currency', currency: 'USD'
            });
            await sendSMS(
                user.phone,
                `💰 Finora Bank: ${formatted} has been credited to your account. Ref: ${description || 'Account credit'}.` +
                `If unauthorized, contact support immediately.`
            );
        }

        // BEFORE:



        req.flash('success', `Account funded with $${parsedAmount.toFixed(2)}`);
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

        const [accounts] = await pool.execute(
            'SELECT id, balance FROM accounts WHERE user_id = ?', [userId]
        );
        if (!accounts.length) {
            req.flash('error', 'Account not found for this user');
            return res.redirect('/admin/fund');
        }

        const currentBalance = parseFloat(accounts[0].balance);
        if (currentBalance < parsedAmount) {
            req.flash('error', `Insufficient balance. Current: $${currentBalance.toFixed(2)}`);
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

        const [[user]] = await pool.execute(
            'SELECT first_name, last_name, email, phone FROM users WHERE id = ?',
            [userId]
        );

        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
        );
        const settings = settingRows.reduce((m, r) => {
            m[r.setting_key] = r.setting_value; return m;
        }, {});

        const name = `${user.first_name} ${user.last_name}`;

        if (settings.alert_email_enabled === 'true') {
            await sendTransactionEmail(user.email, name, 'deposit', parsedAmount, description || 'Account credit');
        }

        if (settings.alert_sms_enabled === 'true' && user.phone) {
            const formatted = parsedAmount.toLocaleString('en-US', {
                style: 'currency', currency: 'USD'
            });
            await sendSMS(
                user.phone,
                `💰 Finora Bank: ${formatted} has been credited to your account. Ref: ${description || 'Account credit'}.` +
                `If unauthorized, contact support immediately.`
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

exports.getTransactions = async (req, res) => {
    try {
        const [transactions] = await pool.execute(
            `SELECT t.*, u.first_name, u.last_name, u.email 
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             ORDER BY t.created_at DESC
             LIMIT 100`
        );
        res.render('admin/transactions', { title: 'Transactions', transactions });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.getFundPage = async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT u.id, u.first_name, u.last_name, u.email, a.balance, a.account_number
             FROM users u
             LEFT JOIN accounts a ON u.id = a.user_id
             WHERE u.is_admin = FALSE
             ORDER BY u.first_name ASC`
        );
        res.render('admin/fund', {
            title: 'Fund Account',
            users,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error')
        });
    } catch (error) {
        console.error(error);
        res.redirect('/admin/dashboard');
    }
};

exports.getCreateUser = async (req, res) => {
    res.render('admin/create-user', { title: 'Create User' });
};

// ─── Withdrawal Settings ─────────────────────────────────────────────────────

exports.toggleWithdrawalSteps = async (req, res) => {
    const { scope, userId } = req.body;

    try {
        if (scope === 'global') {
            const [settings] = await pool.execute(
                "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
            );

            const newValue = settings[0].setting_value === 'true' ? 'false' : 'true';

            await pool.execute(
                "UPDATE settings SET setting_value = ? WHERE setting_key = 'global_withdrawal_steps_required'",
                [newValue]
            );
        } else {
            const [users] = await pool.execute(
                'SELECT withdrawal_steps_required FROM users WHERE id = ?',
                [userId]
            );

            await pool.execute(
                'UPDATE users SET withdrawal_steps_required = ? WHERE id = ?',
                [!users[0].withdrawal_steps_required, userId]
            );
        }

        jsonSuccess(res);
    } catch (error) {
        jsonError(res, error);
    }
};

// ─── Pending Withdrawals Page ─────────────────────────────────────────────────
// Route: GET /admin/pending-withdrawals
// Shows all pending withdrawal transactions with their step status + OTP controls
// ─── Pending Withdrawals Page ─────────────────────────────────────────────────
// Route: GET /admin/pending-withdrawals

exports.getPendingWithdrawals = async (req, res) => {
    try {
        const [transactions] = await pool.execute(`
            SELECT
                t.id, t.user_id, t.amount, t.status,
                t.description, t.recipient_account,
                t.withdrawal_step, t.created_at,
                u.first_name, u.last_name, u.email, u.phone,
                (SELECT COUNT(*) FROM withdrawal_step_configs WHERE is_active = TRUE) AS total_steps
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.type = 'withdrawal' AND t.status = 'pending'
            ORDER BY t.created_at ASC
        `);

        for (const tx of transactions) {
            const [steps] = await pool.execute(`
                SELECT
                    tsl.id            AS log_id,
                    tsl.step_number,
                    tsl.step_code,
                    tsl.status,
                    tsl.completed_at,
                    tsl.admin_otp_code,
                    tsl.otp_set_at,
                    tsl.otp_consumed,
                    tsl.otp_attempts,
                    tsl.otp_locked_until,
                    tsl.otp_set_by,
                    wsc.step_name,
                    wsc.validation_rules,
                    wsc.is_required
                FROM transaction_step_logs tsl
                LEFT JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
                WHERE tsl.transaction_id = ?
                ORDER BY tsl.step_number ASC
            `, [tx.id]);

            for (const step of steps) {
                let rules = {};
                try {
                    if (typeof step.validation_rules === 'string') {
                        rules = JSON.parse(step.validation_rules);
                    } else if (typeof step.validation_rules === 'object' && step.validation_rules !== null) {
                        rules = step.validation_rules;
                    }
                } catch (e) { rules = {}; }

                step.requires_otp      = rules.requires_otp === true || rules.requires_otp === 1;
                step.requires_document = rules.requires_document === true || rules.requires_document === 1;
                step.otp_is_set        = !!step.admin_otp_code;
                step.otp_consumed_bool = step.otp_consumed === 1 || step.otp_consumed === true;
                step.is_locked         = !!(step.otp_locked_until && new Date(step.otp_locked_until) > new Date());

                delete step.admin_otp_code; // never send hash to view
                delete step.validation_rules;

                console.log(`[pendingWithdrawals] tx=${tx.id} step=${step.step_number} code=${step.step_code} requires_otp=${step.requires_otp} otp_is_set=${step.otp_is_set} status=${step.status}`);
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


// ─── Set OTP ──────────────────────────────────────────────────────────────────
// Route: POST /admin/transactions/:transactionId/steps/:stepNumber/set-otp

exports.setWithdrawalOtp = async (req, res) => {
    const { transactionId, stepNumber } = req.params;
    const { otp } = req.body;

    if (!otp || !/^\d{4,8}$/.test(otp)) {
        return res.status(400).json({ success: false, message: 'OTP must be 4–8 digits.' });
    }

    try {
        const [[transaction]] = await pool.execute(
            `SELECT id, amount, user_id FROM transactions WHERE id = ? AND type = 'withdrawal'`,
            [transactionId]
        );
        if (!transaction) {
            return res.status(404).json({ success: false, message: `Transaction ${transactionId} not found.` });
        }

        const [[stepLog]] = await pool.execute(
            `SELECT id, step_code FROM transaction_step_logs
             WHERE transaction_id = ? AND step_number = ?`,
            [transactionId, stepNumber]
        );
        if (!stepLog) {
            return res.status(404).json({ success: false, message: 'Step log not found.' });
        }

        const hashedOtp = await bcrypt.hash(otp, 10);

        await pool.execute(
            `UPDATE transaction_step_logs
             SET admin_otp_code   = ?,
                 otp_set_by       = ?,
                 otp_set_at       = NOW(),
                 otp_consumed     = 0,
                 otp_attempts     = 0,
                 otp_locked_until = NULL
             WHERE id = ?`,
            [hashedOtp, req.user.id, stepLog.id]
        );

        // ── Notify user via email + SMS ──
        const [[user]] = await pool.execute(
            'SELECT first_name, last_name, email, phone FROM users WHERE id = ?',
            [transaction.user_id]
        );

        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});

        const formattedAmount = parseFloat(transaction.amount).toLocaleString('en-US', {
            style: 'currency', currency: 'USD'
        });

        if (settings.alert_email_enabled === 'true' && user?.email) {
            await sendTransactionEmail(
                user.email,
                `${user.first_name} ${user.last_name}`,
                'withdrawal_otp',         // you'll handle this label below
                transaction.amount,
                `Your withdrawal verification code is: ${otp}. Enter this code to continue your withdrawal of ${formattedAmount}.`
            );
        }

        if (settings.alert_sms_enabled === 'true' && user?.phone) {
            await sendSMS(
                user.phone,
                `🔐 Finora Bank: Your withdrawal verification code is ${otp}. ` +
                `Use this to complete your withdrawal of ${formattedAmount}. ` +
                `Do not share this code with anyone.`
            );
        }

        console.log(`[setWithdrawalOtp] Admin ${req.user.id} set OTP for tx=${transactionId} step=${stepNumber}`);
        res.json({ success: true, message: `Code set and sent to user for transaction #${transactionId}.` });

    } catch (error) {
        console.error('[setWithdrawalOtp]', error);
        res.status(500).json({ success: false, message: 'Failed to set OTP: ' + error.message });
    }
};

// ─── Clear OTP ────────────────────────────────────────────────────────────────
// Route: POST /admin/transactions/:transactionId/steps/:stepNumber/clear-otp

exports.clearWithdrawalOtp = async (req, res) => {
    const { transactionId, stepNumber } = req.params;

    try {
        const [[stepLog]] = await pool.execute(
            `SELECT id FROM transaction_step_logs
             WHERE transaction_id = ? AND step_number = ?`,
            [transactionId, stepNumber]
        );
        if (!stepLog) {
            return res.status(404).json({ success: false, message: 'Step log not found.' });
        }

        await pool.execute(
            `UPDATE transaction_step_logs
             SET admin_otp_code   = NULL,
                 otp_set_by       = NULL,
                 otp_set_at       = NULL,
                 otp_consumed     = 0,
                 otp_attempts     = 0,
                 otp_locked_until = NULL
             WHERE id = ?`,
            [stepLog.id]
        );

        console.log(`[clearWithdrawalOtp] Admin ${req.user.id} cleared OTP for tx=${transactionId} step=${stepNumber}`);
        res.json({ success: true, message: 'OTP cleared.' });

    } catch (error) {
        console.error('[clearWithdrawalOtp]', error);
        res.status(500).json({ success: false, message: 'Failed to clear OTP: ' + error.message });
    }
};

// ─── APPROVE WITHDRAWAL (Skip all steps, send money) ────────────────────────

exports.approveWithdrawal = async (req, res) => {
    const { transactionId } = req.params;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[tx]] = await conn.execute(
            `SELECT t.*, a.balance, a.id as account_id
             FROM transactions t
             JOIN accounts a ON t.user_id = a.user_id
             WHERE t.id = ? AND t.type = 'withdrawal' AND t.status = 'pending'`,
            [transactionId]
        );

        if (!tx) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'Not found or already processed' });
        }

        if (parseFloat(tx.balance) < parseFloat(tx.amount)) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'User has insufficient balance' });
        }

        await conn.execute(
            'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
            [tx.amount, tx.user_id]
        );

        // ── Clean description — no "admin" language ──
        await conn.execute(
            `UPDATE transactions 
             SET status = 'completed', withdrawal_step = NULL, 
                 description = COALESCE(NULLIF(TRIM(description),''), 'Withdrawal processed')
             WHERE id = ?`,
            [transactionId]
        );

        await conn.execute(
            `UPDATE transaction_step_logs SET status = 'completed', completed_at = NOW() 
             WHERE transaction_id = ?`,
            [transactionId]
        );

        await conn.commit();

        // ── Notify user ──
        const [[user]] = await pool.execute(
            'SELECT first_name, last_name, email, phone FROM users WHERE id = ?',
            [tx.user_id]
        );

        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});

        const formattedAmount = parseFloat(tx.amount).toLocaleString('en-US', {
            style: 'currency', currency: 'USD'
        });

        if (settings.alert_email_enabled === 'true' && user?.email) {
            await sendTransactionEmail(
                user.email,
                `${user.first_name} ${user.last_name}`,
                'withdrawal',             // renders as "Withdrawal" — not "admin_approve"
                tx.amount,
                `Your withdrawal of ${formattedAmount} has been processed successfully.`
            );
        }

        if (settings.alert_sms_enabled === 'true' && user?.phone) {
            await sendSMS(
                user.phone,
                `💸 Finora Bank: Your withdrawal of ${formattedAmount} has been processed ` +
                `and is on its way. Thank you for banking with us.`
            );
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
            `UPDATE transaction_step_logs SET status = 'rejected' WHERE transaction_id = ?`,
            [transactionId]
        );

        // ── Notify user ──
        if (tx) {
            const [[user]] = await pool.execute(
                'SELECT first_name, last_name, email, phone FROM users WHERE id = ?', [tx.user_id]
            );
            const [settingRows] = await pool.execute(
                `SELECT setting_key, setting_value FROM settings
                 WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
            );
            const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
            const formattedAmount = parseFloat(tx.amount).toLocaleString('en-US', {
                style: 'currency', currency: 'USD'
            });

            if (settings.alert_email_enabled === 'true' && user?.email) {
                await sendTransactionEmail(
                    user.email,
                    `${user.first_name} ${user.last_name}`,
                    'withdrawal_failed',
                    tx.amount,
                    `Your withdrawal request of ${formattedAmount} could not be completed. Please contact support if you have questions.`
                );
            }
            if (settings.alert_sms_enabled === 'true' && user?.phone) {
                await sendSMS(
                    user.phone,
                    `⚠️ Finora Bank: Your withdrawal request of ${formattedAmount} was unsuccessful. ` +
                    `Please contact support for assistance.`
                );
            }
        }

        res.json({ success: true, message: 'Withdrawal rejected' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Clear OTP from a step (admin revokes access) ────────────────────────────
// Route: POST /admin/transactions/:transactionId/steps/:stepNumber/clear-otp

exports.clearWithdrawalOtp = async (req, res) => {
    const { transactionId, stepNumber } = req.params;

    try {
        const [[stepLog]] = await pool.execute(
            `SELECT id FROM transaction_step_logs
             WHERE transaction_id = ? AND step_number = ?`,
            [transactionId, stepNumber]
        );
        if (!stepLog) {
            return res.status(404).json({ success: false, message: 'Step log not found.' });
        }

        await pool.execute(
            `UPDATE transaction_step_logs
             SET admin_otp_code   = NULL,
                 otp_set_by       = NULL,
                 otp_set_at       = NULL,
                 otp_consumed     = 0,
                 otp_attempts     = 0,
                 otp_locked_until = NULL
             WHERE id = ?`,
            [stepLog.id]
        );

        console.log(`[clearWithdrawalOtp] Admin ${req.user.id} cleared OTP for tx=${transactionId} step=${stepNumber}`);

        res.json({ success: true, message: 'OTP cleared successfully.' });

    } catch (error) {
        console.error('[clearWithdrawalOtp] Error:', error);
        res.status(500).json({ success: false, message: 'Failed to clear OTP: ' + error.message });
    }
};

// ─── DEBUG: Inspect a step log row (REMOVE IN PRODUCTION) ────────────────────
// Route: GET /admin/debug/step-log/:transactionId/:stepNumber
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

        if (!stepLog) {
            return res.json({ found: false, transactionId, stepNumber });
        }

        let parsedData = {};
        try {
            const raw = stepLog.submitted_data;
            if (!raw) parsedData = {};
            else if (typeof raw === 'string') parsedData = JSON.parse(raw);
            else if (typeof raw === 'object') parsedData = raw;
        } catch (e) {
            parsedData = { parse_error: e.message, raw: String(stepLog.submitted_data) };
        }

        res.json({
        found:              true,
        log_row_id:         stepLog.id,
        transaction_id:     stepLog.transaction_id,
        step_number:        stepLog.step_number,
        step_code:          stepLog.step_code,
        status:             stepLog.status,
        tx_status:          stepLog.tx_status,
        tx_current_step:    stepLog.tx_current_step,
        // ✅ Read from actual columns
        has_admin_otp_code: !!stepLog.admin_otp_code,
        otp_consumed:       stepLog.otp_consumed,
        otp_attempts:       stepLog.otp_attempts,
        otp_locked_until:   stepLog.otp_locked_until,
        otp_set_at:         stepLog.otp_set_at,
        otp_set_by:         stepLog.otp_set_by,
        created_at:         stepLog.created_at,
    });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ─── Single User Details ──────────────────────────────────────────────────────

exports.getUser = async (req, res) => {
    const { userId } = req.params;

    try {
        const [users] = await pool.execute(
            `SELECT u.*, a.balance, a.account_number, a.created_at as account_created
             FROM users u
             LEFT JOIN accounts a ON u.id = a.user_id
             WHERE u.id = ? AND u.is_admin = FALSE`,
            [userId]
        );

        if (!users.length) {
            req.flash('error', 'User not found');
            return res.redirect('/admin/users');
        }

        const user = users[0];

        const [transactions] = await pool.execute(
            `SELECT * FROM transactions 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 20`,
            [userId]
        );

        const [kycDocs] = await pool.execute(
            `SELECT * FROM kyc_documents 
             WHERE user_id = ? 
             ORDER BY submitted_at DESC`,
            [userId]
        );

        res.render('admin/user-detail', {
            title: `${user.first_name} ${user.last_name}`,
            user,
            transactions,
            kycDocs
        });

    } catch (error) {
        console.error(error);
        req.flash('error', 'Failed to load user details');
        res.redirect('/admin/users');
    }
};

// ─── Site Settings ────────────────────────────────────────────────────────────

exports.getSettings = async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM settings');

        const settings = rows.reduce((map, row) => {
            map[row.setting_key] = row.setting_value;
            return map;
        }, {});

        res.render('admin/settings', {
            title: 'Admin Settings',
            settings,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error')
        });
    } catch (error) {
        console.error('Settings error:', error);
        req.flash('error', 'Failed to load settings');
        res.redirect('/admin/dashboard');
    }
};

exports.updateSettings = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const {
            site_name,
            theme_primary_color,
            maintenance_mode,
            alert_email_enabled,
            alert_sms_enabled,
            global_withdrawal_steps_required
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
                `INSERT INTO settings (setting_key, setting_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = ?`,
                [key, value, value]
            );
        }

        if (req.file) {
            await conn.execute(
                `INSERT INTO settings (setting_key, setting_value)
                 VALUES ('site_logo', ?)
                 ON DUPLICATE KEY UPDATE setting_value = ?`,
                [`/uploads/logos/${req.file.filename}`, `/uploads/logos/${req.file.filename}`]
            );
        }

        req.flash('success', 'Settings updated successfully');
        res.redirect('/admin/settings');

    } catch (error) {
        console.error('Update settings error:', error);
        req.flash('error', 'Failed to update settings');
        res.redirect('/admin/settings');
    } finally {
        conn.release();
    }
};

// ─── Admin Withdrawal Steps Management ───────────────────────────────────────

exports.getWithdrawalSteps = async (req, res) => {
    try {
        const [steps] = await pool.execute(
            'SELECT * FROM withdrawal_step_configs ORDER BY step_number ASC'
        );

        res.render('admin/withdrawal-steps', {
            title: 'Withdrawal Steps Configuration',
            steps,
            success_msg: req.flash('success'),
            error_msg: req.flash('error')
        });
    } catch (error) {
        console.error('Withdrawal steps admin error:', error);
        req.flash('error', 'Failed to load step configuration');
        res.redirect('/admin/dashboard');
    }
};

exports.updateWithdrawalStep = async (req, res) => {
    const { id } = req.params;
    const {
        step_code,
        step_name,
        description,
        is_required,
        validation_rules,
        rejection_reasons
    } = req.body;

    try {
        let parsedRules = {};
        let parsedReasons = [];

        try {
            parsedRules = validation_rules ? JSON.parse(validation_rules) : {};
        } catch (e) {
            parsedRules = { custom_text: validation_rules };
        }

        try {
            parsedReasons = rejection_reasons 
                ? JSON.parse(rejection_reasons) 
                : [];
        } catch (e) {
            parsedReasons = rejection_reasons 
                ? rejection_reasons.split('\n').filter(r => r.trim()) 
                : [];
        }

        await pool.execute(
            `UPDATE withdrawal_step_configs 
             SET step_code = ?, step_name = ?, description = ?, 
                 is_required = ?, validation_rules = ?, rejection_reasons = ?
             WHERE id = ?`,
            [
                step_code,
                step_name,
                description,
                is_required === 'on' ? 1 : 0,
                JSON.stringify(parsedRules),
                JSON.stringify(parsedReasons),
                id
            ]
        );

        req.flash('success', `Step ${step_name} updated successfully`);
        res.redirect('/admin/withdrawal-steps');
    } catch (error) {
        console.error('Update step error:', error);
        req.flash('error', 'Failed to update step configuration');
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
        console.error('Toggle step error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle step' });
    }
};

// ─── Admin Review Pending Steps ───────────────────────────────────────────────

exports.getPendingStepReviews = async (req, res) => {
    try {
        const [pending] = await pool.execute(`
            SELECT 
                tsl.*,
                t.amount,
                t.user_id,
                u.first_name,
                u.last_name,
                u.email,
                wsc.step_name,
                wsc.step_code
            FROM transaction_step_logs tsl
            JOIN transactions t ON tsl.transaction_id = t.id
            JOIN users u ON t.user_id = u.id
            JOIN withdrawal_step_configs wsc ON tsl.step_number = wsc.step_number
            WHERE tsl.status = 'pending' AND wsc.step_code = 'ADMIN_APPROVE'
            ORDER BY tsl.created_at ASC
        `);

        res.render('admin/pending-reviews', {
            title: 'Pending Withdrawal Reviews',
            pending,
            success_msg: req.flash('success'),
            error_msg: req.flash('error')
        });
    } catch (error) {
        console.error('Pending reviews error:', error);
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
            WHERE tsl.id = ?
            FOR UPDATE
        `, [logId]);

        if (!log) throw new Error('Step log not found');

        if (log.step_code !== 'ADMIN_APPROVE') {
            throw new Error('This step does not require admin review');
        }

        if (log.tx_status !== 'pending') {
            throw new Error(`Transaction is already ${log.tx_status}`);
        }

        if (log.status !== 'pending') {
            throw new Error(`Step is already ${log.status}`);
        }

        const newStatus = action === 'approve' ? 'completed' : 'rejected';
        
        await conn.execute(
            `UPDATE transaction_step_logs 
             SET status = ?, admin_notes = ?, completed_at = NOW(), reviewed_by = ? 
             WHERE id = ?`,
            [newStatus, admin_notes || null, req.user.id, logId]
        );

        if (action === 'reject') {
            await conn.execute(
                `UPDATE transactions 
                 SET status = 'rejected', 
                     description = CONCAT(COALESCE(description, ''), ' | Rejected by admin: ', ?) 
                 WHERE id = ?`,
                [admin_notes || 'No reason provided', log.transaction_id]
            );
            
            console.log(`[ADMIN] Rejected withdrawal: tx=${log.transaction_id}, admin=${req.user.id}`);
            
        } else {
            const [remainingSteps] = await conn.execute(`
                SELECT COUNT(*) as count 
                FROM transaction_step_logs 
                WHERE transaction_id = ? AND status != 'completed'
            `, [log.transaction_id]);

            if (remainingSteps[0].count === 0) {
                await conn.execute(
                    'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
                    [log.amount, log.user_id]
                );
                
                await conn.execute(
                    `UPDATE transactions 
                     SET status = 'completed', withdrawal_step = ? 
                     WHERE id = ?`,
                    [log.step_number, log.transaction_id]
                );

                try {
                    const [[user]] = await conn.execute(
                        'SELECT email, first_name, phone FROM users WHERE id = ?',
                        [log.user_id]
                    );
                    await sendAlerts(
                        { id: log.user_id, email: user.email, first_name: user.first_name, phone: user.phone },
                        'withdrawal',
                        log.amount,
                        'Withdrawal approved and completed by admin'
                    );
                } catch (e) {
                    console.warn('Approval alert failed:', e.message);
                }
                
                console.log(`[ADMIN] Approved and finalized: tx=${log.transaction_id}`);
                
            } else {
                const [nextStep] = await conn.execute(`
                    SELECT step_number FROM transaction_step_logs 
                    WHERE transaction_id = ? AND status != 'completed'
                    ORDER BY step_number ASC LIMIT 1
                `, [log.transaction_id]);

                if (nextStep.length > 0) {
                    await conn.execute(
                        `UPDATE transactions SET withdrawal_step = ? WHERE id = ?`,
                        [nextStep[0].step_number, log.transaction_id]
                    );
                }
                
                console.log(`[ADMIN] Approved, moved to next step: tx=${log.transaction_id}`);
            }
        }

        await conn.commit();
        req.flash('success', `Step ${action === 'approve' ? 'approved' : 'rejected'} successfully`);
        res.redirect('/admin/pending-reviews');

    } catch (error) {
        await conn.rollback();
        console.error('[ADMIN] Review step error:', error);
        req.flash('error', error.message || 'Failed to process review');
        res.redirect('/admin/pending-reviews');
    } finally {
        conn.release();
    }
};

// ─── Notifications ────────────────────────────────────────────────────────────

exports.getNotificationsPage = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, first_name, last_name, email FROM users WHERE is_admin = FALSE ORDER BY first_name ASC`
    );

    const [notifications] = await pool.execute(
      `SELECT n.*, 
              COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'All Users') AS recipient_name
       FROM notifications n
       LEFT JOIN users u ON n.user_id = u.id
       ORDER BY n.created_at DESC
       LIMIT 50`
    );

    res.render('admin/notifications', {
      title: 'Notifications',
      users,
      notifications,
      success_msg: req.flash('success'),
      error_msg:   req.flash('error'),
    });
  } catch (error) {
    console.error('Admin notifications page error:', error);
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
      `INSERT INTO notifications (user_id, title, message, type) VALUES (NULL, ?, ?, 'general')`,
      [title, message]
    );

    req.flash('success', 'General notification sent to all users.');
    res.redirect('/admin/notifications');
  } catch (error) {
    console.error('Send general notification error:', error);
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
      `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'personal')`,
      [user_id, title, message]
    );

    req.flash('success', 'Personal notification sent successfully.');
    res.redirect('/admin/notifications');
  } catch (error) {
    console.error('Send personal notification error:', error);
    req.flash('error', 'Failed to send notification.');
    res.redirect('/admin/notifications');
  }
};

exports.deleteNotification = async (req, res) => {
  const { id } = req.params;

  try {
    await pool.execute(`DELETE FROM notifications WHERE id = ?`, [id]);
    req.flash('success', 'Notification deleted.');
  } catch (error) {
    console.error('Delete notification error:', error);
    req.flash('error', 'Could not delete notification.');
  }

  res.redirect('/admin/notifications');
};

// ─── Transaction Editing ──────────────────────────────────────────────────────

exports.getEditTransaction = async (req, res) => {
    const { transactionId } = req.params;

    try {
        const [transactions] = await pool.execute(
            `SELECT t.*, u.first_name, u.last_name, u.email
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             WHERE t.id = ?`,
            [transactionId]
        );

        if (!transactions.length) {
            req.flash('error', 'Transaction not found');
            return res.redirect('/admin/transactions');
        }

        res.render('admin/edit-transaction', {
            title: 'Edit Transaction',
            transaction: transactions[0],
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error('Edit transaction page error:', error);
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
            `UPDATE transactions 
             SET created_at  = ?,
                 description = ?,
                 amount      = ?,
                 status      = ?
             WHERE id = ?`,
            [created_at, description, parseFloat(amount), status, transactionId]
        );

        req.flash('success', 'Transaction updated successfully.');
        res.redirect(`/admin/transactions/${transactionId}/edit`);
    } catch (error) {
        console.error('Edit transaction error:', error);
        req.flash('error', 'Failed to update transaction.');
        res.redirect(`/admin/transactions/${transactionId}/edit`);
    }
};