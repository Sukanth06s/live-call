# Agora Integration

This document explains how LiveRoom uses Agora for real-time microphone and camera transport.

## 1. Why Agora Is Used

Agora handles low-latency media transport:

- HR voice.
- Candidate voice.
- HR camera.
- Candidate camera.
- Super admin audio/video subscription.

Deepgram is not used for playback. Deepgram only receives candidate PCM audio for transcription.

## 2. Files Involved

Frontend:

- `client/src/hooks/useAgora.ts`
- `client/src/components/RoomPage.tsx`
- `client/src/components/VideoPlayer.tsx`
- `client/src/app/page.tsx`

Backend:

- `server/index.js`

Environment:

Frontend:

```txt
NEXT_PUBLIC_AGORA_APP_ID
```

Backend:

```txt
AGORA_APP_ID
AGORA_APP_CERTIFICATE
```

## 3. Agora Token Flow

The client requests a token after Socket.IO room join succeeds.

Request:

```txt
GET /api/token?channelName=<roomId>
Authorization: Bearer <supabase_access_token>
```

Backend:

```js
const rtcRole = authorizedRole === "super_admin"
  ? RtcRole.SUBSCRIBER
  : RtcRole.PUBLISHER;

const uid = createAgoraUid(user.id, channelName, authorizedRole);

const agoraToken = RtcTokenBuilder.buildTokenWithUid(
  appId,
  appCertificate,
  channelName,
  uid,
  rtcRole,
  Math.floor(Date.now() / 1000) + 3600
);
```

Syntax choice:

- Agora strictly requires `uid` to be a 32-bit unsigned integer. We generate a stable integer by hashing `${userId}:${roomId}:${role}` using `crypto.createHash`.
- `buildTokenWithUid` is used instead of string accounts.
- Token lifetime is one hour.
- Role is selected server-side from Supabase profile, not from the browser.

## 4. Agora UID Strategy

LiveRoom uses the deterministic `createAgoraUid` integer hash for the Agora `uid`.

Example:

```ts
await joinChannel(newRoomId, agoraToken, agoraUid, resolvedRole);
```

Then:

```ts
await client.join(APP_ID, channelName, token || null, uid);
```

Reason:

- Agora requires numbers.
- By deriving it deterministically from the Supabase User ID, Room ID, and Role, the UID is stable even if the user reconnects (which assigns them a new Socket.IO ID).
- The frontend receives `agoraUid` via the Socket.IO `room-state` event, allowing it to seamlessly match incoming Agora video/audio tracks to the correct participant object.

This fixed the camera inconsistency where:

- Candidate saw both feeds.
- HR saw a misaligned feed.
- Admin saw only one feed.

Those bugs happened because tracks were previously assigned by array order. Agora does not guarantee remote user order.

## 5. Publisher and Subscriber Rules

### Candidate

Agora role:

```txt
PUBLISHER
```

Publishes:

- Microphone.
- Camera.

Subscribes:

- HR audio/video.

### HR

Agora role:

```txt
PUBLISHER
```

Publishes:

- Microphone.
- Camera.

Subscribes:

- Candidate audio/video.

### Super Admin

Agora role:

```txt
SUBSCRIBER
```

Publishes:

- Nothing.

Subscribes:

- Candidate audio/video.
- HR audio/video.

Syntax choice:

- Super admin does not create local mic/camera tracks. This prevents accidental observer audio/video leakage.

## 6. Client Creation

In `useAgora.ts`:

```ts
const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
```

Syntax choice:

- Dynamic import avoids server-side rendering issues because Agora depends on browser APIs.
- `mode: "rtc"` is used for live conversation.
- `codec: "vp8"` is widely supported for browser video.

## 7. Publishing Local Tracks

For HR/candidate:

```ts
const micTrack = await AgoraRTC.createMicrophoneAudioTrack({
  encoderConfig: "speech_standard",
});
await client.publish([micTrack]);
```

Camera:

```ts
const cameraTrack = await AgoraRTC.createCameraVideoTrack({
  encoderConfig: {
    width: 640,
    height: 360,
    frameRate: 15,
    bitrateMin: 400,
    bitrateMax: 800,
  },
});
await client.publish([cameraTrack]);
```

Syntax choice:

- `speech_standard` is enough for interview voice and avoids wasting bandwidth.
- 640x360 at 15fps keeps the UI responsive and limits bandwidth.
- Camera creation is wrapped in `try/catch`. If camera fails, the user can still join with microphone.

## 8. Subscribing to Remote Tracks

The client listens:

```ts
client.on("user-published", async (user, mediaType) => {
  await client.subscribe(user, mediaType);
  if (mediaType === "audio") user.audioTrack?.play();
  if (mediaType === "video") setRemoteUsers(...);
});
```

Audio:

- Played immediately with `audioTrack.play()`.

Video:

- Stored in `remoteUsers`.
- Rendered by `RoomPage`.

## 9. Remote Video Mapping

`RoomPage` creates:

```ts
const remoteVideoTracksBySocketId = new Map(
  remoteUsers
    .filter((remoteUser) => remoteUser.videoTrack)
    .map((remoteUser) => [
      String(remoteUser.uid),
      remoteUser.videoTrack as VideoTrackLike
    ])
);
```

Then each participant card receives:

```ts
const track = roomUser.isVideoEnabled
  ? remoteVideoTracksBySocketId.get(roomUser.id)
  : null;
```

Syntax choice:

- A `Map` gives direct lookup by socket id.
- The UI no longer depends on remote user order.
- This is essential for super admin because admin often joins after both HR/candidate have already published media.

## 10. Video Rendering

`VideoPlayer` receives a track:

```ts
track.play(container)
```

Before playing a new track, it clears old children:

```ts
container.replaceChildren();
```

Video CSS:

```txt
[&_video]:h-full [&_video]:w-full [&_video]:object-cover
```

Reason:

- Agora injects a video element into the container.
- The app must style that injected element, not only the wrapper.
- Clearing children prevents stale video nodes during role switches or track changes.

## 11. Camera Toggle

Frontend:

```ts
await localCameraTrackRef.current.setEnabled(newEnabled);
setIsVideoEnabled(newEnabled);
```

Then Socket.IO metadata update:

```ts
emitVideoToggle(roomId, newEnabled);
```

Backend:

```js
toggleVideo(roomId, socket.id, isVideoEnabled);
broadcastProjectedRoomState(roomId);
```

Why both Agora and Socket.IO:

- Agora controls the real media stream.
- Socket.IO controls UI metadata such as "Camera Off" placeholders.

## 12. Mute Toggle

Frontend:

```ts
await localTrackRef.current.setMuted(newMuted);
```

Syntax choice:

- `setMuted` keeps the microphone track alive.
- This is less disruptive than disabling/closing the track.
- It helps the transcription audio graph stay stable.

## 13. Same Camera on Multiple Devices

If HR and candidate are opened on the same physical laptop/browser, they may both capture the same webcam view.

That can make both feeds look similar, but it should not cause:

- Missing feed.
- Wrong role label.
- Camera-off placeholder on the wrong person.
- Misaligned video.

Those are mapping/rendering bugs, not normal same-camera behavior.

## 14. Common Agora Warnings

### SEND_VIDEO_BITRATE_TOO_LOW

Meaning:

- Agora detected low outgoing video bitrate.

Likely causes:

- Weak network.
- Browser throttling.
- Camera contention.
- Multiple tabs using the same camera.

Impact:

- Not an auth/security issue.
- May reduce video quality.

## 15. Debug Checklist

If a feed is missing:

1. Confirm both HR and candidate show `Voice Connected`.
2. Confirm both users have `isVideoEnabled: true` in `room-state`.
3. Confirm remote Agora uid equals the participant socket id.
4. Confirm `/api/token` was requested with `uid=<socketId>`.
5. Refresh after restarting backend/frontend so old token logic is gone.

If admin sees only one feed:

1. Make sure frontend has the socket-id mapping patch.
2. Make sure backend token endpoint uses `buildTokenWithAccount`.
3. Make sure admin joined after receiving a valid socket id.

## 16. Current Limitations

- No device picker UI yet.
- No camera preview in lobby.
- No explicit network quality indicator beyond Agora console warnings.
- One super admin observer per room by business rule.
