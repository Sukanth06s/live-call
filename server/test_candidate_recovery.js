/**
 * Local socket test: candidate disconnect -> HR receives recovery ticks
 */
const { io } = require("socket.io-client");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:3001";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectSocket(token, label) {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token },
    });
    const timer = setTimeout(() => reject(new Error(`${label} connect timeout`)), 10000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const suffix = Date.now();
  const candEmail = `recovery_cand_${suffix}@example.com`;
  const hrEmail = `recovery_hr_${suffix}@example.com`;

  const { data: candAuth, error: cErr } = await supabase.auth.admin.createUser({
    email: candEmail,
    password: "password123",
    email_confirm: true,
  });
  if (cErr) throw cErr;

  const { data: hrAuth, error: hErr } = await supabase.auth.admin.createUser({
    email: hrEmail,
    password: "password123",
    email_confirm: true,
  });
  if (hErr) throw hErr;

  await supabase.from("profiles").upsert([
    { user_id: candAuth.user.id, role: "candidate", display_name: "Recovery Cand", language: "english" },
    { user_id: hrAuth.user.id, role: "hr", display_name: "Recovery HR", language: "english" },
  ]);

  const { data: candSession } = await supabase.auth.signInWithPassword({ email: candEmail, password: "password123" });
  const { data: hrSession } = await supabase.auth.signInWithPassword({ email: hrEmail, password: "password123" });

  const candToken = candSession.session.access_token;
  const hrToken = hrSession.session.access_token;

  const candSocket = await connectSocket(candToken, "candidate");
  const hrSocket = await connectSocket(hrToken, "hr");

  let roomId = null;
  const hrEvents = [];
  hrSocket.on("candidate-recovering", (p) => hrEvents.push({ type: "recovering", ...p }));
  hrSocket.on("candidate-recovery-tick", (p) => hrEvents.push({ type: "tick", ...p }));
  hrSocket.on("room-state", (p) => {
    if (p.state === "candidate_recovering") {
      hrEvents.push({ type: "room-state", state: p.state, candidateRecovery: p.candidateRecovery });
    }
  });

  await new Promise((resolve, reject) => {
    candSocket.once("join-ack", (ack) => {
      roomId = ack.roomId;
      resolve();
    });
    candSocket.once("join-error", reject);
    candSocket.emit("candidate-create-room", { userName: "Recovery Cand", language: "english" });
  });

  await new Promise((resolve, reject) => {
    hrSocket.once("join-ack", resolve);
    hrSocket.once("join-error", reject);
    hrSocket.emit("join-room", { roomId, userName: "Recovery HR", role: "hr" });
  });

  await wait(500);
  candSocket.disconnect();

  await wait(3500);

  console.log(JSON.stringify({ roomId, eventCount: hrEvents.length, hrEvents: hrEvents.slice(0, 10) }, null, 2));

  hrSocket.disconnect();
  process.exit(hrEvents.some((e) => e.type === "recovering" || e.type === "tick") ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
