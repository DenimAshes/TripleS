import { Link2 } from "lucide-react";

export function ConnectServiceButton({ service }: { service: "spotify" }) {
  return (
    <form method="post" action={`/api/oauth/${service}/start`}>
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-1 rounded-md border border-[#deded8] bg-white px-2 py-1 text-xs font-medium"
      >
        <Link2 size={13} /> Connect
      </button>
    </form>
  );
}
