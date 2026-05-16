import { CheckCircle2, Cloud } from "lucide-react";
import Link from "next/link";

type Props = {
  hasState: boolean;
  isEnabled: boolean;
};

export function SoundCloudConnector({ hasState, isEnabled }: Props) {
  return (
    <section className="panel space-y-3 p-5">
      <header className="flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]">
          <Cloud size={16} />
        </div>
        <h2 className="text-base font-semibold">SoundCloud</h2>
      </header>

      {hasState ? (
        <div className="panel-inset flex items-center gap-2 p-3 text-sm">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span className="pill pill-success">connected</span>
          <span className="text-muted-fg">Browser session is saved.</span>
        </div>
      ) : (
        <div className="panel-inset p-3 text-sm text-muted-fg">
          <span className="pill pill-warning mr-2">not connected</span>
          SoundCloud is not connected yet.
        </div>
      )}

      {!isEnabled ? (
        <div className="panel-inset p-3 text-sm text-muted-fg">
          <span className="pill pill-warning mr-2">disabled</span>
          Playlist sync is not enabled for SoundCloud.
        </div>
      ) : null}

      {hasState ? (
        <Link href="/soundcloud-browser" className="btn btn-ghost">
          Open SoundCloud tools
        </Link>
      ) : null}
    </section>
  );
}
