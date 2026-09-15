import { notFound } from "next/navigation";
import { Overlay } from "../../../../components/Overlay";
import { ProviderSettings } from "../../../../components/ProviderSettings";
import { api } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ProviderSettingsPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  const catalog = await api.providers();
  const item = catalog?.providers.find((entry) => entry.id === provider);
  if (!item) notFound();

  return (
    <Overlay variant="drawer" title={`Configure ${item.label}`}>
      {item.description && <p className="provider-card-desc">{item.description}</p>}
      <ProviderSettings item={item} />
    </Overlay>
  );
}
