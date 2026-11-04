# Journey del cliente: embudo de etapas + flujos de reglas

Tarjeta 985 · 2026-11-04 · Estado: **borrador para revisión de Luis**

## 1. Por qué se rehace

Visto en producción el 2026-11-04 (`/journey`):

- Cinco «etapas» en fila (Entrada de leads → Reunión realizada → Reservado → Seguimiento → Postventa) unidas por curvas que regresan hacia atrás.
- Las 8 reglas (WF1–WF8) flotan debajo, **sin conexión** con las etapas; cinco quedaron apiladas lejos.
- **No hay datos**: ni cuántos contactos hay en cada etapa ni cuántos avanzan.
- Las posiciones se acomodan a mano y se guardan; con cada regla nueva el mapa se desordena más.

No cuenta el recorrido del cliente ni sirve para editar.

## 2. Qué se conserva

- **React Flow (`@xyflow/react` 12, MIT)**: ya instalado. El problema no es la librería, es cómo se usa.
- **El núcleo del editor** `src/lib/journey/rule-draft.ts`: borrador con acciones, retrasos, decisiones con ramas y «si no», y round-trip exacto con `AutomationRule`. Con 340 líneas de tests, se reutiliza tal cual.
- Catálogos de E2/E3 (`trigger-catalog`, `condition-catalog`, `action-catalog`), frases de `describeRule`, panel «Probar con un contacto» (#247) y el resumen «Todas las reglas» (#252).

## 3. Qué ve el usuario

### 3.1 Arriba: el embudo

Se construye sobre el **estado del contacto del flujograma v0.2** (#953, campo `estado`, lista y etiquetas en `src/lib/estados.ts`), que es el recorrido real del cliente. Una fila de tarjetas HTML de izquierda a derecha (sin lienzo), en el orden de `ESTADO_ORDER`:

Nuevo → Sin respuesta → Contactado → Reunión → Demo → Recorrido → Propuesta → Apartado → Firma → Escritura → Postventa

Al final, aparte, las salidas (Perdido, Contactado perdido, Negocio perdido) y los especiales (Registrado por broker, Derivado a RH), como contadores con «de qué paso salieron».

Datos de producción el 2026-11-04 (941 contactos): Nuevo 220, Sin respuesta 79, Contactado 242, Reunión 24, Demo 2, Apartado 1, Firma 32, Negocio perdido 75, Derivado a RH 262, otros ≤2; 905 cambios de `estado` en el historial. Por comparación, negocios hay 79 (11 abiertos) con solo 6 cambios de etapa registrados: un embudo de negocios saldría casi vacío.

Cada tarjeta muestra:

- **Hoy**: contactos en ese estado (color de `ESTADO_COLORS`).
- **Entraron** en la ventana elegida (7/30/90 días) y **% que pasó a un estado posterior**.
- **Tiempo típico** en el estado (mediana) y cuántos llevan más del doble («atorados»), con clic a Contactos filtrado.
- **Reglas que actúan aquí**: pastillas con cada regla cuyo disparador cae en ese paso, verde si está encendida y gris si no. Clic → abre su flujo abajo.

Filtros: plaza, flujo comercial (F1–F8), asesor y ventana de días.

**Datos**: conteo actual con `groupBy` sobre `contacts.estado`; entradas y pasos con `RecordFieldChange` (`entityType: "contact"`, `field: "estado"`) en una consulta agregada por estado de origen y destino. **Se excluyen los cambios hechos por la migración del 2026-11-03/04** (#958; filtrar por `source`), si no, el primer mes parecería que todos «entraron» de golpe. Sin modelos nuevos.

**Reglas por paso**: los disparadores por etapa de negocio se ubican en el estado equivalente (`MEETING_COMPLETED` → Reunión, `PROPOSAL_SENT`/`NEGOTIATION` → Propuesta, `RESERVED` → Apartado, `CONTRACT_SIGNED`/`CLOSING` → Firma, `WON` → Postventa). Con eso WF4 cae en Reunión y WF5 en Apartado. Disparadores por evento (lead nuevo, pago vencido, inactividad) van al grupo «En cualquier momento». Un disparador «cuando el estado del contacto cambia a…» queda como mejora posterior.

### 3.2 Abajo: los flujos de las reglas

- Lista lateral de reglas agrupadas por paso del embudo (más un grupo «En cualquier momento» para eventos como «lead nuevo» o «pago vencido»), con interruptor encendido/apagado y las métricas de «Todas las reglas».
- Al elegir una, su flujo en un lienzo **vertical que se acomoda solo**:
  - Arriba, la tarjeta **Cuando** (disparador en frase) y **Si** (condiciones en frase).
  - Debajo, un paso por acción, unidos por líneas rectas hacia abajo.
  - Un retraso se dibuja como pastilla **«Esperar 2 días»** sobre la línea, no como texto escondido dentro de la acción.
  - Una decisión abre ramas lado a lado con etiqueta (**Sí / No**, o el nombre de cada rama) que vuelven a juntarse.
  - **Botón «+» en cada línea** para insertar ahí una acción, una espera o una decisión; ramas vacías muestran «+» para no quedar cortadas.
  - Clic en un paso → panel lateral para configurarlo (el inspector actual en lenguaje de negocio). Paso incompleto → borde rojo y «Falta elegir plantilla».
  - Sobre cada paso: cuántas veces corrió, se completó y falló en la ventana (métricas por nodo que ya existen).
- Botones: Guardar, Descartar, Probar con un contacto, Encender/Apagar. El acomodo **no se guarda**: siempre se calcula. Se puede hacer zoom y moverse, no arrastrar pasos (el orden se cambia con «+», borrar, o arrastrando en la lista de «Entonces» del editor de frase).

## 4. Diseño técnico

- **Acomodo**: `dagre` (MIT) con `rankdir: "TB"`, sobre los nodos que produce `draftToFlow`. Nueva función pura `layoutFlow(flow): Flow` en `src/lib/journey/layout.ts`, con tests (orden vertical, ramas en paralelo, rama vacía, decisión anidada). Se reemplaza la posición fija `col * LANE_W, depth * 90` de `draftToFlow`.
- **Esperas como nodo visual**: `draftToFlow` emite un nodo `wait` entre dos acciones cuando la segunda tiene `delayMinutes`. Es solo visual: al guardar sigue siendo `delayMinutes` de la acción (no cambia el formato de la regla ni el motor).
- **«+» en las líneas**: arista personalizada (ya existe `insert-edge.tsx`) que llama a `insertAction` / `addDecision` / nueva `insertWait` del borrador.
- **Embudo**: `GET /api/admin/journey/embudo?dias=30&plaza=&flujo=&asesor=` (ADMIN/DIRECTOR/GERENTE), lógica pura en `src/lib/journey/embudo.ts` (orden de estados, tasas, mediana, exclusión de cambios de migración) con tests; consultas agregadas (sin N+1) y en lotes (helper `enLotes` de #246).
- **Reglas por paso**: función pura `pasoDeRegla(regla)` con la tabla de equivalencias de §3.1. Sustituye a `ruleStage` / carriles actuales.
- **Se retira**: el mapa general con posiciones guardadas (`journey-map-view` modo «General», `/api/admin/journey/layout`, la tabla de layout). La migración manual de layout se deja (no se borra la tabla en esta entrega).
- `/journey` deja de ser de solo lectura: edita con los mismos permisos que Configuración → Reglas (ADMIN/DIRECTOR). Otros roles ven embudo y flujos sin botones de edición.

## 5. Entregas

| # | Qué | Se ve |
|---|---|---|
| J1 | Embudo con datos y filtros; pastillas de reglas por paso | Arriba de /journey |
| J2 | Flujo vertical con acomodo automático, esperas visibles y ramas Sí/No (solo lectura) | Abajo de /journey |
| J3 | Edición en el lienzo: «+», panel lateral, validación, guardar/encender; retirar el mapa viejo | /journey completo |

Cada entrega: tests de la lógica pura, verificación en navegador con datos reales (solo lectura en J1/J2), PR propio contra `main`.

## 6. Preguntas para Luis

1. **¿Embudo por estado del contacto?** Propuesta: sí, con los 11 estados del flujograma uno por uno (§3.1). Alternativa: agrupar algunos (p. ej. Demo + Recorrido).
2. **¿Cuentan los «Derivado a RH»?** Son 262 (candidatos de reclutamiento, no compradores). Propuesta: excluirlos del embudo y mostrarlos solo como contador aparte.
3. **¿Quién ve el Journey?** Propuesta: gerencia y dirección ven todo; asesores no lo ven.
