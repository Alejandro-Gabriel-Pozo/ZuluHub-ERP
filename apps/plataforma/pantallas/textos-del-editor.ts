import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";

/** El texto de un error que no es de un campo; el de campo se ve junto a su campo. */
export function textoGeneral(error: ErrorParaLaPantalla): string {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
      return error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para editar submarcas.";
    case "CAMPO":
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "No pudimos guardar el borrador.";
  }
}

/** El texto de un error de la ficha que se muestra en un aviso, o `null` si no dice nada útil. */
export function textoParaAviso(error: ErrorParaLaPantalla): string | null {
  switch (error.tipo) {
    case "CAMPO":
    case "GENERAL":
    case "PANTALLA_VIEJA":
      return error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para confirmar versiones.";
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return null;
  }
}
