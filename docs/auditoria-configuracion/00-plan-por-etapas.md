# Simplificar Configuración del CRM — plan por etapas

Fecha: 2026-11-03 · Origen: comentario de Luis ("no puede ser tan complicado todo") y auditoría
pantalla por pantalla de las 19 tarjetas de Configuración (reportes 01–06 en esta carpeta).

## Diagnóstico en una frase
Configuración habla el idioma del motor, no el del negocio: claves técnicas en inglés
(`lead.captured`, `contact.leadSource`, `ASESOR_SR`, L0–L2), formularios planos sin valores
por defecto, errores de validación que no dicen qué falló, acciones destructivas sin
confirmar, y varias opciones decorativas que no hacen nada (Acuerdo de actividad, plaza y
zonas de territorio, ver/editar de territorio, Guardia = Manual).

## Principios para todas las etapas
1. **Lenguaje de negocio primero.** Todo enum y toda clave con etiqueta en español. Las claves
   técnicas solo bajo "Avanzado".
2. **Elegir, no teclear.** Donde haya catálogo (fuentes, plazas, plantillas, cadencias,
   usuarios, etapas), un selector; nunca un campo de texto libre.
3. **Decir qué va a pasar.** Cada regla se lee como una frase ("Cuando entra un lead · si
   viene de Meta · asignar → el bot saluda → avisar") en la lista y antes de guardar.
4. **Cero placebo.** Lo que no hace nada se quita o se avisa "sin efecto todavía".
5. **El motor no cambia.** Las etapas escriben lo que el motor ya lee; si algo requiere tocar
   el motor, se dice y se decide aparte.
6. **Una etapa = un PR**, implementado por subagentes en Sonnet con pruebas, verificado en
   navegador antes de pedir revisión.

## Etapas

### E0 — Auditoría y plan (este PR, solo docs)
Reportes 01–06 y este plan.

### E1 — Idioma, limpieza y seguridad básica (transversal, quick wins)
Objetivo: que ninguna pantalla muestre jerga ni rompa nada sin avisar. Sin cambiar estructura.
- Índice de Configuración reescrito en lenguaje de negocio y agrupado por tarea (propuesta en
  05 §5: Mi cuenta · Equipo y permisos · Proceso de ventas · Fichas y datos · Asistente ·
  Conexiones). Tarjetas filtradas por rol de verdad; fuera "WhatsApp → inbox"; Duplicados y
  Huérfanos a "Calidad de datos".
- Diccionario único de etiquetas (`src/lib/labels.ts` o ampliar `constants.ts`): roles (falta
  ADMIN), plazas, fuentes, tipos de contacto, tipos de campo, niveles de autonomía
  ("Automático / Sugiere / Pide aprobación"), estrategias de reparto, niveles de equipo.
  Usarlo en todas las pantallas auditadas.
- Errores de API legibles: helper que convierte `zod.flatten()` en mensaje por campo; aplicarlo
  en admin-content, settings, fields, teams, routing-rules, automation.
- Confirmaciones propias (Dialog, no `confirm()`/`alert()`) y toasts en: webhook, API key,
  conexión, plantilla, comisión, duplicados, reglas. Quitar `window.location.reload()`.
- Quitar lo decorativo: ver/editar de territorio, badge "sin forecast manager", estrategias
  Guardia/Manual (dejar Turno y Menor carga), tarjeta "Agentes automáticos" si sigue muerta,
  `connectors-section.tsx` (código muerto). Aviso "sin efecto todavía" en Acuerdo de actividad
  y en plaza/zonas de territorio.
Tamaño: 1–2 días de subagentes. Archivos: config-center, admin-content, teams-section,
routing-rules-block, territory-editor, settings, integrations-tab, duplicados, constants.

### E2 — Constructor de condiciones en español (compartido)
Objetivo: nadie vuelve a teclear `contact.leadSource`.
- Catálogo de campos de condición con etiqueta, tipo y origen de valores
  (`src/lib/workflows/condition-catalog.ts`): fuente, tipo de contacto, plaza, zona, idioma,
  presupuesto, tipo de propiedad, temperatura, score, etapa, campaña/adset/red de Meta,
  campos custom.
- Operadores filtrados por tipo (lista → "es alguno de / no es"; número → "mayor/menor";
  texto → "contiene"). Valores con selector múltiple desde `constants.ts` y enums.
- Reemplaza el editor libre en reglas de flujo, ruteo, territorios y cadencias; el editor
  libre queda bajo "Avanzado".
- `describeRule()` / `describeConditions()` en español para listas y vista previa.
Tamaño: 2 días. Archivos: condition-tree.tsx, builder-model.ts, rules-model.ts, nuevos.

### E3 — Reglas de flujo en frase + pasos visuales (el comentario original)
Objetivo: el modal de la captura se vuelve "Cuando · Si · Entonces" con tarjetas.
- Disparadores por catálogo con nombre ("Entra un lead", "Cambia de etapa a…", "Lleva N días
  sin actividad", "Se venció el SLA") a partir de los 8 eventos reales de `emitEvent`; retirar
  o marcar "próximamente" los disparadores que el motor no ejecuta (TIME, BEHAVIORAL).
- Acciones con selectores reales: plantilla de WhatsApp/correo de la lista, cadencia por
  nombre, playbook/agente en "El bot responde", destinatario en "Avisar a", campo y valor en
  "Actualizar ficha". Retraso y cooldown con presets ("inmediato, 5 min, 1 h, 1 día").
- Tira visual disparador → condición → acciones con íconos y resumen por tarjeta; cada
  tarjeta se abre para editar. Prioridad/descripción bajo "Avanzado".
- Cadencias: mismo catálogo de acciones, días en vez de minutos, campos por paso.
- SLA en frase ("Contactar en 15 min · recordar cada 1 h · reasignar a las 24 h").
- Pantalla madre: cola en español con semáforo "¿Está funcionando?"; cron a "Detalles técnicos".
- "Probar con un contacto" (dry-run) si cabe; si no, E3b.
Tamaño: 3–4 días. Archivos: workflow-builder, cadence-editor, sla-policy-editor,
automation-section, node-catalog, builder-templates.

### E4 — Journey: que funcione y tenga un rol claro
- Quick wins del reporte 03: deep-link que abre cualquier regla (no solo las de campaña),
  clases CSS del inspector, altura del lienzo, nombre al crear, estados vacíos, errores con
  detalle, `journey_layouts` sin fallo silencioso.
- Decisión recomendada: un solo editor de reglas (E3) en Configuración; el lienzo editable se
  embebe ahí como "vista avanzada" para ramas; `/journey` pasa a solo lectura con métricas y
  SLA para gerencia.
Tamaño: 2 días quick wins + 2 días embeber. Archivos: journey/*.

### E5 — Bot conversacional: una sola historia
- Resumen "¿Quién contesta?" (marca → agente → global) arriba de las tres pantallas y
  "Hereda: X" en cada selector.
- Autonomía en español; Modelo, Arranque, Data-gate, Prioridad y slug bajo "Avanzado".
- Playbook con etiquetas en español y opciones de enum por selector; sinónimos en chips.
- UI de "Pasa a humano cuando…" (hoy prometida y sin pantalla).
- Probador del bot en seco (como ya tiene Comentarios).
Tamaño: 3 días. Archivos: bot-config-tab, playbook-tab, bot-agents-tab, brands/*.

### E6 — Conexiones: saber si está roto y conectar sin pegar claves
- Semáforo con texto, "último lead hace N", conteo de errores, diccionario de errores de Meta,
  botón "Probar" en cuentas conectadas.
- Verify token generado y URL de webhook con "copiar" al terminar el alta.
- Mapeo de campos con etiquetas y resultado en tabla.
- Rediseño aparte (decisión de Luis): OAuth de Facebook Login for Business para Lead Ads/IG,
  como ya hace WhatsApp.
Tamaño: 2 días (sin OAuth). Archivos: conexiones/*, integrations-tab.

### E7 — Fichas y datos
- Campos custom: nombre técnico autogenerado bajo "Avanzado", tipos en español, editar
  etiqueta/ayuda/orden, restaurar archivados; "Permisos por rol" o se construye o se quita del
  índice.
- Visibilidad: candado en campos del sistema, ayuda con acoplamientos, resumen por rol.
- Duplicados: "Sugerido", enlace a fichas, confirmación honesta ("los demás se archivan"),
  paginación.
Tamaño: 2 días. Archivos: fields-section, core-fields-section, duplicados/*.

### E8 — Decisiones de producto (no son UI)
Requieren decisión de Luis antes de tocar código:
- Acuerdo de actividad: conectarlo al motor (alertas por mínimos) o retirarlo.
- Equipos: hoy no influyen en el reparto; ¿deben? (reparto por equipo, líder recibe aviso).
- Plaza y zonas de territorio: convertirlas en regla automática ("si la zona preferida está en
  las zonas del territorio") o quitarlas.
- Comisiones: unicidad por tipo+fuente+rol y matriz en vez de listas.

## Orden propuesto y por qué
E1 → E2 → E3 → E4 → E5 → E6 → E7. E1 es barata y mejora todas las pantallas a la vez;
E2 es la pieza que E3, E4 y las reglas de ruteo comparten; E3 es el comentario original
de Luis; E4 depende de E3 para no construir dos editores; E5–E7 son independientes entre sí
y pueden ir en paralelo si hay presupuesto. E8 se decide en cualquier momento.

## Cómo se ejecuta cada etapa
1. Rama `feat/config-e<N>-<tema>` desde `origin/main`, worktree en `.claude/worktrees/`.
2. Subagentes en Sonnet por pantalla, con brief que cite el reporte correspondiente y los
   principios de arriba; pruebas unitarias de lo puro y de rutas.
3. Verificación en navegador con sesión de Luis; datos de prueba borrados.
4. PR con captura antes/después; tarjeta en el tablero de mejoras.
