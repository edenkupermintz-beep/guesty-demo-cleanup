const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Always load cloner/.env (never the repo-root Apprentice .env), regardless of cwd.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const axios = require('axios');

// ==========================================
// 1. CONFIGURATION & ACCOUNT AUTHENTICATION
// ==========================================
const BASE_URL = 'https://open-api.guesty.com/v1';

const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID;
const DEMO_CLIENT_SECRET = process.env.DEMO_CLIENT_SECRET;

if (!DEMO_CLIENT_ID || !DEMO_CLIENT_SECRET) {
    console.error("❌ Missing DEMO_CLIENT_ID or DEMO_CLIENT_SECRET in cloner/.env.");
    process.exit(1);
}

const DEMO_TOKEN_FILE = path.join(__dirname, '.token_cache_demo.json');

const demoClient = axios.create({ baseURL: BASE_URL });
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getCachedOrFreshToken(clientId, clientSecret, cacheFilePath) {
    const currentCredsHash = crypto.createHash('md5').update(`${clientId}:${clientSecret}`).digest('hex');
    if (fs.existsSync(cacheFilePath)) {
        try {
            const cache = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
            if (cache.credsHash === currentCredsHash && Date.now() < (cache.expiresAt - 60000)) {
                return cache.token;
            }
        } catch (e) {}
    }
    const response = await axios.post('https://open-api.guesty.com/oauth2/token', {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
    }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const token = response.data.access_token;
    fs.writeFileSync(cacheFilePath, JSON.stringify({ token, expiresAt: Date.now() + (response.data.expires_in || 3600) * 1000, credsHash: currentCredsHash }, null, 2));
    return token;
}

// ==========================================
// 2. ABSOLUTE PURGE ENGINE
// ==========================================
async function globalFactoryReset() {
    try {
        console.log("🔐 Authenticating Sandbox Client...");
        const demoToken = await getCachedOrFreshToken(DEMO_CLIENT_ID, DEMO_CLIENT_SECRET, DEMO_TOKEN_FILE);
        demoClient.defaults.headers.common['Authorization'] = `Bearer ${demoToken}`;

        console.log("💣 CRITICAL: Beginning global purge on target demo account...");

        // ------------------------------------------
        // PHASE 1: CLEANING CALENDARS & RESERVATIONS
        // ------------------------------------------
        console.log("\n🔎 Scanning for open reservations...");
        const reservationsRes = await demoClient.get('/reservations?limit=100');
        const reservations = reservationsRes.data.results || [];
        
        // Catch any reservation that isn't already canceled (using one 'l' to stay safe)
        const activeReservations = reservations.filter(res => res.status !== 'canceled' && res.status !== 'cancelled');

        if (activeReservations.length > 0) {
            console.log(`🧹 Found ${activeReservations.length} active bookings. Cancelling reservations to clear calendars...`);
            for (let i = 0; i < activeReservations.length; i++) {
                const resObj = activeReservations[i];
                try {
                    try {
                        // Attempt standard operational channel cancel flow
                        await demoClient.post(`/reservations/${resObj._id}/cancel`);
                        console.log(`   ✅ Cancelled Booking: ${resObj._id}`);
                    } catch (e) {
                        // FIXED: Altered payload string assignment spelling from 'cancelled' -> 'canceled' (Single 'l')
                        await demoClient.put(`/reservations/${resObj._id}`, { status: 'canceled' });
                        console.log(`   ✅ Status updated to canceled: ${resObj._id}`);
                    }
                } catch (innerErr) {
                    console.warn(`   ⚠️ Non-fatal reservation warning: Could not alter state for ${resObj._id}. Skipping past locked object...`);
                }
                await delay(1000);
            }
        } else {
            console.log("✨ No active reservations found.");
        }

        // ------------------------------------------
        // PHASE 2: GLOBAL LISTINGS DEACTIVATION
        // ------------------------------------------
        console.log("\n🔎 Scanning for operational listings...");
        const listingsRes = await demoClient.get('/listings?active=true&limit=100');
        const activeListings = listingsRes.data.results || [];

        if (activeListings.length === 0) {
            console.log("✨ Account is already completely empty and clean!");
            return;
        }

        console.log(`🧹 Found ${activeListings.length} active properties. Starting full deactivation wipe...`);

        for (let i = 0; i < activeListings.length; i++) {
            const target = activeListings[i];
            console.log(`\n[Listing ${i + 1}/${activeListings.length}] Wiping: "${target.title || 'Untitled'}" (ID: ${target._id})`);

            const wipePayload = {
                active: false,
                isListed: false,
                pms: {
                    active: false
                }
            };

            await demoClient.put(`/listings/${target._id}`, wipePayload);
            console.log(`✅ Property hidden from main dashboard grids and multi-calendar views.`);

            if (i < activeListings.length - 1) {
                await delay(1500); 
            }
        }

        console.log("\n🎉 UNIVERSE PURGE COMPLETE! The account environment has been completely reset to a blank slate.");

    } catch (error) {
        console.error("❌ Purge execution interrupted:");
        if (error.response && error.response.data) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

globalFactoryReset();