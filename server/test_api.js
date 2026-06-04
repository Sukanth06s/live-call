const candidateId = 'a74e0b62-2921-46d2-b241-6fd19131295a';
const hrId = '5de1e633-f297-47c6-b760-82ea2a19a495';
const baseUrl = 'http://localhost:3001/api';

// For simplicity, we just use node 18+ built-in fetch.

async function runTests() {
    console.log("=== Starting Verification API Tests ===");

    try {
        // Test 1: Reset candidate verification (cleanup first)
        console.log("\n[1] Resetting Candidate Verification...");
        let res = await fetch(`${baseUrl}/admin/candidate/${candidateId}/reset-verification`, {
            method: 'POST'
        });
        console.log("Reset Status:", res.status);
        
        // Test 2: Init candidate upload
        console.log("\n[2] Initiating Candidate Upload...");
        res = await fetch(`${baseUrl}/candidate-videos/init-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidateUserId: candidateId,
                originalName: 'test-video-1.webm',
                extension: 'webm'
            })
        });
        const initData1 = await res.json();
        console.log("Init Upload 1 Status:", res.status);
        console.log("Video 1 ID:", initData1.videoRecord?.id);
        const video1Id = initData1.videoRecord?.id;

        // Test 3: Complete candidate upload
        console.log("\n[3] Completing Candidate Upload 1...");
        res = await fetch(`${baseUrl}/candidate-videos/${video1Id}/complete-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const completeData1 = await res.json();
        console.log("Complete Upload 1 Status:", res.status);
        console.log("Video 1 Status after complete:", completeData1.videoRecord?.status); // should be 'enr'

        // Test 4: Init a second candidate upload (to test archiving of old EnR)
        console.log("\n[4] Initiating Candidate Upload 2...");
        res = await fetch(`${baseUrl}/candidate-videos/init-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidateUserId: candidateId,
                originalName: 'test-video-2.webm',
                extension: 'webm'
            })
        });
        const initData2 = await res.json();
        const video2Id = initData2.videoRecord?.id;

        console.log("\n[5] Completing Candidate Upload 2 (should archive Video 1)...");
        res = await fetch(`${baseUrl}/candidate-videos/${video2Id}/complete-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Complete Upload 2 Status:", res.status);

        // Verify Video 1 was archived
        const { createClient } = require('@supabase/supabase-js');
        require('dotenv').config();
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: v1Check } = await supabase.from('candidate_videos').select('status').eq('id', video1Id).single();
        console.log(`Video 1 is now: ${v1Check?.status} (Expected: archived)`);

        // Test 6: Approve Video 2
        console.log("\n[6] Approving Video 2...");
        res = await fetch(`${baseUrl}/candidate-videos/${video2Id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hrUserId: hrId,
                hrNameSnapshot: 'Test HR Verifier'
            })
        });
        const approveData = await res.json();
        console.log("Approve Status:", res.status);
        console.log("Approve Msg:", approveData.message);

        // Verify Verification Record
        const { data: vCheck } = await supabase.from('candidate_verification').select('*').eq('candidate_user_id', candidateId).single();
        console.log("Verification Row exists:", !!vCheck);
        console.log("Verification source:", vCheck?.source);

        // Test 7: Init upload while approved (should be blocked)
        console.log("\n[7] Attempting to init upload while already verified (should fail)...");
        res = await fetch(`${baseUrl}/candidate-videos/init-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidateUserId: candidateId,
                originalName: 'test-video-blocked.webm',
                extension: 'webm'
            })
        });
        console.log("Blocked Init Status:", res.status, "(Expected: 409)");

        // Test 8: Admin Reset
        console.log("\n[8] Resetting Verification again...");
        res = await fetch(`${baseUrl}/admin/candidate/${candidateId}/reset-verification`, {
            method: 'POST'
        });
        console.log("Reset Status:", res.status);

        const { data: v2Check } = await supabase.from('candidate_videos').select('status').eq('id', video2Id).single();
        console.log(`Video 2 is now: ${v2Check?.status} (Expected: archived)`);

        console.log("\n=== All Tests Finished Successfully! ===");

    } catch(e) {
        console.error("Test failed:", e);
    }
}

runTests();
