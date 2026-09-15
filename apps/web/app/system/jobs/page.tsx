import { api } from "../../../lib/api";
import { JobsBoard } from "../../../components/JobsBoard";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const data = await api.jobs();

  if (!data) {
    return (
      <main id="main" className="shelf">
        <div className="empty">
          API server unreachable. Start it with <code>pnpm dev:server</code> (port 3000).
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="shelf">
      <JobsBoard initial={data} />
    </main>
  );
}
