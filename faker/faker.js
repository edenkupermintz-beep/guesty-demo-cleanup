require('dotenv').config(); // Load environment variables from .env file

const axios = require('axios');
const { faker } = require('@faker-js/faker');

// Pull credentials strictly from environment variables
const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;
const BASE_URL = 'https://open-api.guesty.com/v1';

// Validate credentials before making API requests
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET in environment variables.");
    process.exit(1);
}

// Axios instance with interceptor for 429 Exponential Backoff
const apiClient = axios.create({ baseURL: BASE_URL });

apiClient.interceptors.response.use(null, async (error) => {
    if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || 2;
        console.warn(`⚠️ Rate limited by Guesty. Backing off for ${retryAfter} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return apiClient.request(error.config);
    }
    return Promise.reject(error);
});

// Helper function for proactive throttling
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getAccessToken() {
    const response = await axios.post('https://open-api.guesty.com/oauth2/token', {
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
    }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return response.data.access_token;
}

async function seedDemoReservations() {
    const token = await getAccessToken();
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    try {
        // 1. Fetch a larger pool of listings
        const listingsRes = await apiClient.get('/listings?limit=50');
        
        // ARCHITECTURE UPGRADE: Strict client-side verification to ensure only 'active' listings are used
        const listings = listingsRes.data.results.filter(listing => listing.active === true);
        
        if (listings.length === 0) throw new Error("No active listings found in demo account after filtering.");

        // 2. Calculate "Rolling 30-Day" date range safely
        const today = new Date();
        const searchStart = new Date(today);
        searchStart.setDate(today.getDate() + 1);
        
        const searchEnd = new Date(searchStart);
        searchEnd.setDate(searchStart.getDate() + 30);
        
        const formatDate = (date) => {
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        const startDateStr = formatDate(searchStart);
        const endDateStr = formatDate(searchEnd);

        console.log(`Checking availability from ${startDateStr} to ${endDateStr} across ${listings.length} explicitly ACTIVE listings...`);

        let createdCount = 0;
        let attempts = 0;
        const targetReservations = 30;
        const delayBetweenBookingsMs = 2000; // 2 seconds
        const maxAttempts = 50; // Prevent infinite loop if calendars are full

        // 3. Randomized Round Robin Booking Loop
        while (createdCount < targetReservations && attempts < maxAttempts) {
            attempts++;

            // Pick a completely random active listing from the array
            const listing = listings[Math.floor(Math.random() * listings.length)];

            // Fetch its specific calendar
            const calRes = await apiClient.get(`/availability-pricing/api/calendar/listings/${listing._id}?startDate=${startDateStr}&endDate=${endDateStr}`);
            const days = calRes.data.data.days;

            const availableDays = days.filter(day => {
                return typeof day.allotment === 'number' ? day.allotment > 0 : day.status === 'available';
            });

            // Scan to find ALL valid slots for this specific listing
            let validSlots = [];
            for (let i = 0; i < availableDays.length; i++) {
                const checkInDay = availableDays[i];
                const lengthOfStay = checkInDay.minNights || listing.terms?.minNights || 1;

                if (i + lengthOfStay >= availableDays.length) continue;

                const checkOutDay = availableDays[i + lengthOfStay];
                const checkInDateObj = new Date(checkInDay.date);
                const checkOutDateObj = new Date(checkOutDay.date);
                const diffTime = Math.abs(checkOutDateObj - checkInDateObj);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays === lengthOfStay) {
                    validSlots.push({
                        checkInDate: checkInDay.date,
                        checkOutDate: checkOutDay.date,
                        lengthOfStay: lengthOfStay
                    });
                }
            }

            // If this random listing is fully booked, loop again and pick another
            if (validSlots.length === 0) {
                continue; 
            }

            // Pick a completely random date slot from the valid options
            const slot = validSlots[Math.floor(Math.random() * validSlots.length)];

            const firstName = faker.person.firstName();
            const lastName = faker.person.lastName();
            const email = faker.internet.email({ firstName, lastName });

            const reservationPayload = {
                listingId: listing._id,
                checkInDateLocalized: slot.checkInDate,
                checkOutDateLocalized: slot.checkOutDate,
                status: "confirmed",
                money: {
                    currency: "USD",
                    fareAccommodation: faker.number.int({ min: 150, max: 800 }) * slot.lengthOfStay
                },
                guest: {
                    firstName: firstName,
                    lastName: lastName,
                    email: email,
                    phone: faker.phone.number()
                }
            };

            console.log(`Booking ${listing.title || listing._id}: ${slot.checkInDate} to ${slot.checkOutDate} (${slot.lengthOfStay} nights) for ${firstName} ${lastName}...`);
            
            try {
                const res = await apiClient.post('/reservations', reservationPayload);
                console.log(`✅ Reservation Created: ${res.data._id}`);
                createdCount++;
                
                if (createdCount < targetReservations) {
                    console.log(`⏳ Pausing for ${delayBetweenBookingsMs / 1000} seconds...`);
                    await delay(delayBetweenBookingsMs);
                }
            } catch (err) {
                console.error(`❌ Failed to book listing ${listing._id}:`);
                if (err.response && err.response.data) {
                    console.error(JSON.stringify(err.response.data, null, 2));
                } else {
                    console.error(err.message);
                }
            }
        }
        
        if (createdCount < targetReservations) {
            console.log(`\n⚠️ Finished after ${attempts} attempts. Seeded ${createdCount} out of ${targetReservations} requested reservations. (Calendars may be full).`);
        } else {
            console.log(`\n🎉 Successfully seeded ${createdCount} random demo reservations.`);
        }
        
    } catch (error) {
        console.error("❌ Fatal Error:", error.response?.data || error.message);
    }
}

seedDemoReservations();