# LiveRoom: The "Why" Behind the Architecture

This document serves as a learning guide. While the other `.md` files explain *how* the system is built, this file explains **why** it was built this way. Every complex system is a series of trade-offs; here is the rationale behind our biggest decisions.

---

## 1. Memory Management: Ephemeral Rooms vs Persistent Interviews

**How it works:**  
Active rooms exist purely in server RAM (`const rooms = new Map()`). They are not stored in Supabase. Only the "Interview" records, Candidate Videos, and Final Transcripts are persisted to the database. 

**Why we did this:**
- **Real-Time Speed:** Socket.IO events (like someone muting, or a transcript block arriving) happen hundreds of times a second. If we wrote every tiny room state change to Postgres, the database would bottleneck immediately.
- **Transience:** A Live Room is a transient space (like a phone call). If the server crashes, the ongoing phone call drops. This is expected. However, the *business output* of that call (the interview history and videos) is permanently saved. 

**Why auto-delete is disabled (`leaveRoom`):**
Normally, socket servers delete a room the millisecond it empties. We intentionally disabled this. We explicitly force the server to wait for manual triggers (like a 15-second timer) to delete the memory. This prevents the room from being prematurely garbage collected during brief internet flickers.

---

## 2. The HR Recovery Policy (15-Second Grace Period)

**How it works:**  
When an HR disconnects, the candidate doesn't get kicked out. Instead, a floating "Waiting for Interviewer" pill appears, and a 15-second countdown starts on the server. Any HR can join and rescue the room before the timer pops.

**Why we did this:**
- **Network Reality:** Real-world internet connections drop. Tabs get accidentally refreshed. Mobile networks switch from 5G to Wi-Fi. 
- **Candidate Empathy:** If a candidate is in the middle of a high-stakes interview and the HR's internet blips for 3 seconds, ending the entire interview permanently would be an awful, anxiety-inducing user experience. 
- **Seamless Handoff:** By giving a 15-second window and surfacing the room to *all* HRs of that language, we allow another HR to jump in and take over if the original HR's laptop battery dies.

---

## 3. The "Forced Logout" Illusion

**How it works:**  
If HR signs into their account on an iPad while already signed in on their Laptop, the Laptop is forcefully logged out. Crucially, the frontend code for the Laptop *intentionally skips* emitting the `leave-room` socket event as it closes.

**Why we did this:**
- We *want* the server to think the Laptop's connection crashed.
- If the Laptop politely said "I am leaving the room", the server would assume the HR intended to end the interview.
- By silently cutting the connection, the server panics, assumes a network failure, and triggers the 15-second HR Recovery Policy. This perfectly allows the new iPad device to connect, see the recovering room in the lobby, and seamlessly resume the interview!

---

## 4. The Deterministic Agora UID Hash (`createAgoraUid`)

**How it works:**  
Agora WebRTC requires users to be identified by a 32-bit integer (`uid`). Instead of using a random number or the Socket.IO ID, we generate this integer by cryptographically hashing the user's Supabase ID, Room ID, and Role.

**Why we did this:**
- **Reconnection Stability:** If a user's internet flickers, their Socket.IO ID changes when they reconnect. If we used the Socket ID for Agora, the video grid would suddenly think a brand new person joined, resulting in duplicated or frozen video tiles.
- By deriving the `uid` from immutable facts (User ID + Room ID), the UID is **stable**. Even if the user reconnects 5 times, Agora knows it's the exact same person and automatically reconnects their camera feed to the existing video player tile.

---

## 5. API Fallback Resilience (`lastCandidateUser`)

**How it works:**  
When a Candidate uploads a verification video, the REST API endpoints (like `/complete-upload` or `/cancel-upload`) have to find the active room in memory to authorize the action. They do this by checking both `room.candidateUser` and `room.lastCandidateUser`.

**Why we did this:**
- Video uploads can take 10+ seconds. In that 10 seconds, the HR might drop offline (triggering recovery), or the Candidate might accidentally refresh the page (temporarily dropping from `candidateUser` to `lastCandidateUser`).
- If the API only looked at active users, the upload would crash with a `403 Access Denied` error right at the finish line just because a socket was briefly disconnected. By checking the historical `lastCandidateUser`, the API acts with resilience and successfully completes the upload.

---

## 6. Backend-Only Deepgram Transcription

**How it works:**  
The browser captures raw audio (PCM) from the candidate's microphone and streams it over WebSockets to our Node.js backend. The backend then opens a secure connection to Deepgram's API.

**Why we did this:**
- **Security:** If the browser connected directly to Deepgram, we would have to send the `DEEPGRAM_API_KEY` to the client. Malicious users could steal it and rack up massive transcription bills.
- **Single Source of Truth:** If 3 people are in the room (Candidate, HR, Admin) and all 3 browsers ran their own transcriptions, you would get 3 slightly different, overlapping transcripts. By routing it through the backend, the server acts as the single source of truth, building one perfect, synchronized transcript array that it broadcasts to everyone simultaneously.

---

## 7. Decoupling Next.js and Socket.IO (The Separate Backend)

**How it works:**  
The frontend is built in Next.js (`client/`), but the WebSocket and API logic runs on a completely separate Node.js Express server (`server/`). 

**Why we did this:**
- Next.js is heavily optimized for Serverless Edge Functions (like Vercel). However, **Serverless functions cannot hold persistent WebSocket connections open**. 
- Live Rooms require persistent, long-lived TCP connections. By splitting the architecture, we let Next.js handle fast UI rendering, while a dedicated, long-running Node.js container handles the heavy realtime socket traffic.

---

## 8. TypeScript Frontend vs JavaScript Backend

**How it works:**  
The Next.js client is written entirely in strict TypeScript (`.tsx`), while the backend uses plain JavaScript (`index.js`).

**Why we did this:**
- **Frontend Complexity:** React components have massively complex Prop structures, state objects, and UI interactions. TypeScript catches a huge class of rendering errors at compile time and makes building UI components much faster.
- **Backend Velocity:** The backend is essentially a thin routing layer that holds a Map of rooms and forwards socket events. Writing it in vanilla Node.js JavaScript eliminates the need for a compile step (`tsc`), making backend iteration, debugging, and deployment extremely fast.

---

## 9. AudioWorklet over Standard ScriptProcessor

**How it works:**  
To send audio to Deepgram, the frontend uses a custom `audio-processor.js` AudioWorklet to capture the microphone feed.

**Why we did this:**
- Browsers natively capture audio as 32-bit floating-point arrays. Sending raw float32 audio over WebSockets would consume massive amounts of bandwidth.
- The `AudioWorklet` runs on a completely separate background thread in the browser. It efficiently downsamples the audio to 16kHz, 16-bit PCM integer arrays *before* sending it to the server. This prevents the browser's main UI thread from lagging and drastically reduces network bandwidth.

---

## 10. Live Transcript Editing by HR

**How it works:**  
HR users see a live, editable text box containing the AI transcription. They can click into it, type corrections, and save it while the interview is still happening.

**Why we did this:**
- **AI is flawed:** Speech-to-text models like Deepgram are incredible, but they are only about 80-90% accurate, especially with technical jargon, accents, or background noise.
- **Legal/Compliance Record:** The final transcript acts as the official permanent record of the interview. If the AI hallucinates a word, the HR *must* have the ability to manually override and correct the record before it is permanently committed to the Supabase database.

---

## 11. Supabase Authentication Strategy

**How it works:**  
We do not use HTTP-Only Cookies for authentication. Instead, the frontend fetches a JWT Access Token from Supabase and explicitly passes it in the `Authorization: Bearer` header for REST APIs, and inside the `auth: { token }` payload for Socket.IO.

**Why we did this:**
- **Cross-Origin Flexibility:** Cookies are notoriously difficult to share across different domains (e.g. `client.vercel.app` vs `api.railway.app`) due to strict browser CORS policies. 
- By explicitly passing the JWT token, the frontend and backend can be hosted on entirely different URLs without worrying about cross-site tracking protections blocking the authentication.
