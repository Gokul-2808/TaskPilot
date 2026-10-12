


const SUPABASE_URL = "https://qmttpmbtaavvagnxvyxd.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mCS4Z8dcA41YHCJJCxBxsA_4dgRbiSY";

// Check that the Supabase library loaded
if (!window.supabase) {
  throw new Error(
    "Supabase library not loaded. Check your index.html script order."
  );
}

// Initialize Supabase
window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

console.log("TaskFlow: Supabase client initialized.");
