from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "LiveRoom_Project_Usage_Report.pdf"


def styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="CoverTitle",
            parent=base["Title"],
            alignment=TA_CENTER,
            fontSize=26,
            leading=32,
            spaceAfter=18,
            textColor=colors.HexColor("#111827"),
        )
    )
    base.add(
        ParagraphStyle(
            name="CoverSub",
            parent=base["Normal"],
            alignment=TA_CENTER,
            fontSize=12,
            leading=18,
            textColor=colors.HexColor("#4b5563"),
        )
    )
    base.add(
        ParagraphStyle(
            name="Section",
            parent=base["Heading1"],
            fontSize=15,
            leading=19,
            spaceBefore=12,
            spaceAfter=8,
            textColor=colors.HexColor("#111827"),
        )
    )
    base.add(
        ParagraphStyle(
            name="Body",
            parent=base["BodyText"],
            fontSize=9.5,
            leading=13,
            spaceAfter=6,
            alignment=TA_LEFT,
        )
    )
    base.add(
        ParagraphStyle(
            name="Small",
            parent=base["BodyText"],
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#4b5563"),
        )
    )
    base.add(
        ParagraphStyle(
            name="CodeBlock",
            parent=base["Code"],
            fontName="Courier",
            fontSize=8,
            leading=10,
            backColor=colors.HexColor("#f3f4f6"),
            borderColor=colors.HexColor("#e5e7eb"),
            borderWidth=0.5,
            borderPadding=5,
            spaceAfter=8,
        )
    )
    return base


S = styles()


def p(text, style="Body"):
    text = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return Paragraph(text, S[style])


def section(title):
    return Paragraph(title, S["Section"])


def code(text):
    return Preformatted(text.strip(), S["CodeBlock"])


def bullets(items):
    return ListFlowable(
        [ListItem(p(item), leftIndent=12) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=16,
    )


def table(rows, widths=None):
    data = [[p(str(cell), "Small") for cell in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(inch * 0.65, 0.45 * inch, "LiveRoom Project Usage Report")
    canvas.drawRightString(A4[0] - inch * 0.65, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build():
    story = []

    story += [
        Spacer(1, 1.6 * inch),
        Paragraph("LiveRoom Project Usage Report", S["CoverTitle"]),
        Paragraph("SRS-style usage and system overview", S["CoverSub"]),
        Spacer(1, 0.3 * inch),
        Paragraph("Prepared from the current repository code and documentation", S["CoverSub"]),
        Paragraph("Date: July 13, 2026", S["CoverSub"]),
        PageBreak(),
    ]

    story += [
        section("1. Executive Summary"),
        p("LiveRoom is a realtime interview workspace for candidate and HR conversations. It supports authenticated room access, live audio/video, candidate-only AI transcription, candidate verification video uploads, HR candidate recordings, transcript editing/saving, room recovery, and super-admin observation."),
        code("Room = temporary realtime infrastructure\nInterview = persisted product record"),
        section("2. Project Scope"),
        bullets([
            "Candidate login, room creation, and recovery rejoin.",
            "HR language-filtered queue and interview room joining.",
            "Super-admin active-room observation.",
            "Agora live audio/video calling.",
            "Deepgram-powered candidate speech transcription.",
            "Candidate upload and HR recording verification workflows.",
            "Transcript editing, clearing, replacing, and final saving.",
            "Candidate and HR recovery after unexpected disconnects.",
        ]),
        section("3. User Roles"),
        table(
            [
                ["Role", "Purpose"],
                ["candidate", "Creates or rejoins interview rooms and provides speech/video input"],
                ["hr", "Joins candidate rooms, controls transcription, reviews videos, and ends interviews"],
                ["super_admin", "Observes full active sessions and can reset candidate verification"],
            ],
            [1.4 * inch, 4.8 * inch],
        ),
        p("Supported languages: english, tamil, hindi."),
        section("4. Services Used"),
        table(
            [
                ["Service", "Usage"],
                ["Supabase Auth", "Login, session tracking, access tokens"],
                ["Supabase Postgres", "Profiles, interviews, transcripts, candidate videos, verification records"],
                ["Supabase Storage", "Candidate verification uploads and HR candidate recordings"],
                ["Socket.IO", "Realtime room events, recovery events, transcript updates, participant state"],
                ["Agora RTC", "Live audio/video calling"],
                ["Deepgram", "Live candidate speech transcription"],
                ["Next.js", "Frontend web application"],
                ["Express.js", "Backend HTTP API server"],
                ["AudioWorklet", "Browser candidate audio processing into PCM"],
            ],
            [1.7 * inch, 4.5 * inch],
        ),
        section("5. Technology Stack"),
        p("Frontend: Next.js 16.2.5, React 19.2.4, TypeScript, Tailwind CSS, Framer Motion, Socket.IO Client, Agora RTC SDK, Supabase JS Client."),
        p("Backend: Node.js, Express 4.21.0, Socket.IO 4.7.5, Supabase JS Client, Agora Access Token, Deepgram SDK, CORS, dotenv."),
        p("Database and storage: Supabase Postgres, Supabase Auth, Supabase Storage."),
        section("6. High-Level Architecture"),
        code(
            """
Browser Client
  Next.js, Supabase auth client, Socket.IO client,
  Agora RTC SDK, AudioWorklet
        |
        | HTTPS and WebSocket
        v
Node/Express Backend
  REST APIs, Socket.IO server, Supabase service-role client,
  Agora token generator, Deepgram live client,
  In-memory room store
        |
        +--> Supabase Auth
        +--> Supabase Postgres
        +--> Supabase Storage
        +--> Agora RTC Cloud
        +--> Deepgram Streaming API
            """
        ),
    ]

    story += [
        section("7. Main User Workflows"),
        table(
            [
                ["Workflow", "Steps"],
                ["Candidate", "Login, choose language, join room, wait for HR, join Agora call, upload verification video if needed, speak while HR controls transcription, rejoin recovery room if disconnected."],
                ["HR", "Login, view language-matched candidate queue, join room, start/stop transcription, review videos, record candidate if needed, approve/dismiss video, save transcript, end interview."],
                ["Super Admin", "Login, view active/recovering rooms, observe full sessions, reset candidate verification if required."],
            ],
            [1.4 * inch, 4.8 * inch],
        ),
        section("8. REST API Summary"),
        p("The backend currently exposes 13 REST APIs: 6 GET endpoints and 7 POST endpoints."),
        table(
            [
                ["Method", "Endpoint", "Purpose"],
                ["GET", "/", "Health check"],
                ["GET", "/api/me", "Return authenticated user and authorized role"],
                ["GET", "/api/token", "Generate Agora RTC token"],
                ["GET", "/api/rooms", "Return room queue/list for HR/admin"],
                ["GET", "/api/candidate/recovery-room", "Return candidate recovery room if HR is waiting"],
                ["GET", "/api/candidate-videos/state", "Return candidate video/upload state"],
                ["POST", "/api/candidate-videos/init-upload", "Initialize candidate verification upload"],
                ["POST", "/api/candidate-videos/hr-recording/init-upload", "Initialize HR recording upload"],
                ["POST", "/api/candidate-videos/:videoId/cancel-upload", "Cancel/archive candidate upload"],
                ["POST", "/api/candidate-videos/:videoId/complete-upload", "Mark uploaded video ready for review"],
                ["POST", "/api/candidate-videos/:videoId/approve", "Approve candidate verification video"],
                ["POST", "/api/candidate-videos/:videoId/dismiss", "Dismiss candidate verification video"],
                ["POST", "/api/admin/candidate/:candidateId/reset-verification", "Admin reset of candidate verification"],
            ],
            [0.75 * inch, 2.6 * inch, 2.85 * inch],
        ),
        section("9. Socket.IO Realtime API Summary"),
        p("Socket.IO is used for realtime collaboration. The project has 16 major client-emitted socket commands and 21+ server-emitted event types."),
        code(
            """
Client commands:
candidate-create-room, join-room, start-transcription,
stop-transcription, save-final-transcript, audio-chunk,
toggle-mute, toggle-video, transcript-edit, clear-transcript,
transcript-replace, hr-keep-waiting, hr-end-interview,
end-interview, leave-room, disconnect

Server events:
join-ack, join-error, room-state, force-logout,
room-closed, candidate-video-updated, transcription-starting,
countdown-tick, transcription-stopped, interview-ended,
block-update, transcript-saved, transcript-save-error,
hr-recovering, hr-recovery-tick, hr-rejoined,
candidate-recovering, candidate-recovery-tick,
candidate-recovery-timeout, candidate-rejoined, room-recovered
            """
        ),
        section("10. Authentication And Authorization"),
        bullets([
            "Protected REST APIs require Authorization: Bearer <token>.",
            "Socket.IO connects with token in auth.token.",
            "Backend validates the Supabase token.",
            "Backend reads role from profiles.",
            "Frontend-submitted role values are not trusted.",
            "Agora tokens are generated only by the backend.",
        ]),
        section("11. Room Lifecycle And Recovery"),
        p("Room states include waiting, active, transcribing, paused, hr_recovering, candidate_recovering, waiting_for_candidate, abandoned, ending, and ended."),
        p("Candidate recovery preserves lastCandidateUser and lets the candidate return to the same open room if HR is waiting. HR recovery gives the session a grace window after unexpected HR disconnects."),
        section("12. Transcription Usage"),
        code("Candidate microphone -> AudioWorklet -> Int16 PCM -> Socket.IO audio-chunk -> Backend Deepgram stream -> block-update -> TranscriptPanel"),
        p("Only candidate audio is transcribed. HR starts and stops transcription but HR audio is not sent to Deepgram."),
    ]

    story += [
        section("13. Candidate Verification Video Usage"),
        p("Candidate verification supports local preview before upload. The selected file is not uploaded until the candidate clicks Save Upload."),
        bullets([
            "Allowed MIME types: video/webm and video/mp4.",
            "Maximum file size: 50 MB.",
            "Upload rows begin as uploading.",
            "Completed videos become enr and are ready for HR review.",
            "Approved videos become anr and are linked to candidate_verification.",
            "Dismissed, reset, or superseded videos become archived.",
        ]),
        section("14. Database Summary"),
        table(
            [
                ["Table", "Purpose"],
                ["profiles", "User role, language, display name"],
                ["interviews", "Persisted interview session"],
                ["transcript_blocks", "Saved transcript blocks"],
                ["candidate_videos", "Candidate video upload/recording history"],
                ["candidate_verification", "Final active verification record per candidate"],
            ],
            [1.8 * inch, 4.4 * inch],
        ),
        p("Database functions: approve_candidate_video and reset_candidate_verification."),
        section("15. Storage Structure"),
        code("Bucket: candidate-videos\n\ncandidate_user_id/candidate-upload/U_video_id.webm\ncandidate_user_id/hr-recording/R_video_id.webm"),
        section("16. Important Frontend Files"),
        table(
            [
                ["File", "Purpose"],
                ["client/src/app/login/page.tsx", "Login page"],
                ["client/src/app/page.tsx", "Main orchestrator"],
                ["client/src/components/Lobby.tsx", "Lobby, queues, candidate rejoin"],
                ["client/src/components/RoomPage.tsx", "Main room UI"],
                ["client/src/components/TranscriptPanel.tsx", "Candidate speech log and transcript controls"],
                ["client/src/components/CandidateVideoPanel.tsx", "Candidate upload and HR recording workflow"],
                ["client/src/hooks/useSocket.ts", "Socket.IO client lifecycle"],
                ["client/src/hooks/useAgora.ts", "Agora audio/video lifecycle"],
                ["client/src/hooks/useDeepgram.ts", "Candidate audio pipeline to backend"],
                ["client/public/audio-processor.js", "AudioWorklet PCM conversion"],
            ],
            [2.55 * inch, 3.65 * inch],
        ),
        section("17. Environment Variables"),
        code(
            """
Frontend:
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SOCKET_URL
NEXT_PUBLIC_AGORA_APP_ID

Backend:
PORT
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AGORA_APP_ID
AGORA_APP_CERTIFICATE
DEEPGRAM_API_KEY
            """
        ),
        section("18. Current Limitations And Risks"),
        bullets([
            "Live room state is in memory.",
            "Server restart clears active rooms.",
            "Multi-instance deployment needs Redis or equivalent shared room state.",
            "Duplicate-login coordination is currently process-local.",
            "Supabase Storage bucket rules must match backend file limits.",
        ]),
        section("19. Verification Commands"),
        code("cd server\nnode --check index.js\n\ncd client\nnpx tsc --noEmit\nnpm run lint"),
        section("20. Final Summary"),
        p("LiveRoom is a realtime interview platform powered by Next.js, Express, Socket.IO, Supabase, Agora, and Deepgram."),
        code("13 REST APIs\n16 client socket commands\n21+ server realtime events\n5 main database tables\n2 database functions\n3 user roles\n3 supported languages"),
    ]

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        rightMargin=0.65 * inch,
        leftMargin=0.65 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title="LiveRoom Project Usage Report",
        author="Codex",
    )
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    build()
    print(OUT)
