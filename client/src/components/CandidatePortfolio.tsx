"use client";

import { CandidatePortfolioState } from "@/types";

interface CandidatePortfolioProps {
  portfolio: CandidatePortfolioState;
  candidateName: string;
  onSignOut: () => void;
}

function formatToIST(isoString?: string | null) {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return `${date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })} IST`;
  } catch {
    return isoString || "";
  }
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export default function CandidatePortfolio({ portfolio, candidateName, onSignOut }: CandidatePortfolioProps) {
  const transcript = (portfolio.transcript?.content || "").trim();
  const approvedAt = formatToIST(portfolio.verification?.approvedAt);
  const savedAt = formatToIST(portfolio.transcript?.savedAt);

  return (
    <main className="min-h-screen overflow-y-auto bg-[#07070a] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">Verified Portfolio</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {candidateName}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Your verification video and latest interview transcript are available here.
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-fit rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-gray-300 transition hover:bg-white/[0.08]"
          >
            Sign Out
          </button>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <article className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-2xl shadow-black/20 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Approved Verification Video</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Approved by {portfolio.verification?.approvedByHrName || "HR"}
                  {approvedAt ? ` on ${approvedAt}` : ""}
                </p>
              </div>
              <span className="w-fit rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Approved
              </span>
            </div>

            {portfolio.video?.signedUrl ? (
              <video
                src={portfolio.video.signedUrl}
                controls
                className="aspect-video w-full rounded-xl bg-black object-contain"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-xl border border-white/[0.06] bg-black/30 text-sm text-gray-500">
                Video preview is unavailable right now.
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{portfolio.video?.fileName || "candidate-verification-video"}</span>
              {portfolio.video?.fileSize ? <span>{formatBytes(portfolio.video.fileSize)}</span> : null}
              {portfolio.video?.source ? <span>{portfolio.video.source.replace("_", " ")}</span> : null}
            </div>
          </article>

          <article className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-2xl shadow-black/20 sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Latest Transcript</h2>
              <p className="mt-1 text-xs text-gray-500">
                {savedAt ? `Saved after HR adjourned the interview on ${savedAt}` : "Saved after HR adjourned the interview"}
              </p>
            </div>
            <div className="max-h-[520px] overflow-y-auto rounded-xl border border-white/[0.06] bg-[#09090d] p-4 text-sm font-medium leading-7 text-gray-200">
              {transcript || "No transcript was saved for this interview."}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
