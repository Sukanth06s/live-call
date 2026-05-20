"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("candidate");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Store intended role in sessionStorage
      // so the main page can use it for socket joining
      sessionStorage.setItem("intendedRole", role);

      router.push("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#07070a] px-4 font-sans relative overflow-hidden">
      {/* Dynamic Ambient Background Neon Glows */}
      <motion.div 
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.15, 0.22, 0.15],
          x: [0, 20, 0],
          y: [0, -20, 0]
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-10 left-10 w-[500px] h-[500px] bg-indigo-600 rounded-full blur-[160px] pointer-events-none" 
      />
      <motion.div 
        animate={{ 
          scale: [1, 1.15, 1],
          opacity: [0.08, 0.15, 0.08],
          x: [0, -30, 0],
          y: [0, 30, 0]
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-10 right-10 w-[500px] h-[500px] bg-purple-600 rounded-full blur-[160px] pointer-events-none" 
      />
      
      <motion.div
        initial={{ opacity: 0, y: 35, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Glow behind the card */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-3xl blur-[40px]" />

        <div className="bg-[#0b0b10]/70 border border-white/[0.07] hover:border-white/[0.1] rounded-3xl p-8 backdrop-blur-3xl shadow-2xl shadow-black/80 relative overflow-hidden transition-all duration-300">
          
          {/* Logo / Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 450, damping: 18, delay: 0.15 }}
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 mb-4 shadow-lg shadow-indigo-500/20 relative"
            >
              <div className="absolute inset-0 bg-indigo-500 rounded-2xl blur-[12px] opacity-35 animate-pulse" />
              <svg className="w-6 h-6 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </motion.div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">LiveRoom</h1>
            <p className="text-xs text-gray-500 mt-1 select-none font-medium">Sign in to initialize secure interview workspace</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email Input */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider select-none">Email</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-gray-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
                  </svg>
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#07070a]/50 border border-white/[0.07] rounded-xl pl-10 pr-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-medium"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider select-none">Password</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-gray-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#07070a]/50 border border-white/[0.07] rounded-xl pl-10 pr-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* Premium Glowing Interactive Role selector pills */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider select-none">Access Role</label>
              <div className="grid grid-cols-3 gap-2 bg-white/[0.03] border border-white/[0.06] p-1.5 rounded-xl select-none">
                {[
                  { id: "candidate", label: "Candidate", grad: "from-blue-500 to-cyan-500", glow: "shadow-blue-500/10" },
                  { id: "hr", label: "HR / Interviewer", grad: "from-purple-500 to-indigo-500", glow: "shadow-purple-500/10" },
                  { id: "super_admin", label: "Super Admin", grad: "from-orange-500 to-rose-600", glow: "shadow-orange-500/10" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRole(item.id)}
                    className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer ${
                      role === item.id
                        ? `bg-gradient-to-r ${item.grad} text-white shadow-md ${item.glow}`
                        : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.01]"
                    }`}
                  >
                    {item.id === "super_admin" ? "Admin" : item.id === "hr" ? "HR" : "Candidate"}
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs text-center font-medium"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed mt-2 cursor-pointer"
            >
              {loading ? "Signing in..." : "Join Session"}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
