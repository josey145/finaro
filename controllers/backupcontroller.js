const pool = require('../config/database');
const { formatCurrency, generateWithdrawalCode } = require('../utils/helpers');
const { sendWithdrawalCode, sendTransactionEmail } = require('../utils/email');
const { formatMoney, getSymbol } = require('../utils/currencyConverter');
const { sendSMS } = require('../utils/sms');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ─── Helper: Load user preferences ───────────────────────────────────────────
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
            
            const symbols = { 
                USD: '$', EUR: '€', GBP: '£', JPY: '¥', MYR: 'RM', NGN: '₦',
                CAD: 'C$', AUD: 'A$', SGD: 'S$', HKD: 'HK$', KRW: '₩',
                INR: '₹', CNY: '¥', CHF: 'Fr', SEK: 'kr', NOK: 'kr'
            };
            const symbol = symbols[currency] || currency + ' ';

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

// ─── Internal helper: fetch & apply prefs to res.locals ──────────────────────
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
            currency,
            symbol,
            lang,
            theme,
            dailyLimit,
            perTransaction,
            monthlyLimit,
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

// ═══════════════════════════════════════════════════════════════════════════════
// FIXED: initiateWithdrawal — KYC bypass removed, always goes through steps
// ═══════════════════════════════════════════════════════════════════════════════

exports.initiateWithdrawal = async (req, res) => {
    const { amount, recipient_account, description } = req.body;
    const safeDescription = description || null;
    const safeRecipient = recipient_account || null;

    try {
        // ── 1. Check balance ────────────────────────────────────────────────
        const [accounts] = await pool.execute(
            'SELECT balance FROM accounts WHERE user_id = ?',
            [req.user.id]
        );

        if (!accounts.length) {
            return res.status(400).json({ success: false, message: 'No account found' });
        }

        if (parseFloat(accounts[0].balance) < parseFloat(amount)) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }

        // ── 2. Check if steps are required ──────────────────────────────────
        const [settings] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
        );
        const stepsRequired = settings[0]?.setting_value === 'true' && req.user.withdrawal_steps_required;

        // ── 3. Multi-step withdrawal path ───────────────────────────────────
        if (stepsRequired) {
            const [[kycDoc]] = await pool.execute(
                'SELECT status FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
                [req.user.id]
            );
            const kycApproved = kycDoc?.status === 'approved';

            const [stepConfigs] = await pool.execute(
                'SELECT * FROM withdrawal_step_configs WHERE is_active = TRUE ORDER BY step_number ASC'
            );

            // Filter out KYC_VERIFY if already approved
            let filteredSteps = stepConfigs.filter(step => {
                if (step.step_code === 'KYC_VERIFY' && kycApproved) return false;
                return true;
            });

            if (filteredSteps.length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Withdrawal step configuration error. No active steps found.' 
                });
            }

            // Create transaction with FIRST active step (always pending)
            const [result] = await pool.execute(
                `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account, withdrawal_step, completed_steps)
                 VALUES (?, 'withdrawal', ?, 'pending', ?, ?, ?, '[]')`,
                [req.user.id, amount, safeDescription, safeRecipient, filteredSteps[0].step_number]
            );

            const transactionId = result.insertId;

            // Initialize step logs for ALL original steps
            for (const step of stepConfigs) {
                const isKycSkipped = step.step_code === 'KYC_VERIFY' && kycApproved;
                await pool.execute(
                    `INSERT INTO transaction_step_logs (transaction_id, step_number, step_code, status)
                     VALUES (?, ?, ?, ?)`,
                    [transactionId, step.step_number, step.step_code, 
                     isKycSkipped ? 'completed' : 'pending']
                );
            }

            // Auto-complete KYC log if verified
            if (kycApproved) {
                await pool.execute(
                    `UPDATE transaction_step_logs 
                     SET status = 'completed', completed_at = NOW(), submitted_data = ?
                     WHERE transaction_id = ? AND step_code = 'KYC_VERIFY'`,
                    [JSON.stringify({ skipped: true, reason: 'KYC already verified' }), transactionId]
                );
            }

            const firstActiveStep = filteredSteps[0];

            // 🔒 SECURITY: Generate nonce for first active step
            const stepNonce = require('crypto').randomBytes(32).toString('hex');
            await pool.execute(
                `UPDATE transaction_step_logs 
                 SET submitted_data = ? 
                 WHERE transaction_id = ? AND step_number = ?`,
                [JSON.stringify({ 
                    step_nonce: stepNonce, 
                    step_number: firstActiveStep.step_number,
                    created_at: new Date().toISOString()
                }), transactionId, firstActiveStep.step_number]
            );

            return res.json({
                success: true,
                requiresSteps: true,
                transactionId: transactionId,
                currentStep: firstActiveStep.step_number,
                stepName: firstActiveStep.step_name,
                stepCode: firstActiveStep.step_code,
                stepDescription: firstActiveStep.description,
                redirect: `/user/withdraw/steps/${transactionId}`
            });
        }

        // ── 4. Direct completion (no steps required) ────────────────────────
        await pool.execute(
            'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
            [amount, req.user.id]
        );

        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account, withdrawal_step)
             VALUES (?, 'withdrawal', ?, 'completed', ?, ?, 4)`,
            [req.user.id, amount, safeDescription, safeRecipient]
        );

        await sendAlerts(req.user, 'withdrawal', amount, safeDescription || `Withdrawal to ${safeRecipient || 'recipient'}`);

        res.json({ success: true, message: 'Withdrawal processed successfully' });

    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Withdrawal failed' });
    }
};


// ═══════════════════════════════════════════════════════════════════════════════
// FIXED: processWithdrawStep — Better error handling + document_url fix
// ═══════════════════════════════════════════════════════════════════════════════

exports.processWithdrawStep = async (req, res) => {
    const { transactionId } = req.params;
    const { stepData, otp_code, step_nonce } = req.body;
    
    const document_url = req.file ? `/uploads/withdrawals/${req.file.filename}` : req.body.document_url || null;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // ── 1. Lock and get transaction ─────────────────────────────────────
        const [transactions] = await conn.execute(
            'SELECT * FROM transactions WHERE id = ? AND user_id = ? FOR UPDATE',
            [transactionId, req.user.id]
        );

        if (!transactions.length) throw new Error('Transaction not found');
        
        const transaction = transactions[0];
        if (transaction.status !== 'pending') {
            throw new Error(`Transaction is ${transaction.status}`);
        }

        // 🔒 Check expiry
        const txAge = Date.now() - new Date(transaction.created_at).getTime();
        if (txAge > 24 * 60 * 60 * 1000) {
            await conn.execute(`UPDATE transactions SET status = 'expired' WHERE id = ?`, [transactionId]);
            throw new Error('Withdrawal expired');
        }

        const currentStep = transaction.withdrawal_step || 1;

        // ── 2. Get step config ──────────────────────────────────────────────
        const [[stepConfig]] = await conn.execute(
            'SELECT * FROM withdrawal_step_configs WHERE step_number = ? AND is_active = TRUE',
            [currentStep]
        );
        if (!stepConfig) throw new Error('Step config not found');

        // ── 3. Get current step log ───────────────────────────────────────
        const [[currentLog]] = await conn.execute(
            `SELECT * FROM transaction_step_logs WHERE transaction_id = ? AND step_number = ?`,
            [transactionId, currentStep]
        );
        if (!currentLog) throw new Error('Step log not found');
        if (currentLog.status !== 'pending') throw new Error(`Step already ${currentLog.status}`);

        // ── 4. Parse log data ─────────────────────────────────────────────
        let logData = {};
        try {
            if (typeof currentLog.submitted_data === 'string' && currentLog.submitted_data !== '[object Object]') {
                logData = JSON.parse(currentLog.submitted_data);
            } else if (typeof currentLog.submitted_data === 'object' && currentLog.submitted_data !== null) {
                logData = currentLog.submitted_data;
            }
        } catch (e) { logData = {}; }

        // ── 5. 🔒 VERIFY NONCE ─────────────────────────────────────────────
        if (!step_nonce) throw new Error('Step session missing. Refresh the page.');
        
        const crypto = require('crypto');
        let nonceValid = false;
        try {
            nonceValid = crypto.timingSafeEqual(
                Buffer.from(step_nonce, 'utf8'),
                Buffer.from(logData.step_nonce || '', 'utf8')
            );
        } catch (e) { nonceValid = false; }
        
        if (!nonceValid) throw new Error('Invalid step session. Refresh the page.');

        // ── 6. 🔒 VERIFY PREVIOUS STEPS ───────────────────────────────────
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

        // ── 7. Parse validation rules ─────────────────────────────────────
        let validationRules = {};
        try {
            if (typeof stepConfig.validation_rules === 'string' && stepConfig.validation_rules !== '[object Object]') {
                validationRules = JSON.parse(stepConfig.validation_rules);
            } else if (typeof stepConfig.validation_rules === 'object' && stepConfig.validation_rules !== null) {
                validationRules = stepConfig.validation_rules;
            }
        } catch (e) { validationRules = {}; }

        // ── 8. Process by step_code ───────────────────────────────────────
        let isValid = false;
        let submittedData = {};

        switch (stepConfig.step_code) {

            case 'KYC_VERIFY':
            case 'TAX_DOC':
            case 'ID_UPLOAD':
                if (!document_url) throw new Error('Document upload required');
                submittedData = { 
                    document_url, 
                    uploaded_at: new Date().toISOString(),
                    original_name: req.file?.originalname || null
                };
                isValid = true;
                break;

            // 🔒 ADMIN OTP — admin must set this first
            case 'OTP_CONFIRM': {
                if (!otp_code || otp_code.length < 4) {
                    throw new Error('Enter the OTP code provided by admin');
                }

                // Check admin set an OTP
                if (!logData.admin_otp_code) {
                    throw new Error('No admin OTP set. Contact support.');
                }

                // Check consumed
                if (logData.otp_consumed === true) {
                    throw new Error('OTP already used. Request new code from admin.');
                }

                // Check lockout
                if (logData.otp_locked_until) {
                    const locked = new Date(logData.otp_locked_until);
                    if (locked > new Date()) {
                        const mins = Math.ceil((locked - new Date()) / 60000);
                        throw new Error(`Locked. Contact admin to unlock (${mins} mins left).`);
                    }
                }

                // Verify against admin-set code
                const bcrypt = require('bcryptjs');
                const valid = await bcrypt.compare(otp_code, logData.admin_otp_code);
                
                if (!valid) {
                    const attempts = (logData.otp_attempts || 0) + 1;
                    const remaining = 3 - attempts;
                    
                    logData.otp_attempts = attempts;
                    if (remaining <= 0) {
                        logData.otp_locked_until = new Date(Date.now() + 60 * 60000).toISOString();
                    }
                    
                    await conn.execute(
                        `UPDATE transaction_step_logs SET submitted_data = ? WHERE id = ?`,
                        [JSON.stringify(logData), currentLog.id]
                    );
                    await conn.commit();
                    
                    if (remaining <= 0) {
                        return res.status(400).json({ success: false, message: 'Locked. Contact admin.' });
                    }
                    return res.status(400).json({ 
                        success: false, 
                        message: `Wrong code. ${remaining} try${remaining > 1 ? 's' : ''} left.` 
                    });
                }

                submittedData = { verified: true, verified_at: new Date().toISOString(), otp_consumed: true };
                isValid = true;
                break;
            }

            // 🔒 USER CANNOT COMPLETE ADMIN APPROVAL
            case 'ADMIN_APPROVE':
                throw new Error('This step requires admin review. Please wait.');

            case 'SELFIE_VERIFY':
                if (!document_url) throw new Error('Selfie upload required');
                submittedData = { selfie_url: document_url, uploaded_at: new Date().toISOString() };
                isValid = true;
                break;

            case 'TERMS_ACCEPT':
                if (!stepData || stepData.accepted !== 'true') {
                    throw new Error('Accept terms to proceed');
                }
                submittedData = { accepted: true, accepted_at: new Date().toISOString(), ip: req.ip };
                isValid = true;
                break;

            // 🔒 UNKNOWN STEP = REJECT
            default:
                console.error(`[SECURITY] Unknown step: ${stepConfig.step_code}`);
                throw new Error('Invalid step. Logged.');
        }

        if (!isValid) throw new Error('Validation failed');

        // ── 9. Mark complete ──────────────────────────────────────────────
        submittedData.step_nonce = null; // invalidate for replay protection
        submittedData.completed_at = new Date().toISOString();

        await conn.execute(
            `UPDATE transaction_step_logs SET status = 'completed', submitted_data = ?, completed_at = NOW() WHERE id = ?`,
            [JSON.stringify(submittedData), currentLog.id]
        );

        // ── 10. Find next step ────────────────────────────────────────────
        const [allLogs] = await conn.execute(
            `SELECT tsl.step_number, tsl.status, wsc.step_code, wsc.step_name, wsc.description
             FROM transaction_step_logs tsl
             JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
             WHERE tsl.transaction_id = ? ORDER BY tsl.step_number ASC`,
            [transactionId]
        );

        const nextLog = allLogs.find(log => log.status !== 'completed');

        // ── 11. All done → finalize ───────────────────────────────────────
        if (!nextLog) {
            await conn.execute(
                'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
                [transaction.amount, req.user.id]
            );
            await conn.execute(
                `UPDATE transactions SET status = 'completed', withdrawal_step = ? WHERE id = ?`,
                [currentStep, transactionId]
            );
            try { await sendAlerts(req.user, 'withdrawal', transaction.amount, transaction.description); } 
            catch (e) { console.warn('Alert failed:', e.message); }

            await conn.commit();
            return res.json({ success: true, completed: true, message: 'Done', redirect: '/user/dashboard' });
        }

        // ── 12. Move to next step ─────────────────────────────────────────
        await conn.execute(
            `UPDATE transactions SET withdrawal_step = ? WHERE id = ?`,
            [nextLog.step_number, transactionId]
        );

        // Generate nonce for next step
        const nextNonce = crypto.randomBytes(32).toString('hex');
        const nextData = {
            step_nonce: nextNonce,
            step_number: nextLog.step_number,
            transaction_id: parseInt(transactionId),
            created_at: new Date().toISOString()
        };

        await conn.execute(
            `UPDATE transaction_step_logs SET submitted_data = ? WHERE transaction_id = ? AND step_number = ?`,
            [JSON.stringify(nextData), transactionId, nextLog.step_number]
        );

        // ── 13. Handle ADMIN_APPROVE next ─────────────────────────────────
        if (nextLog.step_code === 'ADMIN_APPROVE') {
            await conn.execute(
                `UPDATE transaction_step_logs SET status = 'pending', submitted_data = ? WHERE transaction_id = ? AND step_number = ?`,
                [JSON.stringify({ waiting_for_admin: true, submitted_at: new Date().toISOString() }), transactionId, nextLog.step_number]
            );
            await conn.commit();
            return res.json({
                success: true, completed: false, requiresAdmin: true,
                message: 'Waiting for admin review', nextStep: nextLog.step_number,
                stepName: nextLog.step_name, stepCode: nextLog.step_code,
                redirect: `/user/withdraw/steps/${transactionId}`
            });
        }

        await conn.commit();
        res.json({
            success: true, completed: false,
            nextStep: nextLog.step_number, stepName: nextLog.step_name, stepCode: nextLog.step_code,
            redirect: `/user/withdraw/steps/${transactionId}`
        });

    } catch (error) {
        await conn.rollback();
        console.error('[SECURITY]', error.message);
        res.status(400).json({ success: false, message: error.message || 'Failed' });
    } finally {
        conn.release();
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD HANDLERS WITH BETTER ERROR MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
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

// ─── ADD THIS to userController.js (before module.exports or anywhere in the file) ───

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