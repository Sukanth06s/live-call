require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { io } = require("socket.io-client");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzb2d1ZmtzdGdpeWRyY3l0eGJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNTU2MDEsImV4cCI6MjA5NDgzMTYwMX0.PZBZ0GtQXICMLBScHKQIh25VVX8tB4ECp_FZNSsNGdg";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runTest() {
  console.log("[Test] Signing in as HR...");
  const { data: hrData, error: hrError } = await supabase.auth.signInWithPassword({
    email: "hr@test.com",
    password: "password"
  });

  if (hrError) return console.error("[Test] HR Login failed:", hrError.message);
  
  console.log("[Test] HR Login successful! Token received.");

  console.log("[Test] Signing in as Candidate...");
  const { data: candidateData, error: candError } = await supabase.auth.signInWithPassword({
    email: "candidate@test.com",
    password: "password1"
  });

  if (candError) return console.error("[Test] Candidate Login failed:", candError.message);
  console.log("[Test] Candidate Login successful! Token received.");

  const hrSocket = io("http://localhost:3001", {
    transports: ["websocket"],
    auth: { token: hrData.session.access_token, role: "hr" }
  });

  const candSocket = io("http://localhost:3001", {
    transports: ["websocket"],
    auth: { token: candidateData.session.access_token, role: "candidate" }
  });

  hrSocket.on("connect", () => {
    console.log("[HR Socket] Connected with ID:", hrSocket.id);
    hrSocket.emit("join-room", { roomId: "test-room-123", userName: "HR_User" });
  });

  candSocket.on("connect", () => {
    console.log("[Candidate Socket] Connected with ID:", candSocket.id);
    candSocket.emit("join-room", { roomId: "test-room-123", userName: "Candidate_User" });
  });

  hrSocket.on("room-state", (state) => console.log("[HR Socket] Received room-state length:", state.users?.length));
  candSocket.on("room-state", (state) => console.log("[Candidate Socket] Received room-state length:", state.users?.length));

  hrSocket.on("connect_error", (err) => console.error("[HR Socket] Error:", err.message));
  candSocket.on("connect_error", (err) => console.error("[Candidate Socket] Error:", err.message));

  setTimeout(() => {
    console.log("[Test] Test completed. Exiting.");
    hrSocket.disconnect();
    candSocket.disconnect();
    process.exit(0);
  }, 4000);
}

runTest();
