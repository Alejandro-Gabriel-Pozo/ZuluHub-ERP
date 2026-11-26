import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";
import {
  TEXTOS_DE_LA_FICHA_DE_COBRAR_A_CUENTA,
  type FuenteDeTexto,
  type TextoDeFicha,
} from "./textos-de-ficha-de-cobrar-a-cuenta";

/**
 * LA FICHA DE LAS PANTALLAS DE LA CUENTA CORRIENTE DE CLIENTES (CC-5, A1: el listado y la ficha del cliente; A2: habilitar, cambiar plazo o límite, suspender y reactivar; DDD:174: toda pantalla nace con ficha). Declara lo que ofrecen: rutas y archivos, el acceso,
 * los botones (A2: habilitar, cambiar plazo o límite, suspender y reactivar; exportar y cobrar llegan con sus pantallas), los estados y cada texto con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts`; la comprueba
 * `test/web/ficha-de-cuenta-corriente.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. Los textos que ya existían en otros catálogos se listan aparte
 * (`reutilizados`) y no se duplican. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

type BotonDeLaFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  sinPermiso: "APAGADO";
}>;

export type FichaDeLaCuentaCorriente = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** La acción de lectura que exige la consulta y la fila del menú. */
  acceso: ClaveAccion;
  /** Los botones que escriben o navegan a un formulario; los enlaces de orden y de ficha son navegación y no figuran. Sin el permiso salen apagados (el servidor igual decide). */
  botones: readonly BotonDeLaFicha[];
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
const A2: FuenteDeTexto = {
  decidio:
    "el dueño, 26/11/2026 (chat: «Apruebo» a los textos de las maquetas); el orquestador asentó la plantilla de A2 en DEC-CCL-006 por la delegación de la fila 173, sin el pie explicativo",
  donde:
    "Pedernal-docs 11-especificaciones/briefs/maquetas/cuenta-corriente-ficha-listado-y-cobro.html (v2, «Habilitar cuenta» y «Ficha suspendida»); arquitectura/decisiones/registro/DEC-CCL-006.json",
};
const VENDER: FuenteDeTexto = {
  decidio:
    "el dueño, 26/11/2026 (chat: «Apruebo» a los textos de las maquetas; «Si» a que en la primera etapa con el límite pasado el confirmar quede bloqueado para todos); el orquestador asentó los textos en DEC-CCL-008 por la delegación de la fila 173, sin la aprobación del exceso ni el límite a la vista de quien vende",
  donde:
    "Pedernal-docs 11-especificaciones/briefs/maquetas/cuenta-corriente-elegir-cliente.html y cuenta-corriente-aprobar-exceso.html; arquitectura/decisiones/registro/DEC-CCL-008.json",
};
const MODELO = "modelo-de-cuenta-corriente.ts";

export const FICHA_DE_CUENTA_CORRIENTE = {
  archivos: [
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/page.tsx",
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/[parteId]/page.tsx",
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/habilitar/page.tsx",
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/[parteId]/condiciones/page.tsx",
    "apps/web/app/s/app/(operacion)/caja/cuenta-corriente/[parteId]/cobrar/page.tsx",
    "apps/web/app/s/app/acciones-de-cuenta-corriente.ts",
    "apps/web/app/s/app/acciones-de-cobrar-a-cuenta.ts",
    "apps/web/servidor/cuenta-corriente.ts",
    "apps/web/servidor/cobrar-a-cuenta.ts",
    "apps/web/servidor/cuenta-corriente-escritura.ts",
    "apps/web/ui/plantillas/cuenta-corriente/PantallaDeLaListaDeCuentas.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/PantallaDeLaFichaDeCuenta.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/FormularioDeHabilitarCuenta.cliente.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/FormularioDeCondicionesDeCuenta.cliente.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/FormularioDeSuspenderCuenta.cliente.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/FormularioDeReactivarCuenta.cliente.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/PantallaDeCobrarACuenta.cliente.tsx",
    "apps/web/ui/plantillas/cuenta-corriente/modelo-de-cuenta-corriente.ts",
    "apps/web/ui/plantillas/cuenta-corriente/modelo-de-cobrar-a-cuenta.ts",
    "apps/web/ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente.ts",
    "apps/web/ui/plantillas/cuenta-corriente/textos-de-cobrar-a-cuenta.ts",
    "apps/web/ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente.ts",
    "apps/web/ui/plantillas/cobrar/HojaDeVenderACuenta.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/textos-de-vender-a-cuenta.ts",
  ],
  rutas: [
    "/caja/cuenta-corriente",
    "/caja/cuenta-corriente/[parteId]",
    "/caja/cuenta-corriente/habilitar",
    "/caja/cuenta-corriente/[parteId]/condiciones",
    "/caja/cuenta-corriente/[parteId]/cobrar",
  ],
  titulo: "cuenta_corriente.lista.titulo",
  acceso: "cuenta_corriente.ver",
  botones: [
    {
      id: "exportar",
      texto: "compras.exportacion.exportar",
      hace: { navega: "/caja/cuenta-corriente/exportar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "habilitar-cliente",
      texto: "cuenta_corriente.lista.habilitar_cliente",
      hace: { navega: "/caja/cuenta-corriente/habilitar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "habilitar",
      texto: "cuenta_corriente.habilitar.habilitar",
      hace: { envia: "cuenta_corriente.administrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cobrar-un-ticket",
      texto: "cuenta_corriente.cobro.boton_de_la_ficha",
      hace: { navega: "/caja/cuenta-corriente/[parteId]/cobrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cobrar",
      texto: "cuenta_corriente.cobro.cobrar",
      hace: { envia: "tickets.cobrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cambiar-condiciones",
      texto: "cuenta_corriente.ficha.cambiar_condiciones",
      hace: { navega: "/caja/cuenta-corriente/[parteId]/condiciones" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar-condiciones",
      texto: "catalogo.accion.guardar",
      hace: { envia: "cuenta_corriente.administrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "suspender",
      texto: "cuenta_corriente.ficha.suspender",
      hace: { envia: "cuenta_corriente.administrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reactivar",
      texto: "cuenta_corriente.ficha.reactivar",
      hace: { envia: "cuenta_corriente.administrar" },
      sinPermiso: "APAGADO",
    },
  ],
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

    "cuenta_corriente.lista.habilitar_cliente": {
      usos: ["botón del listado que abre el formulario de habilitar"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.titulo": {
      usos: ["título de la pantalla y de la pestaña de habilitar"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.elegir_cliente": {
      usos: ["opción vacía del selector de cliente"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.razon_social": {
      usos: ["rótulo de la razón social del cliente elegido"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.limite": {
      usos: ["rótulo del campo límite de crédito al habilitar"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.falta_cuit": {
      usos: ["aviso del cliente elegido sin CUIT (parte en negrita)"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.falta_cuit_detalle": {
      usos: ["aviso del cliente elegido sin CUIT (detalle)"],
      fuente: A2,
    },
    "cuenta_corriente.habilitar.habilitar": {
      usos: ["botón de enviar del formulario de habilitar"],
      fuente: A2,
    },
    "cuenta_corriente.ficha.cambiar_condiciones": {
      usos: ["botón de la ficha y título de la pantalla de cambiar plazo o límite"],
      fuente: A2,
    },
    "cuenta_corriente.ficha.suspender": { usos: ["botón de suspender la cuenta"], fuente: A2 },
    "cuenta_corriente.ficha.motivo_de_suspension": {
      usos: ["rótulo del motivo al suspender"],
      fuente: A2,
    },
    "cuenta_corriente.ficha.motivo_de_reactivacion": {
      usos: ["rótulo del motivo al reactivar"],
      fuente: A2,
    },
    "cuenta_corriente.ficha.reactivar": { usos: ["botón de reactivar la cuenta"], fuente: A2 },

    ...TEXTOS_DE_LA_FICHA_DE_COBRAR_A_CUENTA,
    "cuenta_corriente.vender.titulo": {
      usos: ["título de la hoja «Vender a cuenta corriente» y botón del cobro que la abre"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.saldo_actual": {
      usos: ["fila de la hoja de vender a cuenta"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.esta_venta": {
      usos: ["fila de la hoja de vender a cuenta"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.saldo_despues": {
      usos: ["fila de la hoja de vender a cuenta"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.cargar": {
      usos: ["botón de la hoja: confirma la venta a cuenta"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.elegir_otro_cliente": {
      usos: ["botón de la hoja cuando la venta supera el límite"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.supera_el_limite": {
      usos: ["aviso de la hoja cuando la venta pasa el límite del cliente"],
      fuente: VENDER,
    },
    "cuenta_corriente.vender.sin_permiso_para_aprobar": {
      usos: ["aviso de la hoja, solo a quien no tiene aprobar_exceso"],
      fuente: VENDER,
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
    "catalogo.accion.guardar",
    "catalogo.accion.cancelar",
    "compras.exportacion.exportar",
    "fiscal.pantalla.imprimir_formato_ticket",
    "ventas.cobro.cobrado",
    "cuenta_corriente.credito_disponible",
    "ventas.cobro.volver_al_cobro",
  ],
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeLaCuentaCorriente;
