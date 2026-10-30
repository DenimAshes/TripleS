import { CheckCircle2, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BulkAcceptControls } from "@/components/BulkAcceptControls";
import { ManualMatchDialog, type ManualCandidateView } from "@/components/ManualMatchDialog";
import { ManualReviewShortcuts } from "@/components/ManualReviewShortcuts";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { parseManualMatchAlternatives } from "@/lib/services/manualMatchRequest";

export default async function ManualMatchPage() {
  const session = await getSession();
  const matches = await prisma.manualMatchCandidate.findMany({
    where: { userId: session!.userId, status: "PENDING" },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
  });

  const alternativesByCandidate = new Map<string, ReturnType<typeof parseManualMatchAlternatives>>();
  const trackIds = new Set<string>();
  for (const item of matches) {
    trackIds.add(item.sourceServiceTrackId);
    trackIds.add(item.candidateServiceTrackId);
    const alts = parseManualMatchAlternatives(item.alternativesJson);
    alternativesByCandidate.set(item.id, alts);
    for (const alt of alts) trackIds.add(alt.serviceTrackId);
  }

  const tracks = trackIds.size
    ? await prisma.serviceTrack.findMany({ where: { id: { in: Array.from(trackIds) } } })
    : [];
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const enriched: ManualCandidateView[] = matches.map((item) => {
    const alternatives = alternativesByCandidate.get(item.id) ?? [];
    return {
      ...item,
      source: trackById.get(item.sourceServiceTrackId) ?? null,
      candidate: trackById.get(item.candidateServiceTrackId) ?? null,
      alternatives: alternatives
        .map((alt) => {
          const track = trackById.get(alt.serviceTrackId);
          return track ? { track, confidence: alt.confidence, breakdown: alt.breakdown } : null;
        })
        .filter(Boolean) as ManualCandidateView["alternatives"],
    };
  });

  const empty = enriched.length === 0;
  const highConfidenceCount = enriched.filter((item) => item.confidence >= 0.85).length;
  const lowConfidenceCount = enriched.filter((item) => item.confidence <= 0.7).length;
  const firstItem = enriched[0];
  const firstItemCandidateIds = firstItem?.alternatives?.length
    ? firstItem.alternatives.map((candidate) => candidate.track.id).slice(0, 5)
    : firstItem?.candidate
      ? [firstItem.candidate.id]
      : [];

  return (
    <AppShell
      title="Review queue"
      description="Pick the right version once. The saved match is reused by every sync rule that touches the source song."
      actions={
        <span className={`pill ${empty ? "pill-success" : "pill-warning"}`}>
          {empty ? <CheckCircle2 size={12} /> : <Sparkles size={12} />}
          {empty ? "Inbox zero" : `${enriched.length} to review`}
        </span>
      }
    >
      <ManualReviewShortcuts reviewId={firstItem?.id} candidateTrackIds={firstItemCandidateIds} />

      {empty ? (
        <div className="py-14 text-center">
          <CheckCircle2 size={32} className="mx-auto text-success" />
          <div className="heading-panel mt-3">Nothing needs review</div>
          <p className="mt-1 text-sm text-muted-fg">All pending matches are resolved.</p>
        </div>
      ) : (
        <>
          <section className="mb-5 flex flex-col gap-3 border-y border-line-soft py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="heading-row">One decision now, {enriched.length - 1} after this</div>
              <div className="mt-0.5 text-xs text-muted-fg">Compare the source with the suggested versions before choosing.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {highConfidenceCount ? <span className="pill pill-success">{highConfidenceCount} likely</span> : null}
              {lowConfidenceCount ? <span className="pill pill-warning">{lowConfidenceCount} need a closer look</span> : null}
            </div>
          </section>

          <BulkAcceptControls totalPending={enriched.length} />

          <section className="section">
            <div className="section-head">
              <h2 className="heading-section">Next decision</h2>
              <span className="text-xs text-muted-fg">Resolve or skip to load the next song</span>
            </div>
            <div className="border-y border-[var(--border-soft)]">
              <ManualMatchDialog item={firstItem!} />
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
