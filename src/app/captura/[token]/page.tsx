import { getUsableLink } from "@/lib/intake/get-usable-link";
import CapturaFormClient from "./captura-form-client";

export default async function PublicCapturaPage({ params }: { params: { token: string } }) {
  const link = await getUsableLink(params.token);

  if (!link) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Link inválido o expirado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pide a tu contacto en Propyte que te genere un nuevo enlace.
        </p>
      </div>
    );
  }

  return (
    <CapturaFormClient
      token={params.token}
      label={link.label}
      isUpdate={!!link.targetDevId}
    />
  );
}
