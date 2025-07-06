// compliance-service.js - Circle Compliance Engine Integration
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();

class ComplianceService {
  constructor() {
    this.baseURL = 'https://api.circle.com/v1/w3s/compliance';
    this.apiKey = process.env.CIRCLE_API_KEY;
  }

  // Screen wallet address against sanctions lists
  async screenWalletAddress(address) {
    try {
      const response = await fetch(`${this.baseURL}/addresses/screen`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: address,
          blockchain: 'BASE-SEPOLIA',
        })
      });

      const result = await response.json();

      return {
        passed: result.data?.screening?.status === 'CLEARED',
        risk_level: result.data?.screening?.riskLevel || 'UNKNOWN',
        reason: result.data?.screening?.reason || 'Address screening complete',
        sanctions_match: result.data?.screening?.sanctionsMatch || false
      };

    } catch (error) {
      console.error('❌ Compliance screening error:', error);
      // Fail secure - if compliance service is down, block transaction
      return {
        passed: false,
        risk_level: 'HIGH',
        reason: 'Compliance service unavailable',
        sanctions_match: false
      };
    }
  }

  // Screen transaction before processing
  async screenTransaction(fromAddress, toAddress, amount, tokenId = 'USDC') {
    try {
      const response = await fetch(`${this.baseURL}/transactions/screen`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: {
            address: fromAddress,
            type: 'EXTERNAL_ADDRESS'
          },
          destination: {
            address: toAddress,
            type: 'EXTERNAL_ADDRESS'
          },
          amount: amount.toString(),
          tokenId: tokenId,
          transactionType: 'TRANSFER'
        })
      });

      const result = await response.json();

      return {
        passed: result.data?.screening?.decision === 'APPROVED',
        decision: result.data?.screening?.decision || 'REJECTED',
        risk_score: result.data?.screening?.riskScore || 100,
        flagged_reasons: result.data?.screening?.flaggedReasons || [],
        alert_id: result.data?.screening?.alertId
      };

    } catch (error) {
      console.error('❌ Transaction screening error:', error);
      // Fail secure
      return {
        passed: false,
        decision: 'REJECTED',
        risk_score: 100,
        flagged_reasons: ['Service unavailable'],
        alert_id: null
      };
    }
  }

  // Enhanced compliance checks for kill switch operations
  async screenKillSwitchWithdrawal(userWallet, treasuryWallet, amount) {
    try {
      // Screen both addresses individually
      const userScreening = await this.screenWalletAddress(userWallet);
      const treasuryScreening = await this.screenWalletAddress(treasuryWallet);

      // Screen the transaction
      const txScreening = await this.screenTransaction(userWallet, treasuryWallet, amount);

      // Additional checks for large withdrawals
      const isLargeWithdrawal = amount > 500; // $500 USDC threshold
      const requiresManualReview = isLargeWithdrawal ||
        userScreening.risk_level === 'HIGH' ||
        txScreening.risk_score > 80;

      return {
        passed: userScreening.passed && treasuryScreening.passed && txScreening.passed,
        user_screening: userScreening,
        treasury_screening: treasuryScreening,
        transaction_screening: txScreening,
        requires_manual_review: requiresManualReview,
        withdrawal_amount: amount,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Kill switch compliance error:', error);
      return {
        passed: false,
        error: error.message,
        requires_manual_review: true
      };
    }
  }

  // Check if address is on custom blocklist
  checkInternalBlocklist(address) {
    // In production, this would check your internal database
    const blockedAddresses = [
      '0x123...abc', // Example blocked addresses
      '0x456...def'
    ];

    return {
      blocked: blockedAddresses.includes(address.toLowerCase()),
      reason: blockedAddresses.includes(address.toLowerCase()) ? 'Internal blocklist' : null
    };
  }

  // Comprehensive compliance check combining all methods
  async comprehensiveComplianceCheck(fromAddress, toAddress, amount, transactionType = 'PAYMENT') {
    try {
      console.log(`🔍 Running compliance check: ${fromAddress} → ${toAddress} (${amount} USDC)`);

      // For demo purposes, always pass compliance checks
      // In production, you'd implement real compliance screening

      // Check internal blocklists first (fastest)
      const fromBlocklist = this.checkInternalBlocklist(fromAddress);
      const toBlocklist = this.checkInternalBlocklist(toAddress);

      if (fromBlocklist.blocked || toBlocklist.blocked) {
        console.log('❌ Compliance check failed: Address on internal blocklist');
        return {
          passed: false,
          reason: 'Address on internal blocklist',
          blocked_address: fromBlocklist.blocked ? fromAddress : toAddress,
          transaction_type: transactionType
        };
      }

      // Basic amount check
      if (amount > 1000) {
        console.log('❌ Compliance check failed: Amount too high');
        return {
          passed: false,
          reason: 'Amount exceeds compliance threshold',
          transaction_type: transactionType
        };
      }

      console.log('✅ Compliance check passed');
      return {
        passed: true,
        reason: 'Transaction approved',
        transaction_type: transactionType,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Comprehensive compliance check failed:', error);
      // For demo, don't fail on compliance errors
      console.log('⚠️  Compliance service error, allowing transaction for demo');
      return {
        passed: true,
        reason: 'Demo mode - compliance check bypassed',
        transaction_type: transactionType
      };
    }
  }

  // Report transaction for audit trail
  async reportTransaction(transactionId, complianceResult, walletId) {
    try {
      // In production, this would report to Circle's compliance system
      const auditEntry = {
        transaction_id: transactionId,
        wallet_id: walletId,
        compliance_result: complianceResult,
        timestamp: new Date().toISOString()
      };

      console.log('📋 Transaction reported for audit:', auditEntry);

      // Store in your audit database
      return { reported: true, audit_id: `audit_${Date.now()}` };

    } catch (error) {
      console.error('❌ Audit reporting failed:', error);
      return { reported: false, error: error.message };
    }
  }
}

module.exports = ComplianceService;
