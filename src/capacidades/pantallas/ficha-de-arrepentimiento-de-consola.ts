import type { FichaDePantallaDeConsola } from "./ficha-de-planes-de-consola";

/**
 * LA FICHA DE LO QUE H-14b SUMA A «PLAN DE UNA EMPRESA» (consola): deshacer por arrepentimiento el último cambio de plan y la fecha mínima del cambio dictada por el servidor. Misma forma que la de «Planes»
 * (`ficha-de-planes-de-consola.ts`); la comprueba `test/web/ficha-de-arrepentimiento-de-consola.test.ts` contra el catálogo de textos, el de permisos, el registro de datos y el código. No crea acciones ni permisos:
 * declara los de H-14a. La pantalla ya existía y no tiene ficha propia: esta cubre solo lo nuevo (sin entrada de menú propia).
 * Previene: un botón, un campo o un texto que nadie aprobó. Fuente: el dueño aprobó la pantalla con la ficha de §4.3 del brief, sin maqueta (fila «H14b-1», 20/11/2026) y los textos con «h14b ok» (DEC-0817).
 */

const PANEL = "apps/plataforma/pantallas/panel-de-plan.cliente.tsx";
const PANTALLA = "apps/plataforma/pantallas/arrepentimiento.cliente.tsx";
const CAMBIO = "apps/plataforma/pantallas/cambio-de-plan.cliente.tsx";
const LOGICA = "apps/plataforma/logica/arrepentimiento.ts";
const ERRORES = "apps/plataforma/logica/errores-de-cambio-de-plan.ts";

const aprobado = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0817" } as const,
});
/** Textos que «Planes» ya tenía aprobados y esta pantalla reusa sin cambio. */
const deLaConsola = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0805" } as const,
});

export const FICHA_DE_ARREPENTIMIENTO_DE_CONSOLA = {
  archivos: [PANEL, PANTALLA, CAMBIO],
  rutas: ["/empresas/[id]/plan"],
  acceso: "planes.ver",
  campos: [{ dato: "motivo-de-arrepentimiento", archivo: PANTALLA }],
  botones: [
    {
      id: "deshacer",
      texto: "plataforma.arrepentir.boton",
      hace: { abre: "deshacer" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-deshacer",
      texto: "plataforma.arrepentir.boton",
      hace: { envia: "planes.arrepentir" },
      sinPermiso: "AUSENTE",
    },
  ],
  modales: [
    { id: "deshacer", titulo: "plataforma.arrepentir.boton", botones: ["confirmar-deshacer"] },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "plataforma.planes.no_permitido" },
  textos: {
    "plataforma.arrepentir.puede_hasta": aprobado(LOGICA),
    "plataforma.arrepentir.etiqueta_suba": aprobado(LOGICA),
    "plataforma.arrepentir.etiqueta_baja": aprobado(LOGICA),
    "plataforma.arrepentir.deshecho": aprobado(LOGICA),
    "plataforma.arrepentir.boton": aprobado(PANTALLA),
    "plataforma.arrepentir.vuelve": aprobado(LOGICA),
    "plataforma.arrepentir.consecuencia_baja": aprobado(LOGICA),
    "plataforma.arrepentir.consecuencia_suba": aprobado(LOGICA),
    "plataforma.arrepentir.no_se_repite": aprobado(LOGICA),
    "plataforma.arrepentir.del_cambio": aprobado(LOGICA),
    "plataforma.arrepentir.minima_suba": aprobado(LOGICA),
    "plataforma.arrepentir.minima_baja": aprobado(LOGICA),
    "plataforma.arrepentir.falta_anticipacion": aprobado(LOGICA),
    "plataforma.arrepentir.no_es_el_ultimo": aprobado(ERRORES),
    "plataforma.arrepentir.sin_arrepentimiento": aprobado(ERRORES),
    "plataforma.arrepentir.plazo_vencido": aprobado(ERRORES),
    "plataforma.arrepentir.ya_arrepentido": aprobado(LOGICA, ERRORES),
    "plataforma.planes.motivo": deLaConsola(PANTALLA),
    "plataforma.planes.cancelar": deLaConsola(PANTALLA),
    "plataforma.planes.falta_motivo": deLaConsola(PANTALLA),
    "plataforma.planes.no_permitido": deLaConsola(PANTALLA),
    "plataforma.planes.version_vieja": deLaConsola(ERRORES),
  },
  textosDelNucleo: ["conexion.no_se_puede_enviar", "conexion.verificando"],
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantallaDeConsola;
