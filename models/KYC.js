// KYC Model - Database queries for KYC document management
const pool = require('../config/database');

class KYC {
  // Submit KYC documents
  static async submitKYC(userId, kycData) {
    const { idType, idNumber, documentPath, status = 'pending' } = kycData;
    const [result] = await pool.query(
      'INSERT INTO kyc_documents (user_id, id_type, id_number, document_path, status, submitted_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [userId, idType, idNumber, documentPath, status]
    );
    return result.insertId;
  }

  // Get user KYC status
  static async getKYCStatus(userId) {
    const [rows] = await pool.query(
      'SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
      [userId]
    );
    return rows[0];
  }

  // Get pending KYC submissions (admin)
  static async getPendingKYC(limit = 50, offset = 0) {
    const [rows] = await pool.query(
      'SELECT k.*, u.first_name, u.last_name, u.email FROM kyc_documents k JOIN users u ON k.user_id = u.id WHERE k.status = "pending" LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows;
  }

  // Approve KYC (admin)
  static async approveKYC(kycId, adminId) {
    const [result] = await pool.query(
      'UPDATE kyc_documents SET status = "approved", verified_at = NOW(), verified_by = ? WHERE id = ?',
      [adminId, kycId]
    );
    return result.affectedRows;
  }

  // Reject KYC (admin)
  static async rejectKYC(kycId, adminId, reason) {
    const [result] = await pool.query(
      'UPDATE kyc_documents SET status = "rejected", verified_at = NOW(), verified_by = ?, rejection_reason = ? WHERE id = ?',
      [adminId, reason, kycId]
    );
    return result.affectedRows;
  }

  // Get all KYC documents
  static async getAllKYC(limit = 50, offset = 0) {
    const [rows] = await pool.query(
      'SELECT k.*, u.first_name, u.last_name, u.email FROM kyc_documents k JOIN users u ON k.user_id = u.id LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows;
  }
}

module.exports = KYC;
