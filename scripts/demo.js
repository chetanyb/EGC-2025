// demo.js - Demo runner script
const express = require('express');
const path = require('path');
const { setupDemo, createNFCRoutes } = require('../src/nfc-integration');
require('dotenv').config();

async function runDemo() {
  console.log('🎬 Starting NFC Smart Wallet Demo...');

  const app = express();
  const PORT = process.env.PORT || 3001;

  // Middleware
  app.use(express.json());
  app.use(express.static('public'));

  // Serve the POS interface
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'merchant-pos.html'));
  });

  // Import main server routes
  const mainServer = require('../src/server');

  // Add NFC testing routes
  app.use('/api/nfc', createNFCRoutes());

  // Demo endpoints
  app.get('/api/demo/status', (req, res) => {
    res.json({
      demo: true,
      timestamp: new Date().toISOString(),
      availableCards: [
        'DEMO_CARD_001',
        'DEMO_CARD_002',
        'DEMO_CARD_VIP'
      ],
      instructions: [
        '1. Enter amount on POS',
        '2. Click "Ready for Payment"',
        '3. Automatic NFC simulation will trigger',
        '4. View transaction results'
      ]
    });
  });

  // Setup demo data
  try {

    app.listen(PORT, () => {
      console.log('\n🎉 Demo is ready!');
      console.log(`📱 Open your browser to: http://localhost:${PORT}`);
      console.log('💳 Demo NFC cards available:');
      console.log('   - DEMO_CARD_001 (Limit: $50/tx, $200/day)');
      console.log('   - DEMO_CARD_002 (Limit: $25/tx, $100/day)');
      console.log('   - DEMO_CARD_VIP (Limit: $200/tx, $1000/day)');
      console.log('\n📊 Test endpoints:');
      console.log(`   - POST ${PORT}/api/nfc/test-suite`);
      console.log(`   - GET ${PORT}/api/demo/status`);
    });
  } catch (error) {
    console.error('❌ Demo setup failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runDemo();
}

module.exports = { runDemo };
