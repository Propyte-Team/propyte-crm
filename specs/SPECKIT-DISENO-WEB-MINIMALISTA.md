# SPECKIT — Diseño Web Minimalista (Propyte CRM)
### Dirección visual para que NO parezca "app hecha por IA"

> **Companion #6 (diseño).** Sistema visual del CRM, anclado en la marca real de Propyte (sitio + tokens del CRM ya existentes) y en una dirección minimalista deliberada.
> **Autoridad de marca:** `Manual UX/UI Sitio Web Propyte v1.0` + tokens en código (`web/globals.css`, `propyte-crm/globals.css`).
> **Versión:** 1.0 — 2026-06-10

---

## 0. TESIS DE DISEÑO

Propyte no es un SaaS genérico: es una herramienta de **inteligencia inmobiliaria** para asesores que venden preventa en la Riviera Maya, con una marca **Sage** (pedagógica, anti-hype, dato con fuente). El CRM debe sentirse como un **instrumento de precisión, calmo y legible** — no como una landing con gradientes.

**Una sola frase de dirección:** *monocromo absoluto — blanco, negro y grises — donde el color aparece SOLO como señal (etapa, temperatura, estado), el dato manda, y cada cifra muestra de dónde viene.*

> **Elemento firma (donde vive el color):** **el sistema de etapas.** El pipeline es el único lugar donde el color es protagonista: cada etapa tiene un color fijo y consistente que se reconoce en chip, columna de kanban y barra de progreso del deal. Fuera de las etapas/estado/temperatura, la pantalla es blanco y negro. Firma secundaria: **cifras con procedencia** (mono tabular + micro-etiqueta de fuente/fecha — encarna el data-gate).

> **"Máximo minimalista, pero ni simple ni feo":** quitar el color sube la vara, no la baja. Lo que sostiene la calidad es el **oficio**, no la decoración — jerarquía tipográfica fuerte, líneas finas (0.5px) precisas, espaciado en grid estricto, alineación impecable de cifras, y estados vacíos con voz. B&W mal ejecutado parece wireframe sin terminar; B&W bien ejecutado parece instrumento caro. La diferencia es 100% precisión.

---

## 1. EL "LOOK DE APP DE IA" — QUÉ EVITAR (checklist duro)

Estos son los tells que delatan una UI autogenerada. **Ninguno entra:**
- ❌ Morado/índigo por default, o **gradientes de texto** en títulos.
- ❌ **Glassmorphism**, blur, "glow" de neón, sombras `2xl` brillantes en tarjetas estáticas.
- ❌ `rounded-3xl` en todo; mezcla aleatoria de radios.
- ❌ Tres tarjetas con ícono + título + parrafito centradas ("feature grid").
- ❌ Íconos emoji, ✨ "AI sparkle", o un acento acid-green sobre negro puro.
- ❌ Tipografía **Inter** por inercia; todo en `font-medium`; centrado por default.
- ❌ Animaciones por todos lados (cada hover con bounce/scale).
- ❌ Copy de marketing dentro del producto ("¡Potencia tus ventas!").

**Norte visual (referencias reales, no copiar — calibrar):** Linear, Attio, Stripe Dashboard, Vercel, Height. Todas leen como **artesanales**: monocromas, con jerarquía tipográfica fuerte, estructura de líneas finas, densidad bien resuelta, color solo donde codifica significado, cero decoración.

---

## 2. SISTEMA DE TOKENS (refinado desde lo que ya tienen)

### 2.1 Color — blanco y negro, color solo como señal
**Base achromática (canvas claro, alto contraste):**
`--ink #0A0A0A` (texto/negro) · `--surface #FFFFFF` (canvas) · `--surface-2 #FAFAFA` (paneles) · grises `#6B7280` (secundario) / `#9CA3AF` (terciario).
**Bordes:** hairline `0.5px` gris `rgba(10,10,10,.10 / .16)` — estructuran en lugar de sombras.
**Acciones:** botón primario = **relleno negro, texto blanco**; secundario = hairline + texto negro. *No hay color de marca en los botones.* El foco usa un ring negro/gris, no un acento de color.

**El color aparece ÚNICAMENTE en tres sistemas de señal (nunca decorativo):**
1. **Etapas del pipeline** — color fijo por etapa, consistente en chip/kanban/barra. Espectro funnel (frío→cálido→cierre):
   `NEW_LEAD/CONTACTED` gris-azul · `DISCOVERY/MEETING` azul · `PROPOSAL/NEGOTIATION` índigo→ámbar · `RESERVED` ámbar · `CONTRACT_SIGNED/CLOSING` teal · `WON` verde · `LOST` rojo · `FROZEN` gris.
2. **Temperatura de lead** — un punto: hot rojo · warm ámbar · cold azul.
3. **Estado semántico** — success verde · error rojo · warning ámbar · info azul, siempre como **tinte suave + texto del mismo tono**, no relleno saturado.

> Regla de oro: si quitas todos los datos, la pantalla es **blanco y negro**. El color solo aparece donde *significa* una etapa, una temperatura o un estado. Cero color de adorno, cero acento de marca suelto. Esto **supersede** los tokens dark teal del `globals.css` actual del CRM.

### 2.2 Tipografía — pareja deliberada
- **Display / UI:** **Space Grotesk** (su cara, geométrica con carácter) — pesos 400/500/600/700, con restraint.
- **Datos / cifras:** una **mono tabular** (`Geist Mono` o `JetBrains Mono`, `font-variant-numeric: tabular-nums`) para precios, ROI, score, IDs, fechas. *Esta pareja (grotesque + mono tabular) es la decisión que lo hace leer como "instrumento financiero", no como app de IA.*
- **Escala (del Manual):** h1 36/700 · h2 28/600 · h3 22/600 · body 16/400 · body-sm 14 · metadata 14/500 · badge 12/600. Para tablas, `13px` data con mono.

### 2.3 Forma, elevación, espacio, motion
- **Radios:** `sm 4` (badges) · `md 8` (controles, default) · `lg 12` (tarjetas). Nada de `full` salvo avatares.
- **Elevación: plana.** Las líneas finas estructuran; la **sombra solo en overlays reales** (modal, popover, menú). Cero sombra-glow en superficies estáticas.
- **Espacio:** grid base 4px; aire generoso pero disciplinado. Modo **densidad** para tablas/kanban.
- **Motion:** 100–200ms ease (sus tokens). **Un solo** momento orquestado: el cambio de estado en la **matriz de disponibilidad** (un pulse breve). Respetar `prefers-reduced-motion`. *Más animación = más se siente autogenerado.*

---

## 3. LAYOUT

```
┌──────────┬─────────────────────────────────────────────┐
│ SIDEBAR  │  TOPBAR: breadcrumb · ⌘K búsqueda · usuario   │
│ (#FAFAFA)├─────────────────────────────────────────────┤
│ módulos  │  CANVAS (#FFFFFF)                            │
│ activo=  │  título h2 · acciones a la derecha           │
│ negro    │  ──────────── hairline ────────────────      │
│          │  contenido: tabla / kanban / record          │
└──────────┴─────────────────────────────────────────────┘
```
- **Sidebar** fija, íconos de línea (no emoji), el módulo activo en **negro sólido** (texto + barra de 2px negra), el resto en gris. Sin fondo de color.
- **Record (contacto / deal):** dos columnas — **riel de resumen** (cifras con procedencia, chip de etapa con color, dueño) + **timeline** unificada.
- **Pipeline:** kanban (dnd-kit), tarjetas blancas planas con hairline; el **único color** es el de la etapa (encabezado de columna + borde-izq de chip) y el punto de temperatura.
- **"Hoy" del asesor:** lista limpia B&W; prioridad por tipografía y jerarquía, con un punto de color solo para temperatura/estado.

---

## 4. COMPONENTES (reglas mínimas)

- **Botones:** primary = **relleno negro, texto blanco**; secondary = hairline + texto negro; ghost = solo texto. Una sola altura por contexto. Verbo activo ("Apartar unidad", no "Enviar").
- **Inputs:** fondo blanco/`#FAFAFA`, hairline, foco = ring negro/gris 2px (sin color de acento). Label arriba, sentence case.
- **Tablas:** densas, **mono tabular** en columnas numéricas, filas separadas por hairline (sin zebra), hover gris muy sutil, acciones al hover. Ordenables.
- **Tarjetas:** blancas planas, hairline, padding consistente; el dato manda, no el contenedor.
- **Chips de etapa/estado (único color):** 12px, radio 4, color de la etapa/temperatura/estado como **tinte de fondo + texto del mismo tono**, nunca relleno saturado. Es el lugar donde el color vive.
- **Cifra-con-procedencia (firma):** `mono tabular` + micro-tag `↳ Avica · al 2026-06` en `text-tertiary` 12px. Si no hay fuente → no se muestra el número (data-gate).
- **Estados vacíos:** dirección, no decoración: "Sin leads asignados hoy. Revisa la cola del territorio." + acción. Voz Sage, sin signos de hype.

---

## 5. VOZ EN LA INTERFAZ (es diseño, no relleno)
- Voz **Sage**: directa, pedagógica, sin hype; cero frases prohibidas del Playbook.
- Voz activa, sentence case, nombrar por lo que el usuario controla ("Recordatorios", no "Webhooks de notificación").
- El botón "Apartar" produce un toast "Apartada". Consistencia de vocabulario en todo el flujo.
- Errores sin disculpa y sin vaguedad: qué pasó y cómo resolverlo.

---

## 6. PISO DE CALIDAD (no negociable)
Responsive hasta móvil (sala de ventas), foco de teclado visible, `prefers-reduced-motion` respetado, contraste WCAG AA (negro sobre blanco sobra; cuidar grises secundarios ≥ 4.5:1), ES/EN (next-intl). Móvil: misma disciplina, una columna, acciones a pulgar.

---

## 7. CÓMO USAR ESTE SPECKIT
1. Es la fuente de la dirección visual; los tokens dark teal del `globals.css` del CRM se **reemplazan** por el sistema B&W de §2 (el color queda confinado a etapas/estado/temperatura).
2. Toda pantalla nueva se valida contra el **checklist §1** + la regla de oro de §2.1 (¿sin datos, la pantalla es blanco y negro?) antes de mergear.
3. El **elemento firma (§0)** se implementa primero: el sistema de color de etapas (chip/kanban/barra) y las cifras con procedencia.

> **Resuelto:** **canvas claro, monocromo (blanco y negro), color solo como señal.** Si más adelante se quiere un modo oscuro, debe espejar la misma disciplina (negro→tinta clara, blanco→superficie oscura, color idéntico solo en etapas/estado).

*Fin — Speckit Diseño Web Minimalista v1.0.*
