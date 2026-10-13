import { REGLAS_DE_EMPRESA } from "../capacidades/permisos/empresa";
import { crearCasosDeUsoDeEmpresas, crearConsultasDeEmpresas } from "../modulos/empresas/publico";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
} from "../modulos/identidad/publico";
import type { Conexiones } from "./conexiones";
import { perezoso } from "./perezoso";

/**
 * Lo que ofrece la composición a la aplicación web: los casos de uso y las consultas de empresas e
 * identidad que ya existen, armados a mano (sin contenedor de inyección) sobre las conexiones. Cada
 * grupo se arma la primera vez que se pide; hasta entonces no se lee ninguna variable.
 *
 * Todavía no están (no tienen contraparte en el código): la resolución de marca por host
 * (`ResolucionDeMarca.porHost`, M4), `empresasDeLaSesion` y `personaDeLaSesion` con la puerta
 * `SESION` (W3a), la autenticación (W3b) y fiscal. Se suman en sus tramos.
 */
export function armarWeb(conexiones: Conexiones) {
  const reglas = REGLAS_DE_EMPRESA;
  return {
    casosDeUsoDeEmpresas: perezoso(() =>
      crearCasosDeUsoDeEmpresas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeEmpresas: perezoso(() =>
      crearConsultasDeEmpresas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    casosDeUsoDeIdentidad: perezoso(() =>
      crearCasosDeUsoDeIdentidad({
        transacciones: conexiones.transaccionesDeApp(),
        tokens: conexiones.tokens(),
        reglas,
      }),
    ),
    consultasDeIdentidad: perezoso(() =>
      crearConsultasDeIdentidad({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}

export type Web = ReturnType<typeof armarWeb>;
