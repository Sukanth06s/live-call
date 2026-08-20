# LiveRoom Project Usage Report

## Document Control

Project: LiveRoom

Document type: Usage and system report

Prepared for: Project stakeholders, developers, testers, and future maintainers

Date: July 13, 2026

Source reviewed: Current repository code and documentation

## 1. Executive Summary

LiveRoom is a realtime interview workspace for candidate and HR conversations. It supports authenticated room access, live audio and video, candidate-only AI transcription, candidate verification video uploads, HR candidate recordings, transcript editing, transcript saving, room recovery, and super-admin observation.

The project is built around this model:

```txt
Room = temporary realtime infrastructure
Interview = persisted product record
```

Rooms live in server memory and are used for active collaboration. Interviews, transcripts, candidate videos, and verification records are persisted in Supabase.

## 2. Project Scope

The project currently covers:

- Candidate login and room creation.
- HR language-filtered room queue.
- Super-admin active-room observation.
- Agora live audio/video calling.
- Deepgram-powered candidate speech transcription.
- Candidate verification upload flow.
- HR candidate recording flow.
- Transcript editing, clearing, replacing, and final saving.
- Candidate and HR recovery after unexpected disconnects.
- Candidate verification approval, dismissal, and admin reset.

Out of scope or current limitations:

- Multi-backend-instance room state.
- Redis-backed Socket.IO adapter.
- Long-term durable live room recovery across server restarts.
- Full production observability dashboard.

## 3. User Roles

The system supports 3 roles:

| Role | Purpose |
|---|---|
| candidate | Creates or rejoins interview rooms and provides speech/video input |
| hr | Joins candidate rooms, controls transcription, reviews videos, and ends interviews |
| super_admin | Observes full active sessions and can reset candidate verification |

Roles are stored in Supabase `profiles.role`.

The backend treats frontend-submitted roles as untrusted. Every protected action resolves role from the authenticated Supabase user profile.

Supported languages:

```txt
english
tamil
hindi
```

## 4. Services Used

| Service | Usage |
|---|---|
| Supabase Auth | Login, session tracking, access tokens |
| Supabase Postgres | Profiles, interviews, transcripts, candidate videos, verification records |
| Supabase Storage | Candidate verification uploads and HR candidate recordings |
| Socket.IO | Realtime room events, recovery events, transcript updates, participant state |
| Agora RTC | Live audio/video calling |
| Deepgram | Live candidate speech transcription |
| Next.js | Frontend web application |
| Express.js | Backend HTTP API server |
| AudioWorklet | Browser candidate audio processing into PCM |

## 5. Technology Stack

Frontend:

- Next.js 16.2.5
- React 19.2.4
- TypeScript
- Tailwind CSS
- Framer Motion
- Socket.IO Client
- Agora RTC SDK
- Supabase JS Client

Backend:

- Node.js
- Express 4.21.0
- Socket.IO 4.7.5
- Supabase JS Client
- Agora Access Token
- Deepgram SDK
- CORS
- dotenv

Database and storage:

- Supabase Postgres
- Supabase Auth
- Supabase Storage

## 6. Main Code Locations

| Area | Path |
|---|---|
| Frontend app | `client/src/app` |
| Frontend components | `client/src/components` |
| Frontend hooks | `client/src/hooks` |
| Backend server | `server/index.js` |
| Room store | `server/rooms.js` |
| Supabase client | `server/supabase.js` |
| Schema | `supabase/schema.sql` |
| Migration | `supabase/migration.sql` |

## 7. High-Level Architecture

```txt
Browser Client
  Next.js
  Supabase auth client
  Socket.IO client
  Agora RTC SDK
  AudioWorklet
        |
        | HTTPS and WebSocket
        v
Node/Express Backend
  REST APIs
  Socket.IO server
  Supabase service-role client
  Agora token generator
  Deepgram live client
  In-memory room store
        |
        +--> Supabase Auth
        +--> Supabase Postgres
        +--> Supabase Storage
        +--> Agora RTC Cloud
        +--> Deepgram Streaming API
```

## 8. Main User Workflows

### Candidate Workflow

```txt
Login
Choose language
Join room
Wait for HR
Join Agora call
Upload verification video if needed
Speak while HR controls transcription
Rejoin recovery room if disconnected
```

### HR Workflow

```txt
Login
View language-matched candidate queue
Join candidate room
Start or stop transcription
Review candidate verification video
Record candidate if needed
Approve or dismiss video
Save final transcript
End interview
```

### Super Admin Workflow

```txt
Login
View active or recovering rooms
Observe full sessions
Reset candidate verification if required
```

## 9. REST API Summary

The backend currently exposes 13 REST APIs.

| Count | Type |
|---:|---|
| 6 | GET endpoints |
| 7 | POST endpoints |
| 13 | Total REST endpoints |

### REST API List

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Health check |
| GET | `/api/me` | Return authenticated user and authorized role |
| GET | `/api/token` | Generate Agora RTC token |
| GET | `/api/rooms` | Return room queue/list for HR/admin |
| GET | `/api/candidate/recovery-room` | Return candidate recovery room if HR is waiting |
| GET | `/api/candidate-videos/state` | Return candidate video/upload state |
| POST | `/api/candidate-videos/init-upload` | Initialize candidate verification upload |
| POST | `/api/candidate-videos/hr-recording/init-upload` | Initialize HR recording upload |
| POST | `/api/candidate-videos/:videoId/cancel-upload` | Cancel/archive candidate upload |
| POST | `/api/candidate-videos/:videoId/complete-upload` | Mark uploaded video ready for review |
| POST | `/api/candidate-videos/:videoId/approve` | Approve candidate verification video |
| POST | `/api/candidate-videos/:videoId/dismiss` | Dismiss candidate verification video |
| POST | `/api/admin/candidate/:candidateId/reset-verification` | Admin reset of candidate verification |

## 10. Socket.IO Realtime API Summary

Socket.IO is used for realtime collaboration.

Client-emitted socket commands: 16

Important client commands:

```txt
candidate-create-room
join-room
start-transcription
stop-transcription
save-final-transcript
audio-chunk
toggle-mute
toggle-video
transcript-edit
clear-transcript
transcript-replace
hr-keep-waiting
hr-end-interview
end-interview
leave-room
disconnect
```

Important server-emitted events:

```txt
join-ack
join-error
room-state
force-logout
room-closed
candidate-video-updated
transcription-starting
countdown-tick
transcription-stopped
interview-ended
block-update
transcript-saved
transcript-save-error
hr-recovering
hr-recovery-tick
hr-rejoined
candidate-recovering
candidate-recovery-tick
candidate-recovery-timeout
candidate-rejoined
room-recovered
```

## 11. Authentication And Authorization

Authentication:

- Frontend logs in through Supabase Auth.
- Backend receives Supabase access tokens.
- Protected REST APIs require `Authorization: Bearer <token>`.
- Socket.IO connects with token in `auth.token`.

Authorization:

- Backend validates the token.
- Backend reads `profiles.role`.
- Backend stores trusted role in `socket.data.role`.
- Browser-submitted roles are never trusted.

Sensitive backend-only secrets:

```txt
SUPABASE_SERVICE_ROLE_KEY
AGORA_APP_CERTIFICATE
DEEPGRAM_API_KEY
```

## 12. Room Lifecycle

Room states include:

```txt
waiting
active
transcribing
paused
hr_recovering
candidate_recovering
waiting_for_candidate
abandoned
ending
ended
```

Room data is stored in memory in `server/rooms.js`.

Important room fields:

```txt
roomId
language
interviewSessionId
state
candidateUser
hrUser
lastCandidateUser
lastHrUser
hiddenObservers
activeTranscriptionSession
blocks
activeSpeakers
roomStateVersion
hrRecovery
candidateRecovery
abandonedRecovery
priority
```

## 13. Candidate Recovery

If a candidate disconnects unexpectedly:

```txt
Room enters candidate_recovering
HR remains in the room
Candidate identity is preserved using lastCandidateUser
Candidate returns to lobby
Frontend calls /api/candidate/recovery-room
Candidate sees a rejoin prompt
Candidate clicks Rejoin Interview
Room recovery is cancelled
Session continues
```

If HR has ended the meeting:

```txt
No recovery room is returned
Candidate sees normal join page
```

## 14. HR Recovery

If HR disconnects unexpectedly:

```txt
Room enters hr_recovering
Candidate waits
Matching HR can rescue the room
If HR rejoins in time, room resumes
If recovery expires, room is torn down
```

This protects active interviews from accidental HR refreshes, tab closes, or network drops.

## 15. Transcription Usage

Only candidate speech is transcribed.

Flow:

```txt
Candidate microphone
AudioWorklet
Int16 PCM chunks
Socket.IO audio-chunk
Backend Deepgram stream
Transcript block updates
TranscriptPanel UI
```

HR starts and stops transcription. HR audio is not sent to Deepgram.

Deepgram configuration:

```txt
model: nova-2
encoding: linear16
sample_rate: 16000
smart_format: true
```

## 16. Transcript Usage

The transcript panel supports:

- Live candidate speech display.
- Final and live transcript block rendering.
- Transcript editing.
- Transcript replacement.
- Transcript clearing.
- Final transcript saving.
- Word count.
- Total committed turns.

The elapsed timer has been removed from the speech log UI to avoid layout collisions and reduce unnecessary panel updates.

## 17. Candidate Verification Video Usage

Candidate upload flow:

```txt
Candidate chooses file
Frontend validates file
Frontend creates local preview
Candidate clicks Save Upload
Backend creates candidate_videos row
Frontend uploads to Supabase Storage
Frontend calls complete-upload
Backend marks video as enr
HR reviews video
HR approves or dismisses
```

Allowed file types:

```txt
video/webm
video/mp4
```

Maximum file size:

```txt
50 MB
```

## 18. HR Candidate Recording Usage

HR recording flow:

```txt
HR clicks Record Candidate
Browser records candidate remote media
HR stops recording
Frontend creates preview
HR clicks Save
Backend initializes upload
Frontend uploads to Supabase Storage
Backend marks recording as enr
HR approves or dismisses
```

## 19. Candidate Video Status Model

Valid video sources:

```txt
candidate_upload
hr_recording
```

Valid video statuses:

```txt
uploading
enr
anr
archived
```

Meaning:

| Status | Meaning |
|---|---|
| uploading | Upload row exists but file workflow is not completed |
| enr | Ready for HR review |
| anr | Approved and linked to candidate verification |
| archived | Dismissed, reset, or superseded |

Rule:

```txt
Only one active enr video is allowed per candidate.
```

## 20. Database Summary

Main tables:

| Table | Purpose |
|---|---|
| profiles | User role, language, display name |
| interviews | Persisted interview session |
| transcript_blocks | Saved transcript blocks |
| candidate_videos | Candidate video upload/recording history |
| candidate_verification | Final active verification record per candidate |

Database functions:

| Function | Purpose |
|---|---|
| approve_candidate_video | Atomically approves video and creates verification |
| reset_candidate_verification | Clears verification and archives approved video |

## 21. Storage Structure

Supabase Storage bucket:

```txt
candidate-videos
```

Storage paths:

```txt
candidate_user_id/candidate-upload/U_video_id.webm
candidate_user_id/hr-recording/R_video_id.webm
```

## 22. Frontend Pages And Components

Important frontend files:

| File | Purpose |
|---|---|
| `client/src/app/login/page.tsx` | Login page |
| `client/src/app/page.tsx` | Main orchestrator |
| `client/src/components/Lobby.tsx` | Lobby, queues, candidate rejoin |
| `client/src/components/RoomPage.tsx` | Main room UI |
| `client/src/components/TranscriptPanel.tsx` | Candidate speech log and transcript controls |
| `client/src/components/CandidateVideoPanel.tsx` | Candidate upload and HR recording workflow |
| `client/src/hooks/useSocket.ts` | Socket.IO client lifecycle |
| `client/src/hooks/useAgora.ts` | Agora audio/video lifecycle |
| `client/src/hooks/useDeepgram.ts` | Candidate audio pipeline to backend |
| `client/public/audio-processor.js` | AudioWorklet PCM conversion |

## 23. Environment Variables

Frontend:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SOCKET_URL
NEXT_PUBLIC_AGORA_APP_ID
```

Backend:

```txt
PORT
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AGORA_APP_ID
AGORA_APP_CERTIFICATE
DEEPGRAM_API_KEY
```

## 24. Security Notes

Trusted:

- Supabase access token after backend validation.
- Backend role lookup from `profiles`.
- Backend-generated Agora token.
- Supabase service-role client on backend.

Untrusted:

- Frontend role values.
- Frontend room ownership claims.
- Frontend upload status claims.
- Frontend candidate video ownership claims.
- Audio chunks unless sender is active candidate.

## 25. Current Limitations And Risks

- Live room state is in memory.
- Server restart clears live rooms.
- Multi-instance deployment requires Redis or equivalent shared room state.
- Socket.IO duplicate-login coordination is process-local.
- Supabase Storage bucket configuration must match backend file limits.
- Some older documentation may contain stale wording; schema and code are source of truth.

## 26. Verification Commands

Backend:

```txt
cd server
node --check index.js
```

Frontend:

```txt
cd client
npx tsc --noEmit
npm run lint
```

## 27. Final Summary

LiveRoom is a realtime interview platform powered by:

```txt
Next.js + Express + Socket.IO + Supabase + Agora + Deepgram
```

Current application surface:

```txt
13 REST APIs
16 client socket commands
21+ server realtime events
5 main database tables
2 database functions
3 user roles
3 supported languages
```

The project is ready for single-backend-instance usage and testing. For production scaling across multiple backend instances, shared room state and a Socket.IO adapter should be added.
