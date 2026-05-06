-- Online Banking System - MySQL Schema

CREATE DATABASE IF NOT EXISTS finora_bank 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE finora_bank;

-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    pin VARCHAR(255), -- hashed 4-digit PIN
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token VARCHAR(255),
    kyc_status ENUM('pending', 'approved', 'rejected', 'not_submitted') DEFAULT 'not_submitted',
    kyc_enabled BOOLEAN DEFAULT TRUE,
    is_suspended BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    withdrawal_steps_required BOOLEAN DEFAULT TRUE,
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Accounts table (balances)
CREATE TABLE accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    account_number VARCHAR(50) UNIQUE NOT NULL,
    balance DECIMAL(15, 2) DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'USD',
    status ENUM('active', 'frozen', 'closed') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- KYC Documents table
CREATE TABLE kyc_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    document_type ENUM('passport', 'national_id', 'drivers_license', 'utility_bill', 'bank_statement') NOT NULL,
    document_number VARCHAR(100),
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    admin_notes TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    reviewed_by INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- Withdrawal codes table
CREATE TABLE withdrawal_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code VARCHAR(255) NOT NULL, -- hashed 7-digit code
    is_used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Transactions table
CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('deposit', 'withdrawal', 'transfer', 'admin_credit', 'admin_debit') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    description TEXT,
    reference_id VARCHAR(100),
    recipient_account VARCHAR(100),
    withdrawal_step INT DEFAULT 0, -- tracks 4-step process (0-4)
    completed_steps JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Admin Settings table
CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type ENUM('string', 'boolean', 'number', 'json') DEFAULT 'string',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Login logs (security)
CREATE TABLE login_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status ENUM('success', 'failed', 'pin_required') DEFAULT 'success',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Insert default settings
INSERT INTO settings (setting_key, setting_value, setting_type) VALUES
('site_name', 'Finora Bank', 'string'),
('site_logo', '/images/logo.png', 'string'),
('theme_primary_color', '#0d9488', 'string'),
('global_withdrawal_steps_required', 'true', 'boolean'),
('registration_enabled', 'true', 'boolean'),
('maintenance_mode', 'false', 'boolean');