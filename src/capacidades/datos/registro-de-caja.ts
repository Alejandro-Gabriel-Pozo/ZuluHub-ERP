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
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
