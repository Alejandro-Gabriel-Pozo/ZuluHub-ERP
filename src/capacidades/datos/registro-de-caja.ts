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
const MEDIOS_DATOS_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeDatosDelMedio.cliente.tsx";
const MODAL_DE_CORREGIR_MEDIO = "apps/web/ui/plantillas/cierre/ModalDeCorregirMedio.cliente.tsx";
/** Los propósitos que el cierre del día suma a los datos del cobro que ya son de caja: un dato, una definición (los consumidores y propósitos de las dos pantallas viven juntos). */
const CORRECCION_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/conceptos/pantalla-cierre-del-dia.md §3 y la maqueta aceptada `cierre-del-dia.html` (decisiones del dueño, DDD:175 y DDD:183)",
});
const APERTURA = "apps/web/ui/plantillas/caja/FormularioDeApertura.cliente.tsx";
const CIERRE = "apps/web/ui/plantillas/caja/FormularioDeCierre.cliente.tsx";
/**
 * La pantalla «Caja» del mostrador: sus formularios de apertura y cierre los pide `caja.html` (maqueta aprobada, `vAbrir` y `vCierre`, carpeta de prototipos de Pedernal-docs 10-ux-ui) y lo fija
 * `e3-caja-y-cobros-especificacion.md` §3.2 (abrir, contar y cerrar) y §3.9; los textos y la pantalla los aceptó el dueño el 15/11/2026 (`decisiones-del-dueno-2026-11.md`, filas del 15/11/2026: textos aceptados
 * y «Aceptado por el orquestador, por delegación (filas 173 y 174): maqueta del cierre…», decisión 175).
 */
const MOSTRADOR_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/e3-caja-y-cobros-especificacion.md §3.2 y §3.9, la maqueta aprobada `caja.html` (carpeta de prototipos de Pedernal-docs 10-ux-ui) y 11-especificaciones/decisiones-del-dueno-2026-11.md (filas del 15/11/2026: textos aceptados por el dueño y delegación de las filas 173 y 174)",
});
const MEDIOS_PROPOSITO_TIPO: Proposito = {
  para: "Tipo de un medio de pago, de una lista cerrada, al agregarlo (pantalla «Medios de pago»); no se cambia después.",
  fuente:
    "Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (medio de pago: lista cerrada de tipos) y la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
};

// La hoja de cobro del mostrador (módulo ventas) CONSUME estos dos datos, que son de caja (dueño, 17/11/2026, fila 247 de
// `decisiones-del-dueno-2026-11.md`, punto 1: «medio de cobro» y «cuenta de cobro» van bajo el módulo caja; ventas los consume).
const COBRAR_A_CUENTA =
  "apps/web/ui/plantillas/cuenta-corriente/PantallaDeCobrarACuenta.cliente.tsx";
const COBRO_FILA = "apps/web/ui/plantillas/cobrar/FilaDeCobro.cliente.tsx";
const COBRO_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/conceptos/pantalla-cobrar.md §2 y servidor-del-mostrador-minimo.md §7; la maqueta de venta rápida `venta-rapida-v4.html` (zona cobro, carpeta de prototipos de Pedernal-docs 10-ux-ui); fila 247 (punto 1) de 11-especificaciones/decisiones-del-dueno-2026-11.md",
});

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
  // Un solo dato con cinco campos (uno por dato del cobro): el conjunto vive una vez, en `DATOS_DEL_COBRO` (estados.ts). Hoy solo «aparece / no aparece»; el selector «Opcional / Obligatorio»
  // (T4b) amplía este mismo dato cuando exista «obligatorio» en el servidor.
  "estado-de-dato-del-cobro-del-medio": {
    ficha: "src/modulos/caja/estados.ts",
    propositos: [
      {
        para: "Si cada dato que el tipo del medio admite (cupón, últimos 4 dígitos, marca, cuotas, DNI) aparece al cobrar con ese medio (pantalla «Datos que se piden al cobrar»).",
        fuente:
          "Pedernal-docs/11-especificaciones/parametrizacion-de-medios-de-pago.md §3.4 (T4a) y la maqueta aprobada el 09/11/2026 (`datos-cobro.html`, ajustada el 15/11, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
      },
    ],
    consumidores: [MEDIOS_DATOS_FORMULARIO],
    ponerPor: ["medios_de_pago.editar"],
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
  "medio-de-cobro": {
    // Sin primitiva: es la elección de uno de los medios activos que el servidor ofrece para la caja (lista cerrada, como `eleccion-de-opcion-de-venta`).
    ficha: "src/modulos/caja/cobrar/opciones-de-cobro.ts",
    propositos: [
      COBRO_PROPOSITO(
        "Medio de pago de cada fila de la hoja de cobro, de entre los medios activos que el servidor ofrece para la caja.",
      ),
      CORRECCION_PROPOSITO(
        "Medio al que pasa un cobro (elección cerrada entre los medios activos de la empresa que ofrece el servidor) en el diálogo «Corregir medio» del cierre del día.",
      ),
    ],
    consumidores: [COBRO_FILA, COBRAR_A_CUENTA, MODAL_DE_CORREGIR_MEDIO],
    ponerPor: ["tickets.cobrar", "cobros.corregir_medio"],
    requiere: REQUIERE_CAJA,
  },
  "cuenta-de-cobro": {
    ficha: "src/modulos/caja/cobrar/opciones-de-cobro.ts",
    propositos: [
      COBRO_PROPOSITO(
        "Cuenta de cobro, opcional, de la fila de cobro, de entre las cuentas activas de la sucursal que el servidor ofrece para ese medio.",
      ),
      CORRECCION_PROPOSITO(
        "Cuenta de cobro de la corrección (elección cerrada entre las cuentas activas de la sucursal que admite el medio, o «Sin cuenta») en el diálogo «Corregir medio» del cierre del día.",
      ),
    ],
    consumidores: [COBRO_FILA, COBRAR_A_CUENTA, MODAL_DE_CORREGIR_MEDIO],
    ponerPor: ["tickets.cobrar", "cobros.corregir_medio"],
    requiere: REQUIERE_CAJA,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
