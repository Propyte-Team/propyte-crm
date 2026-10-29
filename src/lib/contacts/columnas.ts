// Columnas configurables de la tabla de Contactos: mismo "Gestionar columnas" que las tablas
// de Reuniones y Llamadas de la Agenda (HUB #842). Módulo PURO: solo el catálogo y la clave de
// almacenamiento; el saneo de la preferencia (columnasVisibles) y el buscador (filtrarColumnas)
// son los de lib/agenda/columnas.ts, no una copia, para que las tres tablas se comporten igual.

import type { ColumnaDef } from "@/lib/agenda/columnas";

/**
 * Orden = orden en pantalla. "Acciones" (el menú ⋯) no está aquí a propósito: es un control,
 * no un dato, y siempre se muestra al final.
 */
export const COLUMNAS_CONTACTOS: ColumnaDef[] = [
  // `align` (#865): el texto libre (nombres, teléfonos, correos, ciudad) a la izquierda; las
  // pastillas, etiquetas, fechas y conteos centrados. Los encabezados van todos centrados.
  { key: "nombre", label: "Nombre", required: true, defaultVisible: true, align: "left" },
  { key: "estado", label: "Estado", defaultVisible: true, align: "center" },
  { key: "tipo", label: "Tipo de contacto", defaultVisible: true, align: "center" },
  // #951: flujo del flujograma (#948). Visible por defecto para que salten los «Sin flujo»; quien
  // ya guardó su elección de columnas lo agrega desde «Gestionar columnas».
  { key: "flujo", label: "Flujo", defaultVisible: true, align: "center" },
  { key: "telefono", label: "Teléfono", defaultVisible: true, align: "left" },
  { key: "email", label: "Email", defaultVisible: true, align: "left" },
  { key: "fuente", label: "Fuente", defaultVisible: true, align: "center" },
  { key: "temperatura", label: "Temperatura", defaultVisible: true, align: "center" },
  { key: "asesor", label: "Asesor asignado", defaultVisible: true, align: "left" },
  { key: "registro", label: "Fecha de registro", defaultVisible: true, align: "center" },
  // Ocultas por defecto: el asesor las activa si le sirven.
  // Teléfono secundario: temporal, se planea quitar esa opción del CRM (#865).
  { key: "telefono2", label: "Teléfono secundario", align: "left" },
  { key: "ciudad", label: "Ciudad", align: "left" }, // antes «Ciudad de residencia» (#865)
  { key: "ultimaActividad", label: "Última actividad", align: "center" },
  { key: "negocios", label: "Negocios", align: "center" },
  { key: "actividades", label: "Actividades", align: "center" },
  { key: "modificado", label: "Última modificación", align: "center" },
];

/** Clave de localStorage. Versionada: si el catálogo cambia de forma incompatible, se sube. */
export const STORAGE_KEY_COLUMNAS_CONTACTOS = "contacts.columnas.v1";
