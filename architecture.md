# LiveRoom Architecture

This document describes the current architecture for LiveRoom after the room, interview, candidate video, HR recording, and upload-preview changes.

## 1. System Overview

```txt
Browser Client
  Next.js app
  Supabase auth client
  Socket.IO client
  Agora RTC SDK
  Web Audio AudioWorklet
        |
        | HTTPS + WebSocket
        v
Node/Express Backend
  REST APIs
  Socket.IO server
  Supabase service-role client
  Agora token generator
  Deepgram live client
  In-memory room/session store
        |
        +--> Supabase Auth
        +--> Supabase Postgres
        +--> Supabase Storage
        +--> Agora RTC cloud
        +--> Deepgram streaming API
```

Core idea:

```txt
Room = temporary realtime infrastructure
Interview = persisted product record
```

Rooms can disappear. Interviews, transcripts, candidate uploads, HR recordings, and future history remain attached to `interviews.id`.

## 2. Roles

Valid roles are stored in `profiles.role`:

```txt
candidate
hr
super_admin
```

Rules:

- Only candidates can create/join candidate waiting rooms.
- HR users join candidates from a language-filtered waiting list.
- Each HR has one language for now, stored in `profiles.language`.
- Super admins can observe full calls across all languages, but only when both HR and candidate are present.
- Browser-submitted roles are treated as untrusted. The backend always resolves role from Supabase.

Supported languages:

```txt
english
tamil
hindi
```

## 3. Room Lifecycle

Candidate flow:

```txt
Candidate selects language
Candidate clicks Join a Room
Server creates room
Candidate waits
```

HR flow:

```txt
HR opens waiting list
Server returns candidates matching HR language
HR joins candidate room
Room becomes active/full
```

Room state is held in memory in `server/rooms.js`.

A room stores:

```js
{
  roomId,
  language,
  interviewSessionId,
  state,
  candidateUser,
  hrUser,
  hiddenObservers,
  activeTranscriptionSession,
  blocks,
  activeSpeakers,
  roomStateVersion,
  createdAt
}
```

Important rule:

```txt
Create/reuse an interview when the room transitions into an active HR + candidate session.
Do not create a new interview every time a socket reconnects.
```

As long as the room still exists, reconnects reuse the same `interviewSessionId`. After the room is ended/destroyed, a future meeting creates a new interview session, even if it is the same candidate and same HR.

## 4. Interview Lifecycle

The interview is the root database object.

```txt
Candidate enters queue
HR joins candidate
Interview created or reused for this room
Call active
Transcript, candidate video, HR recording attach to interview
HR ends call
Interview completed
Room destroyed
```

Current statuses:

```txt
waiting_for_hr
active
completed
cancelled
```

Current table:

```sql
interviews (
  id uuid primary key,
  room_id text not null,
  hr_user_id uuid,
  candidate_user_id uuid,
  status text not null,
  started_at timestamp,
  ended_at timestamp,
  final_transcript text,
  created_at timestamp,
  updated_at timestamp
)
```

Recommended future metadata columns:

```sql
candidate_name_snapshot text,
hr_name_snapshot text,
language text,
ended_reason text
```

Rationale:

- `id` remains a UUID and should not contain names or language.
- Human-readable history should be generated from metadata.
- Snapshot names preserve historical interview records even if profile names change later.

## 5. Candidate Video Architecture

This system is a breaking candidate-centric redesign. The `candidate_verification` table is the single source of truth for verification status, while `candidate_videos` stores historical upload/recording review workflows.

Table structures:

```sql
candidate_videos (
  id uuid primary key,
  candidate_user_id uuid not null,
  hr_user_id uuid,
  interview_id uuid references interviews(id),
  room_id text,
  source text not null,
  status text not null,
  storage_bucket text not null,
  storage_path text not null,
  file_name text,
  mime_type text not null,
  file_size bigint,
  duration_seconds integer,
  uploaded_by_user_id uuid,
  approved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamp,
  updated_at timestamp
)

candidate_verification (
  candidate_user_id uuid primary key references profiles(user_id) on delete cascade,
  video_id uuid not null references candidate_videos(id) on delete restrict,
  storage_bucket text not null,
  storage_path text not null,
  source text not null,
  approved_by_hr_user_id uuid references profiles(user_id) on delete set null,
  approved_by_hr_name_snapshot text,
  approved_at timestamptz,
  is_active boolean not null default true
)
```

Valid sources:

```txt
candidate_upload
hr_recording
```

Valid statuses:

```txt
uploading
enr
anr
archived
```

Rules:
*   There can only ever be **0 or 1 active review video (EnR)** globally per candidate. A unique partial index enforces this at the DB layer.
*   Upon successful completion of a new upload or recording, any existing `enr` video for that candidate is automatically set to `archived`.
*   A finalized verification locks the workflow: uploads and recordings are blocked at the API layer if a record exists in `candidate_verification`.

## 6. Storage Paths

Files are grouped by candidate and source folder, using prefix markers on filenames to prevent namespace collisions. No interview or room directories are used:

```txt
candidate_user_id/candidate-upload/U_video_id.webm
candidate_user_id/hr-recording/R_video_id.webm
```

## 7. Candidate Upload Flow

Candidate upload is now preview-before-save.

```txt
Candidate chooses file
Frontend validates MIME + 50 MB limit
Frontend creates local object URL
Candidate previews the selected video in the page
Candidate clicks Save Upload
Backend creates candidate_videos row with status = uploading
Backend creates Supabase signed upload URL
Frontend uploads file to Supabase Storage
Frontend calls complete-upload
Backend archives existing enr videos and sets this status to enr
HR can review the uploaded video
```

The selected file is not sent to storage until the candidate clicks `Save Upload`.

Frontend state used for this:

```ts
candidateUploadFile
candidateUploadPreviewUrl
isUploading
uploadProgress
uploadPhase
```

Why this exists:

- Candidate can verify the selected file before saving.
- The page no longer appears empty between file selection and DB save.
- Failed upload cleanup sets status to `archived` to reset the review.

Limits:

```txt
Max size: 50 MB
Allowed MIME types: video/webm, video/mp4
```

The frontend and backend both enforce this. The Supabase bucket should also be configured with the same MIME and size restrictions.

## 8. HR Recording Flow

HR recording also follows preview-before-save.

```txt
HR clicks Record Candidate
Browser records candidate remote audio/video track
HR clicks Stop
Frontend creates local preview URL
HR previews recording in modal
HR clicks Save
Backend creates candidate_videos row with source = hr_recording and status = uploading
Frontend uploads file to Supabase Storage
Frontend calls complete-upload
Backend archives existing enr videos and sets status to enr
HR can review and approve/dismiss the recording in the room
```

Only one recording or upload is in `enr` review state at any point in time. An incomplete recording due to disconnection still gets uploaded as an `enr` video preview.

Recording UI states:

```txt
idle
recording
preview
saving
saved
discarded
```

## 9. Video Retrieval and Playback

Playback uses signed Supabase Storage URLs generated by the backend.

Rules:

- Candidate can play their own active review or verified verification video.
- HR can play candidate-upload or HR recording videos in the active interview room.
- HR can approve or dismiss `enr` status videos.
- Super admin can play eligible videos when observing full calls.

The frontend renders an attached video when:

```txt
currentVideo.signedUrl exists
currentVideo.status is not uploading
viewer is candidate, HR, or super_admin
```

Polling was removed from the video panel. The panel now refreshes on:

- Initial mount.
- Video workflow actions.
- `candidate-video-updated` socket events.

Reason:

- Polling generated new signed URLs every few seconds.
- New signed URLs caused the browser video player to reload repeatedly.
- Removing polling fixed video flicker and spinner churn.

## 10. Upload State API

The backend owns upload permission decisions.

Upload is allowed only when:

```txt
interview exists
room has HR present
requestor is the room candidate
candidate has no finalized verification in candidate_verification
candidate has no video with status enr
candidate has no video with status uploading
```

Frontend renders from backend authority:

```txt
GET /api/candidate-videos/state?roomId=...
```

Important responses:

```txt
uploadAllowed
reason
currentVideo
signedUrl
verification
```

This prevents the upload button from being controlled only by browser state.

## 11. REST APIs

Main video endpoints:

```txt
GET  /api/candidate-videos/state?roomId=:roomId
POST /api/candidate-videos/init-upload
POST /api/candidate-videos/hr-recording/init-upload
POST /api/candidate-videos/:videoId/complete-upload
POST /api/candidate-videos/:videoId/cancel-upload
POST /api/candidate-videos/:videoId/approve
POST /api/candidate-videos/:videoId/dismiss
POST /api/admin/candidate/:candidateId/reset-verification
```

Behavior:

- `init-upload` creates the database row and returns a signed upload target (protected against existing verification).
- `complete-upload` finalizes status after the file is in Supabase Storage and archives older `enr` videos.
- `cancel-upload` updates status to `archived`.
- `approve` calls transactional PostgreSQL function to atomically update status to `anr` and insert `candidate_verification` row.
- `dismiss` updates status to `archived` without deleting storage or DB rows.
- `reset-verification` (Admin-only) calls transactional PostgreSQL function to remove verification record and set `anr` status back to `archived`.

## 12. Transcription Architecture

Agora handles live media. Deepgram handles transcription.

```txt
Candidate microphone track
  -> MediaStream
  -> AudioWorklet
  -> Int16 PCM chunks
  -> Socket.IO audio-chunk
  -> Backend
  -> Deepgram live connection
  -> Transcript blocks
  -> Socket.IO block-update
  -> TranscriptPanel
```

Only the candidate browser streams PCM to Deepgram. HR starts/stops the session, but HR audio is not transcribed.

Transcription start:

```txt
HR clicks Start Transcription
Server starts countdown
Room activeTranscriptionSession.isActive = true
Candidate browser starts PCM pipeline
Transcript blocks stream back to room
```

## 13. Socket and Realtime Updates

Socket.IO is used for:

- Room join/leave.
- Participant state.
- Transcription control.
- Transcript block updates.
- Candidate video state notifications.
- Forced logout for duplicate sessions.

Duplicate login behavior:

```txt
Same Supabase user connects again
Old socket receives force-logout
Old socket disconnects
New socket becomes active
```

The frontend signs out locally on forced logout.

## 14. Trust Boundaries

Trusted:

- Supabase access token.
- Backend role lookup from `profiles`.
- Server-side `socket.data.role`.
- Server-generated Agora token.
- Supabase service role client on the backend.

Untrusted:

- Browser-submitted role.
- Browser-submitted room id unless the socket belongs to that room.
- Browser-submitted upload status.
- Browser-submitted video ownership.
- Browser-submitted audio chunks unless the sender is the active candidate.

## 15. Supabase Requirements

Postgres:

- `profiles.language` must allow `english`, `tamil`, `hindi`.
- `candidate_videos.status` must allow `uploading`, `pending_review`, `approved`, `discarded`.
- Backend service role must have table permissions for `interviews`, `candidate_videos`, and `transcript_blocks`.

Storage bucket:

```txt
candidate-videos
```

Recommended bucket limits:

```txt
Max file size: 50 MB
Allowed MIME types: video/webm, video/mp4
```

The backend should use `SUPABASE_SERVICE_ROLE_KEY`, not the anon key, for server-side DB and storage operations.

## 16. Current Single-Instance Limitation

Rooms are stored in memory.

This is fine for a single backend instance. Multi-instance deployment would need:

- Shared room state, such as Redis.
- Socket.IO Redis adapter.
- Shared duplicate-login coordination.
- Durable reconnect/session handling.

Until then, all clients for a room must connect to the same backend process.