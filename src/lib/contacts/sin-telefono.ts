// Contactos sin teléfono guardado — #833 y #834.
//
// Desde la #830 un contacto puede existir solo con su Usuario de WhatsApp (BSUID), su Instagram o
// su Messenger: `Contact.phone` sigue siendo NOT NULL y se guarda "" (el mismo valor que usan los
// leads solo-email). Llamar o mandar SMS no tiene equivalente sin número, y en pantalla un ""
// deja un hueco donde todos esperan ver el teléfono.

/** ¿El contacto tiene un teléfono al que se pueda llamar o mandar SMS? */
export function tieneTelefono(phone: string | null | undefined): phone is string {
  return typeof phone === "string" && phone.trim().length > 0;
}

/** Lo que responde el servidor (422) al intentar llamar o mandar SMS sin teléfono. */
export const MENSAJE_SIN_TELEFONO =
  "Este contacto no tiene teléfono guardado, así que no se le puede llamar ni mandar SMS. " +
  "Agrega su teléfono en la ficha o escríbele por el canal por el que llegó.";

const NOMBRE_CANAL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
  SMS: "SMS",
  WEB: "el sitio web",
};

/**
 * Lo que se muestra donde va el teléfono (#834): el número, o «Sin teléfono · escribe por
 * Instagram» según el canal del hilo, para que nunca quede en blanco.
 */
export function telefonoParaMostrar(phone: string | null | undefined, canal?: string | null): string {
  if (tieneTelefono(phone)) return phone.trim();
  const nombre = canal ? NOMBRE_CANAL[canal] : undefined;
  return nombre && canal !== "SMS" ? `Sin teléfono · escribe por ${nombre}` : "Sin teléfono";
}
