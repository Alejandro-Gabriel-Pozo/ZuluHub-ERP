import { errorParaLaPantalla, type ErrorParaLaPantalla } from "./errores-de-plataforma";
import { textoDePlanes } from "./textos-de-planes";

const vieja = (texto: string): ErrorParaLaPantalla => ({ tipo: "PANTALLA_VIEJA", texto });

/**
 * Los rechazos de crear un plan, guardar un borrador y publicar una versión, con su texto aprobado. Lo que se espera que la pantalla no produzca (módulo o perilla desconocidos, valor del tipo
 * equivocado, `requiere` faltante) significa que el catálogo cambió desde que se abrió: «La pantalla quedó vieja». Lo que no está acá (segundo factor, falta de permiso, clave, error de base) lo traduce
 * `errorParaLaPantalla`. Previene: mostrar al cliente de la consola un código crudo o un texto que nadie aprobó.
 */
export function errorDePlanes(error: unknown): ErrorParaLaPantalla {
  const codigo =
    typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "codigo" in error
        ? error.codigo
        : undefined;
  switch (codigo) {
    case "SIN_BORRADOR":
      return vieja(textoDePlanes("plataforma.planes.sin_borrador"));
    case "VERSION_DESACTUALIZADA":
    case "PLAN_NO_ENCONTRADO":
    case "ID_INVALIDO":
    case "VERSION_ESPERADA_INVALIDA":
    case "MOTIVO_DEMASIADO_LARGO":
    case "MODULO_DESCONOCIDO":
    case "REQUIERE_FALTANTE":
    case "PERILLA_DESCONOCIDA":
    case "VALOR_DE_PERILLA_INVALIDO":
    case "PERILLA_REQUIERE_OTRA":
      return vieja(textoDePlanes("plataforma.planes.version_vieja"));
    case "MOTIVO_OBLIGATORIO":
      return {
        tipo: "CAMPO",
        campo: "motivo",
        texto: textoDePlanes("plataforma.planes.falta_motivo"),
      };
    case "NOMBRE_DE_PLAN_INVALIDO":
      return { tipo: "GENERAL", texto: textoDePlanes("plataforma.planes.falta_nombre") };
    case "CODIGO_DE_PLAN_INVALIDO":
      return { tipo: "GENERAL", texto: textoDePlanes("plataforma.planes.codigo_invalido") };
    case "PLAN_RETIRADO":
      return { tipo: "GENERAL", texto: textoDePlanes("plataforma.planes.no_permitido") };
    default:
      return errorParaLaPantalla(error, "GENERAL");
  }
}
