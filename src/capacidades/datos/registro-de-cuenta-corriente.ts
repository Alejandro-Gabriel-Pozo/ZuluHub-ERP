import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de las pantallas de la cuenta corriente de clientes (CC-5, A2: habilitar, cambiar plazo o límite, suspender y reactivar) del registro de datos (ver `registro.ts`), en su propio archivo.
 * La regla de cada dato vive una vez, en su ficha (el dominio de `cuenta_corriente` o una primitiva); la pantalla solo la espeja con lo que deja escribir y el servidor la vuelve a decidir.
 */

const HABILITAR = "apps/web/ui/plantillas/cuenta-corriente/FormularioDeHabilitarCuenta.cliente.tsx";
const CONDICIONES =
  "apps/web/ui/plantillas/cuenta-corriente/FormularioDeCondicionesDeCuenta.cliente.tsx";
const SUSPENDER = "apps/web/ui/plantillas/cuenta-corriente/FormularioDeSuspenderCuenta.cliente.tsx";
const REACTIVAR = "apps/web/ui/plantillas/cuenta-corriente/FormularioDeReactivarCuenta.cliente.tsx";
const COBRAR_A_CUENTA =
  "apps/web/ui/plantillas/cuenta-corriente/PantallaDeCobrarACuenta.cliente.tsx";
const VENDER = "apps/web/ui/plantillas/cobrar/HojaDeVenderACuenta.cliente.tsx";
const REQUIERE_CUENTA_CORRIENTE = {
  modulo: "cuenta_corriente",
  estadoDeEmpresa: ["ACTIVE"],
} as const;
const PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/briefs/cuenta-corriente/PR-CC-1-ficha-del-cliente-y-clases-a-cobrar.md §2 y §3 (habilitar, condiciones, suspender y reactivar) y la maqueta cuenta-corriente-ficha-listado-y-cobro.html (v2, aprobada por el dueño el 26/11/2026); arquitectura/decisiones/registro/DEC-CCL-006.json",
});

const PROPOSITO_DE_COBRAR = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/briefs/cuenta-corriente/PR-CC-1-ficha-del-cliente-y-clases-a-cobrar.md y la maqueta cuenta-corriente-ficha-listado-y-cobro.html (hoja «Cobrar un ticket a cuenta», aprobada por el dueño el 26/11/2026)",
});

export const DATOS_DE_CUENTA_CORRIENTE = {
  "cliente-a-habilitar-de-cuenta-corriente": {
    ficha: "src/modulos/cuenta_corriente/casos-de-uso/habilitar.ts",
    propositos: [
      PROPOSITO(
        "Cliente activo sin cuenta corriente al que se le habilita crédito (pantalla «Habilitar cuenta corriente»); el servidor revalida que sea cliente activo, con CUIT y razón social, y sin ficha.",
      ),
    ],
    consumidores: [HABILITAR],
    ponerPor: ["cuenta_corriente.administrar"],
    requiere: REQUIERE_CUENTA_CORRIENTE,
  },
  "plazo-de-cuenta-corriente": {
    ficha: "src/modulos/cuenta_corriente/dominio/condiciones.ts",
    propositos: [
      PROPOSITO(
        "Plazo de pago en días de la cuenta corriente de un cliente, entero de 1 a 365; al habilitar y al cambiar las condiciones.",
      ),
    ],
    consumidores: [HABILITAR, CONDICIONES],
    ponerPor: ["cuenta_corriente.administrar"],
    requiere: REQUIERE_CUENTA_CORRIENTE,
  },
  "limite-de-cuenta-corriente": {
    ficha: "src/primitivas/dinero/forma-del-importe.ts",
    propositos: [
      PROPOSITO(
        "Límite de crédito en pesos de la cuenta corriente de un cliente, cero o más; al habilitar y al cambiar las condiciones. Solo se guarda: lo hace cumplir el cargo de una venta a cuenta.",
      ),
    ],
    consumidores: [HABILITAR, CONDICIONES],
    ponerPor: ["cuenta_corriente.administrar"],
    requiere: REQUIERE_CUENTA_CORRIENTE,
  },
  "motivo-de-suspension-de-cuenta-corriente": {
    ficha: "src/primitivas/texto/motivo-de-suspension-de-cuenta.ts",
    propositos: [
      PROPOSITO(
        "Motivo, obligatorio, por el que se suspende la cuenta corriente de un cliente; se guarda en la ficha y se ve en el aviso de la ficha suspendida.",
      ),
    ],
    consumidores: [SUSPENDER],
    ponerPor: ["cuenta_corriente.administrar"],
    requiere: REQUIERE_CUENTA_CORRIENTE,
  },
  "motivo-de-reactivacion-de-cuenta-corriente": {
    ficha: "src/primitivas/texto/motivo-de-suspension-de-cuenta.ts",
    propositos: [
      PROPOSITO(
        "Motivo, obligatorio, por el que se reactiva la cuenta corriente de un cliente suspendido; queda en la constancia de auditoría (misma regla de texto que el motivo de suspender).",
      ),
    ],
    consumidores: [REACTIVAR],
    ponerPor: ["cuenta_corriente.administrar"],
    requiere: REQUIERE_CUENTA_CORRIENTE,
  },
  "caja-de-cobro-a-cuenta": {
    // Sin primitiva: es la elección de una de las cajas con sesión abierta hoy de la sucursal del ticket (lista cerrada que arma el servidor); el servidor revalida caja, sesión y jornada.
    ficha: "src/modulos/caja/cobrar/opciones-de-cobro.ts",
    propositos: [
      PROPOSITO_DE_COBRAR(
        "Caja abierta de la sucursal del ticket donde entra el cobro de un ticket a cuenta (pantalla «Cobrar un ticket a cuenta»), de entre las que tienen la sesión abierta hoy.",
      ),
    ],
    consumidores: [COBRAR_A_CUENTA],
    ponerPor: ["tickets.cobrar"],
    requiere: { modulo: "caja", estadoDeEmpresa: ["ACTIVE"] },
  },
  "cliente-a-cuenta-de-la-venta": {
    ficha: "src/modulos/cuenta_corriente/casos-de-uso/ver-cliente-para-vender.ts",
    propositos: [
      {
        para: "Cliente con cuenta corriente al que se le carga la venta al cobrar (hoja «Vender a cuenta corriente»); el servidor revalida que sea de la empresa, tenga la cuenta habilitada y que la venta no pase el límite.",
        fuente:
          "Pedernal-docs/11-especificaciones/briefs/cuenta-corriente/PR-CC-2-cargo-a-cuenta-al-cerrar-el-ticket.md (elegir el cliente al cobrar) y la maqueta cuenta-corriente-elegir-cliente.html (aprobada por el dueño el 26/11/2026); arquitectura/decisiones/registro/DEC-CCL-008.json",
      },
    ],
    consumidores: [VENDER],
    ponerPor: ["cuenta_corriente.cargar_a_cuenta"],
    requiere: REQUIERE_CUENTA_CORRIENTE,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
