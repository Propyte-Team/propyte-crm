// Lógica pura de la pantalla de duplicados (E7 #968): textos de confirmación y resultado de fusión.

export interface ResultadoFusion {
  /** Contactos del grupo que se unieron al principal */
  fusionados: number;
  /** Contactos que se pidió unir */
  total: number;
  /** Mensaje del primer error (si lo hubo) */
  error?: string;
}

export interface ResumenFusion {
  tono: "ok" | "parcial" | "error";
  titulo: string;
  detalle?: string;
}

/** Resultado por grupo, con aviso claro si la fusión quedó a medias. */
export function resumenFusion(r: ResultadoFusion): ResumenFusion {
  const plural = (n: number) => `${n} ${n === 1 ? "contacto" : "contactos"}`;
  if (r.fusionados >= r.total) {
    return { tono: "ok", titulo: `Se fusionaron ${plural(r.total)} en el contacto principal` };
  }
  if (r.fusionados === 0) {
    return { tono: "error", titulo: "No se pudo fusionar el grupo", detalle: r.error };
  }
  return {
    tono: "parcial",
    titulo: `Fusión incompleta: se unieron ${r.fusionados} de ${r.total}`,
    detalle: `Quedaron ${plural(r.total - r.fusionados)} sin fusionar${r.error ? `: ${r.error}` : ""}. Revisa el grupo y vuelve a intentar.`,
  };
}

export interface ContactoResumen {
  firstName: string;
  lastName: string;
  _count: { deals: number; activities: number };
}

/** Texto del modal de confirmación: qué se conserva, qué se mueve y qué se archiva. */
export function descripcionFusion(principal: ContactoResumen, otros: ContactoResumen[]): string {
  const negocios = otros.reduce((s, c) => s + c._count.deals, 0);
  const actividades = otros.reduce((s, c) => s + c._count.activities, 0);
  const nombre = `${principal.firstName} ${principal.lastName}`.trim();
  const mover =
    negocios + actividades > 0
      ? `Se moverán ${negocios} ${negocios === 1 ? "negocio" : "negocios"} y ${actividades} ${actividades === 1 ? "actividad" : "actividades"} a ese contacto. `
      : "No hay negocios ni actividades que mover. ";
  return `Se conservará a ${nombre}. ${mover}Los otros ${otros.length === 1 ? "contacto se archiva" : `${otros.length} contactos se archivan`} y no se pueden recuperar desde esta pantalla.`;
}
