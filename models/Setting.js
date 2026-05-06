// Setting Model - Database queries for site settings and toggles
const pool = require('../config/database');

class Setting {
  // Get all settings
  static async getAllSettings() {
    const [rows] = await pool.query('SELECT * FROM settings');
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  }

  // Get specific setting
  static async getSetting(key) {
    const [rows] = await pool.query('SELECT value FROM settings WHERE key = ?', [key]);
    return rows[0] ? rows[0].value : null;
  }

  // Update setting
  static async updateSetting(key, value) {
    const [result] = await pool.query(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value = ?, updated_at = NOW()',
      [key, value, value]
    );
    return result.affectedRows;
  }

  // Enable maintenance mode
  static async setMaintenanceMode(enabled) {
    return await this.updateSetting('maintenance_mode', enabled ? '1' : '0');
  }

  // Check maintenance mode
  static async isMaintenanceMode() {
    const value = await this.getSetting('maintenance_mode');
    return value === '1';
  }

  // Get withdrawal limits
  static async getWithdrawalLimits() {
    const daily = await this.getSetting('daily_withdrawal_limit');
    const transaction = await this.getSetting('transaction_withdrawal_limit');
    return {
      daily: parseFloat(daily) || 5000,
      transaction: parseFloat(transaction) || 10000
    };
  }

  // Update system configuration
  static async updateSystemConfig(config) {
    const updates = [];
    for (const [key, value] of Object.entries(config)) {
      updates.push(this.updateSetting(key, value));
    }
    return Promise.all(updates);
  }
}

module.exports = Setting;
