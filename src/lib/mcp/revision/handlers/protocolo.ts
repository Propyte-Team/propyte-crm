import { construirSobre, envolver } from "../sobre";
import type { RevisionContext } from "../types";

/**
 * `crm_revision_protocolo` — el checklist de la corrida diaria.
 *
 * POR QUÉ EL PROTOCOLO VIVE AQUÍ Y NO EN EL PROMPT PROGRAMADO. La tarea de Cowork queda
 * en una línea —"corre la revisión siguiendo crm_revision_protocolo()"— y el protocolo se
 * corrige desplegando este repo, sin tocar nada en claude.ai. Es la misma razón por la que
 * el puente `propyte-mejoras` no implementa tools propias: una sola fuente de verdad, sin
 * una segunda copia que quede desincronizada y que nadie recuerde actualizar.
 *
 * Los tres pasos defensivos (1, 2 y 4) no son prudencia genérica. Cada uno corresponde a
 * un fallo ya pagado en este proyecto, y están anotados con cuál.
 */

export async function protocolo(_args: unknown, ctx: RevisionContext) {
  return envolver(
    construirSobre({
      ref: "protocolo versionado en el repo",
      sha: null,
      ahora: ctx.ahora,
      alcance: "checklist de la revisión diaria",
    }),
    {
      version: 1,
      pasos: [
        {
          n: 1,
          nombre: "Situar",
          hacer: [
            "crm_codigo_cambios({ desde: <ayer> })",
            "crm_pulso()",
            "crm_anomalias()",
            "crm_fallos({ desde: <ayer> })",
          ],
          regla: "Anota el `sha` del sobre. Va en TODA cita de código que produzcas hoy.",
          por_que:
            "Una rama atrasada ya produjo cuatro hallazgos falsos del tipo «esto no existe en el código». Sin el SHA, un hallazgo no se puede verificar después.",
        },
        {
          n: 2,
          nombre: "Descartar lo ya sabido",
          hacer: [
            "mejoras_list_tasks({ proyecto: 'crm' })",
            "mejoras_list_tasks({ proyecto: 'crm', estado: 'descartada' })",
            "mejoras_list_tasks({ proyecto: 'crm', estado: 'desplegada' })",
          ],
          regla:
            "La segunda llamada NO es opcional. `mejoras_list_tasks` OCULTA las descartadas por default: sin pedirlas explícitamente vas a re-proponer cada día justo lo que ya fue rechazado.",
          por_que:
            "Lo archivado sale del listado pero sigue vivo, y el guardia que solo mira el listado lo recrea. El dedup del servidor no basta: pega en hallazgos idénticos, y un reformulado pasa.",
        },
        {
          n: 3,
          nombre: "Buscar en tres frentes",
          hacer: [
            "Correctitud: lee lo que cambió ayer contra lo que debería hacer.",
            "Operación: toma las señales `alto`/`bajo` de crm_anomalias y los grupos de crm_fallos.",
            "Oportunidad: crm_practicas() y mide las de `sugeridas_hoy`.",
          ],
          regla:
            "Ignora `hoy_parcial` de crm_anomalias como evidencia: el día en curso está incompleto y siempre se ve bajo.",
          por_que:
            "Comparar un día a medias contra medianas de días completos marca toda serie en rojo hasta la medianoche. Ya pasó con datos intradía de otra plataforma.",
        },
        {
          n: 4,
          nombre: "Medir antes de registrar",
          regla:
            "Cada hallazgo necesita `archivo:línea@SHA` o una consulta con su número. SIN MEDICIÓN NO SE CREA TAREA: se anota como «sospecha sin medir» en el resumen de la corrida y ahí termina.",
          por_que:
            "De dos tareas cosechadas y trabajadas, las dos estaban YA RESUELTAS: la cosecha había importado afirmaciones, no mediciones. El costo lo paga quien abre la tarea y descubre que no había nada que arreglar.",
        },
        {
          n: 5,
          nombre: "Registrar",
          hacer: [
            "mejoras_create_task({ proyecto: 'crm', origen: 'auditor', origen_ref: 'revision-diaria@<SHA>', titulo, resumen_humano, detalle, impacto })",
          ],
          regla:
            "Un 409 es una RESPUESTA CORRECTA, no un error: significa que el hallazgo ya tiene tarea. Actualiza esa con `mejoras_update_task` si traes un dato nuevo; si no traes nada nuevo, no la toques.",
          por_que:
            "`resumen_humano` lo lee gente que no ve código: dice qué cambió para el usuario, sin nombres de archivo ni de función.",
        },
      ],
      criterio_de_exito:
        "Una corrida que crea CERO tareas es una corrida exitosa. Si no cambió nada y no hay anomalías ni fallos, cierra diciéndolo y no busques algo que registrar.",
      fuera_de_alcance: [
        "Esta puerta SOLO LEE. No arregla, no abre PRs, no escribe en el CRM.",
        "No hay agregador de excepciones de runtime: crm_fallos cubre fallos de negocio. Un resultado vacío significa «sin fallos de negocio», nunca «sin errores».",
        "Las capturas de pantalla no están en esta puerta. La revisión visual por rol la hace el skill `crm-auditor` desde Claude Code, no desde aquí.",
      ],
      formato_del_resumen:
        "Cierra la corrida con: qué revisaste (con el SHA), qué medidas encontraste, qué tareas creaste o actualizaste (con su número), y qué quedó como sospecha sin medir.",
    },
  );
}
