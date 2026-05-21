# LiveRoom Walkthrough

This walkthrough explains the full runtime flow of the application from login to room join, video/audio setup, transcription, observer behavior, and teardown.

## 1. What LiveRoom Does

LiveRoom is a real-time interview room with three server-authorized roles:

- `candidate`: joins one interview room, publishes microphone and camera, and is the transcription audio source.
- `hr`: joins one interview room, publishes microphone and camera, starts/stops transcription, and can edit/clear transcript content.
- `super_admin`: silently observes one active interview room, subscribes to HR/candidate video and audio through Agora, does not publish microphone or camera, and is hidden from regular participants.

Role selection is not trusted from the browser. The browser can send an intended role for UI flow, but the backend reads the real role from Supabase `profiles`.

## 2. Login Flow

1. User opens `/login`.
2. `client/src/app/login/page.tsx` calls:

```ts
supabase.auth.signInWithPassword({ email, password })
```

3. Supabase returns a session containing an access token.
4. The app routes to `/`.
5. `client/src/app/page.tsx` calls the backend:

```ts
GET /api/me
Authorization: Bearer <supabase_access_token>
```

6. The backend validates the token with Supabase Auth and reads `profiles.role`.
7. The lobby renders the verified role.

Syntax choice:

- The frontend uses Supabase's official client for login because password auth belongs to Supabase.
- The backend uses the Supabase service role client for role reads because role authority must not depend on browser permissions or browser-supplied values.
- React state stores `authorizedRole`, and the lobby is blocked until the profile for the current token has loaded. This avoids stale role state when switching accounts.

## 3. Single-Account Login Enforcement

The backend keeps:

```js
const activeUserSockets = new Map(); // auth user id -> socket id
```

When a socket connects:

1. The server reads `socket.data.userId`.
2. If another socket already exists for that Supabase user, the old socket receives:

```txt
force-logout
```

3. The old socket disconnects.
4. The old browser calls:

```ts
supabase.auth.signOut({ scope: "local" })
```

This is intentionally local-only. A normal/global sign-out can revoke the new device's session too, creating the "phantom login page" issue.

## 4. Lobby Flow

The lobby is implemented in `client/src/components/Lobby.tsx`.

For `candidate` and `hr`:

1. User enters a display name.
2. User either enters a room id or creates a generated room id.
3. The lobby calls `onJoinRoom(roomId, userName, authorizedRole)`.

For `super_admin`:

1. Lobby polls:

```txt
GET /api/rooms
```

2. Only super admin can call this endpoint.
3. The dashboard shows active rooms.
4. Clicking a room joins as a silent observer.

Syntax choice:

- `useCallback` wraps `fetchActiveRooms` so the polling `useEffect` can depend on a stable function.
- Super admin room polling is guarded by `authorizedRole === "super_admin"` so regular users do not spam `/api/rooms`.

## 5. Socket Connection Flow

`client/src/hooks/useSocket.ts` creates one Socket.IO client per Supabase access token:

```ts
io(SOCKET_URL, {
  transports: ["websocket"],
  auth: { token: sessionToken },
})
```

The backend Socket.IO middleware validates the token:

```js
const user = await getAuthenticatedUserFromToken(token);
const authorizedRole = await getAuthorizedRole(user.id);
```

The socket stores:

```js
socket.data.userId
socket.data.email
socket.data.role
socket.data.authenticated
```

Syntax choice:

- Socket auth is done in middleware so every event handler receives a known authenticated socket.
- `socket.data` is used because it is the Socket.IO-supported place for per-socket server metadata.

## 6. Joining a Room

The client emits:

```txt
join-room { roomId, userName, role }
```

The server ignores spoofed role intent and uses:

```js
const requestedRole = socket.data.role || "candidate";
```

Then it enforces room capacity:

- One candidate slot.
- One HR slot.
- One super admin observer slot.

If the slot is already occupied, the new socket is rejected:

```txt
join-error "This room is already full..."
```

No participant is silently replaced.

Syntax choice:

- The room store is in-memory because this app currently models live rooms as ephemeral real-time sessions.
- Room role slots are explicit fields (`candidateUser`, `hrUser`, `hiddenObservers`) instead of a generic array so capacity and projection rules stay simple.

## 7. Agora Audio/Video Join

After Socket.IO room join succeeds:

1. The client requests an Agora token:

```txt
GET /api/token?channelName=<roomId>&uid=<socketId>
```

2. The backend returns a token generated for that exact socket id.
3. The client joins Agora using:

```ts
client.join(APP_ID, channelName, token, socketId)
```

4. HR/candidate create and publish microphone/camera tracks.
5. Super admin joins as subscriber and does not create local media tracks.

Why the Agora uid is the socket id:

- Socket.IO room state identifies users by socket id.
- Agora remote users identify streams by uid.
- Using the socket id for both lets the UI map each remote video track to the correct participant card.

## 8. Camera Flow

Camera state has two layers:

1. Actual Agora video track publication/subscription.
2. Socket room metadata (`isVideoEnabled`) used to show camera-on/off UI.

When HR or candidate toggles camera:

```ts
cameraTrack.setEnabled(newEnabled)
socket.emit("toggle-video", { roomId, isVideoEnabled: newEnabled })
```

The server updates `rooms.js` state and broadcasts `room-state`.

The UI renders video cards in `RoomPage`:

- Local user uses `localCameraTrack`.
- Remote users use `remoteVideoTracksBySocketId.get(roomUser.id)`.

This avoids order-based video bugs where admin sees only one feed or the wrong feed on the wrong card.

## 9. Microphone Flow

Microphone has three jobs:

- Publish live voice through Agora.
- Feed local PCM audio into the Deepgram pipeline.
- Reflect mute state in the participant list.

Mute uses:

```ts
micTrack.setMuted(newMuted)
```

The app intentionally uses soft mute instead of disabling the hardware track. This keeps the microphone track alive so the audio graph and Agora publication remain stable.

## 10. Transcription Flow

Only HR can start transcription:

```txt
start-transcription { roomId }
```

The server:

1. Verifies `socket.data.role === "hr"`.
2. Creates an `interviews` row in Supabase.
3. Emits a 10 second countdown.
4. Marks `activeTranscriptionSession.isActive = true`.
5. Opens a Deepgram live transcription connection.

Candidate audio path:

1. Candidate's microphone track becomes a `MediaStream`.
2. `useDeepgram` creates an `AudioContext`.
3. `audio-processor.js` converts float audio to Int16 PCM.
4. The client emits:

```txt
audio-chunk { roomId, audio }
```

5. Backend forwards PCM only when:

```js
socket.data.role === "candidate"
room.activeTranscriptionSession.isActive === true
```

6. Deepgram transcript events become transcript blocks.
7. Blocks are broadcast to the room.

## 11. Transcript Editing

HR can:

- Edit transcript blocks.
- Replace transcript content.
- Clear transcript content.
- Stop transcription/end the interview.

Relevant socket events:

```txt
transcript-edit
transcript-replace
clear-transcript
end-interview
```

The server mutates in-memory blocks and broadcasts updated `room-state` or `block-update`.

## 12. Leaving and Disconnecting

Normal leave:

1. Client stops transcription pipeline.
2. Client leaves Agora.
3. Client emits `leave-room`.
4. Server removes socket from room.
5. If room is empty, room is deleted.

HR disconnect:

1. Server closes the room.
2. Remaining sockets receive:

```txt
room-closed "The Interviewer (HR) has disconnected..."
```

3. Transcript is finalized and persisted if an interview row exists.
4. Deepgram connection is closed.
5. Room is deleted.

## 13. Deployment Walkthrough

Backend:

```txt
cd server
npm install
npm run dev
```

Frontend:

```txt
cd client
npm install
npm run dev
```

Production frontend build:

```txt
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

The heap setting is recommended because Next/Turbopack can use more memory during production builds.

## 14. Quick Manual Test

1. Login as HR.
2. Create room `12`.
3. Login as candidate in another browser/device.
4. Join room `12`.
5. Login as super admin in a third browser/device.
6. Select room `12`.
7. Confirm:
   - HR sees candidate and self video.
   - Candidate sees HR and self video.
   - Super admin sees HR and candidate video, but has no local media controls.
   - Starting transcription from HR shows active state for all.
   - Candidate speech appears in transcript.
   - A second candidate/HR/admin cannot join the occupied room slot.
   - Logging the same account on another device logs out the older device only.
