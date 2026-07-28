// Lista del catálogo publicado — espejo de propyte.com. Solo lectura.
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, DollarSign, Filter, Building2, Tag, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/constants";
import type { PublishedDevelopment } from "@/lib/hub/catalog-types";

interface Props {
  developments: PublishedDevelopment[];
  loadError: string | null;
  isAdmin: boolean;
}

const SITE_BASE = "https://propyte.com/es/desarrollos";

/** Normaliza para búsqueda acento-insensible. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function DevelopmentsClient({ developments, loadError, isAdmin }: Props) {
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCity, setFilterCity] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  const cities = useMemo(
    () => [...new Set(developments.map((d) => d.city).filter((c): c is string => !!c))].sort(),
    [developments]
  );
  const stages = useMemo(
    () => [...new Set(developments.map((d) => d.stage).filter((s): s is string => !!s))].sort(),
    [developments]
  );

  const filtered = developments.filter((d) => {
    if (filterCity !== "all" && d.city !== filterCity) return false;
    if (filterStage !== "all" && d.stage !== filterStage) return false;
    if (search) {
      const q = norm(search);
      const hay = norm(`${d.name} ${d.developerName ?? ""} ${d.zone ?? ""}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Fallo de consulta ≠ catálogo vacío. Nunca los muestres igual.
  if (loadError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Desarrollos</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">No se pudo cargar el catálogo del Hub</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Esto no significa que no haya desarrollos publicados: la consulta falló.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Desarrollos</h1>
          <p className="text-muted-foreground">
            Espejo de lo publicado en propyte.com ({filtered.length})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="mr-1 h-4 w-4" />
            Filtros
          </Button>
          <span
            className="inline-flex items-center rounded-full border px-3 py-1 text-xs text-muted-foreground"
            title="El catálogo es propiedad del Hub (Propyte Hub). El CRM solo lo consulta."
          >
            Catálogo del Hub · solo lectura
          </span>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="w-64">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, desarrollador o zona"
              />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Ciudad</label>
              <Select value={filterCity} onValueChange={setFilterCity}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las ciudades</SelectItem>
                  {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Etapa</label>
              <Select value={filterStage} onValueChange={setFilterStage}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las etapas</SelectItem>
                  {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(""); setFilterCity("all"); setFilterStage("all"); }}
            >
              Limpiar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((dev) => (
          <Card
            key={dev.id}
            className="cursor-pointer overflow-hidden transition-shadow hover:shadow-lg"
            onClick={() => router.push(`/developments/${dev.id}`)}
          >
            {dev.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dev.coverImage} alt={dev.name} className="h-36 w-full object-cover" />
            ) : (
              <div className="flex h-36 items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <Building2 className="h-12 w-12 text-primary/30" />
              </div>
            )}

            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="truncate text-lg">{dev.name}</CardTitle>
                {dev.stage && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                    {dev.stage}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {dev.developerName ?? "Sin desarrollador"}
              </p>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{[dev.zone, dev.city].filter(Boolean).join(", ") || "—"}</span>
              </div>

              <div className="flex items-center gap-1 text-sm">
                <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">
                  {dev.priceMinMxn != null
                    ? `${formatCurrency(dev.priceMinMxn, "MXN")}${
                        dev.priceMaxMxn != null && dev.priceMaxMxn !== dev.priceMinMxn
                          ? ` – ${formatCurrency(dev.priceMaxMxn, "MXN")}`
                          : ""
                      }`
                    : "Precio no publicado"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{dev.publishedUnits} unid. publicadas</span>
                {dev.availableUnits != null && <span>· {dev.availableUnits} disponibles</span>}
                {(dev.discountedUnitsCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                    <Tag className="h-3 w-3" />
                    {dev.discountedUnitsCount} con descuento
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            {developments.length === 0
              ? "No hay desarrollos publicados en propyte.com"
              : "Ningún desarrollo coincide con los filtros"}
          </div>
        )}
      </div>

      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          ¿Falta un desarrollo? Se publica desde el Hub —{" "}
          <a href={SITE_BASE} target="_blank" rel="noreferrer" className="underline">
            ver catálogo en propyte.com
          </a>
        </p>
      )}
    </div>
  );
}
