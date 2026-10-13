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
  { key: "nombre", label: "Nombre", required: true, defaultVisible: true },
  { key: "estado", label: "Estado", defaultVisible: true },
  { key: "tipo", label: "Tipo de contacto", defaultVisible: true },
  { key: "telefono", label: "Teléfono", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "fuente", label: "Fuente", defaultVisible: true },
  { key: "temperatura", label: "Temperatura", defaultVisible: true },
  { key: "asesor", label: "Asesor asignado", defaultVisible: true },
  { key: "registro", label: "Fecha de registro", defaultVisible: true },
  // Ocultas por defecto: el asesor las activa si le sirven.
  { key: "telefono2", label: "Teléfono secundario" },
  { key: "ciudad", label: "Ciudad de residencia" },
  { key: "ultimaActividad", label: "Última actividad" },
  { key: "negocios", label: "Negocios" },
  { key: "actividades", label: "Actividades" },
  { key: "modificado", label: "Última modificación" },
];

/** Clave de localStorage. Versionada: si el catálogo cambia de forma incompatible, se sube. */
export const STORAGE_KEY_COLUMNAS_CONTACTOS = "contacts.columnas.v1";
