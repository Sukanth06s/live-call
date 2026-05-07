import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";
import { getServerSession } from "next-auth";

export async function GET(req: NextRequest) {
  // 1. Check for authentication
  const session = await getServerSession();
  
  // For production, uncomment this to strictly enforce login
  /*
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  */

  const { searchParams } = new URL(req.url);
  const channelName = searchParams.get("channelName");

  if (!channelName) {
    return NextResponse.json({ error: "channelName is required" }, { status: 400 });
  }

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID || "";
  const appCertificate = process.env.AGORA_APP_CERTIFICATE || "";

  if (!appId || !appCertificate) {
    return NextResponse.json({ error: "Agora credentials not configured on server" }, { status: 500 });
  }

  const uid = 0;
  const role = RtcRole.PUBLISHER;
  const expireTime = 3600;
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      role,
      privilegeExpireTime
    );

    return NextResponse.json({ token });
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
