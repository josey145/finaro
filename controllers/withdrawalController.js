// const pool = require('../config/database');
// const bcrypt = require('bcryptjs');
// // const { sendAlerts, sendWithdrawalCode } = require('../utils/notifications');




// // ─── Helper: Safe JSON Parse ─────────────────────────────────────────────────
// function safeJsonParse(value, defaultValue = null) {
//     if (value === null || value === undefined) return defaultValue;
//     if (typeof value === 'object') return value;
//     if (typeof value !== 'string') return defaultValue;
//     try {
//         return JSON.parse(value);
//     } catch (e) {
//         if (value === '[object Object]') return {};
//         return defaultValue;
//     }
// }

// // ─── Helper: Generate OTP Code ───────────────────────────────────────────────
// function generateWithdrawalCode() {
//     return Math.floor(100000 + Math.random() * 900000).toString();
// }

// // ─── GET Withdrawal Steps Page ───────────────────────────────────────────────
// exports.getWithdrawSteps = async (req, res) => {
//     const { transactionId } = req.params;

//     try {
//         const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

//         const [transactions] = await pool.execute(
//             'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
//             [transactionId, req.user.id]
//         );

//         if (transactions.length === 0) return res.redirect('/user/withdraw');

//         const transaction = transactions[0];

//         if (transaction.status === 'completed' || transaction.status === 'rejected') {
//             return res.redirect('/user/dashboard');
//         }

//         const currentStepNum = transaction.withdrawal_step || 1;

//         const [[stepConfig]] = await pool.execute(
//             'SELECT * FROM withdrawal_step_configs WHERE step_number = ? AND is_active = TRUE',
//             [currentStepNum]
//         );

//         if (!stepConfig) return res.redirect('/user/dashboard');

//         const [stepLogs] = await pool.execute(
//             `SELECT * FROM transaction_step_logs WHERE transaction_id = ? ORDER BY step_number ASC`,
//             [transactionId]
//         );

//         const validationRules = safeJsonParse(stepConfig.validation_rules, {});
//         const rejectionReasons = safeJsonParse(stepConfig.rejection_reasons, []);

//         const formattedAmount = await formatMoney(transaction.amount || 0, currency);

//         res.render('user/withdraw-steps', {
//             title: `${stepConfig.step_name} - Step ${currentStepNum}`,
//             transaction,
//             formattedAmount,
//             stepConfig,
//             stepLogs,
//             currentStep: currentStepNum,
//             totalSteps: 4,
//             validationRules,
//             rejectionReasons,
//             currency,
//             symbol,
//             lang,
//             theme,
//         });
//     } catch (error) {
//         console.error('Withdraw steps error:', error);
//         res.redirect('/user/withdraw');
//     }
// };

// // ─── POST Submit Withdrawal Step ──────────────────────────────────────────────
// exports.submitWithdrawStep = async (req, res) => {
//     const { transactionId } = req.params;
//     const { stepData, otp_code } = req.body;

//     // Get document from multer upload OR body
//     const document_url = req.file
//         ? `/uploads/withdrawals/${req.file.filename}`
//         : (req.body.document_url || null);

//     console.log('📎 File:', req.file);
//     console.log('🔗 Document URL:', document_url);

//     const conn = await pool.getConnection();
//     try {
//         await conn.beginTransaction();

//         // ── 1. Get transaction ──────────────────────────────────────────
//         const [transactions] = await conn.execute(
//             'SELECT * FROM transactions WHERE id = ? AND user_id = ? FOR UPDATE',
//             [transactionId, req.user.id]
//         );

//         if (transactions.length === 0) throw new Error('Transaction not found');

//         const transaction = transactions[0];
//         const currentStep = transaction.withdrawal_step || 1;

//         // ── 2. Get step config ──────────────────────────────────────────
//         const [[stepConfig]] = await conn.execute(
//             'SELECT * FROM withdrawal_step_configs WHERE step_number = ? AND is_active = TRUE',
//             [currentStep]
//         );

//         if (!stepConfig) throw new Error('Step configuration not found');

//         const validationRules = safeJsonParse(stepConfig.validation_rules, {});

//         // ── 3. Validate step ────────────────────────────────────────────
//         let isValid = false;
//         let submittedData = {};

//         switch (stepConfig.step_code) {
//             case 'KYC_VERIFY':
//             case 'TAX_DOC':
//                 if (!document_url) throw new Error('Document upload required');
//                 submittedData = { document_url, uploaded_at: new Date() };
//                 isValid = true;
//                 break;

//             case 'OTP_CONFIRM':
//                 if (!otp_code) throw new Error('OTP code required');
//                 const [[otpLog]] = await conn.execute(
//                     `SELECT submitted_data FROM transaction_step_logs 
//                      WHERE transaction_id = ? AND step_code = 'OTP_CONFIRM'`,
//                     [transactionId]
//                 );
//                 const storedData = safeJsonParse(otpLog?.submitted_data, {});
//                 const validOtp = await bcrypt.compare(otp_code, storedData.otp_code || '');
//                 if (!validOtp) throw new Error('Invalid OTP code');
//                 submittedData = { verified: true, verified_at: new Date() };
//                 isValid = true;
//                 break;

//             case 'ADMIN_APPROVE':
//                 submittedData = { submitted_for_review: true, submitted_at: new Date() };
//                 isValid = true;
//                 break;

//             default:
//                 submittedData = stepData || {};
//                 isValid = true;
//         }

//         // ── 4. Mark current step complete ───────────────────────────────
//         await conn.execute(
//             `UPDATE transaction_step_logs 
//              SET status = ?, submitted_data = ?, completed_at = NOW() 
//              WHERE transaction_id = ? AND step_number = ?`,
//             [isValid ? 'completed' : 'pending', JSON.stringify(submittedData), transactionId, currentStep]
//         );

//         // ── 5. Find next uncompleted step ─────────────────────────────
//         const [allLogs] = await conn.execute(
//             `SELECT tsl.step_number, tsl.status, wsc.step_code, wsc.step_name, wsc.description
//              FROM transaction_step_logs tsl
//              JOIN withdrawal_step_configs wsc ON tsl.step_code = wsc.step_code
//              WHERE tsl.transaction_id = ?
//              ORDER BY tsl.step_number ASC`,
//             [transactionId]
//         );

//         const nextLog = allLogs.find(log => log.status !== 'completed');

//         // ── 6. All steps done → finalize ──────────────────────────────
//         if (!nextLog) {
//             await conn.execute(
//                 'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
//                 [transaction.amount, req.user.id]
//             );
//             await conn.execute(
//                 `UPDATE transactions SET withdrawal_step = 4, status = 'completed' WHERE id = ?`,
//                 [transactionId]
//             );
//             try {
//                 await sendAlerts(req.user, 'withdrawal', transaction.amount, transaction.description);
//             } catch (e) { console.warn('Alert failed:', e.message); }

//             await conn.commit();
//             return res.json({
//                 success: true,
//                 completed: true,
//                 message: 'Withdrawal completed successfully',
//                 redirect: '/user/dashboard'
//             });
//         }

//         // ── 7. Move to next step ──────────────────────────────────────
//         await conn.execute(
//             `UPDATE transactions SET withdrawal_step = ? WHERE id = ?`,
//             [nextLog.step_number, transactionId]
//         );

//         if (nextLog.step_code === 'ADMIN_APPROVE') {
//             await conn.execute(
//                 `UPDATE transaction_step_logs SET status = 'pending', submitted_data = ? 
//                  WHERE transaction_id = ? AND step_number = ?`,
//                 [JSON.stringify({ waiting_for_admin: true }), transactionId, nextLog.step_number]
//             );

//             await conn.commit();
//             return res.json({
//                 success: true,
//                 completed: false,
//                 requiresAdmin: true,
//                 message: 'Submitted for administrative review',
//                 nextStep: nextLog.step_number,
//                 stepName: nextLog.step_name,
//                 stepCode: nextLog.step_code,
//                 redirect: `/user/withdraw/steps/${transactionId}`
//             });
//         }

//         await conn.commit();
//         res.json({
//             success: true,
//             completed: false,
//             nextStep: nextLog.step_number,
//             stepName: nextLog.step_name,
//             stepCode: nextLog.step_code,
//             redirect: `/user/withdraw/steps/${transactionId}`
//         });

//     } catch (error) {
//         await conn.rollback();
//         console.error('❌ Submit step error:', error);
//         res.status(400).json({ success: false, message: error.message || 'Step processing failed' });
//     } finally {
//         conn.release();
//     }
// };

// // ─── GET Withdrawal Page ─────────────────────────────────────────────────────
// exports.getWithdraw = async (req, res) => {
//     try {
//         const { lang, currency, theme, symbol } = await applyUserPrefs(req, res);

//         const [accounts] = await pool.execute(
//             'SELECT * FROM accounts WHERE user_id = ? AND status = "active"',
//             [req.user.id]
//         );

//         let activeAccount = accounts.find(a => a.id == req.session?.activeAccountId);
//         if (!activeAccount) {
//             activeAccount = accounts.find(a => a.account_type === 'checking') || accounts[0];
//         }

//         const displayBalance = await formatMoney(activeAccount?.balance || 0, currency);

//         for (let acc of accounts) {
//             acc.displayBalance = await formatMoney(acc.balance, currency);
//         }

//         const dailyLimit = await formatMoney(5000, currency);
//         const perTransaction = await formatMoney(2500, currency);
//         const monthlyLimit = await formatMoney(50000, currency);

//         const [[kycDoc]] = await pool.execute(
//             'SELECT status FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
//             [req.user.id]
//         );

//         const kycApproved = kycDoc?.status === 'approved';

//         const [settings] = await pool.execute(
//             "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
//         );
//         const stepsRequired = settings[0]?.setting_value === 'true' && req.user.withdrawal_steps_required;

//         res.render('user/withdraw', {
//             title: 'Withdraw Funds',
//             user: req.user,
//             balance: activeAccount?.balance || 0,
//             displayBalance,
//             activeAccount,
//             account: activeAccount,
//             accounts,
//             kycApproved,
//             kycStatus: kycDoc?.status || 'not_submitted',
//             stepsRequired,
//             currency,
//             symbol,
//             lang,
//             theme,
//             dailyLimit,
//             perTransaction,
//             monthlyLimit,
//         });

//     } catch (error) {
//         console.error('Withdraw page error:', error);
//         req.flash('error', 'Failed to load withdraw page');
//         res.redirect('/user/dashboard');
//     }
// };

// // ─── POST Initiate Withdrawal ────────────────────────────────────────────────
// exports.initiateWithdrawal = async (req, res) => {
//     const { amount, recipient_account, description } = req.body;
//     const safeDescription = description || null;
//     const safeRecipient = recipient_account || null;

//     try {
//         // Check balance
//         const [accounts] = await pool.execute(
//             'SELECT balance FROM accounts WHERE user_id = ?',
//             [req.user.id]
//         );

//         if (!accounts.length || parseFloat(accounts[0].balance) < parseFloat(amount)) {
//             return res.status(400).json({ success: false, message: 'Insufficient balance' });
//         }

//         // Check if steps required
//         const [settings] = await pool.execute(
//             "SELECT setting_value FROM settings WHERE setting_key = 'global_withdrawal_steps_required'"
//         );
//         const stepsRequired = settings[0]?.setting_value === 'true' && req.user.withdrawal_steps_required;

//         if (stepsRequired) {
//             // Check KYC status
//             const [[kycDoc]] = await pool.execute(
//                 'SELECT status FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
//                 [req.user.id]
//             );
//             const kycApproved = kycDoc?.status === 'approved';

//             // Get all active steps
//             const [stepConfigs] = await pool.execute(
//                 'SELECT * FROM withdrawal_step_configs WHERE is_active = TRUE ORDER BY step_number ASC'
//             );

//             // Filter out KYC if already verified
//             let filteredSteps = stepConfigs.filter(step => {
//                 if (step.step_code === 'KYC_VERIFY' && kycApproved) return false;
//                 return true;
//             });

//             // Edge case: all steps filtered out
//             if (filteredSteps.length === 0) {
//                 await pool.execute(
//                     'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
//                     [amount, req.user.id]
//                 );
//                 await pool.execute(
//                     `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account, withdrawal_step)
//                      VALUES (?, 'withdrawal', ?, 'completed', ?, ?, 4)`,
//                     [req.user.id, amount, safeDescription, safeRecipient]
//                 );
//                 return res.json({ success: true, message: 'Withdrawal processed successfully' });
//             }

//             // Create transaction starting at first non-skipped step
//             const [result] = await pool.execute(
//                 `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account, withdrawal_step, completed_steps)
//                  VALUES (?, 'withdrawal', ?, 'pending', ?, ?, ?, '[]')`,
//                 [req.user.id, amount, safeDescription, safeRecipient, filteredSteps[0].step_number]
//             );

//             const transactionId = result.insertId;

//             // Initialize ALL step logs
//             for (const step of stepConfigs) {
//                 const isSkippedKyc = (step.step_code === 'KYC_VERIFY' && kycApproved);
//                 await pool.execute(
//                     `INSERT INTO transaction_step_logs (transaction_id, step_number, step_code, status)
//                      VALUES (?, ?, ?, ?)`,
//                     [transactionId, step.step_number, step.step_code, isSkippedKyc ? 'completed' : 'pending']
//                 );
//             }

//             // Auto-complete KYC log
//             if (kycApproved) {
//                 await pool.execute(
//                     `UPDATE transaction_step_logs 
//                      SET status = 'completed', completed_at = NOW(), submitted_data = ?
//                      WHERE transaction_id = ? AND step_code = 'KYC_VERIFY'`,
//                     [JSON.stringify({ skipped: true, reason: 'KYC already verified' }), transactionId]
//                 );
//             }

//             const firstActiveStep = filteredSteps[0];

//             // Auto-send OTP if first step needs it
//             if (firstActiveStep?.step_code === 'OTP_CONFIRM') {
//                 const otp = generateWithdrawalCode();
//                 await sendWithdrawalCode(req.user.email, otp, req.user.first_name);
//                 await pool.execute(
//                     `UPDATE transaction_step_logs SET submitted_data = ? WHERE transaction_id = ? AND step_number = ?`,
//                     [JSON.stringify({ otp_sent: true, otp_code: await bcrypt.hash(otp, 10) }), transactionId, firstActiveStep.step_number]
//                 );
//             }

//             return res.json({
//                 success: true,
//                 requiresSteps: true,
//                 transactionId,
//                 currentStep: firstActiveStep?.step_number || 1,
//                 stepName: firstActiveStep?.step_name,
//                 stepCode: firstActiveStep?.step_code,
//                 stepDescription: firstActiveStep?.description,
//                 redirect: `/user/withdraw/steps/${transactionId}`
//             });
//         }

//         // Direct completion (no steps)
//         await pool.execute(
//             'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
//             [amount, req.user.id]
//         );
//         await pool.execute(
//             `INSERT INTO transactions (user_id, type, amount, status, description, recipient_account, withdrawal_step)
//              VALUES (?, 'withdrawal', ?, 'completed', ?, ?, 4)`,
//             [req.user.id, amount, safeDescription, safeRecipient]
//         );

//         res.json({ success: true, message: 'Withdrawal processed successfully' });

//     } catch (error) {
//         console.error('Withdrawal error:', error);
//         res.status(500).json({ success: false, message: 'Withdrawal failed' });
//     }
// };

// // ─── POST Request Withdrawal Code ────────────────────────────────────────────
// exports.requestWithdrawalCode = async (req, res) => {
//     try {
//         const code = generateWithdrawalCode();
//         const hashedCode = await bcrypt.hash(code, 10);
//         const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

//         await pool.execute(
//             'UPDATE withdrawal_codes SET is_used = TRUE WHERE user_id = ?',
//             [req.user.id]
//         );
//         await pool.execute(
//             'INSERT INTO withdrawal_codes (user_id, code, expires_at) VALUES (?, ?, ?)',
//             [req.user.id, hashedCode, expiresAt]
//         );
//         await sendWithdrawalCode(req.user.email, code, req.user.first_name);

//         res.json({ success: true, message: 'Code sent to your email' });
//     } catch (error) {
//         console.error('Withdrawal code error:', error);
//         res.status(500).json({ success: false, message: 'Failed to send code' });
//     }
// };