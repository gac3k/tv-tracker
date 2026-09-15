import Link from "next/link";
import { api } from "../../../../lib/api";
import { JobDetail } from "../../../../components/JobDetail";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await api.job(Number(id));

  if (!job) {
    return (
      <main id="main" className="shelf">
        <div className="empty">
          Job not found. <Link href="/system/jobs">Back to jobs</Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="shelf">
      <JobDetail initial={job} />
    </main>
  );
}
