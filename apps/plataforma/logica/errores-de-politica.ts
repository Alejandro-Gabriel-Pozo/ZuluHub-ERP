import { errorParaLaPantalla, type ErrorParaLaPantalla } from "./errores-de-plataforma";
import { textoDePlanes } from "./textos-de-planes";

/**
 * Los rechazos de definir la política de cambio de plan, con su texto aprobado. `VERSION_DESACTUALIZADA` es el aviso de que otra persona la cambió (T-18; la pantalla conserva lo escrito y se
 * recarga). Lo demás (segundo factor, falta de permiso, clave repetida, error de base) lo traduce `errorParaLaPantalla` (también «El motivo es demasiado largo.», T-13, que ya tenía). Previene: mostrar un código crudo, o perder lo que la persona escribió
 * cuando otra definió una versión primero. Chequeo: `test/plataforma/politica-de-plan.test.ts`.
 */
export function errorDePolitica(error: unknown): ErrorParaLaPantalla {
  const codigo =
    typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "codigo" in error
        ? error.codigo
        : undefined;
  switch (codigo) {
    case "VERSION_DESACTUALIZADA":
      return { tipo: "PANTALLA_VIEJA", texto: textoDePlanes("plataforma.politica.conflicto") };
    case "VERSION_ESPERADA_INVALIDA":
      return { tipo: "PANTALLA_VIEJA", texto: textoDePlanes("plataforma.planes.version_vieja") };
    case "DIAS_DE_POLITICA_INVALIDOS":
      return { tipo: "GENERAL", texto: textoDePlanes("plataforma.politica.falta_dias") };
    case "MOTIVO_OBLIGATORIO":
      return {
        tipo: "CAMPO",
        campo: "motivo",
        texto: textoDePlanes("plataforma.politica.falta_motivo"),
      };
    default:
      return errorParaLaPantalla(error);
  }
}
