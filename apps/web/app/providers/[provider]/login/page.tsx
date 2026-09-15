import { notFound, redirect } from "next/navigation";
import { Overlay } from "../../../../components/Overlay";
import { RemoteLoginConsole } from "../../../../components/RemoteLoginConsole";
import { api, PROVIDER_LABELS } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ProviderLoginPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  const catalog = await api.providers();
  const item = catalog?.providers.find((entry) => entry.id === provider);
  if (!item) notFound();
  if (item.auth !== "browser") {
    redirect(`/providers/${provider}/settings`);
  }
  const status = await api.status(provider);
  const label = PROVIDER_LABELS[provider] ?? provider;

  return (
    <Overlay variant="modal" title={`Sign in to ${label}`}>
      {status?.authenticated && (
        <p className="hint">
          {label} already looks signed in — you only need this if the session expired.
        </p>
      )}
      <RemoteLoginConsole provider={provider} />
    </Overlay>
  );
}
