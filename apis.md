# LiveRoom API Reference

This file documents every application API currently called by the frontend or served by the backend.

## 1. Base URLs

Frontend env:

```txt
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

Backend default:

```txt
http://localhost:3001
```

If `NEXT_PUBLIC_SOCKET_URL` has no `http://` or `https://`, the frontend prefixes it with `https://`. This is useful for deployment hostnames.

## 2. Authentication Convention

Protected REST endpoints require:

```txt
Authorization: Bearer <supabase_access_token>
```

Socket.IO connects with:

```ts
auth: {
  token: sessionToken
}
```

The backend validates tokens using:

```js
supabaseAdmin.auth.getUser(token)
```

The backend then reads `profiles.role` using service-role Supabase access.

## 3. REST API

### GET /

Health check.

Request:

```txt
GET /
```

Response:

```json
{
  "status": "ok",
  "message": "Live Room Server Running"
}
```

Auth:

- None.

Called by:

- Manual health checks.
- Deployment readiness checks.

### GET /api/me

Returns the authenticated user's server-authorized role.

Request:

```txt
GET /api/me
Authorization: Bearer <supabase_access_token>
```

Success response:

```json
{
  "user": {
    "id": "supabase-user-uuid",
    "email": "hr@test.com",
    "role": "hr"
  }
}
```

Errors:

```json
{ "error": "No token provided" }
```

```json
{ "error": "Invalid token" }
```

Status codes:

- `200`: token valid.
- `401`: missing/invalid token or role verification failed.

Called by:

- `client/src/app/page.tsx`

Purpose:

- Prevents frontend role spoofing.
- Keeps role authority on the server.

Syntax choice:

- Uses `GET` because this endpoint only reads identity metadata.
- Reads role from Supabase using service role so browser RLS/anon policies cannot break role verification.

### GET /api/token

Generates an Agora RTC token for a specific room/channel and uid.

Request:

```txt
GET /api/token?channelName=<roomId>&uid=<socketId>
Authorization: Bearer <supabase_access_token>
```

Success response:

```json
{
  "token": "agora-rtc-token",
  "uid": "socket-id-used-as-agora-account"
}
```

Errors:

```json
{ "error": "channelName is required" }
```

```json
{ "error": "No token provided" }
```

```json
{ "error": "Invalid token" }
```

Status codes:

- `200`: token created.
- `400`: missing `channelName`.
- `401`: missing/invalid Supabase token.

Called by:

- `client/src/app/page.tsx`

Important behavior:

- Backend determines Agora role from Supabase profile:
  - `super_admin` -> `RtcRole.SUBSCRIBER`
  - `candidate` / `hr` -> `RtcRole.PUBLISHER`
- Token is generated with `buildTokenWithAccount`, not numeric uid, because socket ids are strings.

Syntax choice:

- `uid` is the Socket.IO socket id so Agora remote users can be mapped back to room participants without relying on array order.

### GET /api/rooms

Returns active rooms for super admin.

Request:

```txt
GET /api/rooms
Authorization: Bearer <supabase_access_token>
```

Success response:

```json
{
  "rooms": [
    {
      "roomId": "12",
      "state": "transcribing", // "waiting", "active", "hr_recovering", etc.
      "participantCount": 2,
      "createdAt": 1779348202581
    }
  ]
}
```

Errors:

```json
{ "error": "No token provided" }
```

```json
{ "error": "Super Admin access required" }
```

```json
{ "error": "Invalid token" }
```

Status codes:

- `200`: caller is super admin.
- `401`: missing/invalid token.
- `403`: authenticated but not super admin.

Called by:

- `client/src/components/Lobby.tsx`
- `client/src/app/admin/page.tsx`

Syntax choice:

- Uses `GET` because active rooms are read-only metadata.
- Backend authorizes role server-side, even if frontend hides the dashboard from non-admins.

## 4. Socket.IO Connection

Client setup:

```ts
io(SOCKET_URL, {
  transports: ["websocket"],
  autoConnect: true,
  withCredentials: true,
  auth: {
    token: sessionToken,
  },
})
```

Backend middleware:

```js
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = await getAuthenticatedUserFromToken(token);
  const authorizedRole = await getAuthorizedRole(user.id);
  socket.data.userId = user.id;
  socket.data.email = user.email;
  socket.data.role = authorizedRole;
  next();
});
```

Connection errors:

- Missing token -> `Authentication error: Token missing`
- Invalid token -> `Authentication error: Invalid token`

## 5. Server-Emitted Socket Events

### force-logout

Sent to the previous socket when the same Supabase user signs in from another device.

Payload:

```txt
This account was signed in from another device. You have been logged out here.
```

Client behavior:

- Stops media.
- Leaves room.
- Calls `supabase.auth.signOut({ scope: "local" })`.
- Redirects to `/login`.

Why local sign-out:

- It clears only the old device session.
- It does not revoke the new device session.

### room-state

Broadcast when room state changes.

Payload:

```ts
{
  roomId: string;
  interviewSessionId: string | null;
  state: "waiting" | "active" | "hr_recovering" | "transcribing" | "paused" | "ended";
  users: RoomUser[];
  blocks: TranscriptBlock[];
  activeTranscriptionSession: ActiveTranscriptionSession;
}
```

Projection:

- Candidate/HR see candidate and HR.
- Super admin sees candidate, HR, and hidden observer entry.

Client listener:

- `client/src/hooks/useSocket.ts`

### join-error

Sent when a room join is rejected.

Examples:

```txt
Your account is authorized as candidate, not super_admin.
```

```txt
This room is already full: A Candidate has already joined this session.
```

```txt
This room is already full: An HR Interviewer has already joined this session.
```

```txt
This room is already full: A Super Admin Observer has already joined this session.
```

Client behavior:

- Shows error in lobby.
- Leaves Agora if partially joined.
- Clears local room state.

### room-closed

Sent when HR leaves/disconnects and the room closes.

Payload:

```txt
The Interviewer (HR) has disconnected. The session is closed.
```

Client behavior:

- Leaves room UI.
- Leaves Agora.
- Stops transcription pipeline.
- Shows message in lobby.

### transcription-starting

Sent when HR starts transcription.

Payload:

```json
{ "countdown": 10 }
```

### countdown-tick

Sent every second during the transcription countdown.

Payload:

```json
{ "countdown": 9 }
```

### block-update

Sent when a single transcript block changes.

Payload:

```ts
TranscriptBlock
```

Client behavior:

- Merges block by id.
- Ignores stale updates with lower/equal version.

### interview-ended

Sent when an interview is ended.

Payload:

- None.

Current behavior:

- Used as a signal that the interview has been stopped server-side.

## 6. Client-Emitted Socket Events

### join-room

Request:

```ts
{
  roomId: string;
  userName: string;
  role?: string;
}
```

Important:

- `role` is treated as intent only.
- Backend uses `socket.data.role` from Supabase profile.

Backend behavior:

- Rejects spoofed roles.
- Rejects occupied room slots.
- Adds socket to room.
- Broadcasts projected `room-state`.

### leave-room

Request:

```txt
leave-room
```

Payload:

- None.

Backend behavior:

- Removes socket from room.
- Deletes empty room.
- If HR leaves, triggers a 15-second `hr_recovering` state to allow for accidental disconnect recovery. If timer expires, closes the whole room.

### toggle-mute

Request:

```ts
{
  roomId: string;
  isMuted: boolean;
}
```

Backend behavior:

- Updates matching `RoomUser.isMuted`.
- Broadcasts `room-state`.

### toggle-video

Request:

```ts
{
  roomId: string;
  isVideoEnabled: boolean;
}
```

Backend behavior:

- Updates matching `RoomUser.isVideoEnabled`.
- Broadcasts `room-state`.

### start-transcription

Request:

```ts
{
  roomId: string;
}
```

Allowed:

- HR only.

Backend behavior:

- Creates `interviews` row.
- Starts countdown.
- Opens Deepgram live connection.
- Marks active transcription state.

### end-interview

Request:

```ts
{
  roomId: string;
}
```

Allowed:

- HR.
- Super admin.

Backend behavior:

- Finalizes transcript blocks.
- Closes Deepgram.
- Updates `interviews`.
- Inserts `transcript_blocks`.
- Emits `interview-ended`.

### audio-chunk

Request:

```ts
{
  roomId: string;
  audio: ArrayBuffer;
}
```

Allowed:

- Candidate only.
- Only while transcription is active.

Backend behavior:

- Sends PCM buffer to Deepgram live connection.
- Queues briefly if Deepgram is still opening.

### transcript-edit

Request:

```ts
{
  roomId: string;
  blockId: string;
  content: string;
}
```

Backend behavior:

- Replaces block content.
- Increments version.
- Broadcasts room state.

### clear-transcript

Request:

```ts
{
  roomId: string;
}
```

Backend behavior:

- Clears all room transcript blocks.
- Clears active speaker buffers.
- Broadcasts room state.

### transcript-replace

Request:

```ts
{
  roomId: string;
  content: string;
}
```

Backend behavior:

- Replaces transcript with one final block.
- Broadcasts room state.

## 7. External APIs

### Supabase Auth

Frontend:

```ts
supabase.auth.signInWithPassword(...)
supabase.auth.getSession()
supabase.auth.onAuthStateChange(...)
supabase.auth.signOut(...)
```

Backend:

```js
supabaseAdmin.auth.getUser(token)
```

### Supabase PostgREST

Backend reads:

```txt
profiles
```

Backend writes:

```txt
interviews
transcript_blocks
```

### Agora RTC

Backend:

```js
RtcTokenBuilder.buildTokenWithAccount(...)
```

Frontend:

```ts
AgoraRTC.createClient(...)
client.join(...)
AgoraRTC.createMicrophoneAudioTrack(...)
AgoraRTC.createCameraVideoTrack(...)
client.publish(...)
client.subscribe(...)
```

### Deepgram

Backend:

```js
createDeepgramClient(DEEPGRAM_API_KEY)
deepgram.listen.live(...)
```

Events:

- `Open`
- `Transcript`
- `Close`
- `Error`
