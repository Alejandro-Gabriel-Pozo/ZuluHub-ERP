import { REGLAS_DE_EMPRESA } from "../capacidades/permisos/empresa";
import { crearCasosDeUsoDeEmpresas, crearConsultasDeEmpresas } from "../modulos/empresas/publico";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  crearConsultasDeSesion,
} from "../modulos/identidad/publico";
import type { Conexiones } from "./conexiones";
import { perezoso } from "./perezoso";

/**
 * Lo que ofrece la composición a la aplicación web: los casos de uso y las consultas de empresas e
 * identidad que ya existen, armados a mano (sin contenedor de inyección) sobre las conexiones. Cada
 * grupo se arma la primera vez que se pide; hasta entonces no se lee ninguna variable.
 *
 * La resolución de un host a su dueño y su marca (`resolucionDeHost`, M4) es la puerta pública: sin
 * sesión, solo lectura, con su propia conexión. Devuelve el host servible o nada; la configuración
 * pública completa de la marca (tema, logo, vocabulario) llega con la puerta web (M9).
 *
 * Todavía no está fiscal (no tiene contraparte en el código); se suma en su tramo. `consultasDeSesion` (la
 * persona del usuario y sus empresas, puerta `SESION`) llegó con W3a. La autenticación (W3b) es otra
 * puerta: `autenticacion()` dice QUIÉN es (usuario y email verificado, por host) y `barridoDeAutenticacion()`
 * es lo que llama el cron; la persona y las empresas salen después, con el contexto `SESION`.
 */
export function armarWeb(conexiones: Conexiones) {
  const reglas = REGLAS_DE_EMPRESA;
  return {
    resolucionDeHost: () => conexiones.resolucionDeHost(),
    autenticacion: () => conexiones.autenticacion(),
    barridoDeAutenticacion: () => conexiones.barridoDeAutenticacion(),
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
    /** `personaDeLaSesion` y `empresasDeLaSesion`: contexto `SESION`, sin empresa ni guard (W3a). */
    consultasDeSesion: perezoso(() =>
      crearConsultasDeSesion({ transacciones: conexiones.transaccionesDeApp() }),
    ),
  };
}

export type Web = ReturnType<typeof armarWeb>;
