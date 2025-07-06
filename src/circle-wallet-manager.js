// circle-wallet-manager.js - CORRECTED VERSION with proper SDK methods
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class CircleWalletManager {
  constructor() {
    this.client = null;
    this.mainWalletSet = null;
    this.mainWallet = null;
    this.blockchain = 'BASE-SEPOLIA';
    this.isInitialized = false;
    this.usdcTokenId = 'bdf128b4-827b-5267-8f9e-243694989b5f';
  }

  // Initialize Circle client and main wallet
  async initializeMainWallet() {
    try {
      console.log('🔧 Initializing Circle Wallet Manager...');

      // Step 1: Validate environment variables
      if (!process.env.CIRCLE_API_KEY) {
        throw new Error('CIRCLE_API_KEY not found in environment variables');
      }

      if (!process.env.CIRCLE_ENTITY_SECRET) {
        throw new Error('CIRCLE_ENTITY_SECRET not found in environment variables');
      }

      // Step 2: Initialize Circle client
      console.log('📡 Connecting to Circle API...');
      this.client = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET,
      });

      // Step 3: Test API connectivity with wallet set creation
      console.log('🏓 Testing API connectivity...');

      // Step 4: Create or get existing wallet set
      console.log('📁 Setting up wallet set...');
      try {
        const walletSetResponse = await this.client.createWalletSet({
          name: 'NFC Event Wallet Treasury - ' + new Date().toISOString().split('T')[0],
          idempotencyKey: uuidv4()
        });
        this.mainWalletSet = walletSetResponse.data.walletSet;
        console.log('✅ Wallet set created:', this.mainWalletSet.id);
      } catch (error) {
        if (error.response?.status === 409) {
          // Wallet set might already exist, let's list them
          console.log('⚠️ Wallet set creation failed, checking existing sets...');
          const existingSets = await this.client.listWalletSets();
          if (existingSets.data.walletSets.length > 0) {
            this.mainWalletSet = existingSets.data.walletSets[0];
            console.log('✅ Using existing wallet set:', this.mainWalletSet.id);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Step 5: Create or get main treasury wallet
      console.log('💰 Setting up main treasury wallet...');
      try {
        const walletsResponse = await this.client.createWallets({
          accountType: 'SCA',
          blockchains: [this.blockchain],
          count: 1,
          walletSetId: this.mainWalletSet.id,
          idempotencyKey: uuidv4()
        });
        this.mainWallet = walletsResponse.data.wallets[0];
        console.log('✅ Main wallet created:', this.mainWallet.address);
      } catch (error) {
        if (error.response?.status === 409) {
          // Main wallet might already exist, get existing wallets
          console.log('⚠️ Main wallet creation failed, checking existing wallets...');
          const existingWallets = await this.client.listWallets({
            walletSetId: this.mainWalletSet.id,
            blockchain: this.blockchain
          });

          if (existingWallets.data.wallets.length > 0) {
            this.mainWallet = existingWallets.data.wallets[0];
            console.log('✅ Using existing main wallet:', this.mainWallet.address);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Step 6: Get current balance
      const balance = await this.getWalletBalance(this.mainWallet.id);
      console.log(`💰 Main wallet balance: ${balance} USDC`);

      this.isInitialized = true;
      console.log('🎉 Circle Wallet Manager initialized successfully!');

      return this.mainWallet;

    } catch (error) {
      console.error('❌ Circle initialization failed:', error.message);

      // Provide specific error guidance
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        console.error('🔑 API Key issue: Check your CIRCLE_API_KEY in .env file');
      } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
        console.error('🔐 Entity Secret issue: Run "node register-entity-secret.js"');
      } else if (error.message.includes('CIRCLE_API_KEY not found')) {
        console.error('📝 Create .env file with CIRCLE_API_KEY=your_api_key');
      } else if (error.message.includes('CIRCLE_ENTITY_SECRET not found')) {
        console.error('📝 Add CIRCLE_ENTITY_SECRET to .env file');
      }

      throw error;
    }
  }

  // Create child wallet with better error handling
  async createChildWallet(nfcUID, userLimits = {}) {
    try {
      if (!this.isInitialized) {
        await this.initializeMainWallet();
      }

      console.log('🔨 Creating child wallet for NFC:', nfcUID);

      const walletResponse = await this.client.createWallets({
        accountType: 'SCA',
        blockchains: [this.blockchain],
        count: 1,
        walletSetId: this.mainWalletSet.id,
        idempotencyKey: uuidv4()
      });

      const childWallet = walletResponse.data.wallets[0];

      const walletRules = {
        nfcUID,
        walletId: childWallet.id,
        address: childWallet.address,
        blockchain: this.blockchain,
        active: true,
        limits: {
          maxTransactionAmount: userLimits.maxTransactionAmount || 50,
          dailySpendLimit: userLimits.dailySpendLimit || 200,
          maxTransactionsPerDay: userLimits.maxTransactionsPerDay || 10,
        },
        usage: {
          dailySpent: 0,
          transactionCount: 0,
          lastTransactionDate: null,
          lastResetDate: new Date().toDateString()
        },
        security: {
          blocked: false,
          createdAt: new Date().toISOString()
        }
      };

      console.log('✅ Child wallet created:', {
        nfcUID,
        address: childWallet.address,
        limits: walletRules.limits
      });

      return { wallet: childWallet, rules: walletRules };

    } catch (error) {
      console.error('❌ Error creating child wallet:', error.message);
      throw new Error(`Failed to create wallet for ${nfcUID}: ${error.message}`);
    }
  }

  // CORRECTED: Use known USDC token ID
  getUSDCTokenId() {
    // Use known USDC token ID for Base Sepolia
    return this.usdcTokenId;
  }



  // getWalletBalance method with this:

  async getWalletBalance(walletId) {
    try {
      if (!this.client) {
        console.error('❌ Client not initialized');
        return '0';
      }

      if (!walletId) {
        console.error('❌ Wallet ID is null or undefined');
        return '0';
      }

      console.log(`💰 Checking balance for wallet: ${walletId}`);

      // CORRECT method from official docs:
      // client.getWalletTokenBalance({ id: 'wallet-id' })
      const balanceResponse = await this.client.getWalletTokenBalance({
        id: walletId  // Use 'id', not 'walletId'
      });

      // Parse the response - it returns ALL token balances
      const tokenBalances = balanceResponse.data.tokenBalances || [];

      // Find USDC balance
      const usdcBalance = tokenBalances.find(balance =>
          balance.token.symbol === 'USDC' ||
          balance.token.symbol === 'USDC-TEST' ||
          balance.token.name.toLowerCase().includes('usd coin')
      );

      const balance = usdcBalance?.amount || '0';
      console.log(`💰 Wallet ${walletId} USDC balance: ${balance}`);

      // Log all balances for debugging
      if (tokenBalances.length > 0) {
        console.log('📊 All token balances:');
        tokenBalances.forEach(balance => {
          console.log(`  - ${balance.token.symbol}: ${balance.amount}`);
        });
      }

      return balance;

    } catch (error) {
      console.error('❌ Error getting wallet balance:', error.message);

      if (error.response) {
        console.error('API Error:', error.response.status, error.response.data);
      }

      return '0';
    }
  }

  // Fund child wallet with proper error handling
  async fundChildWallet(childWalletId, amount) {
    try {
      if (!this.isInitialized) {
        throw new Error('Wallet manager not initialized');
      }

      console.log(`💰 Funding wallet ${childWalletId} with ${amount} USDC...`);

      // Get child wallet details
      const walletResponse = await this.client.getWallet({ id: childWalletId });
      const childWallet = walletResponse.data.wallet;

      // Get USDC token ID
      const usdcTokenId = this.getUSDCTokenId();

      // Check main wallet balance first
      const mainBalance = await this.getWalletBalance(this.mainWallet.id);
      if (parseFloat(mainBalance) < amount) {
        throw new Error(`Insufficient funds in main wallet. Available: ${mainBalance} USDC, Required: ${amount} USDC`);
      }

      const idempotencyKey = uuidv4();
      console.log('🔑 Using idempotency key:', idempotencyKey);

      const transferRequest = {
        idempotencyKey,
        amounts: [amount.toString()],
        destinationAddress: childWallet.address,
        tokenId: usdcTokenId,
        walletId: this.mainWallet.id,
        fee: {
          type: 'level',
          config: {
            feeLevel: 'MEDIUM'
          }
        }
      };

      console.log('📤 Creating funding transaction...');
      const transferResponse = await this.client.createTransaction(transferRequest);
      console.log('✅ Funding transaction created:', transferResponse.data.transaction.id);

      // Wait for confirmation
      const confirmedTx = await this.waitForTransactionConfirmation(
          transferResponse.data.transaction.id
      );

      return confirmedTx;

    } catch (error) {
      console.error('❌ Error funding wallet:', error.message);
      throw new Error(`Failed to fund wallet: ${error.message}`);
    }
  }

  // Process payment with full error handling
  async processNFCPayment(nfcUID, merchantAddress, amount, walletRulesStore) {
    try {
      if (!this.isInitialized) throw new Error('Wallet manager not initialized');

      const walletRules = walletRulesStore[nfcUID];
      if (!walletRules) throw new Error('NFC card not registered');

      const check = this.performSecurityChecks(walletRules, amount, merchantAddress);
      if (!check.passed) throw new Error(check.reason);

      let balance = await this.getWalletBalance(walletRules.walletId);
      if (parseFloat(balance) < amount) {
        const deficit = (amount - parseFloat(balance)).toFixed(2);
        console.log(
            `⚡️ Auto-top-up ${deficit} USDC from treasury to child ${walletRules.walletId}`
        );
        await this.fundChildWallet(walletRules.walletId, deficit);
        balance = await this.getWalletBalance(walletRules.walletId);
        console.log(`✅ New child balance: ${balance} USDC`);
      }

      const entitySecretCiphertext = await this.client.generateEntitySecretCiphertext();
      const transferRequest = {
        idempotencyKey: uuidv4(),
        walletId: walletRules.walletId,
        tokenId: this.getUSDCTokenId(),
        destinationAddress: merchantAddress,
        amounts: [amount.toString()],
        fee: {type: 'level', config: {feeLevel: 'MEDIUM'}},
        entitySecretCiphertext
      };

      const transactionResponse = await this.client.createTransaction(transferRequest);
      const tx = transactionResponse.data;
      if (!tx?.id) throw new Error('Transaction creation failed');
      const confirmedTx = await this.waitForTransactionConfirmation(tx.id);

      this.updateWalletRulesAfterPayment(walletRules, amount, merchantAddress);

      return {
        success: true,
        transaction: confirmedTx,
        transactionHash: confirmedTx.txHash,
        remainingDailyLimit: walletRules.limits.dailySpendLimit - walletRules.usage.dailySpent,
        remainingTransactions: walletRules.limits.maxTransactionsPerDay - walletRules.usage.transactionCount,
        newBalance: await this.getWalletBalance(walletRules.walletId)
      };
    } catch (error) {
      console.error('🚨 Payment error:', error.message);
      if (error.response) {
        console.error('🔍 Full response data:', error.response.data);
        console.error('🔍 Status:', error.response.status);
      }
      return {success: false, error: error.message};
    }
  }

  // Kill switch with proper error handling
  async executeKillSwitch(nfcUID, walletRulesStore) {
    try {
      if (!this.isInitialized) {
        throw new Error('Wallet manager not initialized');
      }

      console.log(`🚨 Executing kill switch for ${nfcUID}...`);

      const walletRules = walletRulesStore[nfcUID];
      if (!walletRules) {
        throw new Error('NFC card not registered');
      }

      // Disable card immediately
      walletRules.active = false;
      walletRules.security.blocked = true;

      // Get balance
      const balance = await this.getWalletBalance(walletRules.walletId);
      const balanceAmount = parseFloat(balance);

      if (balanceAmount > 0) {
        // Get USDC token ID
        const usdcTokenId = this.getUSDCTokenId();

        // Create withdrawal transaction
        const withdrawalRequest = {
          idempotencyKey: uuidv4(),
          amounts: [balance],
          destinationAddress: this.mainWallet.address,
          tokenId: usdcTokenId,
          walletId: walletRules.walletId,
          fee: {
            type: 'level',
            config: {
              feeLevel: 'HIGH'
            }
          }
        };

        console.log('📤 Creating emergency withdrawal...');
        const withdrawalResponse = await this.client.createTransaction(withdrawalRequest);
        const transaction = withdrawalResponse.data.transaction;

        // Wait for confirmation
        const confirmedTx = await this.waitForTransactionConfirmation(transaction.id);

        console.log('🚨 Kill switch executed - funds withdrawn:', balanceAmount, 'USDC');

        return {
          success: true,
          withdrawnAmount: balanceAmount,
          transaction: confirmedTx,
          transactionHash: confirmedTx.txHash,
          withdrawalAddress: this.mainWallet.address
        };
      } else {
        console.log('🚨 Kill switch executed - no funds to withdraw');
        return { success: true, withdrawnAmount: 0 };
      }

    } catch (error) {
      console.error('❌ Kill switch failed:', error.message);
      throw new Error(`Kill switch failed: ${error.message}`);
    }
  }

  // Security checks (same as before)
  performSecurityChecks(walletRules, amount, merchantAddress) {
    const today = new Date().toDateString();

    if (walletRules.usage.lastResetDate !== today) {
      this.resetDailyLimits(walletRules);
    }

    if (!walletRules.active || walletRules.security.blocked) {
      return { passed: false, reason: 'Card disabled or blocked' };
    }

    if (amount > walletRules.limits.maxTransactionAmount) {
      return {
        passed: false,
        reason: `Transaction amount ${amount} exceeds limit ${walletRules.limits.maxTransactionAmount}`
      };
    }

    if (walletRules.usage.dailySpent + amount > walletRules.limits.dailySpendLimit) {
      return {
        passed: false,
        reason: `Daily spend limit would be exceeded. Current: ${walletRules.usage.dailySpent}, Limit: ${walletRules.limits.dailySpendLimit}`
      };
    }

    if (walletRules.usage.transactionCount >= walletRules.limits.maxTransactionsPerDay) {
      return {
        passed: false,
        reason: 'Daily transaction limit reached'
      };
    }

    return { passed: true };
  }

  updateWalletRulesAfterPayment(walletRules, amount, merchantAddress) {
    walletRules.usage.dailySpent += amount;
    walletRules.usage.transactionCount += 1;
    walletRules.usage.lastTransactionDate = new Date().toISOString();
  }

  resetDailyLimits(walletRules) {
    const today = new Date().toDateString();
    walletRules.usage.dailySpent = 0;
    walletRules.usage.transactionCount = 0;
    walletRules.usage.lastResetDate = today;
    console.log(`🔄 Daily limits reset for ${walletRules.nfcUID}`);
  }

  // Wait for transaction confirmation with timeout
  async waitForTransactionConfirmation(transactionId, maxWaitTime = 120000) {
    const startTime = Date.now();
    console.log(`⏳ Waiting for transaction confirmation: ${transactionId}`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await this.client.getTransaction({ id: transactionId });
        const transaction = response.data.transaction;

        console.log(`📊 Transaction ${transactionId} status: ${transaction.state}`);

        if (transaction.state === 'CONFIRMED') {
          console.log('✅ Transaction confirmed:', transactionId);
          return transaction;
        } else if (transaction.state === 'FAILED') {
          throw new Error(`Transaction failed: ${transaction.errorReason || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error('Error checking transaction status:', error.message);
        throw error;
      }
    }

    throw new Error('Transaction confirmation timeout');
  }
}

module.exports = CircleWalletManager;