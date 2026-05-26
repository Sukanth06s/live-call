"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface RoomMeta {
  roomId: string;
  language: string;
  state: string;
  participantCount: number;
  isFull: boolean;
  candidateName: string | null;
  hrName: string | null;
  createdAt: number;
}

const languageLabel = (language: string) =>
  language === "tamil" ? "Tamil" : language === "hindi" ? "Hindi" : "English";

export default function AdminDashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRooms() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }

      let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
      if (socketUrl && !socketUrl.startsWith("http://") && !socketUrl.startsWith("https://")) {
        socketUrl = `https://${socketUrl}`;
      }

      try {
        const res = await fetch(`${socketUrl}/api/rooms`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setRooms(data.rooms);
        }
      } catch (e) {
        console.error("Failed to fetch rooms:", e);
      } finally {
        setLoading(false);
      }
    }

    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, [router]);

  if (loading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#07070a] text-white">Loading...</div>;
  }

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#07070a] p-4 text-white sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="mb-6 text-2xl font-bold sm:mb-8 sm:text-3xl">Admin Dashboard - Ongoing Calls</h1>
        <div className="grid gap-4">
          {rooms.length === 0 ? (
            <p className="text-gray-400">No ongoing full calls found.</p>
          ) : (
            rooms.map(room => (
              <div key={room.roomId} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold sm:text-xl">{room.roomId}</h2>
                  <p className="text-gray-400 text-sm">
                    {languageLabel(room.language)} | Candidate: {room.candidateName || "Unknown"} | HR: {room.hrName || "Unknown"}
                  </p>
                  <p className="text-gray-500 text-xs mt-1">State: {room.state} | Participants: {room.participantCount}</p>
                  <p className="text-gray-500 text-xs mt-1">Created: {new Date(room.createdAt).toLocaleTimeString()}</p>
                </div>
                <Link href={`/admin/${room.roomId}`}>
                  <button className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold transition-all hover:bg-blue-500 sm:w-auto">
                    Observe
                  </button>
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
