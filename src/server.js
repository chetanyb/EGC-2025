const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import our modules
const CircleWalletManager = require('./circle-wallet-manager');
const ComplianceService = require('./compliance-service');
const { createNFCRoutes, setupDemo } = require('./nfc-integration');

const pkg = require(path.join(__dirname, '..', 'package.json'));

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
      ? ['https://yourdomain.com']
      : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static('public'));

// Initialize services
const walletManager = new CircleWalletManager();
const complianceService = new ComplianceService();

// In-memory storage (use Redis/MongoDB in production)
const nfcMappings = {}; // nfcUID -> wallet rules
const userDatabase = {}; // userId -> user info
const transactionHistory = []; // Transaction audit trail

// Merchant wallet addresses for Base Sepolia (REPLACE WITH REAL ONES)
const merchantWallets = {
  'vendor001': '0x7Fde4F9385573236c5B809880B175C35BABB15F2',
};

// System initialization
let isInitialized = false;
async function initializeSystem() {
  if (!isInitialized) {
    try {
      console.log('🚀 Initializing NFC Smart Wallet System...');
      await walletManager.initializeMainWallet();
      isInitialized = true;
      console.log('✅ System initialized successfully!');

      // Setup demo data if in demo mode
      if (process.env.DEMO_MODE === 'true') {
        await setupDemoData();
      }
    } catch (error) {
      console.error('❌ Failed to initialize system:', error);
      throw error;
    }
  }
}

async function setupDemoData() {
  console.log('🎬 Setting up demo data...');

  const demoCards = [
    {
      nfcUID: 'DEMO_CARD_001',
      userId: 'user001',
      limits: { maxTransactionAmount: 50, dailySpendLimit: 200, maxTransactionsPerDay: 10 }
    },
    {
      nfcUID: 'DEMO_CARD_002',
      userId: 'user002',
      limits: { maxTransactionAmount: 25, dailySpendLimit: 100, maxTransactionsPerDay: 5 }
    },
    {
      nfcUID: 'DEMO_CARD_VIP',
      userId: 'vip001',
      limits: { maxTransactionAmount: 200, dailySpendLimit: 1000, maxTransactionsPerDay: 20 }
    }
  ];

  for (const card of demoCards) {
    try {
      const { wallet, rules } = await walletManager.createChildWallet(card.nfcUID, card.limits);

      nfcMappings[card.nfcUID] = rules;
      userDatabase[card.userId] = {
        nfcUID: card.nfcUID,
        walletId: wallet.id,
        walletAddress: wallet.address,
        registeredAt: new Date()
      };

      console.log(`✅ Demo card ${card.nfcUID} registered`);
    } catch (error) {
      console.error(`❌ Failed to register demo card ${card.nfcUID}:`, error.message);
    }
  }
}

// Utility functions
function logTransaction(transaction) {
  transactionHistory.push({
    ...transaction,
    timestamp: new Date().toISOString()
  });

  if (transactionHistory.length > 1000) {
    transactionHistory.shift();
  }
}

// Serve interfaces
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/pos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'merchant-pos.html'));
});

// Add this route to serve the admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    initialized: isInitialized
  });
});

// API Routes

// 1. User Registration & NFC Card Mapping
app.post('/api/register', async (req, res) => {
  await initializeSystem();

  try {
    const { userId, nfcUID, limits = {} } = req.body;

    if (!userId || !nfcUID) {
      return res.status(400).json({ error: 'User ID and NFC UID are required' });
    }

    if (nfcMappings[nfcUID]) {
      return res.status(400).json({ error: 'NFC card already registered' });
    }

    // Create child wallet for this NFC card
    const { wallet, rules } = await walletManager.createChildWallet(nfcUID, limits);

    // Store mappings
    nfcMappings[nfcUID] = rules;
    userDatabase[userId] = {
      nfcUID,
      walletId: wallet.id,
      walletAddress: wallet.address,
      registeredAt: new Date()
    };

    // Log registration
    logTransaction({
      type: 'REGISTRATION',
      userId,
      nfcUID,
      walletAddress: wallet.address,
      limits: rules.limits
    });

    res.json({
      success: true,
      message: 'NFC card registered successfully',
      walletAddress: wallet.address,
      walletId: wallet.id,
      limits: rules.limits
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Fund NFC Wallet (REAL TRANSACTION)
app.post('/api/fund-wallet', async (req, res) => {
  try {
    const { nfcUID, amount } = req.body;

    if (!nfcUID || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid NFC UID and amount required' });
    }

    const walletRules = nfcMappings[nfcUID];
    if (!walletRules) {
      return res.status(404).json({ error: 'NFC card not found' });
    }

    // Prevent topping-up a disabled card
    if (!walletRules.active || walletRules.security?.blocked) {
      return res.status(400).json({ error: 'Card is disabled / blocked' });
    }

    // Check if main wallet has funds
    const mainBalance = await walletManager.getWalletBalance(walletManager.mainWallet.id);
    if (parseFloat(mainBalance) < amount) {
      return res.status(400).json({
        error: `Insufficient funds in main wallet. Available: ${mainBalance} USDC, Required: ${amount} USDC`
      });
    }

    // Compliance screening
    const screening = await complianceService.comprehensiveComplianceCheck(
        walletManager.mainWallet.address,
        walletRules.address,
        amount,
        'FUNDING'
    );

    if (!screening.passed) {
      return res.status(403).json({
        error: `Compliance check failed: ${screening.reason || 'Transaction blocked'}`
      });
    }

    // Execute REAL funding transaction
    const transaction = await walletManager.fundChildWallet(walletRules.walletId, amount);

    // Log funding transaction
    logTransaction({
      type: 'FUNDING',
      nfcUID,
      amount,
      transactionId: transaction.id,
      transactionHash: transaction.txHash,
      compliance: screening
    });

    res.json({
      success: true,
      message: `Wallet funded with ${amount} USDC`,
      transactionId: transaction.id,
      transactionHash: transaction.txHash,
      balance: await walletManager.getWalletBalance(walletRules.walletId)
    });

  } catch (error) {
    console.error('Funding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. NFC Tap Payment Processing (REAL TRANSACTION)
app.post('/api/nfc-payment', async (req, res) => {
  try {
    const { nfcUID, merchantId, amount, category = 'general' } = req.body;

    console.log(`💳 Payment request: ${nfcUID} → ${merchantId} ($${amount} USDC)`);

    // Validation
    if (!nfcUID || !merchantId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'NFC UID, merchant ID, and valid amount required' });
    }

    const merchantAddress = merchantWallets[merchantId];
    if (!merchantAddress) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const walletRules = nfcMappings[nfcUID];
    if (!walletRules) {
      return res.status(404).json({ error: 'NFC card not registered' });
    }

    // Pre-flight checks
    const securityCheck = walletManager.performSecurityChecks(walletRules, amount, merchantAddress);
    if (!securityCheck.passed) {
      console.log(`❌ Security check failed: ${securityCheck.reason}`);
      return res.status(400).json({
        success: false,
        error: securityCheck.reason
      });
    }

    // Compliance screening
    const screening = await complianceService.comprehensiveComplianceCheck(
        walletRules.address,
        merchantAddress,
        amount,
        'PAYMENT'
    );

    if (!screening.passed) {
      const error = `Payment blocked: ${screening.reason || 'Compliance check failed'}`;
      console.log(`❌ Compliance check failed: ${error}`);

      logTransaction({
        type: 'PAYMENT_FAILED',
        nfcUID,
        merchantId,
        amount,
        category,
        reason: error,
        compliance: screening
      });

      return res.status(403).json({
        success: false,
        error
      });
    }

    // Check child wallet balance
    let childBalance = await walletManager.getWalletBalance(walletRules.walletId);
    console.log(`💰 Child wallet balance: ${childBalance} USDC`);

    // AUTO-FUNDING LOGIC
    if (parseFloat(childBalance) < amount) {
      console.log(`⚡ Insufficient funds in child wallet. Auto-funding required.`);

      // Calculate how much we need to top up
      const topUpAmount = amount - parseFloat(childBalance) + 10; // Add $10 buffer
      console.log(`💸 Top-up amount: ${topUpAmount} USDC`);

      // Check main wallet balance
      const mainBalance = await walletManager.getWalletBalance(walletManager.mainWallet.id);
      console.log(`💰 Main wallet balance: ${mainBalance} USDC`);

      if (parseFloat(mainBalance) < topUpAmount) {
        return res.status(400).json({
          success: false,
          error: `Insufficient funds in treasury. Main wallet balance: ${mainBalance} USDC, Required: ${topUpAmount} USDC`,
          mainWalletAddress: walletManager.mainWallet.address,
          instruction: 'Please fund the main wallet first'
        });
      }

      // Execute auto-funding
      try {
        console.log(`🔄 Auto-funding child wallet with ${topUpAmount} USDC...`);
        const fundingTx = await walletManager.fundChildWallet(walletRules.walletId, topUpAmount);
        console.log(`✅ Auto-funding complete. Transaction: ${fundingTx.id}`);

        // Log the auto-funding
        logTransaction({
          type: 'AUTO_FUNDING',
          nfcUID,
          amount: topUpAmount,
          transactionId: fundingTx.id,
          transactionHash: fundingTx.txHash,
          fromWallet: walletManager.mainWallet.address,
          toWallet: walletRules.address
        });

        // Update balance after funding
        childBalance = await walletManager.getWalletBalance(walletRules.walletId);
        console.log(`💰 Updated child wallet balance: ${childBalance} USDC`);

      } catch (fundingError) {
        console.error('❌ Auto-funding failed:', fundingError);
        return res.status(500).json({
          success: false,
          error: `Auto-funding failed: ${fundingError.message}`
        });
      }
    }

    // Process the actual payment
    console.log(`💳 Processing payment of ${amount} USDC...`);
    const result = await walletManager.processNFCPayment(
        nfcUID,
        merchantAddress,
        amount,
        nfcMappings
    );

    // Log transaction
    logTransaction({
      type: result.success ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
      nfcUID,
      merchantId,
      amount,
      category,
      transactionId: result.transaction?.id,
      transactionHash: result.transactionHash,
      compliance: screening,
      remainingLimits: {
        daily: result.remainingDailyLimit,
        transactions: result.remainingTransactions
      }
    });

    if (result.success) {
      // Get updated balance
      const newBalance = await walletManager.getWalletBalance(walletRules.walletId);

      res.json({
        success: true,
        message: `Payment of ${amount} USDC processed successfully`,
        transactionId: result.transaction.id,
        transactionHash: result.transactionHash,
        remainingDailyLimit: result.remainingDailyLimit,
        remainingTransactions: result.remainingTransactions,
        newBalance: newBalance,
        merchantId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced wallet status endpoint
app.get('/api/wallet-status/:nfcUID', async (req, res) => {
  try {
    const { nfcUID } = req.params;

    const walletRules = nfcMappings[nfcUID];
    if (!walletRules) {
      return res.status(404).json({ error: 'NFC card not found' });
    }

    const balance = await walletManager.getWalletBalance(walletRules.walletId);

    // Check if daily limits need reset
    const today = new Date().toDateString();
    if (walletRules.usage.lastResetDate !== today) {
      walletManager.resetDailyLimits(walletRules);
    }

    res.json({
      active: walletRules.active,
      balance: balance,
      limits: walletRules.limits,
      dailySpent: walletRules.usage.dailySpent,
      transactionCount: walletRules.usage.transactionCount,
      remainingDaily: Math.max(0, walletRules.limits.dailySpendLimit - walletRules.usage.dailySpent),
      remainingTransactions: Math.max(0, walletRules.limits.maxTransactionsPerDay - walletRules.usage.transactionCount),
      walletAddress: walletRules.address,
      lastResetDate: walletRules.usage.lastResetDate,
      lastTransaction: walletRules.usage.lastTransactionDate
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Demo setup endpoint
app.post('/api/setup-demo', async (req, res) => {
  try {
    console.log('🎬 Setting up demo cards...');

    const demoCards = [
      {
        nfcUID: 'DEMO_CARD_001',
        userId: 'demo_user_001',
        limits: {
          maxTransactionAmount: 50,
          dailySpendLimit: 200,
          maxTransactionsPerDay: 10
        }
      },
      {
        nfcUID: 'DEMO_CARD_002',
        userId: 'demo_user_002',
        limits: {
          maxTransactionAmount: 25,
          dailySpendLimit: 100,
          maxTransactionsPerDay: 5
        }
      },
      {
        nfcUID: 'DEMO_CARD_VIP',
        userId: 'demo_user_vip',
        limits: {
          maxTransactionAmount: 200,
          dailySpendLimit: 1000,
          maxTransactionsPerDay: 20
        }
      }
    ];

    const results = [];

    for (const card of demoCards) {
      try {
        // Check if already exists
        if (nfcMappings[card.nfcUID]) {
          results.push({
            nfcUID: card.nfcUID,
            status: 'exists',
            message: 'Card already registered'
          });
          continue;
        }

        // Create child wallet
        const { wallet, rules } = await walletManager.createChildWallet(card.nfcUID, card.limits);

        // Store mappings
        nfcMappings[card.nfcUID] = rules;
        userDatabase[card.userId] = {
          nfcUID: card.nfcUID,
          walletId: wallet.id,
          walletAddress: wallet.address,
          registeredAt: new Date()
        };

        results.push({
          nfcUID: card.nfcUID,
          status: 'created',
          walletAddress: wallet.address,
          limits: card.limits
        });

      } catch (error) {
        results.push({
          nfcUID: card.nfcUID,
          status: 'failed',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      mainWallet: walletManager.mainWallet.address,
      demoCards: results
    });

  } catch (error) {
    console.error('Demo setup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Kill Switch Endpoint (REAL WITHDRAWAL)
app.post('/api/kill-switch', async (req, res) => {
  try {
    const { nfcUID, userId, withdrawalAddress } = req.body;

    if (!nfcUID) {
      return res.status(400).json({ error: 'NFC UID required' });
    }

    // Verify user owns this NFC card (if userId provided)
    if (userId) {
      const user = Object.values(userDatabase).find(u => u.nfcUID === nfcUID);
      if (!user) {
        return res.status(404).json({ error: 'NFC card not found for user' });
      }
    }

    const walletRules = nfcMappings[nfcUID];
    if (!walletRules) {
      return res.status(404).json({ error: 'NFC card not found' });
    }

    // Check if card is already disabled
    if (!walletRules.active) {
      return res.status(400).json({ error: 'Card is already disabled' });
    }

    // Get current balance
    const currentBalance = await walletManager.getWalletBalance(walletRules.walletId);
    const balanceAmount = parseFloat(currentBalance);

    console.log(`🚨 Kill switch initiated for ${nfcUID}`);
    console.log(`💰 Current balance: ${balanceAmount} USDC`);

    // Determine withdrawal destination
    let destinationAddress = withdrawalAddress || walletManager.mainWallet.address;
    let destinationType = withdrawalAddress ? 'custom' : 'treasury';

    // Validate custom address if provided
    if (withdrawalAddress) {
      // Basic ethereum address validation
      if (!/^0x[a-fA-F0-9]{40}$/.test(withdrawalAddress)) {
        return res.status(400).json({ error: 'Invalid withdrawal address format' });
      }
      console.log(`📤 Custom withdrawal address: ${withdrawalAddress}`);
    } else {
      console.log(`📤 Withdrawing to treasury: ${destinationAddress}`);
    }

    // Enhanced compliance screening for kill switch
    if (balanceAmount > 0) {
      const screening = await complianceService.comprehensiveComplianceCheck(
          walletRules.address,
          destinationAddress,
          balanceAmount,
          'KILL_SWITCH'
      );

      if (!screening.passed) {
        return res.status(403).json({
          error: `Kill switch blocked: ${screening.reason || 'Compliance check failed'}`
        });
      }
    }

    // Execute kill switch
    try {
      // Step 1: Disable card immediately
      walletRules.active = false;
      walletRules.security.blocked = true;
      walletRules.security.disabledAt = new Date().toISOString();
      walletRules.security.disabledReason = 'Kill switch activated';

      let withdrawalResult = null;

      // Step 2: Withdraw funds if balance > 0
      if (balanceAmount > 0) {
        console.log(`💸 Withdrawing ${balanceAmount} USDC to ${destinationAddress}...`);

        // Get USDC token ID
        const usdcTokenId = walletManager.getUSDCTokenId();

        // Create withdrawal transaction
        const withdrawalRequest = {
          idempotencyKey: uuidv4(),
          amounts: [currentBalance],
          destinationAddress: destinationAddress,
          tokenId: usdcTokenId,
          walletId: walletRules.walletId,
          fee: {
            type: 'level',
            config: {
              feeLevel: 'HIGH' // Use high priority for emergency withdrawal
            }
          }
        };

        console.log('📤 Creating emergency withdrawal transaction...');
        const withdrawalResponse = await walletManager.client.createTransaction(withdrawalRequest);
        // SDK v1:   { data: { id: '…' } }
        // SDK v0.9: { data: { transaction: { id: '…' } } }
        const txId = withdrawalResponse?.data?.id
            ?? withdrawalResponse?.data?.transaction?.id;
        if (!txId) throw new Error('Withdrawal: no transaction id returned');
        const confirmedTx = await walletManager.waitForTransactionConfirmation(txId);


        withdrawalResult = {
          transactionId: confirmedTx.id,
          transactionHash: confirmedTx.txHash,
          amount: balanceAmount,
          destination: destinationAddress
        };

        console.log('✅ Funds withdrawn successfully:', withdrawalResult);
      }

      // Log kill switch activation
      logTransaction({
        type: 'KILL_SWITCH_EXECUTED',
        nfcUID,
        userId,
        withdrawnAmount: balanceAmount,
        destinationAddress: destinationAddress,
        destinationType: destinationType,
        transactionId: withdrawalResult?.transactionId,
        transactionHash: withdrawalResult?.transactionHash,
        timestamp: new Date().toISOString()
      });

      // Return success response
      res.json({
        success: true,
        message: 'Kill switch executed successfully',
        cardDisabled: true,
        withdrawnAmount: balanceAmount,
        destinationAddress: destinationAddress,
        destinationType: destinationType,
        transactionHash: withdrawalResult?.transactionHash,
        transactionId: withdrawalResult?.transactionId
      });

    } catch (withdrawalError) {
      console.error('❌ Withdrawal failed:', withdrawalError);

      // Card is still disabled even if withdrawal fails
      res.status(500).json({
        success: false,
        error: `Card disabled but withdrawal failed: ${withdrawalError.message}`,
        cardDisabled: true,
        withdrawnAmount: 0
      });
    }

  } catch (error) {
    console.error('Kill switch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Get Wallet Status
app.get('/api/wallet-status/:nfcUID', async (req, res) => {
  try {
    const { nfcUID } = req.params;

    const walletRules = nfcMappings[nfcUID];
    if (!walletRules) {
      return res.status(404).json({ error: 'NFC card not found' });
    }

    const balance = await walletManager.getWalletBalance(walletRules.walletId);

    res.json({
      active: walletRules.active,
      balance: balance,
      limits: walletRules.limits,
      dailySpent: walletRules.usage.dailySpent,
      transactionCount: walletRules.usage.transactionCount,
      remainingDaily: Math.max(0, walletRules.limits.dailySpendLimit - walletRules.usage.dailySpent),
      remainingTransactions: Math.max(0, walletRules.limits.maxTransactionsPerDay - walletRules.usage.transactionCount),
      walletAddress: walletRules.address,
      lastResetDate: walletRules.usage.lastResetDate
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Update Wallet Limits
app.put('/api/wallet-limits/:nfcUID', async (req, res) => {
  try {
    const { nfcUID } = req.params;
    const { limits } = req.body;

    if (!limits || typeof limits !== 'object') {
      return res.status(400).json({ error: 'Valid limits object required' });
    }

    const walletRules = nfcMappings[nfcUID];
    if (!walletRules) {
      return res.status(404).json({ error: 'NFC card not found' });
    }

    // Validate limit values
    const validLimits = {};
    if (limits.maxTransactionAmount && limits.maxTransactionAmount > 0) {
      validLimits.maxTransactionAmount = limits.maxTransactionAmount;
    }
    if (limits.dailySpendLimit && limits.dailySpendLimit > 0) {
      validLimits.dailySpendLimit = limits.dailySpendLimit;
    }
    if (limits.maxTransactionsPerDay && limits.maxTransactionsPerDay > 0) {
      validLimits.maxTransactionsPerDay = limits.maxTransactionsPerDay;
    }

    // Update limits
    walletRules.limits = { ...walletRules.limits, ...validLimits };

    // Log limit update
    logTransaction({
      type: 'LIMIT_UPDATE',
      nfcUID,
      oldLimits: walletRules.limits,
      newLimits: validLimits
    });

    res.json({
      success: true,
      message: 'Wallet limits updated',
      newLimits: walletRules.limits
    });

  } catch (error) {
    console.error('Limit update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Fund Main Wallet (for testing)
app.post('/api/fund-main-wallet', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    // In a real scenario, you'd fund from an external source
    // For demo purposes, we'll just show the wallet address
    res.json({
      success: true,
      message: 'To fund the main wallet, send USDC to:',
      mainWalletAddress: walletManager.mainWallet.address,
      network: 'Base Sepolia',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia
      amount: amount,
      instructions: [
        '1. Get Base Sepolia testnet USDC from a faucet',
        '2. Send USDC to the main wallet address above',
        '3. Wait for confirmation',
        '4. Check wallet balance'
      ]
    });

  } catch (error) {
    console.error('Main wallet funding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. System Status
app.get('/api/system-status', async (req, res) => {
  try {
    // make sure initialization has run to completion
    await initializeSystem();
    const mainWalletBalance = walletManager.mainWallet ?
        await walletManager.getWalletBalance(walletManager.mainWallet.id) : '0';

    const mainWalletAddress =
        walletManager.mainWallet?.address ?? 'Not initialized';
    const systemInfo = {
      status: 'running',
      initialized: isInitialized,
      registeredCards: Object.keys(nfcMappings).length,
      mainWallet: mainWalletAddress,
      mainWalletBalance: mainWalletBalance,
      blockchain: 'BASE-SEPOLIA',
      availableMerchants: Object.keys(merchantWallets),
      transactionCount: transactionHistory.length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: pkg.version || '1.0.0'
    };

    res.json(systemInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Transaction History
app.get('/api/transactions', (req, res) => {
  try {
    const { nfcUID, limit = 50, offset = 0 } = req.query;

    let transactions = transactionHistory;

    // Filter by NFC UID if provided
    if (nfcUID) {
      transactions = transactions.filter(tx => tx.nfcUID === nfcUID);
    }

    // Pagination
    const total = transactions.length;
    const paginatedTx = transactions
        .slice(parseInt(offset), parseInt(offset) + parseInt(limit))
        .reverse(); // Most recent first

    res.json({
      transactions: paginatedTx,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mount NFC testing routes
app.use('/api/nfc', createNFCRoutes());

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 NFC Smart Wallet Backend running on port ${PORT}`);
  console.log(`🏪 Merchant POS interface at http://localhost:${PORT}/pos`);
  console.log(`👤 User registration at http://localhost:${PORT}/`);

  try {
    await initializeSystem();
    console.log('✅ System ready for REAL transactions!');
    console.log(`💰 Main wallet: ${walletManager.mainWallet.address}`);
    console.log('🔗 Network: Base Sepolia');
  } catch (error) {
    console.error('❌ System initialization failed:', error.message);
    console.log('Please check your Circle API credentials and try again.');
  }
});

module.exports = app;