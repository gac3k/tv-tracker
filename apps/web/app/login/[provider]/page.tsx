import { redirect } from "next/navigation";

export default async function LegacyLoginPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  redirect(`/providers/${provider}/login`);
}
