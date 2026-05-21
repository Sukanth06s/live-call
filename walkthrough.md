# Video Call Support Walkthrough

## Summary

Full video call support has been added for HR and Candidate roles while keeping the existing Socket.IO room orchestration, Agora audio transport, and Deepgram transcription pipeline intact.

## Completed Changes

- Added `isVideoEnabled` to room users and synchronized camera state through the existing `room-state` broadcast flow.
- Added a `toggle-video` Socket.IO event on the backend.
- Added local camera track management in `useAgora`, including publishing video for HR/Candidate users and skipping local media publication for Super Admin observers.
- Added `emitVideoToggle` in `useSocket`.
- Added a reusable `VideoPlayer` component with camera-off placeholders, name/role overlays, and speaking-state styling.
- Added a horizontal video strip above the transcript workspace in `RoomPage`.
- Added a camera toggle control beside the existing mute control for HR/Candidate users.
- Preserved Super Admin observer behavior: no local camera or mic track is created, while remote video tiles can still be viewed.

## Verification

- `npx tsc --noEmit` completed successfully in `client/`.
- `npm run build` completed successfully in `client/`.
- `node --check index.js` completed successfully in `server/`.
- `node --check rooms.js` completed successfully in `server/`.

## Deployment Notes

- Frontend deployment target: Vercel from `client/`.
- Backend deployment target: Railway from `server/`.
- Required frontend environment values still include `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Required backend environment values still include `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPGRAM_API_KEY`, `AGORA_APP_ID`, and `AGORA_APP_CERTIFICATE`.
