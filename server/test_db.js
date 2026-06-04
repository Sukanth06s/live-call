const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testDatabase() {
    console.log("Checking for candidate_verification table...");
    
    // Attempt to query the table
    const { data, error } = await supabase
        .from('candidate_verification')
        .select('*')
        .limit(1);

    if (error) {
        console.error("Migration test failed! Please run the SQL migration script in your Supabase Dashboard SQL Editor.");
        console.error("Error details:", error.message);
        process.exit(1);
    } else {
        console.log("Migration test passed! The candidate_verification table exists.");
    }

    console.log("Checking if approve_candidate_video RPC exists...");
    const { data: rpcData, error: rpcError } = await supabase
        .rpc('approve_candidate_video', { 
            p_video_id: '00000000-0000-0000-0000-000000000000', 
            p_hr_user_id: '00000000-0000-0000-0000-000000000000', 
            p_hr_name_snapshot: 'Test HR' 
        });

    if (rpcError && !rpcError.message.includes('Video not found')) {
        console.error("RPC test failed! The approve_candidate_video function might not exist or failed unexpectedly.");
        console.error("Error details:", rpcError.message);
        process.exit(1);
    } else {
        console.log("RPC test passed! The approve_candidate_video function exists and responded as expected.");
    }
    
    console.log("All DB checks passed. Ready for full endpoint testing.");
}

testDatabase();
