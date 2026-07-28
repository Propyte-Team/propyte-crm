// Ficha del desarrollo publicado — espejo de propyte.com. Solo lectura.
"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, ExternalLink, Building2, AlertCircle, Tag, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/constants";
import { formatFinancingMonths } from "@/lib/format-financing";
import { formatPriceRange } from "@/lib/format-price";
import type { PublishedDevelopmentDetail, PublishedUnit } from "@/lib/hub/catalog-types";

interface Props {
  development: PublishedDevelopmentDetail | null;
  units: PublishedUnit[];
  /** Fallo al cargar el desarrollo en sí → oculta toda la ficha (no hay nada que mostrar). */
  devError: string | null;
  /** Fallo al cargar SOLO las unidades → la ficha se muestra normal; el error se acota a esa sección. */
  unitsError: string | null;
  isAdmin: boolean;
}

const SITE = "https://propyte.com/es";

export function DevelopmentDetailClient({ development, units, devError, unitsError, isAdmin }: Props) {
  const router = useRouter();

  // Fallo del desarrollo ≠ "sin unidades". Nunca lo escondas detrás de un error parcial de unidades.
  if (devError || !development) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/developments")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Desarrollos
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">No se pudo cargar el desarrollo</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Esto no significa que el desarrollo no exista: la consulta al catálogo falló.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = development;
  const ubicacion = [d.neighborhood, d.zone, d.city, d.state].filter(Boolean).join(", ");
  const financiamiento = formatFinancingMonths(d.financingMonths);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/developments")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Desarrollos
          </Button>
          <h1 className="truncate text-2xl font-bold tracking-tight">{d.name}</h1>
          <p className="text-sm text-muted-foreground">
            {d.developerName ?? "Sin desarrollador"}
            {d.stage ? ` · ${d.stage}` : ""}
          </p>
          {ubicacion && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" /> {ubicacion}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {d.slug && (
            <Button asChild variant="outline" size="sm">
              <a href={`${SITE}/desarrollos/${d.slug}`} target="_blank" rel="noreferrer">
                Ver en propyte.com <ExternalLink className="ml-1 h-4 w-4" />
              </a>
            </Button>
          )}
          {isAdmin && (
            <a
              href="https://hub.propyte.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline"
            >
              Editar en el Hub
            </a>
          )}
        </div>
      </div>

      {d.images.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {d.images.slice(0, 8).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={`${d.name} ${i + 1}`} className="h-40 w-64 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Rango de precio</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {formatPriceRange(d.priceMinMxn, d.priceMaxMxn) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Unidades publicadas</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{unitsError ? "—" : units.length}</p>
            {d.availableUnits != null && (
              <p className="text-xs text-muted-foreground">{d.availableUnits} disponibles según el Hub</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Entrega</CardTitle></CardHeader>
          <CardContent>
            <p className="flex items-center gap-1 text-lg font-semibold">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {d.deliveryText ?? d.estimatedDelivery ?? "—"}
            </p>
            {d.constructionProgress != null && (
              <p className="text-xs text-muted-foreground">{d.constructionProgress}% de avance</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Financiamiento</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {d.financingDownPayment != null ? `${d.financingDownPayment}% enganche` : "—"}
            </p>
            {financiamiento && (
              <p className="text-xs text-muted-foreground">
                {financiamiento}{d.financingInterest != null ? ` · ${d.financingInterest}%` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {d.descriptionEs && (
        <Card>
          <CardHeader><CardTitle className="text-base">Descripción</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-line text-sm text-muted-foreground">{d.descriptionEs}</p></CardContent>
        </Card>
      )}

      {d.amenities.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Amenidades</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {d.amenities.map((a) => (
              <span key={a} className="rounded-full bg-muted px-3 py-1 text-xs">{a}</span>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {unitsError ? "Unidades publicadas" : `Unidades publicadas (${units.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className={unitsError ? undefined : "p-0"}>
          {unitsError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm font-medium">No se pudieron cargar las unidades</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Esto no significa que el desarrollo no tenga unidades publicadas: la consulta al catálogo falló.
              </p>
              <Button variant="outline" size="sm" onClick={() => router.refresh()}>
                Reintentar
              </Button>
            </div>
          ) : units.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              Este desarrollo no tiene unidades publicadas en el sitio
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Unidad</th>
                    <th className="px-4 py-2 font-medium">Tipología</th>
                    <th className="px-4 py-2 font-medium">Rec / Baños</th>
                    <th className="px-4 py-2 font-medium">m²</th>
                    <th className="px-4 py-2 font-medium">Precio</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{u.unitNumber ?? u.title ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{u.typology ?? u.unitType ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {u.bedrooms ?? "—"} / {u.bathrooms ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {u.builtAreaM2 ?? u.areaM2 ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        {u.isDiscountActive && u.discountPriceMxn != null ? (
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{formatCurrency(u.discountPriceMxn, "MXN")}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                              <Tag className="h-3 w-3" />
                              {u.discountPct != null ? `-${u.discountPct}%` : "descuento"}
                            </span>
                          </span>
                        ) : u.priceMxn != null ? (
                          formatCurrency(u.priceMxn, "MXN")
                        ) : u.priceUsd != null ? (
                          formatCurrency(u.priceUsd, "USD")
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{u.status ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        {u.slug && (
                          <a
                            href={`${SITE}/propiedades/${u.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs underline"
                          >
                            Ver <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!unitsError && units.length === 0 && d.images.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-4 w-4" /> El contenido de esta ficha se administra en el Hub.
        </p>
      )}
    </div>
  );
}
