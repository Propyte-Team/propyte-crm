// Botón de ojo para ocultar o mostrar la Cronología de la ficha de contacto (#932).
// La cronología trae todo (campos, actividades, mensajes, cadencias) y con muchos registros
// estorba: por defecto va oculta y cada quien la abre cuando la necesita. La preferencia es
// del navegador (localStorage), no de la cuenta: no viaja entre equipos y puede no estar
// (modo privado, almacenamiento bloqueado); en ese caso se usa el valor por defecto.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export const CLAVE_CRONOLOGIA_VISIBLE = "crm.contacto.cronologia.visible";
/** Oculta por defecto: es lo que se pidió (hoy se ve completa y estorba). */
export const CRONOLOGIA_VISIBLE_POR_DEFECTO = false;

type Almacen = Pick<Storage, "getItem" | "setItem"> | null | undefined;

function almacenDelNavegador(): Almacen {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // acceso bloqueado (cookies de terceros, modo privado estricto…)
  }
}

/** Lee la preferencia guardada; cualquier cosa rara (sin almacén, valor ajeno, error) → el defecto. */
export function leerCronologiaVisible(almacen: Almacen = almacenDelNavegador()): boolean {
  try {
    const v = almacen?.getItem(CLAVE_CRONOLOGIA_VISIBLE);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* sin almacén: se queda el defecto */
  }
  return CRONOLOGIA_VISIBLE_POR_DEFECTO;
}

export function guardarCronologiaVisible(visible: boolean, almacen: Almacen = almacenDelNavegador()): void {
  try {
    almacen?.setItem(CLAVE_CRONOLOGIA_VISIBLE, visible ? "1" : "0");
  } catch {
    /* no se pudo guardar: el cambio vale solo para esta vista */
  }
}

/**
 * Estado de visibilidad de la cronología. Arranca con el defecto (igual en servidor y cliente,
 * para no romper la hidratación) y al montar lee la preferencia del navegador.
 */
export function useCronologiaVisible(): [boolean, () => void] {
  const [visible, setVisible] = useState(CRONOLOGIA_VISIBLE_POR_DEFECTO);
  useEffect(() => {
    setVisible(leerCronologiaVisible());
  }, []);
  const alternar = useCallback(() => {
    setVisible((v) => {
      guardarCronologiaVisible(!v);
      return !v;
    });
  }, []);
  return [visible, alternar];
}

/** El botón del encabezado de la sección: ojo tachado cuando está oculta. */
export function BotonOjoCronologia({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-secondary text-[13px]"
      onClick={onClick}
      aria-pressed={visible}
      aria-label={visible ? "Ocultar cronología" : "Mostrar cronología"}
      title={visible ? "Ocultar cronología" : "Mostrar cronología"}
    >
      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      {visible ? "Ocultar" : "Mostrar"}
    </button>
  );
}
