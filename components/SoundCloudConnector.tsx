import { CheckCircle2, Cloud } from "lucide-react";
import Link from "next/link";

type Props = {
  hasState: boolean;
  isEnabled: boolean;
};

export function SoundCloudConnector({ hasState, isEnabled }: Props) {
  return (
    <section className="panel space-y-3 p-4">
      <header className="flex items-center gap-2">
        <Cloud size={18} />
        <h2 className="text-lg font-semibold">SoundCloud</h2>
      </header>

      {hasState ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} />
            Connected
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">SoundCloud is not connected yet.</div>
      )}

      {!isEnabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Playlist sync is not enabled for SoundCloud.</div>
      ) : null}

      {hasState ? (
        <Link
          href="/soundcloud-browser"
          className="inline-flex items-center justify-center rounded-md border border-[#deded8] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f0f0ec]"
        >
          Open SoundCloud tools
        </Link>
      ) : null}
    </section>
  );
}
