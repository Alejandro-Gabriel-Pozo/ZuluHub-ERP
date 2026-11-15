import { randomUUID } from "node:crypto";
import { crearCasosDeUsoDeCaja } from "../../../src/modulos/caja/publico";
import { crearCasosDeUsoDeVentas } from "../../../src/modulos/ventas/publico";
import { empresaId, personaId, sucursalId } from "../../../src/primitivas/identificadores/marca";
import { productoDeBase, precioDeBase } from "../../integracion/catalogo-apoyo";
import { comoEmpresa, crearEntornoDePrueba } from "../../integracion/entorno";
import { ahoraDeLaCorrida } from "../../integracion/reloj-de-la-corrida";
import { crearPlanPublicado, asignarPlan } from "../../integracion/marcas-apoyo";
import { valorDe, REGLAS_DE_PRUEBA } from "../../integracion/ventas-apoyo";
import type { MundoDelRecorrido } from "./mundo";

/**
 * Siembra, en el mundo del recorrido, un ticket COBRADO por el camino real (los casos de uso de caja y de ventas, con la base y el rol reales):
 * lo que en producción hará la pantalla de venta rápida, que todavía no existe (hoy no hay forma de cobrar desde la web). Lo sembrado es lo
 * mínimo de la venta: un producto de precio fijo, una caja abierta con sus medios de pago y la venta cobrada en efectivo.
 *
 * `ventas`, `caja` y `catalogo` están `en_desarrollo` en el catálogo REAL: la app construida los rechaza con `MODULO_EN_DESARROLLO` aunque
 * la empresa los tenga activos. Acá solo se arma la siembra, con las reglas de las pruebas de integración (`REGLAS_DE_PRUEBA`, que los abre
 * en ESTE proceso); la app sigue con las reales, y por eso el recorrido que usa esto lo dice a la vista mientras no se abran (ver
 * `facturacion-ticket.recorrido.ts`).
 */

/** Los módulos que la empresa necesita activos y habilitados por plan para vender y cobrar (la caja abre su jornada con `cierre`), además de facturar. */
const MODULOS_DE_LA_VENTA = ["facturacion", "catalogo", "caja", "cierre", "ventas"] as const;

export type TicketSembrado = Readonly<{
  ticketId: string;
  /** El número visible del ticket (el que figura en Pendientes como «N.º …»). */
  numero: string;
  /** El total cobrado, como texto decimal exacto («1210.00»). */
  total: string;
  sucursal: string;
}>;

export async function sembrarTicketCobrado(
  mundo: MundoDelRecorrido,
  opciones: Readonly<{ precio: string }>,
): Promise<TicketSembrado> {
  const dueno = mundo.mundo.dueno;
  const empresa = mundo.empresa;
  const consulta = async <T extends object>(texto: string, parametros: unknown[]): Promise<T> =>
    (await dueno.query<T>(texto, parametros)).rows[0] as T;

  // Los módulos de la venta: habilitados por el plan (una versión nueva, asignada al tenant) y activos en la empresa.
  const { tenant_id: tenant } = await consulta<{ tenant_id: string }>(
    "select tenant_id from empresa where id = $1",
    [empresa],
  );
  const { version } = await crearPlanPublicado(dueno, { modulos: [...MODULOS_DE_LA_VENTA] });
  await asignarPlan(dueno, tenant, version);
  for (const modulo of MODULOS_DE_LA_VENTA) {
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2) on conflict do nothing",
      [empresa, modulo],
    );
  }

  const { id: sucursal } = await consulta<{ id: string }>(
    "select id from sucursal where empresa_id = $1 limit 1",
    [empresa],
  );
  const { persona_id: persona } = await consulta<{ persona_id: string }>(
    "select persona_id from membresia where empresa_id = $1 limit 1",
    [empresa],
  );

  const entorno = crearEntornoDePrueba(mundo.mundo.propia.base, 4);
  try {
    // Entra por la marca de la empresa (la misma por la que entró la persona en el navegador); sin ella el actor no tiene rol.
    // Un instante de ESTA corrida que no cruza la medianoche de Argentina (la jornada de la caja y la fecha del ticket salen de acá).
    const contexto = {
      ...comoEmpresa(empresaId(empresa), personaId(persona), mundo.mundo.marcaA),
      ahora: ahoraDeLaCorrida(),
    };
    const caja = crearCasosDeUsoDeCaja({ transacciones: entorno, reglas: REGLAS_DE_PRUEBA });
    const ventas = crearCasosDeUsoDeVentas({ transacciones: entorno, reglas: REGLAS_DE_PRUEBA });

    const producto = await productoDeBase(dueno, empresa, { nombre: "Medialunas x12" });
    await precioDeBase(dueno, {
      empresa,
      producto,
      precio: opciones.precio,
      desde: "2026-01-01T00:00:00Z",
    });
    const { id: cajaId } = await consulta<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja del recorrido') returning id",
      [empresa, sucursal],
    );
    await dueno.query(
      "insert into medio_de_pago (empresa_id, tipo) values ($1, 'EFECTIVO') on conflict do nothing",
      [empresa],
    );
    const { id: efectivo } = await consulta<{ id: string }>(
      "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO' and nombre is null",
      [empresa],
    );
    valorDe(
      await caja.abrirSesion(contexto, {
        claveDeIdempotencia: `clave-${randomUUID()}`,
        sucursalId: sucursalId(sucursal),
        cajaId,
        fondoInicial: { moneda: "ARS", monto: "0.00" },
      }),
    );
    const cobrado = valorDe(
      await ventas.venderYCobrar(contexto, {
        claveIdempotencia: `clave-${randomUUID()}`,
        cuentaId: randomUUID(),
        ejemplarId: randomUUID(),
        sucursalId: sucursal,
        lineas: [{ lineaId: randomUUID(), productoId: producto, opcionIds: [], cantidad: "1" }],
        totalEsperado: { moneda: "ARS", monto: opciones.precio },
        cobro: {
          cajaId,
          cobros: [
            {
              medioDePagoId: efectivo,
              cuentaDeCobroId: null,
              importe: { moneda: "ARS", monto: opciones.precio },
            },
          ],
        },
      }),
    );
    const { numero } = await consulta<{ numero: string }>(
      "select numero::text as numero from ticket where id = $1",
      [cobrado.ticketId],
    );
    return { ticketId: cobrado.ticketId, numero, total: opciones.precio, sucursal };
  } finally {
    await entorno.cerrar();
  }
}
