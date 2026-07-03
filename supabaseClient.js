const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL in environment');
}

// We will use service role on the backend (server-side only).
const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
if (!key) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY');
}

const supabase = createClient(SUPABASE_URL, key, {
  auth: {
    persistSession: false,
  },
});

module.exports = { supabase };

