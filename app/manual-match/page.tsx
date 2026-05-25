import { CheckCircle2, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BulkAcceptControls } from "@/components/BulkAcceptControls";
import { ManualMatchDialog, type ManualCandidateView } from "@/components/ManualMatchDialog";
import { ServicePill } from "@/components/ServiceBrand";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { parseManualMatchAlternatives } from "@/lib/services/manualMatchRequest";

export default async function ManualMatchPage() {
  const session = await getSession();
  const matches = await prisma.manualMatchCandidate.findMany({
    where: { userId: session!.userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
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

  return (
    <AppShell title="Review songs">
      <section className="mb-4 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight text-white md:text-2xl">
              {empty ? "Nothing waiting for review" : `${enriched.length} ${enriched.length === 1 ? "song" : "songs"} to review`}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-fg">
              Auto-match wasn&apos;t sure which version of these songs to use. Pick the best match or skip — accepted picks
              feed every rule that touches the source.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ServicePill service="SPOTIFY" />
              <ServicePill service="YOUTUBE" />
              <ServicePill service="SOUNDCLOUD" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:justify-end">
            <div className="text-4xl font-black leading-none tabular-nums text-white">{enriched.length}</div>
            <span className={`pill ${empty ? "pill-success" : "pill-warning"}`}>
              {empty ? <CheckCircle2 size={12} /> : <Sparkles size={12} />}
              {empty ? "Inbox zero" : "Action needed"}
            </span>
          </div>
        </div>
      </section>
      <BulkAcceptControls totalPending={enriched.length} />
      <div className="space-y-4">
        {enriched.map((item) => <ManualMatchDialog key={item.id} item={item} />)}
        {empty ? (
          <div className="panel group surface-lift animated-gradient-frame animated-sheen relative overflow-hidden p-10 text-center">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_at_50%_0%,rgba(79,141,255,0.1),transparent_55%)]" />
            <CheckCircle2 size={40} className="mx-auto text-emerald-300" />
            <div className="relative mt-3 text-lg font-bold text-white">Nothing needs review</div>
            <p className="relative mt-2 text-sm text-muted-fg">All pending matches are resolved.</p>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
