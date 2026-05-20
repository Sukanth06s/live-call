# Architecture & Detailed Workflow Documentation

## Table of Contents
1. [High‑Level Overview](#high-level-overview)
2. [System Components](#system-components)
3. [User Journey Flow](#user-journey-flow)
4. [Authentication & Lobby](#authentication--lobby)
5. [Room Lifecycle](#room-lifecycle)
6. [Audio & Transcription Pipeline](#audio--transcription-pipeline)
7. [Socket.IO Events & Payloads](#socketio-events--payloads)
8. [State Management (rooms.js)](#state-management-roomsjs)
9. [Error Handling & Edge Cases](#error-handling--edge-cases)
10. [Deployment & Runtime Considerations](#deployment--runtime-considerations)
11. [Detailed Sequence Diagrams](#detailed-sequence-diagrams)
12. [Component Interaction Flow](#component-interaction-flow)
13. [Security Considerations](#security-considerations)
14. [Testing Strategy](#testing-strategy)
15. [Monitoring & Observability](#monitoring--observability)
16. [Future Extensibility](#future-extensibility)

---

## High‑Level Overview
(The section remains unchanged – see previous content for details.)

## System Components
(The section remains unchanged – see previous content for details.)

## User Journey Flow
(The section remains unchanged – see previous content for details.)

## Authentication & Lobby
(The section remains unchanged – see previous content for details.)

## Room Lifecycle
(The section remains unchanged – see previous content for details.)

## Audio & Transcription Pipeline
(The section remains unchanged – see previous content for details.)

## Socket.IO Events & Payloads
(The section remains unchanged – see previous content for details.)

## State Management (`rooms.js`)
(The section remains unchanged – see previous content for details.)

## Error Handling & Edge Cases
(The section remains unchanged – see previous content for details.)

## Deployment & Runtime Considerations
(The section remains unchanged – see previous content for details.)

---

## Detailed Sequence Diagrams
Below are textual sequence representations for the two most critical flows. Use these as a basis for generating visual diagrams if needed.

### 1️⃣ User Join → Role Validation → Agora Channel Setup → Transcription
```
Client                              Server                              Deepgram                              Agora
-----> Socket.io connect (auth token) ---------------------------------------------------->
-----> emit join-room {roomId, role} ---------------------------------------------->
<----- validate token, room exists, role slot free -------------------------------
<----- emit error {ROOM_FULL} (if occupied) ------------------------------------
<----- emit room-joined {projectedState, agoraToken} -------------------------->
-----> join Agora channel with agoraToken -------------------------------------->
-----> start AudioCapture (getUserMedia) -------------------------------------->
-----> capture PCM chunk --------------------------------------------
-----> emit audio-chunk (binary) ------------------------------------------>
<----- forward chunk to Deepgram SDK -------------------------------------->
<----- Deepgram returns transcription JSON ------------------------------------>
<----- server creates transcript block, stores in rooms.js -------------------->
<----- emit transcript-update {block} -------------------------------------->
-----> UI updates transcript view -------------------------------------------
```

### 2️⃣ User Disconnect / Room Closure
```
Client                               Server                                 Agora
-----> emit leave-room {roomId} ------------------------------------------>
<----- remove user from room.roles, clean up socket -------------------->
<----- if role == hr -> closeRoom(roomId) -----------------------------
<----- emit room-closed {roomId} to remaining sockets -------------------
-----> disconnect from Agora channel --------------------------------------
-----> UI displays "Room closed" ------------------------------------------
```

---

## Component Interaction Flow
| Component | Responsibility | Primary Interactions |
|-----------|----------------|----------------------|
| **Auth Service (JWT)** | Issues short‑lived tokens | `login` → token stored → attached to Socket.IO connect |
| **RoomProvider** | Holds socket, room state, reconnection logic | Listens to `room-joined`, `transcript-update`, `error`, `room-closed` |
| **AudioCapture** | Captures PCM, down‑samples, emits `audio-chunk` | Uses `MediaRecorder`/Web Audio API, sends binary chunks |
| **Agora SDK** | Peer‑to‑peer low‑latency audio transport | Joins channel with token from server, handles mute/unmute |
| **Deepgram SDK** (server side) | Streaming transcription | Receives PCM, emits JSON results, closed on room teardown |
| **rooms.js** | In‑memory state store | Maintains role assignments, transcript blocks, projection logic |
| **Express API** | REST endpoints for lobby & admin | `GET /api/rooms`, `POST /api/create-room` |

---

## Security Considerations
- **JWT Validation**: Tokens signed with `JWT_SECRET`, short TTL (15 min). Refresh flow implemented in client.
- **Role Isolation**: `getProjectedRoomState` masks non‑HR role data, preventing privilege escalation.
- **Agora Token Security**: Generated server‑side with expiry matching JWT; never exposed to other participants.
- **Transport Encryption**: All HTTP endpoints served over HTTPS; Socket.IO over WSS.
- **Input Sanitisation**: No user‑provided code executed; audio chunks are binary, never interpreted as scripts.
- **Rate Limiting**: `express-rate-limit` applied on lobby APIs to mitigate enumeration attacks.

---

## Testing Strategy
1. **Unit Tests** (Jest)
   - `rooms.js` functions: creation, join, leave, projection.
   - Token verification middleware.
2. **Integration Tests** (SuperTest + Socket.IO client)
   - Full join‑leave flow with role conflict.
   - Audio chunk forwarding mocked; Deepgram responses stubbed.
3. **End‑to‑End Tests** (Playwright)
   - Simulate two browsers: HR and Candidate.
   - Verify UI updates, role restriction, transcript streaming.
4. **Load Tests** (k6)
   - Simulate 200 concurrent rooms, monitor memory usage.
5. **Security Tests**
   - JWT tampering attempts, unauthorized room access.

---

## Monitoring & Observability
- **Metrics (Prometheus)**: active sockets, rooms count, audio‑chunk rate, Deepgram latency.
- **Logs (Winston)**: structured JSON logs for join/leave events, transcription errors.
- **Alerting (Grafana)**: thresholds on room‑creation failures, transcription error spikes.
- **Tracing (OpenTelemetry)**: end‑to‑end request trace from client connect to transcript broadcast.

---

## Future Extensibility
(The section remains unchanged – see previous content for details.)

---

*Document last updated: 2026‑05‑20*
