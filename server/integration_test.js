const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
const baseUrl = 'http://localhost:3001/api';

async function runTests() {
    console.log("=== Setting up test users ===");
    
    // Create candidate
    const { data: candAuth, error: cErr } = await supabase.auth.admin.createUser({
        email: 'test_cand_' + Date.now() + '@example.com',
        password: 'password123',
        email_confirm: true
    });
    if (cErr) throw cErr;
    const candidateId = candAuth.user.id;
    await supabase.from('profiles').update({ role: 'candidate', display_name: 'Test Candidate' }).eq('user_id', candidateId);

    // Create HR
    const { data: hrAuth, error: hErr } = await supabase.auth.admin.createUser({
        email: 'test_hr_' + Date.now() + '@example.com',
        password: 'password123',
        email_confirm: true
    });
    if (hErr) throw hErr;
    const hrId = hrAuth.user.id;
    await supabase.from('profiles').update({ role: 'hr', display_name: 'Test HR' }).eq('user_id', hrId);

    // Create super_admin
    const { data: adminAuth, error: aErr } = await supabase.auth.admin.createUser({
        email: 'test_admin_' + Date.now() + '@example.com',
        password: 'password123',
        email_confirm: true
    });
    if (aErr) throw aErr;
    const adminId = adminAuth.user.id;
    await supabase.from('profiles').update({ role: 'super_admin', display_name: 'Test Admin' }).eq('user_id', adminId);

    console.log(`Created Candidate: ${candidateId}`);
    console.log(`Created HR: ${hrId}`);
    console.log(`Created Admin: ${adminId}`);

    // Get tokens
    const { data: candSession } = await supabase.auth.signInWithPassword({ email: candAuth.user.email, password: 'password123' });
    const candToken = candSession.session.access_token;

    const { data: hrSession } = await supabase.auth.signInWithPassword({ email: hrAuth.user.email, password: 'password123' });
    const hrToken = hrSession.session.access_token;

    const { data: adminSession } = await supabase.auth.signInWithPassword({ email: adminAuth.user.email, password: 'password123' });
    const adminToken = adminSession.session.access_token;

    console.log("\n=== Running API Tests ===");

    try {
        let res = await fetch(`${baseUrl}/admin/candidate/${candidateId}/reset-verification`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        console.log("[Admin] Reset Status:", res.status);

        res = await fetch(`${baseUrl}/candidate-videos/init-upload`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${candToken}`
            },
            body: JSON.stringify({ candidateUserId: candidateId, originalName: 't1.webm', extension: 'webm' })
        });
        let data = await res.json();
        console.log("[Candidate] Init Upload Status:", res.status);
        const video1Id = data.videoRecord?.id;

        res = await fetch(`${baseUrl}/candidate-videos/${video1Id}/complete-upload`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${candToken}`
            }
        });
        console.log("[Candidate] Complete Upload Status:", res.status);

        res = await fetch(`${baseUrl}/candidate-videos/init-upload`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${candToken}`
            },
            body: JSON.stringify({ candidateUserId: candidateId, originalName: 't2.webm', extension: 'webm' })
        });
        data = await res.json();
        const video2Id = data.videoRecord?.id;
        
        res = await fetch(`${baseUrl}/candidate-videos/${video2Id}/complete-upload`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${candToken}`
            }
        });
        console.log("[Candidate] Complete Upload 2 Status:", res.status);

        // Check if v1 is archived
        const { data: v1Check } = await supabase.from('candidate_videos').select('status').eq('id', video1Id).single();
        console.log(`Video 1 status after Video 2 complete: ${v1Check.status} (Expected: archived)`);

        // Approve video2
        res = await fetch(`${baseUrl}/candidate-videos/${video2Id}/approve`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${hrToken}`
            },
            body: JSON.stringify({ hrUserId: hrId, hrNameSnapshot: 'Test HR' })
        });
        console.log("[HR] Approve Status:", res.status);

        // Try init-upload while verified
        res = await fetch(`${baseUrl}/candidate-videos/init-upload`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${candToken}`
            },
            body: JSON.stringify({ candidateUserId: candidateId, originalName: 'block.webm', extension: 'webm' })
        });
        console.log("[Candidate] Init Upload while verified Status:", res.status, "(Expected: 409)");

        // Admin Reset
        res = await fetch(`${baseUrl}/admin/candidate/${candidateId}/reset-verification`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        console.log("[Admin] Reset Status:", res.status);

        const { data: v2Check } = await supabase.from('candidate_videos').select('status').eq('id', video2Id).single();
        console.log(`Video 2 status after reset: ${v2Check.status} (Expected: archived)`);

    } finally {
        console.log("\n=== Cleaning up test users ===");
        await supabase.auth.admin.deleteUser(candidateId);
        await supabase.auth.admin.deleteUser(hrId);
        await supabase.auth.admin.deleteUser(adminId);
        console.log("Cleanup complete.");
        process.exit(0);
    }
}

runTests();
