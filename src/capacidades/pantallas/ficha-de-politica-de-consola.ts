import type { FichaDePantallaDeConsola } from "./ficha-de-planes-de-consola";

/**
 * LA FICHA DE LA PANTALLA «POLÍTICA DE CAMBIO DE PLAN» DE LA CONSOLA (H-14b). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los campos con su dato, los botones con la acción de permiso que cada
 * uno envía, el modal, los estados y cada texto con SUS usos y SU fuente. Misma forma que la de «Planes» (`ficha-de-planes-de-consola.ts`); la comprueba `test/web/ficha-de-politica-de-consola.test.ts`
 * contra el catálogo de textos, el de permisos, el registro de datos y el código. No crea acciones ni permisos: declara los de H-14a.
 * Previene: un botón, un campo o un texto que nadie aprobó. Fuente: el dueño aprobó la pantalla con esta ficha, sin maqueta (fila «H14b-1» del 20/11/2026) y los textos con «h14b ok» (DEC-0814 y DEC-0815).
 */

const PANTALLA = "apps/plataforma/pantallas/politica-de-plan.cliente.tsx";
const TABLA = "apps/plataforma/pantallas/tabla-de-politicas.tsx";
const PAGINA = "apps/plataforma/app/politica-de-plan/page.tsx";
const ARMAZON = "apps/plataforma/pantallas/armazon-de-consola.tsx";
const LOGICA = "apps/plataforma/logica/politica-de-plan.ts";
const ERRORES = "apps/plataforma/logica/errores-de-politica.ts";

const aprobado = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0814" } as const,
});
/** Textos que «Planes» ya tenía aprobados y esta pantalla reusa sin cambio («Motivo», «Cancelar», la falta de permiso y la pantalla vieja). */
const deLaConsola = (...usos: readonly string[]) => ({
  usos,
  fuente: { decision: "DEC-0805" } as const,
});

export const FICHA_DE_POLITICA_DE_CONSOLA = {
  archivos: [PAGINA, PANTALLA, TABLA],
  rutas: ["/politica-de-plan"],
  titulo: "plataforma.politica.titulo",
  acceso: "planes.ver",
  menu: { clave: "politica", texto: "plataforma.menu.politica", href: "/politica-de-plan" },
  campos: [
    { dato: "dias-de-la-politica-de-plan", archivo: PANTALLA },
    { dato: "motivo-de-politica-de-plan", archivo: PANTALLA },
  ],
  botones: [
    {
      id: "definir",
      texto: "plataforma.politica.definir",
      hace: { abre: "definir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar",
      texto: "plataforma.politica.guardar",
      hace: { envia: "politica_de_plan.definir" },
      sinPermiso: "AUSENTE",
    },
  ],
  modales: [{ id: "definir", titulo: "plataforma.politica.definir", botones: ["guardar"] }],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "plataforma.planes.no_permitido" },
  textos: {
    "plataforma.menu.politica": aprobado(ARMAZON),
    "plataforma.politica.titulo": aprobado(PAGINA),
    "plataforma.politica.rotulo_suba": aprobado(PANTALLA, LOGICA),
    "plataforma.politica.rotulo_baja": aprobado(PANTALLA, LOGICA),
    "plataforma.politica.rotulo_arrepentimiento": aprobado(PANTALLA, LOGICA),
    "plataforma.politica.unidad_dia": aprobado(LOGICA),
    "plataforma.politica.unidad_dias": aprobado(LOGICA),
    "plataforma.politica.pie_vigente": aprobado(LOGICA),
    "plataforma.politica.historial": aprobado(PAGINA, TABLA),
    "plataforma.politica.col_fecha": aprobado(TABLA),
    "plataforma.politica.col_suba": aprobado(TABLA),
    "plataforma.politica.col_baja": aprobado(TABLA),
    "plataforma.politica.col_arrepentimiento": aprobado(TABLA),
    "plataforma.politica.col_definida_por": aprobado(TABLA),
    "plataforma.politica.col_motivo": aprobado(TABLA),
    "plataforma.politica.definir": aprobado(PANTALLA),
    "plataforma.politica.falta_dias": aprobado(LOGICA, ERRORES),
    "plataforma.politica.falta_motivo": aprobado(LOGICA, ERRORES),
    "plataforma.politica.motivo_largo": aprobado(LOGICA),
    "plataforma.politica.guardar": aprobado(PANTALLA),
    "plataforma.politica.resumen": aprobado(LOGICA),
    "plataforma.politica.no_modifica": aprobado(PANTALLA),
    "plataforma.politica.guardada": aprobado(PANTALLA),
    "plataforma.politica.conflicto": aprobado(ERRORES),
    "plataforma.planes.motivo": deLaConsola(PANTALLA),
    "plataforma.planes.cancelar": deLaConsola(PANTALLA),
    "plataforma.planes.no_permitido": deLaConsola(PANTALLA),
    "plataforma.planes.version_vieja": deLaConsola(ERRORES),
  },
  textosDelNucleo: ["conexion.no_se_puede_enviar", "conexion.verificando", "estado.error_titulo"],
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantallaDeConsola;
