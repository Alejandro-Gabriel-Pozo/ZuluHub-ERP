import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  ajustarElStock,
  anularElMovimiento,
  opcionesParaMover,
  registrarElMovimiento,
  transferirElStock,
  type DependenciasDeMovimientosWeb,
  type OpcionesDeMovimiento,
} from "../../../src/composicion/movimientos-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_MOVIMIENTOS } from "../ui/plantillas/stock/movimientos/modelo-de-formularios";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";
import { laSucursalDeStock } from "./stock";

/**
 * Los movimientos de stock a mano de la web: la lectura de lo que ofrecen los formularios y las cinco acciones (Entrada, Salida, Transferir, Ajustar, Anular). Finas a propósito (ADR-015, punto 2):
 * resuelven QUIÉN y DÓNDE actúan (`laSucursalDeStock`: la elegida en el dispositivo, nunca la del navegador) y llaman a `src/composicion/movimientos-web.ts`. La clave de idempotencia la genera la
 * página al abrir el formulario y viaja ligada a la acción (`bind`): repetir el envío no duplica. El permiso, la cantidad, el costo y las reglas los decide el servidor dentro de su transacción.
 */

const dependencias: DependenciasDeMovimientosWeb = {
  casosDeUso: web.casosDeUsoDeStock,
  consultas: web.consultasDeStock,
  respuesta: dependenciasDeSesion.respuesta,
};

export async function cargarLasOpcionesDeMovimiento(
  contexto: ContextoOperativo,
): Promise<Respuesta<OpcionesDeMovimiento>> {
  const sucursal = await laSucursalDeStock(contexto);
  if (!sucursal.ok) return sucursal;
  return opcionesParaMover(dependencias, contexto, sucursal.dato);
}

const campos = (datos: FormData, nombres: readonly string[]): Record<string, string> =>
  Object.fromEntries(nombres.map((n) => [n, textoDe(datos, n)]));

/** Entrada (`entrada: true`) o salida a mano; si sale bien vuelve a Movimientos. */
export async function registrarEntradaOSalidaDeStock(
  clave: string,
  entrada: boolean,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return registrarElMovimiento(dependencias, contexto, sucursal.dato, entrada, {
        clave,
        ...campos(datos, [
          "depositoId",
          "articuloId",
          "cantidad",
          "motivo",
          "costoUnitario",
          "detalle",
          "confirmar",
        ]),
      });
    }),
    RUTAS_DE_MOVIMIENTOS.lista,
  );
}

export async function transferirElStockDeLaSucursal(
  clave: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return transferirElStock(dependencias, contexto, sucursal.dato, {
        clave,
        ...campos(datos, ["origenId", "destinoId", "articuloId", "cantidad", "confirmar"]),
      });
    }),
    RUTAS_DE_MOVIMIENTOS.lista,
  );
}

export async function ajustarElStockDeLaSucursal(
  clave: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa(async (contexto) => {
      const sucursal = await laSucursalDeStock(contexto);
      if (!sucursal.ok) return sucursal;
      return ajustarElStock(dependencias, contexto, sucursal.dato, {
        clave,
        ...campos(datos, ["depositoId", "articuloId", "sentido", "cantidad", "detalle"]),
      });
    }),
    RUTAS_DE_MOVIMIENTOS.lista,
  );
}

/** El movimiento a anular lo fija la página (`bind`); el detalle es lo único que escribe la persona. */
export async function anularElMovimientoDeLaSucursal(
  clave: string,
  movimientoId: string,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      anularElMovimiento(dependencias, contexto, {
        clave,
        movimientoId,
        detalle: textoDe(datos, "detalle"),
      }),
    ),
    RUTAS_DE_MOVIMIENTOS.lista,
  );
}
