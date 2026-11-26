import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LAS PANTALLAS DE LA CUENTA CORRIENTE DE CLIENTES (CC-5, A1: el listado y la ficha del cliente, solo lectura; DDD:174: toda pantalla nace con ficha). Declara lo que ofrecen: rutas y archivos, el acceso,
 * los botones (ninguno todavía: exportar, habilitar, suspender y cobrar llegan con sus pantallas), los estados y cada texto con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts`; la comprueba
 * `test/web/ficha-de-cuenta-corriente.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. Los textos que ya existían en otros catálogos se listan aparte
 * (`reutilizados`) y no se duplican. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;

export type FichaDeLaCuentaCorriente = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** La acción de lectura que exige la consulta y la fila del menú. */
  acceso: ClaveAccion;
  /** Sin botones de acción en esta entrega; los enlaces de orden y de ficha son navegación. */
  botones: readonly never[];
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", "GENERICO">>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  /** Textos de otros catálogos que la pantalla usa tal cual (cada uno con su propia fuente allá). */
  reutilizados: readonly ClaveDeTexto[];
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const MAQUETA_V2: FuenteDeTexto = {
  decidio:
    "el dueño, 26/11/2026 (chat: «Apruebo» a los textos de las maquetas, con lo ya decidido aplicado); el orquestador lo asentó en DEC-CCL-004 por la delegación de la fila 173",
  donde:
    "Pedernal-docs 11-especificaciones/briefs/maquetas/cuenta-corriente-ficha-listado-y-cobro.html (v2); arquitectura/decisiones/registro/DEC-CCL-004.json",
};
const BANNER: FuenteDeTexto = {
  decidio:
    "texto de la maqueta aprobada por el dueño el 26/11/2026, SIN «(quién, cuándo)» porque la ficha no guarda esos datos: decisión confirmada por el dueño el 26/11/2026 (chat: «Si a tus recomendaciones», DEC-CCL-005)",
  donde:
    "Pedernal-docs 11-especificaciones/briefs/maquetas/cuenta-corriente-ficha-listado-y-cobro.html (v2, «Ficha suspendida»); arquitectura/decisiones/registro/DEC-CCL-005.json",
};
const MODELO = "modelo-de-cuenta-corriente.ts";

export const FICHA_DE_CUENTA_CORRIENTE = {
  archivos: [
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/page.tsx",
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/[parteId]/page.tsx",
    "apps/web/servidor/cuenta-corriente.ts",
    "apps/web/ui/plantillas/cuenta-corriente/PantallaDeLaListaDeCuentas.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/PantallaDeLaFichaDeCuenta.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/modelo-de-cuenta-corriente.ts",
    "apps/web/ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente.ts",
    "apps/web/ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente.ts",
  ],
  rutas: ["/caja/cuenta-corriente", "/caja/cuenta-corriente/[parteId]"],
  titulo: "cuenta_corriente.lista.titulo",
  acceso: "cuenta_corriente.ver",
  botones: [],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "cuenta_corriente.menu.entrada": {
      usos: ["fila «Cuenta corriente» del menú (Caja)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.titulo": {
      usos: ["título de la pantalla y de la pestaña (listado y ficha)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.ordenar_por_saldo": {
      usos: ["enlace de orden del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.ordenar_por_vencido": {
      usos: ["enlace de orden del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.ordenar_por_antiguedad": {
      usos: ["enlace de orden del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.saldo": {
      usos: ["encabezado de columna del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.vencido": {
      usos: ["encabezado de columna del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.limite": {
      usos: ["encabezado de columna del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.credito_disponible": {
      usos: [MODELO + " (listado y ficha)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.cargo_mas_antiguo": {
      usos: ["encabezado de columna del listado"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.lista.dias": {
      usos: [MODELO + " (antigüedad en el listado y plazo en la ficha)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.estado.habilitada": {
      usos: ["insignia de estado de la cuenta"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.estado.suspendida": {
      usos: ["insignia de estado de la cuenta"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.estado.excedida": {
      usos: ["insignia de estado de la cuenta (saldo sobre el límite)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.ficha.cuit": {
      usos: [MODELO + " (subtítulo de la ficha)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.ficha.limite_de_credito": {
      usos: ["rótulo del dato de la ficha"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.ficha.plazo": { usos: ["rótulo del dato de la ficha"], fuente: MAQUETA_V2 },
    "cuenta_corriente.ficha.suspendida": {
      usos: ["aviso de la ficha de una cuenta suspendida (parte en negrita)"],
      fuente: BANNER,
    },
    "cuenta_corriente.ficha.suspendida_detalle": {
      usos: ["aviso de la ficha de una cuenta suspendida (detalle con el motivo)"],
      fuente: BANNER,
    },
    "cuenta_corriente.movimiento.movimiento": {
      usos: ["encabezado de columna de los movimientos"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.origen_del_movimiento": {
      usos: ["encabezado de columna de los movimientos"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.venta_a_cuenta": {
      usos: [MODELO + " (tipo de movimiento)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.cobranza": {
      usos: [MODELO + " (tipo de movimiento, con el medio de pago)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.venta_anulada": {
      usos: [MODELO + " (tipo de movimiento)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.vencida": {
      usos: ["insignia de un cargo vencido"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.origen_ticket": {
      usos: [MODELO + " (origen: ticket, canal y sucursal)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.origen_cobro": {
      usos: [MODELO + " (origen de una cobranza)"],
      fuente: MAQUETA_V2,
    },
    "cuenta_corriente.movimiento.origen_anulacion": {
      usos: [MODELO + " (origen de una anulación)"],
      fuente: MAQUETA_V2,
    },
  },
  reutilizados: [
    "fiscal.pantalla.rotulo_cliente",
    "fiscal.pantalla.listado_rotulo_estado",
    "fiscal.pantalla.rotulo_fecha",
    "compras.control.vence",
    "ventas.cobro.importe",
    "caja.movimiento.anulacion",
    "catalogo.lista.sin_resultados",
    "salon.texto.grupo_salon",
    "navegacion.grupo.mostrador",
  ],
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeLaCuentaCorriente;
