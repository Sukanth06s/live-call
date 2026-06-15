# Frontend Documentation

The frontend is a Next.js app located in `client/`.

## 1. Frontend Responsibilities

The frontend handles:

- Supabase login.
- Current session tracking.
- Server-authorized role fetch.
- Lobby rendering.
- Socket.IO signaling.
- Agora audio/video.
- Candidate PCM capture for transcription.
- Transcript display/editing.
- Forced logout and room closure UX.

The frontend does not own authorization. It displays the role returned by the backend.

## 2. Main Files

```txt
client/src/app/login/page.tsx          Login page
client/src/app/page.tsx                Main app orchestrator
client/src/app/layout.tsx              Root layout
client/src/components/Lobby.tsx        Lobby and admin room list
client/src/components/RoomPage.tsx     Main room UI
client/src/components/VideoPlayer.tsx  Video tile rendering
client/src/components/UserList.tsx     Participant list
client/src/components/TranscriptPanel.tsx Transcript UI
client/src/hooks/useSocket.ts          Socket.IO hook
client/src/hooks/useAgora.ts           Agora hook
client/src/hooks/useDeepgram.ts        AudioWorklet transcription hook
client/public/audio-processor.js       PCM AudioWorklet
client/src/lib/supabase.ts             Supabase browser client
client/src/types.ts                    Shared TypeScript types
```

## 3. Environment Variables

Required:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SOCKET_URL
NEXT_PUBLIC_AGORA_APP_ID
```

Optional/currently present:

```txt
NEXT_PUBLIC_DEEPGRAM_API_KEY
```

Note:

- Deepgram should normally stay backend-only. The current transcription path uses the backend, not a direct browser Deepgram connection.

## 4. Root Layout

`layout.tsx` defines metadata and page shell.

The app intentionally avoids `next/font/google` so production builds do not fail in restricted network environments.

Syntax choice:

- System font stack is declared in `globals.css`.
- This avoids build-time fetches to Google Fonts.

## 5. Login Page

`login/page.tsx` calls:

```ts
supabase.auth.signInWithPassword({
  email,
  password,
})
```

On success:

```ts
router.push("/")
```

It also clears:

```ts
sessionStorage.removeItem("intendedRole")
```

Reason:

- Prevents a role from a previous login from leaking into a new account session.

Forced logout notice:

```ts
const [error, setError] = useState<string | null>(() => {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("authNotice");
});
```

Syntax choice:

- State initializer reads sessionStorage once.
- This avoids React lint warnings for synchronous setState inside `useEffect`.

## 6. Main App Orchestrator

`client/src/app/page.tsx` is the central coordinator.

It owns:

- `session`
- `authorizedRole`
- `loadedProfileToken`
- `inRoom`
- `roomId`
- `userName`
- `joinError`
- `userRole`

It composes:

```ts
useSocket(accessToken)
useAgora()
// Only Candidate streams audio to Deepgram
useDeepgram({ socket, roomId, userName })
```

Syntax choice:

- Keeping orchestration in one page avoids hidden cross-hook dependency loops.
- Hooks own specific external systems: Socket.IO, Agora, Web Audio.
- The `RoomPage` receives `isTranscribing={activeTranscriptionSession?.isActive}` from global state, NOT local `useDeepgram` state, because HR does not stream audio but still needs the UI to reflect global transcription status.

## 7. Session Loading

Initial session:

```ts
supabase.auth.getSession()
```

Auth changes:

```ts
supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
})
```

If no session:

```ts
router.replace("/login")
```

## 8. Role Loading

After `accessToken` exists, the frontend calls:

```txt
GET /api/me
```

Then stores:

```ts
setAuthorizedRole(resolvedRole)
setUserRole(resolvedRole)
sessionStorage.setItem("intendedRole", resolvedRole)
setLoadedProfileToken(accessToken)
```

Render is blocked while:

```ts
loadingSession || (session && (loadingProfile || loadedProfileToken !== accessToken))
```

Reason:

- Prevents stale roles from a previous account.
- Stops candidate/admin role mismatches during fast account switching.

## 9. Forced Logout Handling

Socket event:

```txt
force-logout
```

Frontend response:

```ts
sessionStorage.removeItem("intendedRole");
sessionStorage.setItem("authNotice", message);
await leaveChannel();
socketLeaveRoom();
await supabase.auth.signOut({ scope: "local" });
router.replace("/login");
```

Syntax choice:

- `scope: "local"` logs out only the old browser/device.
- It does not revoke the newly logged-in device.

## 10. Lobby Component

`Lobby.tsx` renders different UI by role.

Candidate/HR:

- Name input.
- Join/create room mode.
- Join button.

Super admin:

- Name input.
- Active room list.
- Refresh button.
- Click room to observe.

Room fetch:

```ts
fetch(`${socketUrl}/api/rooms`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
```

Polling:

```ts
setInterval(fetchActiveRooms, 3000)
```

Syntax choice:

- Super admin polling lives in Lobby because it is lobby-specific UI.
- Fetch is guarded by role and token.

## 11. Socket Hook

`useSocket.ts` creates and owns the Socket.IO connection.

Important refs:

```ts
socketRef
roomIdRef
userNameRef
roleRef
sessionTokenRef
```

Why refs:

- Socket callbacks need current room/user values without forcing reconnection on every render.
- Refs avoid stale closures in reconnect handlers.

When `sessionToken` changes:

```ts
roomIdRef.current = null;
userNameRef.current = null;
roleRef.current = "candidate";
setUsers([]);
setBlocks([]);
setActiveTranscriptionSession(null);
```

Reason:

- New login should not auto-rejoin a room from a previous account.

## 12. Socket Events in the Client

Listeners:

- `connect`
- `disconnect`
- `connect_error`
- `room-state`
- `user-speaking`
- `block-update`

Emitters:

- `join-room`
- `leave-room`
- `toggle-mute`
- `toggle-video`
- `transcript-edit`
- `clear-transcript`
- `transcript-replace`
- `start-transcription`
- `end-interview`

## 13. Agora Hook

`useAgora.ts` owns:

- Agora client instance.
- Local microphone track.
- Local camera track.
- Remote users.
- Mute state.
- Camera state.
- Joined state.

Dynamic import:

```ts
const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
```

Reason:

- Agora SDK depends on browser APIs and should not load during SSR.

## 14. Joining Agora

After socket room join:

1. Fetch Agora token.
2. Use `socketId` as Agora uid.
3. Join channel.
4. Publish local tracks if not super admin.

```ts
await client.join(APP_ID, channelName, token || null, uid || null);
```

Super admin skips:

```ts
createMicrophoneAudioTrack
createCameraVideoTrack
client.publish
```

## 15. Room Page

`RoomPage.tsx` renders:

- Sidebar.
- Participant list.
- Connection status.
- Media controls.
- Video strip.
- Transcript panel.

Role behavior:

- HR sees transcription start/stop controls.
- Candidate sees waiting/running transcription state.
- Super admin sees silent observer notice and no media controls.

## 16. Video Mapping

Remote tracks are mapped by Agora uid:

```ts
const remoteVideoTracksBySocketId = new Map(
  remoteUsers
    .filter((remoteUser) => remoteUser.videoTrack)
    .map((remoteUser) => [String(remoteUser.uid), remoteUser.videoTrack])
);
```

Then:

```ts
remoteVideoTracksBySocketId.get(roomUser.id)
```

Reason:

- `roomUser.id` is the Socket.IO socket id.
- Agora uid is also the Socket.IO socket id.
- Therefore the correct track goes to the correct user card.

This avoids relying on array order.

## 17. Video Player

`VideoPlayer.tsx` accepts:

- `track`
- `isVideoEnabled`
- `userName`
- `role`
- `isSpeaking`
- `isLocal`

If video is enabled:

```ts
container.replaceChildren();
track.play(container);
```

If video is disabled:

- Shows avatar initial.
- Shows "Camera Off".

Injected Agora video styling:

```txt
[&_video]:h-full [&_video]:w-full [&_video]:object-cover
```

Syntax choice:

- Agora injects its own video element, so the wrapper must target child `video`.

## 18. Deepgram Hook

`useDeepgram.ts` does not connect directly to Deepgram. It builds the browser audio pipeline and sends PCM to the backend.

Flow:

1. Receives candidate microphone `MediaStream`.
2. Creates or reuses `AudioContext`.
3. Loads `/audio-processor.js`.
4. Creates `MediaStreamSource`.
5. Creates `AudioWorkletNode`.
6. Receives audio buffers from worklet.
7. Emits `audio-chunk` to backend.

Syntax choice:

- AudioWorklet is used because it is more stable and lower-latency than old ScriptProcessor APIs.
- Rebuild logic tears down stale nodes before creating new ones.

## 19. AudioWorklet

`client/public/audio-processor.js` runs off the main UI thread.

It:

- Reads mono Float32 audio.
- Calculates average volume.
- Converts Float32 samples to Int16.
- Buffers 4096 samples.
- Posts `ArrayBuffer` back to main thread.

PCM conversion:

```js
const s = Math.max(-1, Math.min(1, channelData[i]));
const int16Val = s < 0 ? s * 0x8000 : s * 0x7fff;
```

Reason:

- Backend Deepgram stream expects `linear16`.

## 20. Transcript Panel

`TranscriptPanel.tsx` displays transcript blocks and controls editing.

HR actions:

- Edit accumulated transcript.
- Clear box.
- Stop transcription.

Display state:

- Active transcription badge.
- Engine connected indicator.
- Elapsed timer.
- Word count.
- Total committed turns.

React/Framer Motion Detail:
- `AnimatePresence` must map over `<motion.span>` components, not standard HTML `<span>`. Using regular spans causes silent DOM rendering failures during array updates.

## 21. Styling Choices

The UI uses:

- Tailwind utilities.
- Dark background.
- Role-colored badges.
- Fixed sidebar.
- Horizontal video strip.
- Transcript workspace below video.

Syntax choice:

- Utility classes keep component-local styling close to markup.
- Video cards use stable aspect ratio to avoid layout shifts.

## 22. Known Testing Notes

When testing HR, candidate, and admin on one physical laptop:

- Feeds may look similar because they can use the same webcam.
- Browser camera permissions can be shared or blocked per tab/profile.
- Use separate browsers or profiles for cleaner testing.

Expected after current fixes:

- Candidate sees candidate self + HR remote.
- HR sees HR self + candidate remote.
- Super admin sees candidate + HR remote only.
- Super admin has no self camera tile.

## 23. Build Commands

TypeScript:

```txt
npx tsc --noEmit
```

Lint:

```txt
npm run lint
```

Production build:

```txt
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```
