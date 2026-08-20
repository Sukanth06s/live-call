"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";

function getSocketUrl() {
  let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
  if (socketUrl && !socketUrl.startsWith("http://") && !socketUrl.startsWith("https://")) {
    socketUrl = `https://${socketUrl}`;
  }
  return socketUrl;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("authNotice");
  });

  const isSignup = mode === "signup";
  const emailInputId = isSignup ? "candidate-signup-email" : "login-email";
  const passwordInputId = isSignup ? "candidate-signup-password" : "login-password";

  useEffect(() => {
    sessionStorage.removeItem("authNotice");
  }, []);

  const resetModeError = (nextMode: "login" | "signup") => {
    setMode(nextMode);
    setError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      sessionStorage.removeItem("intendedRole");
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCandidateSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      const res = await fetch(`${getSocketUrl()}/api/auth/candidate-signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          displayName,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not create candidate account.");
      }

      sessionStorage.removeItem("intendedRole");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-x-hidden overflow-y-auto bg-[#07070a] px-3 py-6 font-sans sm:px-4 sm:py-8">
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.15, 0.22, 0.15],
          x: [0, 20, 0],
          y: [0, -20, 0],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute left-10 top-10 h-[500px] w-[500px] rounded-full bg-indigo-600 blur-[160px]"
      />
      <motion.div
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.08, 0.15, 0.08],
          x: [0, -30, 0],
          y: [0, 30, 0],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute bottom-10 right-10 h-[500px] w-[500px] rounded-full bg-purple-600 blur-[160px]"
      />

      <motion.div
        initial={{ opacity: 0, y: 35, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 blur-[40px]" />

        <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0b0b10]/70 p-5 shadow-2xl shadow-black/80 backdrop-blur-3xl transition-all duration-300 hover:border-white/[0.1] sm:rounded-3xl sm:p-8">
          <div className="mb-6 text-center sm:mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 450, damping: 18, delay: 0.15 }}
              className="relative mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20 sm:h-14 sm:w-14"
            >
              <div className="absolute inset-0 animate-pulse rounded-2xl bg-indigo-500 opacity-35 blur-[12px]" />
              <svg className="relative z-10 h-5 w-5 text-white sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </motion.div>
            <h1 className="bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-xl font-extrabold tracking-tight text-transparent sm:text-2xl">LiveRoom</h1>
            <p className="mt-1 select-none text-xs font-medium text-gray-500">
              {isSignup ? "Create a candidate account to join interviews" : "Sign in to initialize secure interview workspace"}
            </p>
          </div>

          <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => resetModeError("login")}
              className={`rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
                !isSignup ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/15" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => resetModeError("signup")}
              className={`rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
                isSignup ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/15" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Candidate Sign Up
            </button>
          </div>

          <form onSubmit={isSignup ? handleCandidateSignup : handleLogin} className="space-y-5">
            {isSignup && (
              <div className="space-y-1.5">
                <label htmlFor="candidate-signup-display-name" className="block select-none text-[11px] font-bold uppercase tracking-wider text-gray-500">Display Name</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-gray-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A9 9 0 1118.88 6.196M15 11a3 3 0 11-6 0 3 3 0 016 0zM7 20.662V19a5 5 0 0110 0v1.662" />
                    </svg>
                  </span>
                  <input
                    id="candidate-signup-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name"
                    className="w-full rounded-xl border border-white/[0.07] bg-[#07070a]/50 py-3 pl-10 pr-4 text-sm font-medium text-white placeholder-gray-600 transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                    placeholder="Your name"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor={emailInputId} className="block select-none text-[11px] font-bold uppercase tracking-wider text-gray-500">Email</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-gray-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
                  </svg>
                </span>
                <input
                  id={emailInputId}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={`w-full rounded-xl border border-white/[0.07] bg-[#07070a]/50 py-3 pl-10 pr-4 text-sm font-medium text-white placeholder-gray-600 transition-all focus:outline-none ${
                    isSignup ? "focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" : "focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                  }`}
                  placeholder={isSignup ? "candidate@email.com" : "you@company.com"}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={passwordInputId} className="block select-none text-[11px] font-bold uppercase tracking-wider text-gray-500">Password</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-gray-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  id={passwordInputId}
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  className={`w-full rounded-xl border border-white/[0.07] bg-[#07070a]/50 py-3 pl-10 pr-4 text-sm font-medium text-white placeholder-gray-600 transition-all focus:outline-none ${
                    isSignup ? "focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20" : "focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                  }`}
                  placeholder="Password"
                />
              </div>
            </div>

            {isSignup && (
              <div className="space-y-1.5">
                <label htmlFor="candidate-signup-confirm-password" className="block select-none text-[11px] font-bold uppercase tracking-wider text-gray-500">Confirm Password</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-gray-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <input
                    id="candidate-signup-confirm-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-white/[0.07] bg-[#07070a]/50 py-3 pl-10 pr-4 text-sm font-medium text-white placeholder-gray-600 transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                    placeholder="Confirm password"
                  />
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-medium text-red-400"
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
              className={`mt-2 w-full cursor-pointer rounded-xl py-3.5 text-xs font-bold uppercase tracking-widest text-white transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                isSignup
                  ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-blue-600 shadow-lg shadow-emerald-500/10 hover:from-emerald-500 hover:to-blue-500 hover:shadow-emerald-500/25"
                  : "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/10 hover:from-blue-500 hover:to-purple-500 hover:shadow-indigo-500/25"
              }`}
            >
              {loading ? (isSignup ? "Creating account..." : "Signing in...") : isSignup ? "Create Candidate Account" : "Join Session"}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
