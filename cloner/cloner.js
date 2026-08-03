const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Always load cloner/.env (never the repo-root Apprentice .env), regardless of cwd.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const axios = require('axios');
const { faker } = require('@faker-js/faker');

// ==========================================
// 1. CONFIGURATION & DUAL CLIENT SETUP
// ==========================================
const BASE_URL = 'https://open-api.guesty.com/v1';

// CORE ACCOUNT (Source)
const CORE_CLIENT_ID = process.env.CORE_CLIENT_ID;
const CORE_CLIENT_SECRET = process.env.CORE_CLIENT_SECRET;

// DEMO ACCOUNT (Destination)
const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID;
const DEMO_CLIENT_SECRET = process.env.DEMO_CLIENT_SECRET;

// Guard check: Validate credentials before executing
if (!CORE_CLIENT_ID || !CORE_CLIENT_SECRET || !DEMO_CLIENT_ID || !DEMO_CLIENT_SECRET) {
    console.error("❌ Missing required CORE or DEMO credentials in cloner/.env.");
    process.exit(1);
}

// CONFIGURABLE CONTROL PANEL: Change this number to alter the loop iterations performed
const targetLoops = 5;
const reservationsPerListing = 3;   // Advanced Change: Number of staggered reservations to build PER listing

// File token paths for local storage caching
const CORE_TOKEN_FILE = path.join(__dirname, '.token_cache_core.json');
const DEMO_TOKEN_FILE = path.join(__dirname, '.token_cache_demo.json');

// Main script
const createApiClient = () => {
    const client = axios.create({ baseURL: BASE_URL });
    client.interceptors.response.use(null, async (error) => {
        if (error.response && error.response.status === 429) {
            const retryAfter = error.response.headers['retry-after'] || 3;
            console.warn(`⚠️ Rate limited by Guesty API. Backing off for ${retryAfter} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return client.request(error.config);
        }
        return Promise.reject(error);
    });
    return client;
};

const coreClient = createApiClient();
const demoClient = createApiClient();
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getCachedOrFreshToken(clientId, clientSecret, cacheFilePath, accountLabel) {
    const currentCredsHash = crypto.createHash('md5').update(`${clientId}:${clientSecret}`).digest('hex');

    if (fs.existsSync(cacheFilePath)) {
        try {
            const cache = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
            const bufferTime = 60 * 1000;
            if (cache.credsHash === currentCredsHash && Date.now() < (cache.expiresAt - bufferTime)) {
                console.log(`💾 Using cached Bearer token for [${accountLabel}]`);
                return cache.token;
            }
        } catch (e) {}
    }

    console.log(`🌐 Fetching fresh token from Guesty authorization server for [${accountLabel}]...`);
    const response = await axios.post('https://open-api.guesty.com/oauth2/token', {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
    }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const token = response.data.access_token;
    const expiresInMs = (response.data.expires_in || 3600) * 1000; 
    
    const cacheData = { token: token, expiresAt: Date.now() + expiresInMs, credsHash: currentCredsHash };
    fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');
    
    return token;
}

const getNextValidBookingDates = async (listingId, demoClient, currentSearchStartDate, targetLengthOfStay) => {
    const end = new Date(currentSearchStartDate); 
    end.setDate(currentSearchStartDate.getDate() + 60);
    
    const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const startStr = formatDate(currentSearchStartDate);
    const endStr = formatDate(end);

    const maxRetries = 5;
    const pollingInterval = 2500; 

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const calRes = await demoClient.get(`/availability-pricing/api/calendar/listings/${listingId}?startDate=${startStr}&endDate=${endStr}`);
            const days = calRes.data.data.days;

            const availableDays = days.filter(day => {
                return typeof day.allotment === 'number' ? day.allotment > 0 : day.status === 'available';
            });

            for (let i = 0; i < availableDays.length; i++) {
                const checkInDay = availableDays[i];

                if (i + targetLengthOfStay >= availableDays.length) continue;

                const checkOutDay = availableDays[i + targetLengthOfStay];
                const checkInDateObj = new Date(checkInDay.date);
                const checkOutDateObj = new Date(checkOutDay.date);
                const diffTime = Math.abs(checkOutDateObj - checkInDateObj);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays === targetLengthOfStay) {
                    return { checkIn: checkInDay.date, checkOut: checkOutDay.date, lengthOfStay: targetLengthOfStay };
                }
            }
            return null; 
        } catch (err) {
            const isNotFoundError = err.message?.includes('Listing not found') || (err.response && JSON.stringify(err.response.data).includes('not found'));
            if (isNotFoundError && attempt < maxRetries) {
                console.warn(`⏳ [Attempt ${attempt}/${maxRetries}] Syncing calendar service pipeline... Retrying in 2.5s...`);
                await delay(pollingInterval);
            } else {
                throw err;
            }
        }
    }
    return null;
};

// ==========================================
// 2. MAIN DEEP CLONING ENGINE
// ==========================================
async function runSandboxSetup() {
    try {
        console.log("🔐 Initializing Identity Credentials...");
        const coreToken = await getCachedOrFreshToken(CORE_CLIENT_ID, CORE_CLIENT_SECRET, CORE_TOKEN_FILE, 'Core Account');
        const demoToken = await getCachedOrFreshToken(DEMO_CLIENT_ID, DEMO_CLIENT_SECRET, DEMO_TOKEN_FILE, 'Demo Account');

        coreClient.defaults.headers.common['Authorization'] = `Bearer ${coreToken}`;
        demoClient.defaults.headers.common['Authorization'] = `Bearer ${demoToken}`;

        console.log(`📦 Fetching complete source listing details from Core...`);
        const coreListingsRes = await coreClient.get(`/listings?active=true&limit=${targetLoops}`);
        const coreListings = coreListingsRes.data.results;

        if (coreListings.length === 0) throw new Error("No active listings found in Core account.");

        const loops = Math.min(coreListings.length, targetLoops);

        for (let i = 0; i < loops; i++) {
            const sourceListing = coreListings[i];
            
            // RANDOMIZED TITLE ENGINE GENERATION
            const titlePool = [
                'Chic Urban Escape', 'Luxurious Midtown Suite', 'Modern Downtown Loft', 
                'Cozy Metro Flat', 'Premium Central Stay', 'Elegant City Sanctuary', 
                'Stunning Skyline Haven', 'The Industrial Hideaway'
            ];
            const baseRandomTitle = titlePool[Math.floor(Math.random() * titlePool.length)];
            const uniqueRandomSuffix = faker.string.alphanumeric({ length: 4, casing: 'upper' });
            const finalRandomizedTitle = `${baseRandomTitle} ${uniqueRandomSuffix}`;

            const legacyLetterTag = faker.string.alpha({ length: 1, casing: 'upper' });
            const legacyNumberTag = faker.number.int({ min: 1, max: 10 });
            const compliantLegacyNickname = `Guesty Test Listing ${legacyLetterTag}${legacyNumberTag}`;

            console.log(`\n--- 🔄 Deep Cloning Property ${i + 1} of ${loops}: Title: "${finalRandomizedTitle}" ---`);
            
            if (i > 0) {
                console.log(`⏳ Loop Interval: Pausing 3 seconds to keep API limits clean...`);
                await delay(3000);
            }

            const dynamicPicturesArray = Array.isArray(sourceListing.pictures) ? sourceListing.pictures.map(pic => ({
                original: pic.url || pic.original, 
                caption: pic.caption || "Property Image"
            })).filter(p => p.original) : [];

            // 1. DUPLICATE LISTING DATA SCHEMATICS
            const listingPayload = {
                title: finalRandomizedTitle,
                nickname: compliantLegacyNickname, 
                
                type: "SINGLE", 
                active: true,
                isListed: true, 
                pms: {
                    active: true
                },
                housekeeping: {
                    status: "clean"
                },

                propertyType: sourceListing.propertyType || "apartment",
                roomType: sourceListing.roomType || "entire_home",
                publicDescription: sourceListing.publicDescription || undefined,
                amenities: Array.isArray(sourceListing.amenities) ? sourceListing.amenities : [],
                
                accommodates: sourceListing.accommodates || 2,
                bathrooms: sourceListing.bathrooms || 1,
                bedrooms: sourceListing.bedrooms || 1,
                beds: sourceListing.beds || 1,
                squareMeters: sourceListing.squareMeters || undefined,

                pictures: dynamicPicturesArray,

                prices: {
                    basePrice: sourceListing.prices?.basePrice || 150,
                    currency: sourceListing.prices?.currency || "USD",
                    weekendPrice: sourceListing.prices?.weekendPrice || undefined
                },

                address: {
                    full: sourceListing.address?.full || faker.location.streetAddress({ useFullAddress: true }),
                    street: sourceListing.address?.street || undefined,
                    city: sourceListing.address?.city || undefined,
                    state: sourceListing.address?.state || undefined,
                    country: sourceListing.address?.country || undefined,
                    zipcode: sourceListing.address?.zipcode || undefined
                }
            };
            
            Object.keys(listingPayload).forEach(key => listingPayload[key] === undefined && delete listingPayload[key]);

            const demoListingRes = await demoClient.post('/listings', listingPayload);
            const newListingId = demoListingRes.data._id;
            console.log(`✅ Duplicated Property Entity [Status: CLEAN] -> Demo ID: ${newListingId}`);

            // 2. CREATE A TASK
            const taskPayload = {
                title: "Pre-arrival Sandbox Verification Inspection",
                listingId: newListingId,
                status: "pending" 
            };
            await demoClient.post('/tasks', taskPayload);
            console.log(`✅ Created Task for Listing`);

            console.log(`⏳ Syncing with Guesty calendar server...`);
            await delay(2000);

            // 3. NESTED LAYER: DYNAMIC BOOKING FACTORY
            let calendarSearchPointer = new Date();
            calendarSearchPointer.setDate(calendarSearchPointer.getDate() + 1);

            // FIXED: Restored complete valid stay distribution array mapping
            const stayLengthDistribution = [1, 2, 3, 4, 5];

            console.log(`📡 Spawning ${reservationsPerListing} staggered reservations for this property...`);
            
            // FIXED: Restored complete closed loop declaration layer boundary block
            for (let r = 0; r < reservationsPerListing; r++) {
                const chosenLengthOfStay = stayLengthDistribution[Math.floor(Math.random() * stayLengthDistribution.length)];
                const dates = await getNextValidBookingDates(newListingId, demoClient, calendarSearchPointer, chosenLengthOfStay);
                
                if (dates) {
                    const guestFirstName = faker.person.firstName();
                    const guestLastName = faker.person.lastName();
                    
                    const validAreaCodes = ['212', '310', '312', '415', '617', '702', '305', '206'];
                    const chosenAreaCode = validAreaCodes[Math.floor(Math.random() * validAreaCodes.length)];
                    const exchangeCodeFirstDigit = faker.number.int({ min: 2, max: 9 });
                    const remainingSixDigits = faker.string.numeric(6);
                    const cleanPhoneString = `+1${chosenAreaCode}${exchangeCodeFirstDigit}${remainingSixDigits}`;

                    const reservationPayload = {
                        listingId: newListingId,
                        checkInDateLocalized: dates.checkIn,
                        checkOutDateLocalized: dates.checkOut,
                        status: "confirmed",
                        money: {
                            currency: listingPayload.prices.currency,
                            fareAccommodation: (listingPayload.prices.basePrice) * dates.lengthOfStay
                        },
                        guest: {
                            firstName: guestFirstName,
                            lastName: guestLastName,
                            email: faker.internet.email({ firstName: guestFirstName, lastName: guestLastName }),
                            phone: cleanPhoneString
                        }
                    };

                    const res = await demoClient.post('/reservations', reservationPayload);
                    console.log(`   📌 [Res ${r + 1}/${reservationsPerListing}] Booked: ${res.data._id} (${dates.checkIn} to ${dates.checkOut}, ${dates.lengthOfStay} nights)`);

                    const checkoutDateObj = new Date(dates.checkOut);
                    const randomCleaningGap = faker.number.int({ min: 1, max: 3 });
                    
                    checkoutDateObj.setDate(checkoutDateObj.getDate() + randomCleaningGap);
                    calendarSearchPointer = checkoutDateObj;

                    await delay(1000);
                } else {
                    console.log(`   ⚠️ [Res ${r + 1}/${reservationsPerListing}] Calendar space filled. Stopping sub-loop.`);
                    break;
                }
            }
        }
        
        console.log(`\n🎉 Advanced Deep Sandbox Clone Complete! Data matrices fully randomized, staggered, and populated.`);

    } catch (error) {
        console.error("❌ Fatal Error in Engine Execution Flow:");
        if (error.response && error.response.data) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

runSandboxSetup();