# LiveRoom Architecture

This document describes the system architecture, trust boundaries, data model, runtime state, and major design decisions.

## 1. High-Level Architecture

```txt
Browser Client
  Next.js app
  Supabase anon auth client
  Socket.IO client
  Agora RTC SDK
  Web Audio AudioWorklet
        |
        | HTTPS + WebSocket
        v
Node/Express Backend
  REST API
  Socket.IO server
  Supabase service-role client
  Agora token generator
  Deepgram live client
  In-memory room store
        |
        +--> Supabase Auth + Postgres
        +--> Agora RTC cloud
        +--> Deepgram streaming API
```

## 2. Main Components

### Frontend

Location: `client/`

Responsibilities:

- Login with Supabase Auth.
- Fetch server-authorized account role.
- Render lobby, room, transcript, participants, and video strip.
- Maintain Socket.IO connection.
- Join Agora audio/video channel.
- Capture candidate microphone PCM for transcription.
- Handle forced logout and room-closed UX.

### Backend

Location: `server/`

Responsibilities:

- Validate Supabase access tokens.
- Read roles from `profiles`.
- Enforce one active socket per user account.
- Enforce one occupant per room role slot.
- Generate Agora RTC tokens.
- Maintain in-memory room state.
- Proxy candidate PCM audio to Deepgram.
- Persist interview rows and final transcript data to Supabase.

### Supabase

Used for:

- User authentication.
- Role authority through `profiles`.
- Interview persistence through `interviews`.
- Transcript persistence through `transcript_blocks`.

### Agora

Used for:

- Real-time microphone publishing.
- Real-time camera publishing.
- Remote audio playback.
- Remote video subscription.

### Deepgram

Used for:

- Live speech-to-text transcription.
- Candidate audio stream conversion into transcript blocks.

## 3. Trust Boundaries

The browser is not trusted for authorization.

Trusted:

- Supabase Auth access token.
- Backend role lookup from Supabase `profiles`.
- Server-side Socket.IO `socket.data.role`.
- Server-generated Agora token.

Untrusted:

- Any browser-submitted `role`.
- Any browser-submitted `roomId`.
- Any browser-submitted audio payload unless the socket is an authenticated candidate in an active transcription session.

## 4. Role Model

Valid roles:

```txt
candidate
hr
super_admin
```

Database source:

```sql
profiles.role
```

Default:

```txt
candidate
```

If a user has no profile row, the backend treats them as candidate.

## 5. Database Model

### profiles

```sql
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'candidate'
    CHECK (role IN ('candidate', 'hr', 'super_admin')),
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

Purpose:

- Maps Supabase Auth users to server-authoritative app roles.

### interviews

Purpose:

- Stores interview session metadata.
- Created when HR starts transcription.
- Updated when interview ends or HR disconnects.

Important fields:

- `room_id`
- `hr_user_id`
- `candidate_user_id`
- `status`
- `started_at`
- `ended_at`
- `final_transcript`

### transcript_blocks

Purpose:

- Stores transcript blocks after interview completion.

Important fields:

- `interview_id`
- `speaker`
- `content`
- `confidence`
- `version`
- `started_at`
- `ended_at`

## 6. Backend Runtime State

The live room state is in `server/rooms.js`.

```js
const rooms = new Map();
```

Each room stores:

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

Syntax choice:

- `Map` is used for O(1) room lookup and clean deletion.
- Candidate and HR are explicit fields because there can only be one of each.
- Super admin observers are stored in a `Map` because the code originally supported hidden observers as keyed sockets. Current business rules restrict this to one observer in a room.

## 7. Room State Projection

The server does not broadcast the same state to everyone.

Candidate and HR receive:

- Candidate.
- HR.
- Transcript blocks.
- Active transcription state.
- No hidden observer details.

Super admin receives:

- Candidate.
- HR.
- Super admin observer entry.
- Transcript blocks.
- Active transcription state.

This is done through:

```js
getProjectedRoomState(roomId, requestorRole)
```

and:

```js
broadcastProjectedRoomState(roomId)
```

Syntax choice:

- Projection happens server-side so hidden observer behavior is not dependent on frontend filtering.

## 8. Socket Identity

Socket.IO socket id is used as the live user id in room state.

Example:

```js
RoomUser.id = socket.id
```

Agora uid is also set to the socket id:

```ts
joinChannel(roomId, agoraToken, socketId, role)
```

Reason:

- Socket room state and Agora media streams need a shared stable identifier.
- This prevents order-based remote video bugs.

## 9. Authentication Architecture

Frontend login:

```ts
supabase.auth.signInWithPassword(...)
```

Backend token verification:

```js
supabaseAdmin.auth.getUser(token)
```

Role lookup:

```js
supabaseAdmin
  .from("profiles")
  .select("role")
  .eq("user_id", userId)
  .maybeSingle()
```

Syntax choice:

- `maybeSingle()` is used because a missing profile row is allowed and becomes candidate.
- Service role key is used only on the backend.

## 10. Same-Account Session Architecture

The backend tracks active account sockets:

```js
const activeUserSockets = new Map();
```

If the same Supabase user connects again:

1. Old socket receives `force-logout`.
2. Old socket is disconnected.
3. New socket becomes active.

Frontend forced logout uses:

```ts
supabase.auth.signOut({ scope: "local" })
```

Reason:

- The old device should lose its local session.
- The new device must not be globally invalidated.

## 11. Room Capacity Architecture

Room capacity is enforced in the backend `join-room` handler.

Rules:

- If candidate slot is occupied by another socket, reject.
- If HR slot is occupied by another socket, reject.
- If super admin observer slot is occupied by another socket, reject.

The server emits `join-error` instead of replacing users.

Reason:

- Replacing users caused unexpected kickouts.
- A meeting should have exactly one user per business role.

## 12. Media Architecture

Agora handles live peer media:

- HR publishes audio and video.
- Candidate publishes audio and video.
- Super admin subscribes only.

Deepgram handles transcription:

- Candidate's microphone stream is copied into a Web Audio graph.
- AudioWorklet converts Float32 PCM to Int16 PCM.
- PCM travels over Socket.IO to backend.
- Backend streams PCM to Deepgram.

Reason for split:

- Agora is optimized for real-time media transport.
- Deepgram needs raw audio chunks for speech-to-text.
- Keeping transcription separate avoids coupling transcript reliability to remote playback state.

## 13. Frontend State Architecture

The top-level page `client/src/app/page.tsx` orchestrates:

- Supabase session.
- Authorized role.
- Socket state.
- Agora state.
- Deepgram pipeline.
- Room/lobby transitions.

Hooks:

- `useSocket`: all Socket.IO events and emits.
- `useAgora`: Agora client, local tracks, remote users.
- `useDeepgram`: browser-side audio graph and PCM upload.

Components:

- `Lobby`: role-aware join UI.
- `RoomPage`: room layout.
- `UserList`: participant list.
- `VideoPlayer`: local/remote video cards.
- `TranscriptPanel`: transcript display and editing.
- `ConnectionStatus`: Socket, voice, transcript status.

## 14. Failure Handling

Important events:

- `join-error`: user attempted invalid room join.
- `room-closed`: HR left/disconnected, room closes.
- `force-logout`: same account signed in elsewhere.
- `connect_error`: Socket.IO auth/connect failure.

Important fallback behavior:

- Missing profile row becomes candidate.
- Camera failure continues with microphone only.
- Deepgram connection queues short audio bursts while opening.
- Empty room is deleted.

## 15. Deployment Architecture

Frontend:

- Next.js app in `client/`.
- Needs public Supabase, Agora, and socket URL env vars.
- Build should use:

```txt
NODE_OPTIONS=--max-old-space-size=4096
```

Backend:

- Express/Socket.IO app in `server/`.
- Needs service role Supabase key, Agora certificate, and Deepgram key.
- Must run as a long-lived process because rooms are in memory.

Scaling note:

- Current in-memory room state works for one backend instance.
- Multi-instance deployment would require a shared room store and Socket.IO adapter, such as Redis.
