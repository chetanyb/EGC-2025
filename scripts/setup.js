// setup.js - Initial setup script
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setup() {
  console.log('🚀 NFC Smart Wallet Setup');
  console.log('='.repeat(40));
  console.log('Welcome to the NFC Smart Wallet setup!\n');

  try {
    // Check if .env already exists
    let envExists = false;
    try {
      await fs.access('.env');
      envExists = true;
    } catch (error) {
      // .env doesn't exist, which is fine
    }

    if (envExists) {
      const overwrite = await question('⚠️  .env file already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('Setup cancelled.');
        rl.close();
        return;
      }
    }

    console.log('\n📋 Please provide your Circle API credentials:');
    console.log('Get them from: https://console.circle.com/\n');

    const apiKey = await question('Enter your Circle API Key: ');
    if (!apiKey) {
      console.log('❌ API Key is required!');
      rl.close();
      return;
    }

    const entitySecret = await question('Enter your Circle Entity Secret: ');
    if (!entitySecret) {
      console.log('❌ Entity Secret is required!');
      rl.close();
      return;
    }

    const port = await question('Enter server port (default 3001): ') || '3001';

    // Create .env file
    const envContent = `# Circle API Configuration
CIRCLE_API_KEY=${apiKey}
CIRCLE_ENTITY_SECRET=${entitySecret}
CIRCLE_BASE_URL=https://api.circle.com/v1/w3s/

# Server Configuration
PORT=${port}
NODE_ENV=development

# USDC Token Configuration (Polygon Amoy Testnet)
USDC_TOKEN_ID=USDC

# Demo Configuration
DEMO_MODE=true
ENABLE_TESTING=true
`;

    await fs.writeFile('.env', envContent);
    console.log('✅ .env file created successfully!');

    // Create logs directory
    try {
      await fs.mkdir('logs');
      console.log('✅ Logs directory created');
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.log('⚠️  Could not create logs directory:', error.message);
      }
    }

    console.log('\n🎉 Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Run: npm run demo');
    console.log('2. Open: http://localhost:' + port);
    console.log('3. Test with demo NFC cards');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  } finally {
    rl.close();
  }
}

setup();

