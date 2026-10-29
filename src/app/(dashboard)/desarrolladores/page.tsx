// /desarrolladores → /empresas (#949). El módulo cambió de nombre; la dirección vieja se queda
// como redirección permanente para no romper marcadores ni ligas guardadas.
import { permanentRedirect } from "next/navigation";

export default function DesarrolladoresRedirect() {
  permanentRedirect("/empresas");
}
