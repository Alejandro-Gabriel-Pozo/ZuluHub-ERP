import type { FichaDePantallaDeConsola } from "./ficha-de-planes-de-consola";

/**
 * LA FICHA DE LA PANTALLA «DOMINIOS» DE LA CONSOLA (plan de dominio propio, P1): ver los dominios de las empresas (aplicación y carta), agregar uno, verificarlo, activarlo, desactivarlo y retirarlo. Misma forma que la de «Planes»
 * (`ficha-de-planes-de-consola.ts`); la comprueba `test/web/ficha-de-dominios-de-consola.test.ts` contra el catálogo de textos, el de permisos, el registro de datos y el código. No crea acciones de cambio: declara las de M4a;
 * suma solo `dominios.ver` (lectura).
 * Previene: un botón, un campo o un texto que nadie aprobó, y una ruta o un archivo que se mueve sin que la ficha lo note. Fuente: ficha §2.1 de `Pedernal-docs 11-especificaciones/dominio-propio-textos-y-fichas.md` aceptada por el
 * orquestador el 25/11/2026 por la delegación de la fila 174 (DEC-0901) y los textos de §1.1 por la fila 173 (DEC-0900). Sin lo de la etapa 2 (registro DNS, última comprobación, retiros pendientes, sitio de la empresa).
 */

const PAGINA = "apps/plataforma/app/dominios/page.tsx";
const PANTALLA = "apps/plataforma/pantallas/lista-de-dominios.cliente.tsx";
const ARMAZON = "apps/plataforma/pantallas/armazon-de-consola.tsx";

const aprobado = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0900" } as const,
});
/** Textos que «Planes» ya tenía aprobados y esta pantalla reusa sin cambio. */
const deLaConsola = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0805" } as const,
});

export const FICHA_DE_DOMINIOS_DE_CONSOLA = {
  archivos: [
    PAGINA,
    PANTALLA,
    "apps/plataforma/pantallas/usar-cambio-de-dominio.cliente.tsx",
    "apps/plataforma/servidor/dominios.ts",
    "apps/plataforma/servidor/acciones-dominios.ts",
    "apps/plataforma/app/dominios/acciones.ts",
  ],
  rutas: ["/dominios"],
  titulo: "plataforma.dominios.titulo",
  acceso: "dominios.ver",
  menu: { clave: "dominios", texto: "plataforma.dominios.titulo", href: "/dominios" },
  campos: [
    { dato: "empresa-del-dominio", archivo: PANTALLA },
    { dato: "host-de-dominio", archivo: PANTALLA },
    { dato: "superficie-de-dominio", archivo: PANTALLA },
    { dato: "titular-de-dominio", archivo: PANTALLA },
    { dato: "motivo-de-retiro-de-dominio", archivo: PANTALLA },
  ],
  botones: [
    {
      id: "agregar",
      texto: "plataforma.dominios.agregar",
      hace: { abre: "agregar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-agregar",
      texto: "plataforma.dominios.confirmar_agregar",
      hace: { envia: "dominios.agregar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "verificar",
      texto: "plataforma.dominios.verificar",
      hace: { envia: "dominios.verificar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "activar",
      texto: "plataforma.dominios.activar",
      hace: { envia: "dominios.activar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "desactivar",
      texto: "plataforma.dominios.desactivar",
      hace: { envia: "dominios.desactivar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "retirar",
      texto: "plataforma.dominios.retirar",
      hace: { abre: "retirar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-retirar",
      texto: "plataforma.dominios.retirar",
      hace: { envia: "dominios.retirar" },
      sinPermiso: "AUSENTE",
    },
  ],
  modales: [
    {
      id: "agregar",
      titulo: "plataforma.dominios.agregar",
      botones: ["confirmar-agregar"],
    },
    { id: "retirar", titulo: "plataforma.dominios.retirar", botones: ["confirmar-retirar"] },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "plataforma.dominios.titulo": aprobado(PANTALLA, ARMAZON),
    "plataforma.dominios.col_host": aprobado(PANTALLA),
    "plataforma.dominios.col_empresa": aprobado(PANTALLA),
    "plataforma.dominios.col_superficie": aprobado(PANTALLA),
    "plataforma.dominios.col_titular": aprobado(PANTALLA),
    "plataforma.dominios.superficie_app": aprobado(PANTALLA),
    "plataforma.dominios.superficie_carta": aprobado(PANTALLA),
    "plataforma.dominios.titular_cliente": aprobado(PANTALLA),
    "plataforma.dominios.titular_operador": aprobado(PANTALLA),
    "plataforma.dominios.estado_pendiente": aprobado(PANTALLA),
    "plataforma.dominios.estado_verificado": aprobado(PANTALLA),
    "plataforma.dominios.verificado_el": aprobado(PANTALLA),
    "plataforma.dominios.agregar": aprobado(PANTALLA),
    "plataforma.dominios.confirmar_agregar": aprobado(PANTALLA),
    "plataforma.dominios.verificar": aprobado(PANTALLA),
    "plataforma.dominios.activar": aprobado(PANTALLA),
    "plataforma.dominios.desactivar": aprobado(PANTALLA),
    "plataforma.dominios.retirar": aprobado(PANTALLA),
    "plataforma.dominios.vacio": aprobado(PANTALLA),
    "plataforma.dominios.exito_agregado": aprobado(PANTALLA),
    "plataforma.dominios.exito_verificado": aprobado(PANTALLA),
    "plataforma.dominios.exito_activado": aprobado(PANTALLA),
    "plataforma.dominios.exito_desactivado": aprobado(PANTALLA),
    "plataforma.dominios.exito_retirado": aprobado(PANTALLA),
    "plataforma.planes.estado_activo": deLaConsola(PANTALLA),
    "plataforma.planes.estado_retirado": deLaConsola(PANTALLA),
    "plataforma.planes.motivo": deLaConsola(PANTALLA),
    "plataforma.planes.motivo_de": deLaConsola(PANTALLA),
    "plataforma.planes.cancelar": deLaConsola(PANTALLA),
  },
  textosDelNucleo: [],
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantallaDeConsola;
