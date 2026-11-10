import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { importeDesdeTexto, type Importe } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import {
  cajaParaVentas,
  type EntradaDeRegistrarCobro,
  type ErrorAlCobrar,
  type SalidaDeRegistrarCobro,
} from "../../src/modulos/caja/publico";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import type { armarCaja, TxDeCajaDePrueba, crearEntornoDeCaja } from "./caja-configuracion-apoyo";
import { crearMundoDeOperacion, type MundoDeOperacion } from "./caja-operacion-apoyo";
import type { OpcionesDeMundoDeCaja } from "./caja-configuracion-apoyo";
import type { TxDePrueba } from "./entorno";

/**
 * Apoyo de las pruebas del puerto de cobrar (E3, tramo 6). Una «caja falsa de ventas» arma la transacción del llamador como lo haría
 * ventas: lee la autorización (el guard de `tickets.cobrar`, que el puerto NO hace), escribe lo suyo (una constancia de venta falsa) y llama
 * al puerto en la MISMA transacción; si el puerto falla, la venta entera vuelve atrás. Todo con los roles limitados de la aplicación.
 */

export const importe = (monto: string): Importe => importeDesdeTexto(ARS, monto);

/** Un origen nuevo: el id de la cobranza que ventas habría creado. */
export const origenNuevo = (tipo = "ventas.cobranza_de_ticket") => ({ tipo, id: randomUUID() });

export type MundoDeCobro = MundoDeOperacion &
  Readonly<{
    /** Un medio por tipo (el efectivo lo crea la apertura de la primera sesión; acá se asegura). */
    medios: Readonly<
      Record<
        "EFECTIVO" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "TRANSFERENCIA" | "QR" | "OTRO",
        string
      >
    >;
    cuentas: Readonly<{ terminal: string; qr: string; banco: string }>;
  }>;

/** Una empresa con su «Caja 1», un medio de cada tipo y una cuenta de cada tipo en la sucursal. El escenario lo arma el DUEÑO de la base. */
export async function crearMundoDeCobro(
  entornoBase: TransaccionesDePostgres<TxDePrueba>,
  dueno: pg.Client,
  caja: ReturnType<typeof armarCaja>,
  opciones: OpcionesDeMundoDeCaja = {},
): Promise<MundoDeCobro> {
  const m = await crearMundoDeOperacion(entornoBase, dueno, caja, opciones);
  const medios: Record<string, string> = {};
  for (const tipo of [
    "EFECTIVO",
    "TARJETA_DEBITO",
    "TARJETA_CREDITO",
    "TRANSFERENCIA",
    "QR",
    "OTRO",
  ]) {
    await dueno.query(
      "insert into medio_de_pago (empresa_id, tipo) values ($1, $2) on conflict do nothing",
      [m.empresa, tipo],
    );
    const { rows } = await dueno.query<{ id: string }>(
      "select id from medio_de_pago where empresa_id = $1 and tipo = $2 and nombre is null",
      [m.empresa, tipo],
    );
    medios[tipo] = rows[0]?.id as string;
  }
  const cuenta = async (tipo: string, nombre: string): Promise<string> =>
    (
      await dueno.query<{ id: string }>(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, $2, $3, $4) returning id",
        [m.empresa, tipo, nombre, m.sucursal],
      )
    ).rows[0]?.id as string;
  return {
    ...m,
    medios: medios as MundoDeCobro["medios"],
    cuentas: {
      terminal: await cuenta("TERMINAL", "Terminal 1"),
      qr: await cuenta("QR", "QR 1"),
      banco: await cuenta("CUENTA_BANCARIA", "Banco 1"),
    },
  };
}

/** El pedido de cobro de una venta: $100,00 en efectivo, sin cuenta ni datos, con un origen nuevo y orden 1. */
export function entradaDeCobro(
  m: MundoDeCobro,
  cambios: Partial<EntradaDeRegistrarCobro> = {},
): EntradaDeRegistrarCobro {
  return {
    origen: origenNuevo(),
    origenOrden: 1,
    cajaId: m.cajaId,
    sucursalId: m.sucursal,
    medioDePagoId: m.medios.EFECTIVO,
    cuentaDeCobroId: null,
    importe: importe("100.00"),
    datos: {},
    ...cambios,
  };
}

export type EntornoDeCobro = ReturnType<typeof crearEntornoDeCaja>;

/** Lo que la venta falsa hace además de cobrar, para comprobar que se deshace junto con el cobro. */
export type OpcionesDeVentaFalsa = Readonly<{
  /** Corre entre la lectura previa y el cobro (por ejemplo, otro usuario cierra la caja). Recibe el número de intento de la transacción. */
  entreLaLecturaYElCobro?: (intento: number) => Promise<void>;
  /** Corre después del cobro, dentro de la transacción: puede lanzar. */
  despuesDelCobro?: (tx: TxDeCajaDePrueba) => Promise<void>;
}>;

/**
 * Los reintentos con que la venta falsa corre su transacción. Con el valor por defecto del adaptador (6), ocho cobros a la vez sobre la misma caja
 * agotan los reintentos en cerca de 1 de cada 20: los disparadores de la base leen `movimiento_caja` y `cobro` enteras (con tablas chicas el plan
 * no usa el índice) y, bajo `SERIALIZABLE`, cada tabla leída es una dependencia con el alta de cualquier otro cobro. Con 40 no se agotan nunca.
 */
const REINTENTOS_DE_VENTAS = 40;

export const ACCION_DE_VENTA_FALSA = "VENTA_FALSA_EMITIDA";

/**
 * Una venta que cobra. Lee la autorización como el guard de `tickets.cobrar`, deja su propia constancia, lee el estado de la caja (la
 * lectura previa de la pantalla) y cobra con el puerto en la misma transacción. Si el puerto devuelve error, la venta devuelve ese error y la
 * transacción entera se deshace (también su constancia).
 */
export async function cobrarComoVentas(
  entorno: EntornoDeCobro,
  contexto: ContextoOperativo,
  entrada: EntradaDeRegistrarCobro,
  opciones: OpcionesDeVentaFalsa = {},
): Promise<Resultado<SalidaDeRegistrarCobro, ErrorAlCobrar | ErrorDePersistencia>> {
  let intento = 0;
  return entorno.ejecutar({ contexto, reintentos: REINTENTOS_DE_VENTAS }, async (tx) => {
    intento += 1;
    await tx.autorizacion.delActor(contexto);
    await tx.auditoria.registrar({
      empresaId: contexto.empresaId,
      actorPersonaId: contexto.personaId,
      accion: ACCION_DE_VENTA_FALSA,
      entidad: "movimiento_caja",
      entidadId: entrada.origen.id,
      despues: { total: "100.00" },
    });
    await cajaParaVentas.estadoDeCajasParaCobrar(tx, contexto, entrada.sucursalId);
    await opciones.entreLaLecturaYElCobro?.(intento);
    const cobro = await cajaParaVentas.registrarCobroEnTx(tx, contexto, entrada);
    if (!cobro.ok) return cobro;
    await opciones.despuesDelCobro?.(tx);
    return ok(cobro.valor);
  });
}
