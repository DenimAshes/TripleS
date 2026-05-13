import { CheckCircle2, ListVideo } from "lucide-react";

type Props = {
  hasState: boolean;
  isBrowserAutomationEnabled: boolean;
};

export function YouTubeBrowserConnector({ hasState, isBrowserAutomationEnabled }: Props) {
  return (
    <section className="panel space-y-3 p-4">
      <header className="flex items-center gap-2">
        <ListVideo size={18} />
        <h2 className="text-lg font-semibold">YouTube Music</h2>
      </header>

      {hasState ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} />
            Connected
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          YouTube Music is not connected yet.
        </div>
      )}

      {!isBrowserAutomationEnabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Playlist sync is not enabled for YouTube Music.
        </div>
      ) : null}
    </section>
  );
}
