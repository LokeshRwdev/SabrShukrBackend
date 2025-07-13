const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

module.exports = supabase ;
module.exports.serviceRole = supabaseServiceRole;
