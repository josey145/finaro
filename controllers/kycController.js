const pool = require('../config/database');
const fs   = require('fs');
const path = require('path');

// ─── KYC Page ─────────────────────────────────────────────────────────────────

exports.getKYCPage = async (req, res) => {
    try {
        const [docs] = await pool.execute(
            'SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
            [req.user.id]
        );

        res.render('user/kyc-submit', {
            title:     'KYC Verification',
            user:      req.user,
            kycStatus: docs[0] || null,
            success_msg: req.flash('success'),
            error_msg:   req.flash('error'),
        });
    } catch (error) {
        console.error('KYC page error:', error);
        res.redirect('/user/dashboard');
    }
};

// ─── Submit KYC ───────────────────────────────────────────────────────────────

exports.submitKYC = async (req, res) => {
    try {
        const frontFile = req.files?.document_front?.[0];
        const backFile  = req.files?.document_back?.[0];

        if (!frontFile || !backFile) {
            if (frontFile) fs.unlink(frontFile.path, () => {});
            if (backFile)  fs.unlink(backFile.path,  () => {});
            req.flash('error', 'Please upload both front and back of your document');
            return res.redirect('/user/kyc-submit');
        }

        const { document_type, document_number } = req.body;

        if (!document_type || !document_number) {
            fs.unlink(frontFile.path, () => {});
            fs.unlink(backFile.path,  () => {});
            req.flash('error', 'Please select a document type and enter your document number');
            return res.redirect('/user/kyc-submit');
        }

        // Remove old pending submission files if exists
        const [existing] = await pool.execute(
            "SELECT * FROM kyc_documents WHERE user_id = ? AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1",
            [req.user.id]
        );

        if (existing.length > 0) {
            if (existing[0].file_path) {
                const oldFront = path.join(process.cwd(), 'public', existing[0].file_path);
                fs.unlink(oldFront, () => {});
            }
            if (existing[0].file_path_back) {
                const oldBack = path.join(process.cwd(), 'public', existing[0].file_path_back);
                fs.unlink(oldBack, () => {});
            }
        }

        const frontPath = `/uploads/kyc/${frontFile.filename}`;
        const backPath  = `/uploads/kyc/${backFile.filename}`;

        await pool.execute(
            `INSERT INTO kyc_documents 
             (user_id, document_type, document_number, file_path, file_path_back, file_name, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [req.user.id, document_type, document_number, frontPath, backPath, frontFile.filename]
        );

        await pool.execute(
            "UPDATE users SET kyc_status = 'pending' WHERE id = ?",
            [req.user.id]
        );

        req.flash('success', 'KYC documents submitted successfully. We will review them within 1–2 business days.');
        res.redirect('/user/kyc-submit');
    } catch (error) {
        console.error('KYC submit error:', error);
        if (req.files?.document_front?.[0]) fs.unlink(req.files.document_front[0].path, () => {});
        if (req.files?.document_back?.[0])  fs.unlink(req.files.document_back[0].path,  () => {});
        req.flash('error', 'Failed to submit KYC. Please try again.');
        res.redirect('/user/kyc-submit');
    }
};

// ─── KYC Status (API) ─────────────────────────────────────────────────────────

exports.getKYCStatus = async (req, res) => {
    try {
        const [docs] = await pool.execute(
            'SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
            [req.user.id]
        );

        if (!docs.length) {
            return res.status(404).json({ message: 'No KYC submission found' });
        }

        res.json(docs[0]);
    } catch (error) {
        console.error('KYC status error:', error);
        res.status(500).json({ message: 'Error fetching KYC status' });
    }
};

// ─── Re-upload KYC ────────────────────────────────────────────────────────────

exports.reuploadKYC = async (req, res) => {
    try {
        const frontFile = req.files?.document_front?.[0];
        const backFile  = req.files?.document_back?.[0];

        if (!frontFile || !backFile) {
            if (frontFile) fs.unlink(frontFile.path, () => {});
            if (backFile)  fs.unlink(backFile.path,  () => {});
            req.flash('error', 'Please upload both front and back of your document');
            return res.redirect('/user/kyc-submit');
        }

        const { document_type, document_number } = req.body;
        const frontPath = `/uploads/kyc/${frontFile.filename}`;
        const backPath  = `/uploads/kyc/${backFile.filename}`;

        await pool.execute(
            `INSERT INTO kyc_documents 
             (user_id, document_type, document_number, file_path, file_path_back, file_name, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [req.user.id, document_type, document_number, frontPath, backPath, frontFile.filename]
        );

        await pool.execute(
            "UPDATE users SET kyc_status = 'pending' WHERE id = ?",
            [req.user.id]
        );

        req.flash('success', 'KYC document re-uploaded successfully');
        res.redirect('/user/kyc-submit');
    } catch (error) {
        console.error('KYC re-upload error:', error);
        if (req.files?.document_front?.[0]) fs.unlink(req.files.document_front[0].path, () => {});
        if (req.files?.document_back?.[0])  fs.unlink(req.files.document_back[0].path,  () => {});
        req.flash('error', 'Failed to re-upload. Please try again.');
        res.redirect('/user/kyc-submit');
    }
};