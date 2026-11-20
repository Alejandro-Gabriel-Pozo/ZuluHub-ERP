import { errorParaLaPantalla, type ErrorParaLaPantalla } from "./errores-de-plataforma";
import { faltaDeAnticipacion } from "./arrepentimiento";
import { textoDePlanes } from "./textos-de-planes";

const general = (texto: string): ErrorParaLaPantalla => ({ tipo: "GENERAL", texto });

/**
 * Los rechazos de cambiar el plan de una empresa y de deshacer un cambio por arrepentimiento (H-14b), con su texto aprobado: la falta de anticipación con la primera fecha posible que manda el servidor (T-33)
 * y los cuatro del arrepentimiento (T-34 a T-37). `VERSION_DESACTUALIZADA` sigue siendo «la pantalla quedó vieja» (T-38, el texto que ya tenía). Lo demás (segundo factor, falta de permiso, clave repetida, errores
 * de base) lo traduce `errorParaLaPantalla`. Previene: un código crudo en pantalla, o una fecha de anticipación que la consola calculó por su cuenta. Chequeo: `test/plataforma/arrepentimiento.test.ts`.
 */
export function errorDelCambioDePlan(error: unknown): ErrorParaLaPantalla {
  const datos =
    // Stryker disable next-line ConditionalExpression: un valor que no es objeto da `datos` sin campos y el código sale vacío igual; `null` se prueba.
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const codigo = typeof error === "string" ? error : datos["codigo"];
  switch (codigo) {
    case "ANTICIPACION_INSUFICIENTE": {
      const fecha = datos["primeraFechaValida"];
      // Sin la fecha del servidor no hay nada que decir con certeza: lo desconocido cierra.
      return typeof fecha === "string"
        ? general(faltaDeAnticipacion(fecha))
        : { tipo: "INESPERADO" };
    }
    case "NO_ES_EL_ULTIMO_CAMBIO":
      return general(textoDePlanes("plataforma.arrepentir.no_es_el_ultimo"));
    case "CAMBIO_SIN_ARREPENTIMIENTO":
    case "SIN_PLAN_ANTERIOR":
      return general(textoDePlanes("plataforma.arrepentir.sin_arrepentimiento"));
    case "PLAZO_VENCIDO":
      return general(textoDePlanes("plataforma.arrepentir.plazo_vencido"));
    case "YA_ARREPENTIDO":
      return general(textoDePlanes("plataforma.arrepentir.ya_arrepentido"));
    case "CAMBIO_NO_ENCONTRADO":
    case "NUMERO_INVALIDO":
      return { tipo: "PANTALLA_VIEJA", texto: textoDePlanes("plataforma.planes.version_vieja") };
    default:
      return errorParaLaPantalla(error, "PLAN");
  }
}
