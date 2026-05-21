"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ObserverRedirect({ params }: { params: { roomId: string } }) {
  const router = useRouter();

  useEffect(() => {
    async function initObserver() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }
      
      sessionStorage.setItem("intendedRole", "super_admin");
      sessionStorage.setItem("intendedRoomId", params.roomId);
      
      // Redirect to main page which will auto-join based on intendedRole/RoomId
      router.push("/");
    }
    initObserver();
  }, [params.roomId, router]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#07070a] px-4 text-center text-white">
      <p>Initializing Observer Connection...</p>
    </div>
  );
}
