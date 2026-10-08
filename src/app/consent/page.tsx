import { getClientInfo } from "./actions";
import { ConsentForm } from "./consent-form";

// Resolve the app's registered name on the server so the first thing the person reads is right.
export default async function ConsentPage({
  searchParams,
}: PageProps<"/consent">) {
  const sp = await searchParams;
  const clientId = typeof sp.client_id === "string" ? sp.client_id : "";
  const fromQuery = typeof sp.client_name === "string" ? sp.client_name : null;
  const appName = fromQuery ?? (await getClientInfo(clientId)).name;
  return <ConsentForm appName={appName} />;
}
