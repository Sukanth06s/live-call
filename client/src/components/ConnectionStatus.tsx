"use client";

import { motion } from "framer-motion";

interface ConnectionStatusProps {
  isConnected: boolean;
  isAgoraJoined: boolean;
  isTranscribing: boolean;
}

export default function ConnectionStatus({
  isConnected,
  isAgoraJoined,
  isTranscribing,
}: ConnectionStatusProps) {
  const services = [
    { label: "Socket", active: isConnected, color: "bg-emerald-400" },
    { label: "Voice", active: isAgoraJoined, color: "bg-blue-400" },
    { label: "AI Transcript", active: isTranscribing, color: "bg-purple-400" },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
        Connection Status
      </h3>
      <div className="space-y-1.5">
        {services.map((svc) => (
          <motion.div
            key={svc.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
          >
            <div className="relative">
              <div
                className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                  svc.active ? svc.color : "bg-gray-600"
                }`}
              />
              {svc.active && (
                <div
                  className={`absolute inset-0 w-2 h-2 rounded-full ${svc.color} animate-ping opacity-40`}
                />
              )}
            </div>
            <span className="text-xs text-gray-400">{svc.label}</span>
            <span
              className={`ml-auto text-[10px] font-medium ${
                svc.active ? "text-emerald-400" : "text-gray-600"
              }`}
            >
              {svc.active ? "Connected" : "Offline"}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
