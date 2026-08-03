const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function runInitializer() {
  const stateFile = path.join(__dirname, 'state.json');
  let state = {
    nextAccountName: 'EMEA DEMO 37',
    nextEmail: 'nate.foster+38@guesty.com',
    rawAccountNum: 37,
    rawEmailNum: 38
  };

  if (fs.existsSync(stateFile)) {
    try {
      const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (typeof stateData.lastAccountNumber === 'number' && typeof stateData.lastEmailNumber === 'number') {
        const nextAccNum = stateData.lastAccountNumber + 1;
        const nextEmailNum = stateData.lastEmailNumber + 1;
        state.rawAccountNum = nextAccNum;
        state.rawEmailNum = nextEmailNum;
        state.nextAccountName = `EMEA DEMO ${nextAccNum}`;
        state.nextEmail = `nate.foster+${nextEmailNum}@guesty.com`;
      }
    } catch (e) {
      console.log('⚠️ State file corrupted or unreadable, utilizing defaults.');
    }
  }

  console.log(`🚀 Launching native Google Chrome instance...`);
  console.log(`🏢 Generated Account Name: ${state.nextAccountName}`);
  console.log(`📧 Generated Plus-Email:   ${state.nextEmail}`);

  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(__dirname, 'chrome_automation_profile'), {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: false,
      viewport: null,
      args: ['--no-first-run']
    });
    
    const page = await context.newPage();

    console.log('🎯 Navigating directly to registration form URL...');
    await page.goto('https://admin.guesty.com/registration');
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    if (currentUrl.includes('okta.com') || currentUrl.includes('login') || currentUrl.includes('auth')) {
      console.log('\n======================================================');
      console.log('⚠️  AUTHENTICATION REQUIRED! ⚠️');
      console.log('Please log into your Guesty/Okta workspace in the open Chrome window.');
      console.log('Once you successfully authenticate and land on the registration page,');
      console.log('the script will pick up right where it left off and save your cookies.');
      console.log('======================================================\n');
      
      await page.waitForURL('**/registration', { timeout: 300000 });
      console.log('✅ Session authenticated! Resuming form entry...');
    }

    console.log('⏳ Waiting for internal registration form to render...');
    await page.waitForSelector('text=Guesty for Pro Registration');

    // ==========================================
    // PAGE 1/2: COMPANY DETAILS
    // ==========================================
    console.log('✏️ Populating Company Profile form (Page 1)...');
    
    await page.locator('div').filter({ hasText: /^Company name \*/ }).locator('input').first().fill(state.nextAccountName);
    
    const addressInput = page.locator('div').filter({ hasText: /^Company address \*/ }).locator('input').first();
    await addressInput.pressSequentially('123 Innovation Way, Suite 400', { delay: 50 });
    
    await page.waitForTimeout(1500); 
    await addressInput.press('ArrowDown');
    await page.waitForTimeout(200);
    await addressInput.press('Enter');
    await page.waitForTimeout(500);

    await page.locator('div').filter({ hasText: /^Zip code \*/ }).locator('input').first().fill('28001');
    await page.waitForTimeout(500);

    await page.locator('text=I am an individual running a business').click();
    await page.waitForTimeout(500);

    console.log('➡️ Advancing form to Page 2/2...');
    await page.getByRole('button', { name: 'Next' }).click();

    // ==========================================
    // PAGE 2/2: PROFILE DETAILS
    // ==========================================
    console.log('⏳ Waiting for Profile Details form to load...');
    
    const firstNameInput = page.locator('label:has-text("First name *") + div input, div:has(> label:has-text("First name *")) input').first();
    await firstNameInput.waitFor({ state: 'visible', timeout: 10000 });

    console.log('✏️ Populating Profile Details form (Page 2)...');
    
    // 1. First & Last Name
    await firstNameInput.fill('Nate');
    await page.locator('label:has-text("Last name *") + div input, div:has(> label:has-text("Last name *")) input').first().fill('Foster');

    // 2. Phone Number
    await page.locator('div').filter({ hasText: /^Phone number/ }).locator('input').first().fill('2025550143');

    // 3. Plus-Addressed Email Input
    console.log(`📧 Injecting unique email path: ${state.nextEmail}`);
    await page.locator('label:has-text("Email *") + div input, div:has(> label:has-text("Email *")) input').first().fill(state.nextEmail);
    await page.waitForTimeout(500);

    // 4. FIXED: Target the text block container directly to toggle the custom graphical checkbox safely
    console.log('☑️ Checking Terms and Conditions checkbox option...');
    await page.locator('div').filter({ hasText: 'I have read and agree to the Guesty' }).locator('input[type="checkbox"]').first().check({ force: true });
    await page.waitForTimeout(500);

    // 5. Submit Final Form Registration
    console.log('🚀 Submitting registration form...');
    await page.getByRole('button', { name: 'Register' }).click();

    console.log('🎉 Form submission sent! Verifying complete transition state...');
    await page.waitForTimeout(6000);
    
    // 6. Commit State Updates
    const dataToSave = {
      lastAccountNumber: state.rawAccountNum,
      lastEmailNumber: state.rawEmailNum
    };
    fs.writeFileSync(stateFile, JSON.stringify(dataToSave, null, 2));
    console.log(`💾 State updated: Account ID #${state.rawAccountNum} & Email ID #${state.rawEmailNum} saved.`);

  } catch (error) {
    console.error('❌ Automation sequence encountered an error:', error);
  } finally {
    console.log('🔌 Shutting down automation context...');
    if (context) await context.close();
  }
}

runInitializer();