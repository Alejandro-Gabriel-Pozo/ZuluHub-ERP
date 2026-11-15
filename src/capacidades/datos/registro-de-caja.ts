import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos del módulo caja (medios de pago, cuentas de cobro y cajas) del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no toquen
 * las mismas líneas: solo cambia la ubicación, ningún dato ni consumidor. Un dato no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const REQUIERE_CAJA = { modulo: "caja", estadoDeEmpresa: ["ACTIVE"] } as const;
const MEDIOS_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeMedio.cliente.tsx";
const MEDIOS_PROPOSITO_NOMBRE: Proposito = {
  para: "Nombre propio, opcional, de un medio de pago al agregarlo o editarlo (pantalla «Medios de pago»).",
  fuente:
    "Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (medio de pago: el nombre es opcional, la pantalla usa el vocabulario del tipo) y la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
};
const CUENTA_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeCuenta.cliente.tsx";
const CAJA_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeCaja.cliente.tsx";
const MAQUETA_DE_MEDIOS =
  "la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)";
const CUENTA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente: `Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (cuenta de cobro) y ${MAQUETA_DE_MEDIOS}`,
});
const CAJA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente: `Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (caja) y ${MAQUETA_DE_MEDIOS}`,
});
const APERTURA = "apps/web/ui/plantillas/caja/FormularioDeApertura.cliente.tsx";
const MOVIMIENTO = "apps/web/ui/plantillas/caja/FormularioDeMovimiento.cliente.tsx";
const ANULACION = "apps/web/ui/plantillas/caja/FormularioDeAnulacion.cliente.tsx";
const CIERRE = "apps/web/ui/plantillas/caja/FormularioDeCierre.cliente.tsx";
/**
 * La pantalla «Caja» del mostrador: sus formularios los pide `caja.html` (maqueta aprobada, `vAbrir`, `vMov`, `vModal` y `vCierre`, carpeta de prototipos de Pedernal-docs 10-ux-ui) y los fija
 * `e3-caja-y-cobros-especificacion.md` §3.2 (abrir, contar y cerrar), §3.5 y §3.9; los textos y la pantalla los aceptó el dueño el 15/11/2026 (`decisiones-del-dueno-2026-11.md`, filas del
 * 15/11/2026 «Textos: el dueño acepta todos los textos propuestos» y «Aceptado por el orquestador, por delegación (filas 173 y 174): maqueta del cierre…», decisión 175).
 */
const MOSTRADOR_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/e3-caja-y-cobros-especificacion.md §3.2 y §3.9, la maqueta aprobada `caja.html` (carpeta de prototipos de Pedernal-docs 10-ux-ui) y 11-especificaciones/decisiones-del-dueno-2026-11.md (filas del 15/11/2026: textos aceptados y decisión 175)",
});
const MEDIOS_PROPOSITO_TIPO: Proposito = {
  para: "Tipo de un medio de pago, de una lista cerrada, al agregarlo (pantalla «Medios de pago»); no se cambia después.",
  fuente:
    "Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (medio de pago: lista cerrada de tipos) y la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
};

export const DATOS_DE_CAJA = {
  "nombre-de-medio-de-pago": {
    // SUPUESTO (DEC-0342): la ficha es el dominio de caja, que ya tiene el largo y el conjunto permitido del nombre del medio; no se movió a `primitivas/`
    // (cambio mayor que el de este tramo). Revertirlo es mover `nombreDeMedioValido` a una primitiva y apuntar esta ruta a ella.
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [MEDIOS_PROPOSITO_NOMBRE],
    consumidores: [MEDIOS_FORMULARIO],
    ponerPor: ["medios_de_pago.crear", "medios_de_pago.editar"],
    requiere: REQUIERE_CAJA,
  },
  "tipo-de-medio-de-pago": {
    ficha: "src/modulos/caja/estados.ts",
    propositos: [MEDIOS_PROPOSITO_TIPO],
    consumidores: [MEDIOS_FORMULARIO],
    ponerPor: ["medios_de_pago.crear"],
    requiere: REQUIERE_CAJA,
  },
  "nombre-de-cuenta-de-cobro": {
    // Misma ficha que el nombre del medio (SUPUESTO, DEC-0342): el dominio de caja tiene el largo y el conjunto permitido de cada nombre.
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Nombre de una cuenta de cobro al agregarla o editarla (pantalla «Cuentas de cobro»).",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear", "cuentas_de_cobro.editar"],
    requiere: REQUIERE_CAJA,
  },
  "tipo-de-cuenta-de-cobro": {
    ficha: "src/modulos/caja/estados.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Tipo de una cuenta de cobro (terminal, QR o cuenta bancaria), de una lista cerrada, al agregarla; no se cambia después.",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear"],
    requiere: REQUIERE_CAJA,
  },
  "identificador-de-cuenta-de-cobro": {
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Identificador opcional de una cuenta de cobro (número de terminal o alias, nunca una clave) al agregarla o editarla.",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear", "cuentas_de_cobro.editar"],
    requiere: REQUIERE_CAJA,
  },
  "sucursal-de-cuenta-de-cobro": {
    ficha: "src/primitivas/identificadores/marca.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Sucursal a la que pertenece una cuenta de cobro: una sola, siempre elegida, al agregarla o editarla.",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear", "cuentas_de_cobro.editar"],
    requiere: REQUIERE_CAJA,
  },
  "nombre-de-caja": {
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [
      CAJA_PROPOSITO(
        "Nombre de una caja de la sucursal al agregarla o editarla (pantalla «Cajas»).",
      ),
    ],
    consumidores: [CAJA_FORMULARIO],
    ponerPor: ["cajas.crear", "cajas.editar"],
    requiere: REQUIERE_CAJA,
  },
  // Pantalla «Caja» del mostrador. El importe se tipea sin signo (`CampoImporte`) y viaja como texto decimal; el tope, los decimales y el signo que admite cada operación los decide el dominio
  // de caja dentro de la transacción (`importeDeEntrada`, `importes.ts`): la regla vive ahí una vez.
  "importe-de-fondo-inicial": {
    ficha: "src/modulos/caja/dominio/importes.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Fondo inicial de una caja al abrirla (pantalla «Caja»): importe en pesos, cero o más; entra como un movimiento «fondo inicial» que no se anula.",
      ),
    ],
    consumidores: [APERTURA],
    ponerPor: ["sesiones_caja.abrir"],
    requiere: REQUIERE_CAJA,
  },
  "importe-de-movimiento-de-caja": {
    ficha: "src/modulos/caja/dominio/importes.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Importe de un ingreso, un egreso o un ajuste manual de la caja abierta, siempre sin signo y mayor que cero: el sentido es una elección cerrada (ingreso o egreso por el botón elegido; sobra o falta en el ajuste), nunca un signo.",
      ),
    ],
    consumidores: [MOVIMIENTO],
    ponerPor: ["movimientos_caja.registrar_manual", "movimientos_caja.ajustar"],
    requiere: REQUIERE_CAJA,
  },
  "sentido-de-ajuste-de-caja": {
    // La lista cerrada («SOBRA» suma al efectivo, «FALTA» resta) vive una vez en la frontera de la pantalla; el dominio recibe el importe con signo que esa frontera arma. El ingreso y el egreso no son un campo:
    // los fija el botón con que se abre el formulario (maqueta `caja.html`, `vMov`).
    ficha: "src/composicion/entradas-de-sesion-de-caja.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Sentido de un ajuste de caja, de una lista cerrada de dos: «Sobra» (suma al efectivo) o «Falta» (resta); se elige al registrar el ajuste.",
      ),
    ],
    consumidores: [MOVIMIENTO],
    ponerPor: ["movimientos_caja.ajustar"],
    requiere: REQUIERE_CAJA,
  },
  "motivo-de-movimiento-de-caja": {
    // Una regla, un lugar: el motivo de un movimiento, de un ajuste y de una anulación usa la lista de permitidos y el largo de la explicación del cierre (`motivoObligatorio`, `caja/dominio/texto.ts`),
    // que la base repite en `movimiento_caja_motivo_ck`. El campo toma el largo de `LARGO_MAXIMO_DE_LA_EXPLICACION`, no lo escribe de nuevo.
    ficha: "src/modulos/cierre/dominio/explicacion.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Motivo, obligatorio, de un ingreso, un egreso o un ajuste manual de caja.",
      ),
      MOSTRADOR_PROPOSITO("Motivo, obligatorio, al anular un movimiento manual de la caja."),
    ],
    consumidores: [MOVIMIENTO, ANULACION],
    ponerPor: [
      "movimientos_caja.registrar_manual",
      "movimientos_caja.ajustar",
      "movimientos_caja.anular",
      "movimientos_caja.anular_de_otros",
    ],
    requiere: REQUIERE_CAJA,
  },
  "cantidad-de-billetes": {
    // Entero de 0 a `CANTIDAD_MAXIMA_DE_BILLETES` por cada denominación de `DENOMINACIONES_DE_BILLETES`; vacío es «sin billetes de ese valor» (la pantalla lo suma como cero).
    ficha: "src/modulos/caja/dominio/arqueo.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Cantidad de billetes de una denominación al contar el efectivo en el cierre de caja (el efectivo se cuenta siempre por billetes y monedas).",
      ),
    ],
    consumidores: [CIERRE],
    ponerPor: ["sesiones_caja.cerrar"],
    requiere: REQUIERE_CAJA,
  },
  "importe-de-monedas-contadas": {
    ficha: "src/modulos/caja/dominio/arqueo.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Total de las monedas contadas, como un solo importe en pesos, al contar el efectivo en el cierre de caja; vacío es «sin monedas».",
      ),
    ],
    consumidores: [CIERRE],
    ponerPor: ["sesiones_caja.cerrar"],
    requiere: REQUIERE_CAJA,
  },
  "importe-contado-de-medio": {
    ficha: "src/modulos/caja/dominio/arqueo.ts",
    propositos: [
      MOSTRADOR_PROPOSITO(
        "Total contado de un medio que no es efectivo (con su cuenta de cobro, si la tiene) en el cierre de caja; sin total escrito, el medio queda «sin declarar» o «conforme».",
      ),
    ],
    consumidores: [CIERRE],
    ponerPor: ["sesiones_caja.cerrar"],
    requiere: REQUIERE_CAJA,
  },
  "observacion-de-cierre-de-caja": {
    // Opcional; misma lista de permitidos y mismo largo que el motivo (`observacionOpcional`, `caja/dominio/texto.ts`; la base: `sesion_caja_observacion_ck`).
    ficha: "src/modulos/cierre/dominio/explicacion.ts",
    propositos: [MOSTRADOR_PROPOSITO("Observación, opcional, al cerrar una caja.")],
    consumidores: [CIERRE],
    ponerPor: ["sesiones_caja.cerrar"],
    requiere: REQUIERE_CAJA,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
