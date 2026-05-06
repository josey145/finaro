const pool = require('../config/database');
const { formatCurrency, generateWithdrawalCode } = require('../utils/helpers');
const { sendWithdrawalCode, sendTransactionEmail } = require('../utils/email');
const { formatMoney, getSymbol, convert } = require('../utils/currencyConverter');
const { sendSMS } = require('../utils/sms');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// --- Helper: Load user preferences -------------------------------------------
async function loadUserPreferences(req, res) {
    res.locals._lang = 'en';
    res.locals._theme = 'light';
    res.locals._currency = 'USD';
    res.locals._symbol = '$';
    res.locals.lang = 'en';
    res.locals.theme = 'light';
    res.locals.currency = 'USD';
    res.locals.currencySymbol = '$';

    if (!req.user || !req.user.id) return;

    try {
        const [[prefs]] = await pool.execute(
            `SELECT preferred_language, preferred_currency, preferred_theme 
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (prefs) {
            const lang = prefs.preferred_language || 'en';
            const currency = prefs.preferred_currency || 'USD';
            const theme = prefs.preferred_theme || 'light';
            
            const symbol = getSymbol(currency);

            res.locals._lang = lang;
            res.locals._theme = theme;
            res.locals._currency = currency;
            res.locals._symbol = symbol;
            res.locals.lang = lang;
            res.locals.theme = theme;
            res.locals.currency = currency;
            res.locals.currencySymbol = symbol;

            req.session.lang = lang;
            req.session.currency = currency;
            req.session.theme = theme;
            
            console.log('Preferences loaded:', { lang, currency, theme, symbol });
        }
    } catch (err) {
        console.error('Preferences load error:', err.message);
    }
}

// --- Internal helper: fetch & apply prefs to res.locals ----------------------
async function applyUserPrefs(req, res) {
    const [[userPrefs]] = await pool.execute(
        `SELECT preferred_language, preferred_currency, preferred_theme 
         FROM users WHERE id = ?`,
        [req.user.id]
    );

    const lang     = userPrefs?.preferred_language || 'en';
    const currency = userPrefs?.preferred_currency || 'USD';
    const theme    = userPrefs?.preferred_theme    || 'light';
    const symbol   = getSymbol(currency);

    res.locals._lang         = lang;
    res.locals._theme        = theme;
    res.locals._currency     = currency;
    res.locals._symbol       = symbol;
    res.locals.lang          = lang;
    res.locals.theme         = theme;
    res.locals.currency      = currency;
    res.locals.currencySymbol = symbol;

    req.session.lang     = lang;
    req.session.currency = currency;
    req.session.theme    = theme;

    return { lang, currency, theme, symbol };
}


exports.getDashboard = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [accounts] = await pool.execute(
            'SELECT * FROM accounts WHERE user_id = ? AND status = "active"',
            [req.user.id]
        );

        let activeAccount = accounts.find(a => a.id == req.session?.activeAccountId);
        if (!activeAccount) {
            activeAccount = accounts.find(a => a.account_type === 'checking') || accounts[0];
        }

        const displayBalance = await formatMoney(activeAccount?.balance || 0, currency);
        
        for (let acc of accounts) {
            acc.displayBalance = await formatMoney(acc.balance, currency);
        }

        const [transactions] = await pool.execute(
            `SELECT * FROM transactions
             WHERE user_id = ? AND (account_id = ? OR account_id IS NULL)
             ORDER BY created_at DESC LIMIT 10`,
            [req.user.id, activeAccount?.id || 0]
        );

        for (let tx of transactions) {
            tx.displayAmount = await formatMoney(tx.amount, currency);
        }

        const [[transactionCount]] = await pool.execute(
            'SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND (account_id = ? OR account_id IS NULL)',
            [req.user.id, activeAccount?.id || 0]
        );

        const [[totalDeposits]] = await pool.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND (account_id = ? OR account_id IS NULL) AND type = 'deposit' AND status = 'completed'",
            [req.user.id, activeAccount?.id || 0]
        );

        const [[totalWithdrawals]] = await pool.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND (account_id = ? OR account_id IS NULL) AND type = 'withdrawal' AND status = 'completed'",
            [req.user.id, activeAccount?.id || 0]
        );

        const stats = {
            total_transactions: transactionCount?.count || 0,
            total_deposits:     await formatMoney(totalDeposits?.total    || 0, currency),
            total_withdrawals:  await formatMoney(totalWithdrawals?.total || 0, currency),
            account_balance:    displayBalance,
        };

        const [[kycRow]] = await pool.execute(
            'SELECT status FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
            [req.user.id]
        );
        const kyc = { status: kycRow?.status || 'not_submitted' };

        res.render('user/dashboard', {
            title: 'Dashboard',
            user: req.user,
            accounts,
            activeAccount,
            account: activeAccount,
            transactions,
            stats,
            kyc,
            displayBalance,
            weeklyLimit: await formatMoney(5000, currency),
            currency,
            symbol,
            lang,
            theme,
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        req.flash('error', 'Failed to load dashboard');
        res.redirect('/');
    }
};

exports.setActiveAccount = async (req, res) => {
    const { account_id } = req.body;
    
    const [accounts] = await pool.execute(
        'SELECT * FROM accounts WHERE id = ? AND user_id = ?',
        [account_id, req.user.id]
    );
    
    if (accounts.length > 0) {
        req.session.activeAccountId = account_id;
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false });
    }
};

exports.getOpenAccount = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [existing] = await pool.execute(
            'SELECT account_type FROM accounts WHERE user_id = ?',
            [req.user.id]
        );
        
        res.render('user/open-account', {
            title:       'Open Account',
            user:        req.user,
            hasChecking: existing.some(a => a.account_type === 'checking'),
            hasSavings:  existing.some(a => a.account_type === 'savings'),
            hasCredit:   existing.some(a => a.account_type === 'credit_builder'),
            currency,
            symbol,
            lang,
            theme,
        });
    } catch (error) {
        console.error('Open account page error:', error);
        req.flash('error', 'Failed to load page');
        res.redirect('/user/dashboard');
    }
};

exports.postOpenAccount = async (req, res) => {
    try {
        const { account_type } = req.body;
        
        const prefix = account_type === 'checking' ? 'CHK' : 
                      account_type === 'savings' ? 'SVG' : 'CRD';
        const accountNumber = `${prefix}-${Date.now()}-${Math.floor(Math.random()*1000)}`;

        await pool.execute(
            'INSERT INTO accounts (user_id, account_type, account_number, balance) VALUES (?, ?, ?, 0.00)',
            [req.user.id, account_type, accountNumber]
        );

        req.flash('success', `${account_type.replace('_', ' ')} account opened successfully!`);
        res.redirect('/user/dashboard');
    } catch (error) {
        console.error('Open account error:', error);
        req.flash('error', 'Failed to open account');
        res.redirect('/user/open-account');
    }
};

exports.getAccountDetails = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        let account;

        if (req.params.id) {
            const [accounts] = await pool.execute(
                'SELECT * FROM accounts WHERE id = ? AND user_id = ?',
                [req.params.id, req.user.id]
            );
            if (!accounts.length) {
                req.flash('error', 'Account not found');
                return res.redirect('/user/dashboard');
            }
            account = accounts[0];
        } else {
            const [accounts] = await pool.execute(
                'SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 LIMIT 1',
                [req.user.id]
            );
            if (!accounts.length) {
                const [anyAccounts] = await pool.execute(
                    'SELECT * FROM accounts WHERE user_id = ? LIMIT 1',
                    [req.user.id]
                );
                if (!anyAccounts.length) {
                    req.flash('error', 'No accounts found');
                    return res.redirect('/user/dashboard');
                }
                account = anyAccounts[0];
            } else {
                account = accounts[0];
            }
        }

        account.displayBalance = await formatMoney(account.balance, currency);

        const [transactions] = await pool.execute(
            'SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 20',
            [account.id]
        );

        for (let tx of transactions) {
            tx.displayAmount = await formatMoney(tx.amount, currency);
        }

        res.render('user/account-details', {
            title: account.account_type === 'checking' ? 'Checking' : 
                   account.account_type === 'savings'  ? 'Savings'  : 'Credit Builder',
            user: req.user,
            account,
            transactions,
            currency,
            symbol,
            lang,
            theme,
        });
    } catch (error) {
        console.error('Account details error:', error);
        res.redirect('/user/dashboard');
    }
};

exports.getMoveMoney = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [accounts] = await pool.execute(
            'SELECT * FROM accounts WHERE user_id = ? AND status = "active"',
            [req.user.id]
        );

        for (let acc of accounts) {
            acc.displayBalance = await formatMoney(acc.balance, currency);
        }

        res.render('user/move-money', {
            title: 'Move Money',
            user: req.user,
            accounts,
            currency,
            symbol,
            lang,
            theme,
        });
    } catch (error) {
        console.error('Move money page error:', error);
        req.flash('error', 'Failed to load page');
        res.redirect('/user/dashboard');
    }
};

exports.postMoveMoney = async (req, res) => {
    const { from_account, to_account, amount } = req.body;
    const amt = parseFloat(amount);
    
    if (from_account === to_account) {
        req.flash('error', 'Cannot transfer to same account');
        return res.redirect('/user/move-money');
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [fromAcc] = await conn.execute(
            'SELECT balance FROM accounts WHERE id = ? AND user_id = ?',
            [from_account, req.user.id]
        );
        
        if (fromAcc[0].balance < amt) {
            throw new Error('Insufficient funds');
        }

        await conn.execute(
            'UPDATE accounts SET balance = balance - ? WHERE id = ?',
            [amt, from_account]
        );

        await conn.execute(
            'UPDATE accounts SET balance = balance + ? WHERE id = ?',
            [amt, to_account]
        );

        await conn.execute(
            `INSERT INTO transactions (user_id, account_id, type, amount, description, status) VALUES (?, ?, 'transfer', ?, ?, 'completed')`,
            [req.user.id, from_account, amt, `Transfer to account ${to_account}`]
        );
        
        await conn.execute(
            `INSERT INTO transactions (user_id, account_id, type, amount, description, status) VALUES (?, ?, 'deposit', ?, ?, 'completed')`,
            [req.user.id, to_account, amt, `Transfer from account ${from_account}`]
        );

        await conn.commit();
        req.flash('success', `Successfully moved $${amt.toFixed(2)}`);
        res.redirect('/user/dashboard');
    } catch (err) {
        await conn.rollback();
        req.flash('error', err.message);
        res.redirect('/user/move-money');
    } finally {
        conn.release();
    }
};

exports.saveTheme = async (req, res) => {
    try {
        const { theme } = req.body;
        const allowed   = ['light', 'dark', 'auto'];
        if (!allowed.includes(theme)) return res.status(400).json({ error: 'Invalid theme' });

        await pool.execute(
            'UPDATE users SET preferred_theme = ? WHERE id = ?',
            [theme, req.user.id]
        );

        res.json({ ok: true, theme });
    } catch (err) {
        console.error('saveTheme error:', err.message);
        res.status(500).json({ error: 'Failed to save theme' });
    }
};

exports.saveLanguage = async (req, res) => {
    try {
        const { lang } = req.body;
        const allowed  = ['en', 'fr', 'de', 'es', 'zh', 'ar', 'ja', 'pt'];
        if (!allowed.includes(lang)) return res.status(400).json({ error: 'Invalid language' });

        await pool.execute(
            'UPDATE users SET preferred_language = ? WHERE id = ?',
            [lang, req.user.id]
        );

        res.json({ ok: true, lang });
    } catch (err) {
        console.error('saveLanguage error:', err.message);
        res.status(500).json({ error: 'Failed to save language' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [[profileUser]] = await pool.execute(
            'SELECT * FROM users WHERE id = ?', [req.user.id]
        );
        const user = profileUser || req.user;

        res.render('user/profile', {
            title: 'My Profile',
            user,
            currency,
            symbol,
            lang,
            theme,
        });
    } catch (err) {
        console.error('Profile page error:', err);
        req.flash('error', 'Failed to load profile');
        res.redirect('/user/dashboard');
    }
};

exports.updateProfile = async (req, res) => {
    const { first_name, last_name, phone, city, country, address } = req.body;

    try {
        await pool.execute(
            `UPDATE users SET
                first_name = ?,
                last_name  = ?,
                phone      = ?,
                city       = ?,
                country    = ?,
                address    = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [first_name, last_name, phone, city, country, address, req.user.id]
        );

        req.flash('success', 'Profile updated successfully');
        res.redirect('/user/profile');
    } catch (error) {
        console.error('Update profile error:', error);
        req.flash('error', 'Failed to update profile');
        res.redirect('/user/profile');
    }
};

exports.getSettings = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [users] = await pool.execute(
            'SELECT * FROM users WHERE id = ?',
            [req.user.id]
        );

        const user = users[0] || req.user;

        res.render('user/settings', {
            title:       'Settings',
            user,
            currency,
            symbol,
            lang,
            theme,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error('Settings page error:', error);
        req.flash('error', 'Failed to load settings');
        res.redirect('/user/dashboard');
    }
};

exports.savePreferences = async (req, res) => {
    const {
        preferred_language,
        preferred_currency,
        preferred_theme,
        notif_email,
        notif_sms,
        notif_push,
    } = req.body;

    console.log('SAVING PREFERENCES:', { preferred_language, preferred_currency, preferred_theme });

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
                notif_email  ? 1 : 0,
                notif_sms    ? 1 : 0,
                notif_push   ? 1 : 0,
                req.user.id,
            ]
        );

        req.session.lang     = preferred_language || 'en';
        req.session.currency = preferred_currency || 'USD';
        req.session.theme    = preferred_theme    || 'light';

        console.log('PREFERENCES SAVED SUCCESSFULLY');

        req.flash('success', 'Preferences saved successfully.');
        res.redirect('/user/settings');
    } catch (error) {
        console.error('Save preferences error:', error);
        req.flash('error', 'Failed to save preferences.');
        res.redirect('/user/settings');
    }
};

exports.changePassword = async (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;

    try {
        if (new_password !== confirm_password) {
            req.flash('error', 'New passwords do not match.');
            return res.redirect('/user/settings#security');
        }

        if (new_password.length < 8) {
            req.flash('error', 'Password must be at least 8 characters.');
            return res.redirect('/user/settings#security');
        }

        const [users] = await pool.execute(
            'SELECT password FROM users WHERE id = ?',
            [req.user.id]
        );

        const valid = await bcrypt.compare(current_password, users[0].password);
        if (!valid) {
            req.flash('error', 'Current password is incorrect.');
            return res.redirect('/user/settings#security');
        }

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.execute(
            'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashed, req.user.id]
        );

        req.flash('success', 'Password changed successfully.');
        res.redirect('/user/settings#security');
    } catch (error) {
        console.error('Change password error:', error);
        req.flash('error', 'Failed to change password.');
        res.redirect('/user/settings#security');
    }
};

exports.changePin = async (req, res) => {
    const { current_pin, new_pin, confirm_pin } = req.body;

    try {
        if (new_pin !== confirm_pin) {
            req.flash('error', 'New PINs do not match.');
            return res.redirect('/user/settings#security');
        }

        if (!/^\d{4}$/.test(new_pin)) {
            req.flash('error', 'PIN must be exactly 4 digits.');
            return res.redirect('/user/settings#security');
        }

        const [users] = await pool.execute(
            'SELECT pin FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!users[0].pin) {
            req.flash('error', 'No PIN set. Please set your PIN first.');
            return res.redirect('/user/settings#security');
        }

        const valid = await bcrypt.compare(current_pin, users[0].pin);
        if (!valid) {
            req.flash('error', 'Current PIN is incorrect.');
            return res.redirect('/user/settings#security');
        }

        const hashed = await bcrypt.hash(new_pin, 12);
        await pool.execute(
            'UPDATE users SET pin = ?, updated_at = NOW() WHERE id = ?',
            [hashed, req.user.id]
        );

        req.flash('success', 'PIN changed successfully.');
        res.redirect('/user/settings#security');
    } catch (error) {
        console.error('Change PIN error:', error);
        req.flash('error', 'Failed to change PIN.');
        res.redirect('/user/settings#security');
    }
};

exports.getKYCSubmit = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [docs] = await pool.execute(
            'SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
            [req.user.id]
        );

        res.render('user/kyc-submit', {
            title:     'KYC Verification',
            user:      req.user,
            kycStatus: docs[0] || null,
            currency,
            symbol,
            lang,
            theme,
        });
    } catch (error) {
        console.error('KYC page error:', error);
        res.redirect('/user/dashboard');
    }
};

exports.postKYCSubmit = async (req, res) => {
    const { document_type, document_number } = req.body;
    const file = req.file;

    try {
        if (!file) {
            req.flash('error', 'Please upload a document');
            return res.redirect('/user/kyc-submit');
        }

        await pool.execute(
            `INSERT INTO kyc_documents (user_id, document_type, document_number, file_path, file_name)
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, document_type, document_number, file.path, file.filename]
        );

        await pool.execute(
            "UPDATE users SET kyc_status = 'pending' WHERE id = ?",
            [req.user.id]
        );

        req.flash('success', 'KYC documents submitted for review');
        res.redirect('/user/dashboard');
    } catch (error) {
        console.error('KYC submit error:', error);
        req.flash('error', 'Failed to submit KYC');
        res.redirect('/user/kyc-submit');
    }
};

const getAlertSettings = async () => {
    const [rows] = await pool.execute(
        `SELECT setting_key, setting_value FROM settings
         WHERE setting_key IN ('alert_email_enabled', 'alert_sms_enabled')`
    );
    return rows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});
};

const sendAlerts = async (user, type, amount, description) => {
    try {
        const settings = await getAlertSettings();
        const name     = `${user.first_name} ${user.last_name}`;

        if (settings.alert_email_enabled === 'true') {
            await sendTransactionEmail(user.email, name, type, amount, description);
        }

        if (settings.alert_sms_enabled === 'true' && user.phone) {
            const formatted = parseFloat(amount).toLocaleString('en-US', {
                style: 'currency', currency: 'USD'
            });

            const isCredit = ['deposit', 'admin_credit', 'transfer_in'].includes(type);
            const icon     = isCredit ? '💰' : '💸';
            const verb     = isCredit ? 'credited to' : 'deducted from';

            await sendSMS(
                user.phone,
                `${icon} Finora Bank: ${formatted} has been ${verb} your account. ` +
                `Ref: ${description || type}. ` +
                `If unauthorized, contact support immediately.`
            );
        }
    } catch (err) {
        console.error('Alert error:', err.message);
    }
};

exports.getTransactions = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [transactions] = await pool.execute(
            'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );

        for (let tx of transactions) {
            tx.displayAmount = await formatMoney(tx.amount, currency);
        }

        const [[creditRow]] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) AS total 
             FROM transactions 
             WHERE user_id = ? AND type IN ('deposit', 'admin_credit') AND status = 'completed'`,
            [req.user.id]
        );

        const [[debitRow]] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) AS total 
             FROM transactions 
             WHERE user_id = ? AND type IN ('withdrawal', 'admin_debit') AND status = 'completed'`,
            [req.user.id]
        );

        const totalCreditDisplay = await formatMoney(creditRow?.total || 0, currency);
        const totalDebitDisplay  = await formatMoney(debitRow?.total  || 0, currency);

        res.render('user/transactions', {
            title: 'Transactions',
            user: req.user,
            transactions,
            totalCreditDisplay,
            totalDebitDisplay,
            currency,
            symbol,
            lang,
            theme,
        });

    } catch (error) {
        console.error('Transactions error:', error);
        req.flash('error', 'Failed to load transactions');
        res.redirect('/user/dashboard');
    }
};

exports.getTransfer = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [accounts] = await pool.execute(
            'SELECT * FROM accounts WHERE user_id = ?',
            [req.user.id]
        );

        for (let acc of accounts) {
            acc.displayBalance = await formatMoney(acc.balance, currency);
        }

        const [recentTransfers] = await pool.execute(
            `SELECT * FROM transactions
             WHERE user_id = ? AND type = 'transfer'
             ORDER BY created_at DESC LIMIT 5`,
            [req.user.id]
        );

        for (let tx of recentTransfers) {
            tx.displayAmount = await formatMoney(tx.amount, currency);
        }

        res.render('user/transfer', {
            title:           'Send Money',
            user:            req.user,
            account:         accounts[0] || null,
            accounts,
            recentTransfers,
            formatMoney,
            formatCurrency,
            currency,
            currencySymbol: symbol,
            symbol,
            lang,
            theme,
        });
    } catch (error) {
        console.error('Transfer page error:', error);
        req.flash('error', 'Failed to load transfer page');
        res.redirect('/user/dashboard');
    }
};

exports.postTransfer = async (req, res) => {
    const { recipient_account, amount, description } = req.body;

    try {
        const parsedAmount = parseFloat(amount);

        if (!parsedAmount || parsedAmount <= 0) {
            req.flash('error', 'Please enter a valid amount');
            return res.redirect('/user/transfer');
        }

        const [senderAccounts] = await pool.execute(
            'SELECT id, user_id, account_number, balance FROM accounts WHERE user_id = ? LIMIT 1',
            [req.user.id]
        );

        if (!senderAccounts.length) {
            req.flash('error', 'Your account was not found');
            return res.redirect('/user/transfer');
        }

        const sender = senderAccounts[0];

        if (sender.account_number === recipient_account) {
            req.flash('error', 'You cannot transfer to your own account');
            return res.redirect('/user/transfer');
        }

        if (parseFloat(sender.balance) < parsedAmount) {
            req.flash('error', 'Insufficient balance');
            return res.redirect('/user/transfer');
        }

        const [recipientAccounts] = await pool.execute(
            `SELECT a.id, a.user_id, a.account_number,
                    u.first_name, u.last_name, u.email, u.phone
             FROM accounts a
             JOIN users u ON a.user_id = u.id
             WHERE a.account_number = ?
             LIMIT 1`,
            [recipient_account]
        );

        if (!recipientAccounts.length) {
            req.flash('error', 'Recipient account not found. Please check the account number.');
            return res.redirect('/user/transfer');
        }

        const recipient = recipientAccounts[0];
        const note      = description || null;

        await pool.execute(
            'UPDATE accounts SET balance = balance - ? WHERE id = ?',
            [parsedAmount, sender.id]
        );

        await pool.execute(
            'UPDATE accounts SET balance = balance + ? WHERE id = ?',
            [parsedAmount, recipient.id]
        );

        await pool.execute(
            `INSERT INTO transactions
                (user_id, account_id, type, amount, status, description, recipient_account)
             VALUES (?, ?, 'transfer', ?, 'completed', ?, ?)`,
            [req.user.id, sender.id, parsedAmount, note, recipient.account_number]
        );

        await pool.execute(
            `INSERT INTO transactions
                (user_id, account_id, type, amount, status, description, recipient_account)
             VALUES (?, ?, 'deposit', ?, 'completed', ?, ?)`,
            [recipient.user_id, recipient.id, parsedAmount, note, sender.account_number]
        );

        await sendAlerts(
            req.user,
            'transfer',
            parsedAmount,
            `Transfer to ${recipient.first_name} ${recipient.last_name} (${recipient.account_number})`
        );

        await sendAlerts(
            { 
                first_name: recipient.first_name,
                last_name:  recipient.last_name,
                email:      recipient.email,
                phone:      recipient.phone
            },
            'deposit',
            parsedAmount,
            `Transfer received from ${req.user.first_name} ${req.user.last_name}`
        );

        req.flash('success',
            `$${parsedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ` +
            `sent successfully to ${recipient.first_name} ${recipient.last_name}`
        );
        res.redirect('/user/transfer');

    } catch (error) {
        console.error('Transfer error:', error);
        req.flash('error', 'Transfer failed. Please try again.');
        res.redirect('/user/transfer');
    }
};

exports.lookupAccount = async (req, res) => {
    const { account_number } = req.query;

    try {
        if (!account_number || account_number.trim().length < 5) {
            return res.json({ found: false });
        }

        const [accounts] = await pool.execute(
            `SELECT a.account_number, u.first_name, u.last_name
             FROM accounts a
             JOIN users u ON a.user_id = u.id
             WHERE a.account_number = ? AND a.user_id != ?
             LIMIT 1`,
            [account_number.trim(), req.user.id]
        );

        if (!accounts.length) return res.json({ found: false });

        res.json({
            found:   true,
            name:    `${accounts[0].first_name} ${accounts[0].last_name}`,
            account: accounts[0].account_number,
        });
    } catch (error) {
        console.error('Lookup error:', error);
        res.status(500).json({ found: false });
    }
};

exports.getWithdraw = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [accounts] = await pool.execute(
            'SELECT * FROM accounts WHERE user_id = ? AND status = "active"',
            [req.user.id]
        );

        let activeAccount = accounts.find(a => a.id == req.session?.activeAccountId);
        if (!activeAccount) {
            activeAccount = accounts.find(a => a.account_type === 'checking') || accounts[0];
        }

        const displayBalance = await formatMoney(activeAccount?.balance || 0, currency);
        
        for (let acc of accounts) {
            acc.displayBalance = await formatMoney(acc.balance, currency);
        }

        const dailyLimit      = await formatMoney(5000,  currency);
        const perTransaction  = await formatMoney(2500,  currency);
        const monthlyLimit    = await formatMoney(50000, currency);
        const userBalanceInCurrency = await convert(activeAccount?.balance || 0, 'USD', currency);

        const [[kycDoc]] = await pool.execute(
            'SELECT status FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
            [req.user.id]
        );

        const kycApproved = kycDoc?.status === 'approved';

        const [settings] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
        );
        const stepsRequired = settings[0]?.setting_value === 'true' && req.user.withdrawal_steps_required;

        res.render('user/withdraw', {
            title:          'Withdraw Funds',
            user:           req.user,
            balance:        activeAccount?.balance || 0,
            displayBalance,
            activeAccount,
            account:        activeAccount,
            accounts,
            kycApproved,
            kycStatus:      kycDoc?.status || 'not_submitted',
            stepsRequired,
            currency,           // ← already there
            symbol,             // ← already there  
            lang,
            theme,
            dailyLimit,
            perTransaction,
            monthlyLimit,
            userBalanceInCurrency,  // ← ADD THIS — actual balance in user's currency for JS validation
        });

    } catch (error) {
        console.error('Withdraw page error:', error);
        req.flash('error', 'Failed to load withdraw page');
        res.redirect('/user/dashboard');
    }
};

exports.requestWithdrawalCode = async (req, res) => {
    try {
        const code       = generateWithdrawalCode();
        const hashedCode = await bcrypt.hash(code, 10);
        const expiresAt  = new Date(Date.now() + 30 * 60 * 1000);

        await pool.execute(
            'UPDATE withdrawal_codes SET is_used = TRUE WHERE user_id = ?',
            [req.user.id]
        );

        await pool.execute(
            'INSERT INTO withdrawal_codes (user_id, code, expires_at) VALUES (?, ?, ?)',
            [req.user.id, hashedCode, expiresAt]
        );

        await sendWithdrawalCode(req.user.email, code, req.user.first_name);

        res.json({ success: true, message: 'Code sent to your email' });
    } catch (error) {
        console.error('Withdrawal code error:', error);
        res.status(500).json({ success: false, message: 'Failed to send code' });
    }
};

// ===============================================================================
// FIXED: initiateWithdrawal — KYC bypass removed, always goes through steps
// ===============================================================================

exports.initiateWithdrawal = async (req, res) => {
    const { amount, recipient_account, description } = req.body;

    console.log('=== WITHDRAW INITIATE DEBUG ===');
    console.log('Body:', req.body);
    console.log('User:', req.user?.id, 'withdrawal_steps_required:', req.user?.withdrawal_steps_required);

    const safeDescription = description || null;
    const safeRecipient = recipient_account || null;

    try {
        const parsedAmount = parseFloat(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Please enter a valid amount' });
        }

        // ── Get user's preferred currency ──
        const [[userPrefs]] = await pool.execute(
            'SELECT preferred_currency FROM users WHERE id = ?',
            [req.user.id]
        );
        const userCurrency = userPrefs?.preferred_currency || 'USD';

        // ── Convert submitted amount to USD for DB comparison ──
        // If user is in USD already, rate = 1. Otherwise fetch rate.
        let amountInUSD = parsedAmount;
        if (userCurrency !== 'USD') {
            amountInUSD = await convert(parsedAmount, userCurrency, 'USD');
        }

        console.log(`User currency: ${userCurrency}, Input: ${parsedAmount}, USD equivalent: ${amountInUSD}`);

        // ── Check balance (DB is always in USD) ──
        const [accounts] = await pool.execute(
            'SELECT balance FROM accounts WHERE user_id = ?',
            [req.user.id]
        );

        if (!accounts.length) {
            return res.status(400).json({ success: false, message: 'No account found' });
        }

        console.log('Balance (USD):', accounts[0].balance, 'Amount needed (USD):', amountInUSD);

        if (parseFloat(accounts[0].balance) < amountInUSD) {
            // Show error in user's currency
            return res.status(400).json({ 
                success: false, 
                message: 'Insufficient balance' 
            });
        }

        // ── Store amount in USD in DB ──
        const parsedAmountUSD = amountInUSD;

        // ... rest of your existing code unchanged, 
        // but replace all `parsedAmount` with `parsedAmountUSD` from here down
        const [settings] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
        );

        const globalStepsRequired = settings[0]?.setting_value === 'true';
        const userStepsRequired = req.user?.withdrawal_steps_required === 1 || req.user?.withdrawal_steps_required === true;
        const stepsRequired = globalStepsRequired && userStepsRequired;

        if (stepsRequired) {
            const [[kycDoc]] = await pool.execute(
                'SELECT status FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
                [req.user.id]
            );
            const kycApproved = kycDoc?.status === 'approved';

            const [stepConfigs] = await pool.execute(
                'SELECT * FROM withdrawal_step_configs WHERE is_active = TRUE ORDER BY step_number ASC'
            );

            if (!stepConfigs.length) {
                return res.status(400).json({ success: false, message: 'Withdrawal step configuration error.' });
            }

            let filteredSteps = stepConfigs.filter(step => {
                if (step.step_code === 'KYC_VERIFY' && kycApproved) return false;
                return true;
            });

            if (filteredSteps.length === 0) {
                return res.status(400).json({ success: false, message: 'Withdrawal step configuration error.' });
            }

            // ✅ Store USD amount in DB
            const [result] = await pool.execute(
                `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account, withdrawal_step, completed_steps)
                 VALUES (?, 'withdrawal', ?, 'pending', ?, ?, ?, '[]')`,
                [req.user.id, parsedAmountUSD, safeDescription, safeRecipient, filteredSteps[0].step_number]
            );

            const transactionId = result.insertId;
            console.log('Created transaction:', transactionId, 'amount (USD):', parsedAmountUSD);

            // ... rest of your step initialization code unchanged ...
            for (const step of stepConfigs) {
                const isKycSkipped = step.step_code === 'KYC_VERIFY' && kycApproved;
                await pool.execute(
                    `INSERT INTO transaction_step_logs (transaction_id, step_number, step_code, status)
                     VALUES (?, ?, ?, ?)`,
                    [transactionId, step.step_number, step.step_code,
                     isKycSkipped ? 'completed' : 'pending']
                );
            }

            if (kycApproved) {
                await pool.execute(
                    `UPDATE transaction_step_logs 
                     SET status = 'completed', completed_at = NOW(), submitted_data = ?
                     WHERE transaction_id = ? AND step_code = 'KYC_VERIFY'`,
                    [JSON.stringify({ skipped: true, reason: 'KYC already verified' }), transactionId]
                );
            }

            const firstActiveStep = filteredSteps[0];
            const crypto = require('crypto');
            const stepNonce = crypto.randomBytes(32).toString('hex');

            const [[firstLog]] = await pool.execute(
                `SELECT submitted_data FROM transaction_step_logs 
                 WHERE transaction_id = ? AND step_number = ?`,
                [transactionId, firstActiveStep.step_number]
            );

            let firstLogData = {};
            try {
                const raw = firstLog?.submitted_data;
                if (raw && typeof raw === 'string' && raw !== '[object Object]') {
                    firstLogData = JSON.parse(raw);
                } else if (raw && typeof raw === 'object' && raw !== null) {
                    firstLogData = { ...raw };
                }
            } catch (e) { firstLogData = {}; }

            firstLogData.step_nonce  = stepNonce;
            firstLogData.step_number = firstActiveStep.step_number;
            firstLogData.created_at  = new Date().toISOString();

            await pool.execute(
                `UPDATE transaction_step_logs SET submitted_data = ? 
                 WHERE transaction_id = ? AND step_number = ?`,
                [JSON.stringify(firstLogData), transactionId, firstActiveStep.step_number]
            );

            return res.json({
                success: true,
                requiresSteps: true,
                transactionId,
                currentStep: firstActiveStep.step_number,
                stepName: firstActiveStep.step_name,
                stepCode: firstActiveStep.step_code,
                redirect: `/user/withdraw/steps/${transactionId}`
            });
        }

        // Direct completion path
        await pool.execute(
            'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
            [parsedAmountUSD, req.user.id]
        );
        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account)
             VALUES (?, 'withdrawal', ?, 'completed', ?, ?)`,
            [req.user.id, parsedAmountUSD, safeDescription, safeRecipient]
        );

        res.json({ success: true, message: 'Withdrawal processed successfully' });

    } catch (error) {
        console.error('=== WITHDRAWAL CRITICAL ERROR ===', error);
        res.status(500).json({ success: false, message: 'Withdrawal failed: ' + error.message });
    }
};
// ===============================================================================
// FIXED: getWithdrawSteps — Added step count from DB instead of hardcoded 4
// ===============================================================================

exports.getWithdrawSteps = async (req, res) => {
    const { transactionId } = req.params;

    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        // -- 1. Validate transactionId --
        if (!transactionId || transactionId === 'undefined' || transactionId === 'null') {
            console.error('[getWithdrawSteps] Invalid transactionId:', transactionId);
            req.flash('error', 'Invalid withdrawal session');
            return res.redirect('/user/withdraw');
        }

        const txId = parseInt(transactionId);
        if (isNaN(txId) || txId <= 0) {
            console.error('[getWithdrawSteps] NaN transactionId:', transactionId);
            req.flash('error', 'Invalid withdrawal session');
            return res.redirect('/user/withdraw');
        }

        // -- 2. Fetch transaction --
        const [transactions] = await pool.execute(
            'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
            [txId, req.user.id]
        );

        if (transactions.length === 0) {
            console.error('[getWithdrawSteps] Transaction not found:', txId, 'user:', req.user.id);
            req.flash('error', 'Withdrawal not found');
            return res.redirect('/user/withdraw');
        }

        const transaction = transactions[0];

        // -- 3. Check status --
        if (transaction.status === 'completed') {
            req.flash('success', 'Withdrawal already completed');
            return res.redirect('/user/dashboard');
        }
        if (transaction.status === 'rejected') {
            req.flash('error', 'Withdrawal was rejected');
            return res.redirect('/user/dashboard');
        }

        // -- 4. Check 24h expiry --
        const txAge = Date.now() - new Date(transaction.created_at).getTime();
        if (txAge > 24 * 60 * 60 * 1000) {
            await pool.execute(`UPDATE transactions SET status = 'expired' WHERE id = ?`, [txId]);
            req.flash('error', 'Withdrawal expired. Please start a new one.');
            return res.redirect('/user/withdraw');
        }

        const currentStepNum = parseInt(transaction.withdrawal_step) || 1;

        // -- 5. Fetch step config --
        const [[stepConfig]] = await pool.execute(
            'SELECT * FROM withdrawal_step_configs WHERE step_number = ? AND is_active = TRUE',
            [currentStepNum]
        );

        if (!stepConfig) {
            console.error('[getWithdrawSteps] No step config found for step:', currentStepNum);
            req.flash('error', 'Withdrawal configuration error. Contact support.');
            return res.redirect('/user/dashboard');
        }

        // -- 6. Fetch step logs --
        const [stepLogs] = await pool.execute(
            `SELECT * FROM transaction_step_logs WHERE transaction_id = ? ORDER BY step_number ASC`,
            [txId]
        );

        // -- 7. Verify previous steps --
        const previousIncomplete = stepLogs.filter(
            log => log.step_number < currentStepNum && log.status !== 'completed'
        );
        if (previousIncomplete.length > 0) {
            await pool.execute(
                `UPDATE transactions SET withdrawal_step = ? WHERE id = ?`,
                [previousIncomplete[0].step_number, txId]
            );
            return res.redirect(`/user/withdraw/steps/${txId}`);
        }

        // -- 8. Parse validation_rules --
        let validationRules = {
            requires_document: false,
            requires_selfie: false,
            requires_otp: false
        };

        try {
            let raw = stepConfig.validation_rules;
            console.log('[getWithdrawSteps] Raw validation_rules type:', typeof raw, 'value:', raw);

            if (typeof raw === 'string' && raw.trim() !== '' && raw !== '[object Object]') {
                const parsed = JSON.parse(raw);
                validationRules.requires_document = parsed.requires_document === true || parsed.requires_document === 1;
                validationRules.requires_selfie   = parsed.requires_selfie === true || parsed.requires_selfie === 1;
                validationRules.requires_otp      = parsed.requires_otp === true || parsed.requires_otp === 1;
            } else if (typeof raw === 'object' && raw !== null) {
                validationRules.requires_document = raw.requires_document === true || raw.requires_document === 1;
                validationRules.requires_selfie   = raw.requires_selfie === true || raw.requires_selfie === 1;
                validationRules.requires_otp      = raw.requires_otp === true || raw.requires_otp === 1;
            }
        } catch (e) {
            console.error('[getWithdrawSteps] validation_rules parse error:', e.message, 'Raw:', stepConfig.validation_rules);
        }

        console.log('[getWithdrawSteps] Parsed validationRules:', validationRules);

        // -- 9. Parse rejection_reasons --
        let rejectionReasons = [];
        try {
            let raw = stepConfig.rejection_reasons;
            if (typeof raw === 'string' && raw.trim() !== '' && raw !== '[object Object]') {
                rejectionReasons = JSON.parse(raw);
            } else if (Array.isArray(raw)) {
                rejectionReasons = raw;
            } else if (typeof raw === 'object' && raw !== null) {
                rejectionReasons = Object.values(raw);
            }
        } catch (e) {
            console.error('[getWithdrawSteps] rejection_reasons parse error:', e.message);
        }

        // -- 10. Generate or retrieve step nonce --
        // FIXED: Always MERGE nonce into existing data to preserve admin_otp_code
        const currentLog = stepLogs.find(log => log.step_number === currentStepNum);
        let stepNonce = null;

        if (currentLog && currentLog.status === 'pending') {
            let logData = {};
            try {
                const raw = currentLog.submitted_data;
                if (!raw) {
                    logData = {};
                } else if (typeof raw === 'string' && raw !== '[object Object]') {
                    logData = JSON.parse(raw);
                } else if (Buffer.isBuffer(raw)) {
                    logData = JSON.parse(raw.toString('utf8'));
                } else if (typeof raw === 'object' && raw !== null) {
                    logData = { ...raw };
                }
            } catch (e) {
                logData = {};
            }

            if (!logData.step_nonce) {
                stepNonce = require('crypto').randomBytes(32).toString('hex');
                // MERGE: only update nonce fields, keep everything else (e.g. admin_otp_code)
                logData.step_nonce   = stepNonce;
                logData.step_number  = currentStepNum;
                await pool.execute(
                    `UPDATE transaction_step_logs SET submitted_data = ? WHERE id = ?`,
                    [JSON.stringify(logData), currentLog.id]
                );
            } else {
                stepNonce = logData.step_nonce;
            }
        }

     
    // -- 11. Format amount -- 
        const txAmount = parseFloat(transaction.amount) || 0;
        // Convert stored USD amount back to user's display currency
        const formattedAmount = await formatMoney(txAmount, currency);
        // This is correct — formatMoney converts USD→user currency for DISPLAY only

        // -- 12. Get total steps from DB --
        const [activeStepConfigs] = await pool.execute(
            'SELECT COUNT(*) as total FROM withdrawal_step_configs WHERE is_active = TRUE'
        );
        const totalSteps = activeStepConfigs[0]?.total || 4;

        // -- 13. Build safe transaction object --
        const safeTransaction = {
            id: transaction.id,
            amount: txAmount,
            description: transaction.description || '',
            recipient_account: transaction.recipient_account || '',
            status: transaction.status || 'pending',
            created_at: transaction.created_at,
            withdrawal_step: currentStepNum
        };

        // -- 14. Build safe step config --
        const safeStepConfig = {
            step_number: stepConfig.step_number || currentStepNum,
            step_code: stepConfig.step_code || `STEP_${currentStepNum}`,
            step_name: stepConfig.step_name || `Step ${currentStepNum}`,
            description: stepConfig.description || 'Complete this verification step to proceed with your withdrawal.',
            validation_rules: validationRules,
            rejection_reasons: rejectionReasons
        };

        // -- 15. Render --
        console.log('[getWithdrawSteps] Rendering step:', currentStepNum, 'tx:', txId, 'step_code:', safeStepConfig.step_code, 'rules:', validationRules);

        res.render('user/withdraw-steps', {
            title: `${safeStepConfig.step_name} - Step ${currentStepNum}`,
            _transaction: safeTransaction,
            _formattedAmount: formattedAmount,
            _stepConfig: safeStepConfig,
            _stepLogs: stepLogs,
            _currentStep: currentStepNum,
            _totalSteps: totalSteps,
            _validationRules: validationRules,
            _rejectionReasons: rejectionReasons,
            _stepNonce: stepNonce,
            _currency: currency,
            _symbol: symbol,
            _lang: lang,
            _theme: theme,
        });
    } catch (error) {
        console.error('[getWithdrawSteps] CRITICAL ERROR:', error);
        req.flash('error', 'Failed to load withdrawal step');
        res.redirect('/user/withdraw');
    }
};

// ===============================================================================
// FIXED: processWithdrawStep — Merge nonce into next step data (don't overwrite)
// ===============================================================================

exports.processWithdrawStep = async (req, res) => {
    const { transactionId } = req.params;
    const { stepData, otp_code, step_nonce } = req.body;

    const document_url = req.file ? `/uploads/withdrawals/${req.file.filename}` : req.body.document_url || null;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // -- 1. Lock and get transaction -------------------------------------
        const [transactions] = await conn.execute(
            'SELECT * FROM transactions WHERE id = ? AND user_id = ? FOR UPDATE',
            [transactionId, req.user.id]
        );

        if (!transactions.length) throw new Error('Transaction not found');

        const transaction = transactions[0];
        if (transaction.status !== 'pending') {
            throw new Error(`Transaction is ${transaction.status}`);
        }

        // Check expiry
        const txAge = Date.now() - new Date(transaction.created_at).getTime();
        if (txAge > 24 * 60 * 60 * 1000) {
            await conn.execute(`UPDATE transactions SET status = 'expired' WHERE id = ?`, [transactionId]);
            throw new Error('Withdrawal expired');
        }

        const currentStep = transaction.withdrawal_step || 1;

        // -- 2. Get step config ---------------------------------------------
        const [[stepConfig]] = await conn.execute(
            'SELECT * FROM withdrawal_step_configs WHERE step_number = ? AND is_active = TRUE',
            [currentStep]
        );
        if (!stepConfig) throw new Error('Step config not found');

        // -- 3. Get current step log (explicit columns including OTP) -------
        const [[currentLog]] = await conn.execute(
            `SELECT id, transaction_id, step_number, step_code, status, submitted_data,
                    admin_otp_code, otp_consumed, otp_attempts, otp_locked_until, otp_set_at
             FROM transaction_step_logs
             WHERE transaction_id = ? AND step_number = ?`,
            [transactionId, currentStep]
        );
        if (!currentLog) throw new Error('Step log not found');
        if (currentLog.status !== 'pending') throw new Error(`Step already ${currentLog.status}`);

        // -- 4. Parse submitted_data (for nonce only) -----------------------
        let logData = {};
        try {
            const raw = currentLog.submitted_data;
            if (!raw) {
                logData = {};
            } else if (typeof raw === 'string') {
                logData = raw === '[object Object]' ? {} : JSON.parse(raw);
            } else if (Buffer.isBuffer(raw)) {
                logData = JSON.parse(raw.toString('utf8'));
            } else if (typeof raw === 'object') {
                logData = { ...raw };
            } else {
                logData = {};
            }
        } catch (e) {
            console.error('Parse error:', e.message, 'Raw:', currentLog.submitted_data);
            logData = {};
        }

        // -- 5. Verify nonce ------------------------------------------------
        if (!step_nonce) throw new Error('Step session missing. Refresh the page.');

        const crypto = require('crypto');
        let nonceValid = false;
        try {
            nonceValid = crypto.timingSafeEqual(
                Buffer.from(step_nonce,             'utf8'),
                Buffer.from(logData.step_nonce || '', 'utf8')
            );
        } catch (e) { nonceValid = false; }

        if (!nonceValid) throw new Error('Invalid step session. Refresh the page.');

        // -- 6. Verify previous steps are complete --------------------------
        const [previousLogs] = await conn.execute(
            `SELECT tsl.status, wsc.is_required, wsc.step_name
             FROM transaction_step_logs tsl
             JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
             WHERE tsl.transaction_id = ? AND tsl.step_number < ?`,
            [transactionId, currentStep]
        );

        const incomplete = previousLogs.filter(log => log.status !== 'completed' && log.is_required !== 0);
        if (incomplete.length > 0) {
            throw new Error(`Complete previous steps first: ${incomplete.map(l => l.step_name).join(', ')}`);
        }

        // -- 7. Parse validation rules --------------------------------------
        let validationRules = {};
        try {
            if (typeof stepConfig.validation_rules === 'string' && stepConfig.validation_rules !== '[object Object]') {
                validationRules = JSON.parse(stepConfig.validation_rules);
            } else if (typeof stepConfig.validation_rules === 'object' && stepConfig.validation_rules !== null) {
                validationRules = stepConfig.validation_rules;
            }
        } catch (e) { validationRules = {}; }

        // -- 8. Step processing ---------------------------------------------
        let isValid = false;
        let submittedData = {};

        // Admin-only steps — user cannot self-complete
        if (stepConfig.step_code === 'ADMIN_APPROVE' || stepConfig.is_required === 0) {
            throw new Error('This step requires admin review. Please wait.');
        }

        // Document / selfie upload
        if (validationRules.requires_document === true || validationRules.requires_selfie === true) {
            if (!document_url) throw new Error('Document upload required');
            submittedData = { 
                accepted: true, 
                accepted_at: new Date().toISOString(), 
                ip: req.ip,
                notes: stepData || ''
            };
            isValid = true;
        }

        // OTP verification — reads from DB columns, never from submitted_data
        if (validationRules.requires_otp === true) {
            if (!otp_code || otp_code.length < 4) {
                throw new Error('Enter the verification code provided by admin');
            }

            if (!currentLog.admin_otp_code) {
                throw new Error('No verification code set. Contact support.');
            }

            if (currentLog.otp_consumed === 1 || currentLog.otp_consumed === true) {
                throw new Error('Code already used. Contact admin for a new one.');
            }

            if (currentLog.otp_locked_until) {
                const locked = new Date(currentLog.otp_locked_until);
                if (locked > new Date()) {
                    const mins = Math.ceil((locked - new Date()) / 60000);
                    throw new Error(`Too many attempts. Contact admin (${mins} min${mins !== 1 ? 's' : ''} left).`);
                }
            }

            const valid = await bcrypt.compare(otp_code, currentLog.admin_otp_code);

            if (!valid) {
                const attempts  = (currentLog.otp_attempts || 0) + 1;
                const remaining = 3 - attempts;

                await conn.execute(
                    `UPDATE transaction_step_logs
                     SET otp_attempts     = ?,
                         otp_locked_until = ?
                     WHERE id = ?`,
                    [
                        attempts,
                        remaining <= 0 ? new Date(Date.now() + 60 * 60 * 1000) : null,
                        currentLog.id
                    ]
                );
                await conn.commit();

                if (remaining <= 0) {
                    return res.status(400).json({ success: false, message: 'Too many attempts. Contact admin.' });
                }
                return res.status(400).json({
                    success: false,
                    message: `Wrong code. ${remaining} attempt${remaining !== 1 ? 's' : ''} left.`
                });
            }

            // Consume the OTP — one-time use
            await conn.execute(
                `UPDATE transaction_step_logs SET otp_consumed = 1 WHERE id = ?`,
                [currentLog.id]
            );

            submittedData = { verified: true, verified_at: new Date().toISOString() };
            isValid = true;
        }

        // Terms / acknowledgement (no document or OTP required — just checkbox)
        if (!validationRules.requires_document && !validationRules.requires_selfie && !validationRules.requires_otp) {
            if (!stepData || stepData.accepted !== 'true') {
                throw new Error('Please accept the terms to proceed');
            }
            submittedData = { accepted: true, accepted_at: new Date().toISOString(), ip: req.ip };
            isValid = true;
        }

        if (!isValid) throw new Error('Validation failed');

        // -- 9. Mark current step complete ----------------------------------
        submittedData.step_nonce   = null; // invalidate nonce — replay protection
        submittedData.completed_at = new Date().toISOString();

        await conn.execute(
            `UPDATE transaction_step_logs
             SET status = 'completed', submitted_data = ?, completed_at = NOW()
             WHERE id = ?`,
            [JSON.stringify(submittedData), currentLog.id]
        );

        // -- 10. Find next incomplete step ----------------------------------
        const [allLogs] = await conn.execute(
            `SELECT tsl.step_number, tsl.status, wsc.step_code, wsc.step_name, wsc.description, wsc.is_required
             FROM transaction_step_logs tsl
             JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
             WHERE tsl.transaction_id = ?
             ORDER BY tsl.step_number ASC`,
            [transactionId]
        );

        const nextLog = allLogs.find(log => log.status !== 'completed');

        // -- 11. All steps done → finalise withdrawal -----------------------
        if (!nextLog) {
            await conn.execute(
                'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
                [transaction.amount, req.user.id]
            );
            await conn.execute(
                `UPDATE transactions SET status = 'completed', withdrawal_step = ? WHERE id = ?`,
                [currentStep, transactionId]
            );
            try {
                await sendAlerts(req.user, 'withdrawal', transaction.amount, transaction.description);
            } catch (e) {
                console.warn('Alert failed:', e.message);
            }

            await conn.commit();
            return res.json({ success: true, completed: true, message: 'Withdrawal complete', redirect: '/user/dashboard' });
        }

        // -- 12. Advance to next step — write nonce, preserve OTP columns ---
        await conn.execute(
            `UPDATE transactions SET withdrawal_step = ? WHERE id = ?`,
            [nextLog.step_number, transactionId]
        );

        // Read existing submitted_data for next step (keeps whatever is already there)
        const [[nextStepLog]] = await conn.execute(
            `SELECT submitted_data FROM transaction_step_logs
             WHERE transaction_id = ? AND step_number = ?`,
            [transactionId, nextLog.step_number]
        );

        let nextData = {};
        try {
            const raw = nextStepLog?.submitted_data;
            if (!raw) {
                nextData = {};
            } else if (typeof raw === 'string' && raw !== '[object Object]') {
                nextData = JSON.parse(raw);
            } else if (Buffer.isBuffer(raw)) {
                nextData = JSON.parse(raw.toString('utf8'));
            } else if (typeof raw === 'object' && raw !== null) {
                nextData = { ...raw };
            }
        } catch (e) {
            nextData = {};
        }

        // Merge only the nonce fields — never touch OTP columns (they're in DB columns)
        const nextNonce = crypto.randomBytes(32).toString('hex');
        nextData.step_nonce     = nextNonce;
        nextData.step_number    = nextLog.step_number;
        nextData.transaction_id = parseInt(transactionId);
        nextData.created_at     = new Date().toISOString();

        await conn.execute(
            `UPDATE transaction_step_logs SET submitted_data = ?
             WHERE transaction_id = ? AND step_number = ?`,
            [JSON.stringify(nextData), transactionId, nextLog.step_number]
        );

        // -- 13. Next step is admin-review — do NOT overwrite submitted_data
        //        (the nonce write above is enough; admin reads via their own UI)
        if (nextLog.step_code === 'ADMIN_APPROVE' || nextLog.is_required === 0) {
            await conn.commit();
            return res.json({
                success:      true,
                completed:    false,
                requiresAdmin: true,
                message:      'Your request is pending admin review.',
                nextStep:     nextLog.step_number,
                stepName:     nextLog.step_name,
                stepCode:     nextLog.step_code,
                redirect:     `/user/withdraw/steps/${transactionId}`
            });
        }

        await conn.commit();
        res.json({
            success:   true,
            completed: false,
            nextStep:  nextLog.step_number,
            stepName:  nextLog.step_name,
            stepCode:  nextLog.step_code,
            redirect:  `/user/withdraw/steps/${transactionId}`
        });

    } catch (error) {
        await conn.rollback();
        console.error('[processWithdrawStep]', error.message);
        res.status(400).json({ success: false, message: error.message || 'Step failed' });
    } finally {
        conn.release();
    }
};
// ===============================================================================
// MISSING: cancelWithdrawal — Added to fix Route.post() undefined callback error
// ===============================================================================

exports.cancelWithdrawal = async (req, res) => {
    const { transactionId } = req.params;
    const conn = await pool.getConnection();
    
    try {
        await conn.beginTransaction();

        const [transactions] = await conn.execute(
            'SELECT * FROM transactions WHERE id = ? AND user_id = ? AND type = ? AND status = ?',
            [transactionId, req.user.id, 'withdrawal', 'pending']
        );

        if (!transactions.length) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'Withdrawal not found or already processed' });
        }

        await conn.execute(
            `UPDATE transactions SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
            [transactionId]
        );

        await conn.execute(
            `UPDATE transaction_step_logs SET status = 'cancelled', completed_at = NOW() WHERE transaction_id = ?`,
            [transactionId]
        );

        await conn.commit();
        res.json({ success: true, message: 'Withdrawal cancelled successfully' });
    } catch (error) {
        await conn.rollback();
        console.error('Cancel withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Failed to cancel withdrawal' });
    } finally {
        conn.release();
    }
};

// ── Incomplete Withdrawals (for transactions page banner) ──────────────────
exports.getPendingWithdrawals = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [pending] = await pool.execute(
            `SELECT t.id, t.amount, t.status, t.created_at, t.withdrawal_step, t.recipient_account
             FROM transactions t
             WHERE t.user_id = ? AND t.type = 'withdrawal' AND t.status = 'pending'
             ORDER BY t.created_at DESC`,
            [req.user.id]
        );

        for (const tx of pending) {
            tx.displayAmount = await formatMoney(tx.amount, currency);

            const [steps] = await pool.execute(
                `SELECT tsl.step_number, tsl.step_code, tsl.status,
                        wsc.step_name, wsc.validation_rules
                 FROM transaction_step_logs tsl
                 LEFT JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
                 WHERE tsl.transaction_id = ?
                 ORDER BY tsl.step_number ASC`,
                [tx.id]
            );

            tx.steps = steps;
            tx.completedSteps = steps.filter(s => s.status === 'completed').length;
            tx.totalSteps = steps.length;

            // Check if current step needs OTP (user is waiting for admin code)
            const currentStep = steps.find(s => s.status === 'pending');
            tx.currentStepInfo = currentStep || null;
            tx.needsOtp = false;

            if (currentStep) {
                let rules = {};
                try {
                    if (typeof currentStep.validation_rules === 'string') {
                        rules = JSON.parse(currentStep.validation_rules);
                    } else if (typeof currentStep.validation_rules === 'object' && currentStep.validation_rules) {
                        rules = currentStep.validation_rules;
                    }
                } catch (e) { rules = {}; }
                tx.needsOtp = rules.requires_otp === true;
            }
        }

            // Add inside getTransactions, before res.render:
            const [pendingWithdrawals] = await pool.execute(
                `SELECT t.id, t.amount, t.withdrawal_step, t.created_at
                FROM transactions t
                WHERE t.user_id = ? AND t.type = 'withdrawal' AND t.status = 'pending'
                ORDER BY t.created_at DESC LIMIT 5`,
                [req.user.id]
            );
            for (const tx of pendingWithdrawals) {
                tx.displayAmount = await formatMoney(tx.amount, currency);
            }

          

        res.render('user/pending-withdrawals', {
            title: 'Pending Withdrawals',
            user: req.user,
            pendingWithdrawals: pending,
            currency,
            symbol,
            lang,
            theme,
        });

    } catch (error) {
        console.error('getPendingWithdrawals error:', error);
        req.flash('error', 'Failed to load pending withdrawals');
        res.redirect('/user/dashboard');
    }
};

// ── Network Error Page ─────────────────────────────────────────────────────
exports.getNetworkError = async (req, res) => {
    try {
        const { lang, theme, symbol, currency } = await applyUserPrefs(req, res);
        const returnUrl = req.query.return || '/user/dashboard';
        res.render('user/network-error', {
            title: 'Connection Problem',
            user: req.user,
            returnUrl,
            lang,
            theme,
            symbol,
            currency,
        });
    } catch (e) {
        res.render('user/network-error', {
            title: 'Connection Problem',
            user: req.user,
            returnUrl: '/user/dashboard',
            lang: 'en', theme: 'light', symbol: '$', currency: 'USD',
        });
    }
};


// ── Contact Support Page ───────────────────────────────────────────────────
exports.getContactSupport = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const txId  = req.query.tx     || null;
        const reason = req.query.reason || 'general';

        // If a transaction ID is provided, fetch its details so we can pre-fill the form
        let transaction = null;
        if (txId) {
            const [txRows] = await pool.execute(
                `SELECT t.id, t.amount, t.recipient_account, t.withdrawal_step, t.created_at,
                        tsl.step_code, tsl.step_number,
                        wsc.step_name
                 FROM transactions t
                 LEFT JOIN transaction_step_logs tsl 
                       ON tsl.transaction_id = t.id AND tsl.status = 'pending'
                 LEFT JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
                 WHERE t.id = ? AND t.user_id = ?
                 LIMIT 1`,
                [txId, req.user.id]
            );
            if (txRows.length) {
                transaction = txRows[0];
                transaction.displayAmount = await formatMoney(transaction.amount, currency);
            }
        }

        res.render('user/contact-support', {
            title:       'Contact Support',
            user:        req.user,
            transaction,
            reason,
            lang,
            theme,
            symbol,
            currency,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });

    } catch (error) {
        console.error('getContactSupport error:', error);
        req.flash('error', 'Failed to load support page');
        res.redirect('/user/dashboard');
    }
};

// ── Submit Support Request ─────────────────────────────────────────────────
exports.postContactSupport = async (req, res) => {
    const { subject, message, transaction_id, reason } = req.body;

    try {
        if (!subject || !message) {
            req.flash('error', 'Subject and message are required.');
            return res.redirect('/user/contact-support');
        }

        // Save as a notification to admin (reuse notifications table)
        // user_id = NULL means it shows in admin notifications
        await pool.execute(
            `INSERT INTO notifications (user_id, title, message, type, is_read)
             VALUES (NULL, ?, ?, 'support_request', 0)`,
            [
                `[SUPPORT] ${subject} — from ${req.user.first_name} ${req.user.last_name} (User #${req.user.id})`,
                `User: ${req.user.first_name} ${req.user.last_name} | Email: ${req.user.email} | Phone: ${req.user.phone || 'N/A'}\n` +
                (transaction_id ? `Transaction ID: #${transaction_id}\n` : '') +
                (reason ? `Reason: ${reason}\n` : '') +
                `Message: ${message}`
            ]
        );

        // Also email the support team if email alerts are on
        const [settingRows] = await pool.execute(
            `SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('alert_email_enabled', 'support_email')`
        );
        const settings = settingRows.reduce((m, r) => { m[r.setting_key] = r.setting_value; return m; }, {});

        if (settings.alert_email_enabled === 'true') {
            await sendTransactionEmail(
                settings.support_email || 'support@finorabank.com',
                'Support Team',
                'support_request',
                0,
                `From: ${req.user.first_name} ${req.user.last_name} (${req.user.email})\n` +
                (transaction_id ? `Transaction: #${transaction_id}\n` : '') +
                `Subject: ${subject}\n\n${message}`
            );
        }

        // Confirm to the user via SMS if enabled
        const [smsRow] = await pool.execute(
            `SELECT setting_value FROM settings WHERE setting_key = 'alert_sms_enabled'`
        );
        const smsEnabled = smsRow[0]?.setting_value === 'true';
        if (smsEnabled && req.user.phone) {
            await sendSMS(
                req.user.phone,
                `✅ Finora Bank: Your support request has been received. ` +
                `Our team will contact you shortly. ` +
                (transaction_id ? `Ref: Withdrawal #${transaction_id}.` : '')
            );
        }

        req.flash('success', 'Your request has been sent. Our team will contact you shortly.');
        res.redirect(`/user/contact-support${transaction_id ? '?tx=' + transaction_id : ''}`);

    } catch (error) {
        console.error('postContactSupport error:', error);
        req.flash('error', 'Failed to send request. Please try again.');
        res.redirect('/user/contact-support');
    }
};

// ===============================================================================
// FILE UPLOAD HANDLERS WITH BETTER ERROR MANAGEMENT
// ===============================================================================
exports.postDeposit = async (req, res) => {
    const { amount, payment_method, description } = req.body;

    try {
        const parsedAmount = parseFloat(amount);

        if (!parsedAmount || parsedAmount <= 0) {
            req.flash('error', 'Please enter a valid amount');
            return res.redirect('/user/deposit');
        }

        if (parsedAmount > 50000) {
            req.flash('error', 'Maximum deposit amount is $50,000 per transaction');
            return res.redirect('/user/deposit');
        }

        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, status, description, payment_method)
             VALUES (?, 'deposit', ?, 'pending', ?, ?)`,
            [req.user.id, parsedAmount, description || 'Fund deposit', payment_method || 'bank_transfer']
        );

        await sendAlerts(
            req.user,
            'deposit',
            parsedAmount,
            description || 'Deposit request submitted — pending confirmation'
        );

        req.flash('success',
            `Deposit request of $${parsedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ` +
            `submitted. Funds will reflect once confirmed.`
        );
        res.redirect('/user/deposit');

    } catch (error) {
        console.error('Deposit error:', error);
        req.flash('error', 'Failed to process deposit request');
        res.redirect('/user/deposit');
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);
        const userId = req.user.id;

        const [notifications] = await pool.execute(
            `SELECT * FROM notifications
             WHERE user_id = ? OR user_id IS NULL
             ORDER BY created_at DESC`,
            [userId]
        );

        await pool.execute(
            `UPDATE notifications
             SET is_read = 1
             WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0`,
            [userId]
        );

        res.render('user/notifications', {
            title: 'Notifications',
            user:  req.user,
            notifications,
            currency,
            symbol,
            lang,
            theme,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error('Notifications error:', error);
        req.flash('error', 'Failed to load notifications');
        res.redirect('/user/dashboard');
    }
};

exports.getDeposit = async (req, res) => {
    try {
        const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

        const [accounts] = await pool.execute(
            'SELECT * FROM accounts WHERE user_id = ? AND status = "active"',
            [req.user.id]
        );

        for (let acc of accounts) {
            acc.displayBalance = await formatMoney(acc.balance, currency);
        }

        let activeAccount = accounts.find(a => a.id == req.session?.activeAccountId);
        if (!activeAccount) {
            activeAccount = accounts.find(a => a.account_type === 'checking') || accounts[0];
        }

        res.render('user/deposit', {
            title: 'Deposit Funds',
            user: req.user,
            accounts,
            activeAccount,
            account: activeAccount,
            currency,
            symbol,
            lang,
            theme,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });

    } catch (error) {
        console.error('Deposit page error:', error);
        req.flash('error', 'Failed to load deposit page');
        res.redirect('/user/dashboard');
    }
};

exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.id;

        const [[result]] = await pool.execute(
            `SELECT COUNT(*) AS count FROM notifications
             WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0`,
            [userId]
        );

        res.json({ count: result.count });
    } catch (error) {
        console.error('Unread count error:', error);
        res.json({ count: 0 });
    }
};

console.log('=== CONTROLLER EXPORTS AT BOTTOM ===');
console.log('getWithdraw:', typeof exports.getWithdraw);
console.log('getWithdrawSteps:', typeof exports.getWithdrawSteps);
console.log('processWithdrawStep:', typeof exports.processWithdrawStep);
console.log('cancelWithdrawal:', typeof exports.cancelWithdrawal);