const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findTestUsers() {
    console.log("Fetching profiles...");
    const { data: candidates, error: cErr } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('role', 'candidate')
        .limit(1);

    if (cErr) console.error("Candidates error:", cErr);

    const { data: hrs, error: hErr } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('role', 'hr')
        .limit(1);

    if (hErr) console.error("HRs error:", hErr);

    console.log("Candidate:", candidates?.[0]?.user_id);
    console.log("HR:", hrs?.[0]?.user_id);
    
    // Create a dummy video row if candidate exists
    if (candidates?.[0]?.user_id) {
       console.log("All done.");
    }
}

findTestUsers();
