"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface RoomMeta {
  roomId: string;
  state: string;
  participantCount: number;
  createdAt: number;
}

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
    return <div className="min-h-screen bg-[#07070a] text-white flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[#07070a] text-white p-8 font-[var(--font-inter)]">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Admin Dashboard - Active Rooms</h1>
        <div className="grid gap-4">
          {rooms.length === 0 ? (
            <p className="text-gray-400">No active rooms found.</p>
          ) : (
            rooms.map(room => (
              <div key={room.roomId} className="bg-white/5 border border-white/10 rounded-xl p-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">{room.roomId}</h2>
                  <p className="text-gray-400 text-sm">State: {room.state} | Participants: {room.participantCount}</p>
                  <p className="text-gray-500 text-xs mt-1">Created: {new Date(room.createdAt).toLocaleTimeString()}</p>
                </div>
                <Link href={`/admin/${room.roomId}`}>
                  <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-all font-semibold">
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
