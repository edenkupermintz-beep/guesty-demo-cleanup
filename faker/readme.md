# Reservation Faker Data Generator

Script to add new reservations to an existing demo account.

## 🚀 Step-by-Step Usage Instructions

### Step 1: Install Dependencies

Ensure you have Node.js installed, open your terminal in this folder, and run:

npm install

### Step 2: Configure Environment Variables

Create a file named .env in the root directory of your project to safely store your target API credentials:

GUESTY_CLIENT_ID=your_client_id_here
GUESTY_CLIENT_SECRET=your_client_secret_here

> ⚠️ **Security Note:** Never commit your .env file to version control. Ensure .env is listed inside your .gitignore file.

### Step 3: Run the Reservation Faker

Execute the generation script to begin streaming fake reservation traffic into your demo environment:

node faker.js