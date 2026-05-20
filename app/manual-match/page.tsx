import { AppShell } from "@/components/AppShell";
import { BulkAcceptControls } from "@/components/BulkAcceptControls";
import { ManualMatchDialog, type ManualCandidateView } from "@/components/ManualMatchDialog";
import { ServicePill } from "@/components/ServiceBrand";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function ManualMatchPage() {
  const session = await getSession();
  const matches = await prisma.manualMatchCandidate.findMany({
    where: { userId: session!.userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  type Alt = { serviceTrackId: string; confidence: number; breakdown?: Record<string, number> };
  const alternativesByCandidate = new Map<string, Alt[]>();
  const trackIds = new Set<string>();
  for (const item of matches) {
    trackIds.add(item.sourceServiceTrackId);
    trackIds.add(item.candidateServiceTrackId);
    if (item.alternativesJson) {
      try {
        const alts = JSON.parse(item.alternativesJson) as Alt[];
        alternativesByCandidate.set(item.id, alts);
        for (const alt of alts) trackIds.add(alt.serviceTrackId);
      } catch {}
    }
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

  return (
    <AppShell title="Review songs">
      <section className="panel mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <ServicePill service="SPOTIFY" />
            <ServicePill service="YOUTUBE" />
            <ServicePill service="SOUNDCLOUD" />
          </div>
          <p className="mt-3 text-sm text-muted-fg">
            Review only the songs where automatic matching was not confident enough.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black tabular-nums text-white">{enriched.length}</div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-fg">pending</div>
        </div>
      </section>
      <BulkAcceptControls totalPending={enriched.length} />
      <div className="space-y-4">
        {enriched.map((item) => <ManualMatchDialog key={item.id} item={item} />)}
        {!enriched.length ? (
          <div className="panel p-10 text-center">
            <div className="text-lg font-bold text-white">Nothing needs review</div>
            <p className="mt-2 text-sm text-muted-fg">All pending matches are resolved.</p>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
