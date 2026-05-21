# Backend Documentation

The backend is an Express + Socket.IO server located in `server/`.

## 1. Backend Responsibilities

The backend is responsible for all trusted decisions:

- Validate Supabase access tokens.
- Read account role from Supabase `profiles`.
- Reject client role spoofing.
- Enforce one active socket per account.
- Enforce one role slot per room.
- Generate Agora tokens.
- Maintain live room state.
- Forward candidate audio to Deepgram.
- Persist interview and transcript data.

## 2. Main Files

```txt
server/index.js       Main Express and Socket.IO server
server/rooms.js       In-memory room store and room mutation helpers
server/supabase.js    Supabase service-role client
server/package.json   Backend dependencies and scripts
```

## 3. Dependencies

Important packages:

- `express`: HTTP API server.
- `socket.io`: realtime room signaling.
- `cors`: cross-origin support for frontend.
- `@supabase/supabase-js`: token verification and database access.
- `agora-access-token`: Agora RTC token generation.
- `@deepgram/sdk`: live transcription connection.

## 4. Environment Variables

Required:

```txt
PORT
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AGORA_APP_ID
AGORA_APP_CERTIFICATE
DEEPGRAM_API_KEY
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` must stay backend-only.
- `AGORA_APP_CERTIFICATE` must stay backend-only.
- `DEEPGRAM_API_KEY` must stay backend-only.

## 5. Server Startup

The server starts with:

```js
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Railway] Server active on port ${PORT}`);
});
```

Syntax choice:

- `0.0.0.0` allows Railway/container environments to expose the server.
- `PORT || 3001` supports local development and hosted deployment.

## 6. Supabase Admin Client

`server/supabase.js`:

```js
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
```

Purpose:

- Validate users.
- Read `profiles`.
- Write `interviews`.
- Write `transcript_blocks`.

Syntax choice:

- A single exported client avoids repeated initialization.
- Service role bypasses RLS, but table grants must still be correct.

## 7. Auth Helpers

### getAuthenticatedUserFromToken

```js
async function getAuthenticatedUserFromToken(token) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    throw error || new Error("Invalid session");
  }
  return user;
}
```

Purpose:

- Converts a Supabase access token into a trusted user object.

### getAuthorizedRole

```js
async function getAuthorizedRole(userId) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  const role = data?.role || "candidate";
  return allowedRoles.has(role) ? role : "candidate";
}
```

Purpose:

- Reads role from database.
- Defaults missing rows to candidate.
- Guards invalid role values.

Syntax choice:

- `maybeSingle()` is used because missing profile rows are allowed.
- A `Set` is used for role validation because membership checks are direct and clear.

## 8. Socket Auth Middleware

All sockets must authenticate:

```js
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = await getAuthenticatedUserFromToken(token);
  const authorizedRole = await getAuthorizedRole(user.id);

  socket.data.userId = user.id;
  socket.data.email = user.email;
  socket.data.role = authorizedRole;
  socket.data.authenticated = true;
  next();
});
```

Syntax choice:

- Middleware centralizes auth.
- Event handlers never need to trust payload roles.
- `socket.data` is the idiomatic Socket.IO storage for per-socket metadata.

## 9. Same-Account Enforcement

State:

```js
const activeUserSockets = new Map();
```

On connection:

```js
const existingSocketId = activeUserSockets.get(socket.data.userId);
if (existingSocketId && existingSocketId !== socket.id) {
  const existingSocket = io.sockets.sockets.get(existingSocketId);
  if (existingSocket) {
    existingSocket.emit("force-logout", "...message...");
    existingSocket.disconnect(true);
  }
}
activeUserSockets.set(socket.data.userId, socket.id);
```

On leave/disconnect:

```js
if (activeUserSockets.get(socket.data.userId) === socket.id) {
  activeUserSockets.delete(socket.data.userId);
}
```

Purpose:

- Logging into the same account on a new device logs out the old device.

Important frontend detail:

- The old client uses `signOut({ scope: "local" })` so the new device stays logged in.

## 10. Room Store

`rooms.js` stores all live room data:

```js
const rooms = new Map();
```

Room shape:

```js
{
  roomId,
  interviewSessionId,
  state,
  candidateUser,
  hrUser,
  hiddenObservers,
  activeTranscriptionSession,
  blocks,
  activeSpeakers,
  createdAt
}
```

Why in-memory:

- Live rooms are ephemeral.
- Room updates are frequent.
- The current app is designed for a single backend instance.

Scaling note:

- Multiple backend instances require shared state and a Socket.IO adapter.

## 11. Room Join Enforcement

The client emits:

```js
join-room { roomId, userName, role }
```

Backend:

```js
const requestedRole = socket.data.role || "candidate";
```

The payload `role` is only compared to detect spoofing:

```js
if (role && role !== requestedRole) {
  socket.emit("join-error", `Your account is authorized as ${requestedRole}, not ${role}.`);
  return;
}
```

Room capacity:

- Candidate slot occupied -> reject.
- HR slot occupied -> reject.
- Super admin observer slot occupied -> reject.

Syntax choice:

- Rejection is explicit. The server no longer silently replaces existing users.
- This avoids accidental kickouts when another device/account joins.

## 12. Room Projection

`broadcastProjectedRoomState(roomId)` sends different room state to regular users and admins.

Regular users:

```js
getProjectedRoomState(roomId, "candidate")
```

Super admin:

```js
getProjectedRoomState(roomId, "super_admin")
```

Purpose:

- Candidate and HR do not see hidden observer metadata.
- Super admin sees all visible and hidden participants.

## 13. Agora Token Endpoint

`GET /api/token`

Inputs:

- `channelName`
- `uid`
- Supabase bearer token

Behavior:

- Validates bearer token.
- Reads authorized role.
- Generates `PUBLISHER` token for candidate/HR.
- Generates `SUBSCRIBER` token for super admin.
- Uses socket id as Agora account uid.

Why account token:

```js
RtcTokenBuilder.buildTokenWithAccount(...)
```

Socket ids are strings, not numeric ids.

## 14. Deepgram Setup

Backend client:

```js
const deepgram = createDeepgramClient(process.env.DEEPGRAM_API_KEY);
```

Live connection:

```js
const dgConnection = deepgram.listen.live({
  model: "nova-2",
  smart_format: true,
  encoding: "linear16",
  sample_rate: 16000
});
```

Syntax choice:

- `linear16` matches the Int16 PCM sent by the browser AudioWorklet.
- `smart_format` improves punctuation and formatting.

## 15. Starting Transcription

Event:

```txt
start-transcription { roomId }
```

Allowed:

- HR only.

Backend steps:

1. Verify `socket.data.role === "hr"`.
2. Get room.
3. Insert interview row in Supabase.
4. Emit `transcription-starting`.
5. Run countdown.
6. Mark room `state = "transcribing"`.
7. Open Deepgram connection.

Interview insert:

```js
supabaseAdmin
  .from("interviews")
  .insert([{ room_id, hr_user_id, candidate_user_id, status, started_at }])
```

## 16. Audio Chunk Handling

Event:

```txt
audio-chunk { roomId, audio }
```

Backend accepts only if:

```js
room.activeTranscriptionSession.isActive
socket.data.role === "candidate"
```

If Deepgram is open:

```js
dgConnection.send(audio)
```

If Deepgram is still connecting:

```js
dgState.audioQueue.push(audio)
```

Syntax choice:

- Candidate-only audio routing prevents HR/admin audio from being transcribed.
- Queueing covers the short startup gap between countdown completion and Deepgram open.

## 17. Transcript Block Lifecycle

Deepgram transcript event:

1. Extract transcript text.
2. Find or create active speaker block.
3. Add interim or final segment.
4. Update block content.
5. Increment block version.
6. Emit `block-update`.

Block versioning:

- The frontend ignores older updates.
- This prevents stale Socket.IO delivery from overwriting newer transcript text.

## 18. Ending Interviews

Event:

```txt
end-interview { roomId }
```

Allowed:

- HR.
- Super admin.

Backend:

- Marks room ended.
- Finalizes active speakers.
- Closes Deepgram.
- Builds flattened transcript.
- Updates `interviews`.
- Inserts `transcript_blocks`.
- Emits `interview-ended`.

## 19. HR Disconnect Behavior

If HR disconnects:

1. Room closes immediately.
2. Remaining sockets receive `room-closed`.
3. Final transcript is persisted if possible.
4. Deepgram connection closes.
5. All sockets leave the room.
6. Room is deleted.

Reason:

- HR is the meeting owner/interviewer.
- Candidate should not remain in an orphaned interview session.

## 20. Error Handling

Main error paths:

- Invalid token -> auth failure.
- Missing role row -> default candidate.
- Unauthorized role action -> ignored or rejected.
- Room slot full -> `join-error`.
- Deepgram failure -> logged and connection state reset.
- Camera failure is handled on frontend, not backend.

## 21. Verification Commands

Backend syntax:

```txt
node --check index.js
```

Frontend:

```txt
npx tsc --noEmit
npm run lint
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```
