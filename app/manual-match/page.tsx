import { AppShell } from "@/components/AppShell";
import { ManualMatchDialog, type ManualCandidateView } from "@/components/ManualMatchDialog";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export default async function ManualMatchPage() {
  const session = await getSession();
  const matches = await prisma.manualMatchCandidate.findMany({
    where: { userId: session!.userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const enriched: ManualCandidateView[] = await Promise.all(matches.map(async (item) => {
    const alternatives = item.alternativesJson
      ? (JSON.parse(item.alternativesJson) as Array<{ serviceTrackId: string; confidence: number }>)
      : [];
    const tracks = alternatives.length
      ? await prisma.serviceTrack.findMany({ where: { id: { in: alternatives.map((candidate) => candidate.serviceTrackId) } } })
      : [];
    return {
      ...item,
      source: await prisma.serviceTrack.findUnique({ where: { id: item.sourceServiceTrackId } }),
      candidate: await prisma.serviceTrack.findUnique({ where: { id: item.candidateServiceTrackId } }),
      alternatives: alternatives
        .map((candidate) => {
          const track = tracks.find((item) => item.id === candidate.serviceTrackId);
          return track ? { track, confidence: candidate.confidence } : null;
        })
        .filter(Boolean) as ManualCandidateView["alternatives"],
    };
  }));

  return (
    <AppShell title="Review songs">
      <div className="space-y-3">
        {enriched.map((item) => <ManualMatchDialog key={item.id} item={item} />)}
        {!enriched.length ? <div className="panel p-4 text-sm text-[#666a73]">Nothing to review.</div> : null}
      </div>
    </AppShell>
  );
}
