const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // Make sure to load environment variables

// Check if environment variables are loaded
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error("Supabase URL or Anon Key is missing from .env file");
}

// Create a single Supabase client for your application
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// IMPORTANT: Export the client
module.exports = { supabase };