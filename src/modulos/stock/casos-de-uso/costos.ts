import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { valorAbsolutoDe } from "../../../primitivas/cantidad/con-signo";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import {
  precioUnitarioATexto,
  precioUnitarioDesdeTexto,
  type PrecioUnitario,
} from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  costoDefinitivo,
  costoVigente,
  entrar,
  ESTADO_DE_COSTO_INICIAL,
  salir,
  SIN_COSTO,
  transferir,
  type CostoDeRenglon,
  type EstadoDeCosto,
} from "../dominio/costo";
import type { ClaseDeMovimiento, RenglonDeLibro } from "../dominio/movimiento";
import type { CostoDeRenglonGuardado, EstadoDeCostoGuardado } from "../persistencia/costos";
import { llaveDeSaldo } from "../persistencia/repositorio-de-movimientos";
import type { TxDeStock } from "./contrato";

/**
 * El costo de cada movimiento del libro (E5 §3.6, tramo TCO): promedio móvil ponderado por (depósito, artículo) y costo congelado en cada
 * renglón. La cuenta es la función pura de `dominio/costo.ts`; acá se lee y se bloquea el estado, se decide qué costo lleva cada renglón según
 * la clase del movimiento, y se escribe el estado nuevo y el costo congelado EN LA MISMA transacción del movimiento.
 *
 * Concurrencia: se llama DESPUÉS de insertar los renglones, y cada renglón ya tomó el saldo de su par (el disparador, en el orden canónico).
 * Quien llega acá es el único que mueve esos pares hasta que confirme, así que el estado que lee es el vigente y nadie calcula sobre el mismo
 * punto de partida; la lectura además lo bloquea (`FOR UPDATE`) como red de seguridad. Previene: dos entradas simultáneas que promedian
 * sobre el costo viejo y pierden una.
 */

/** Los costos que la persona declaró en una entrada, por `llaveDeSaldo(depósito, artículo)`. Sin entrada en el mapa, el renglón es `SIN_COSTO`. */
export type CostosDeclarados = ReadonlyMap<string, PrecioUnitario>;

/**
 * El costo que declara una entrada en un renglón: texto decimal de hasta 6 decimales, estrictamente mayor que cero. Cero NO se acepta: «sin
 * costo» se dice no mandándolo, porque un cero declarado a modo de «no sé» diluiría el promedio en silencio (SUPUESTO (DEC-0004) S-T10-2: aflojarlo después
 * es cambiar esta línea; apretarlo con datos cargados no). Cualquier otra cosa, o un valor fuera de `numeric(18,6)`, es `COSTO_INVALIDO`.
 */
export function leerCostoDeclarado(valor: unknown): Resultado<PrecioUnitario, "COSTO_INVALIDO"> {
  if (typeof valor !== "string") return err("COSTO_INVALIDO");
  try {
    const costo = precioUnitarioDesdeTexto(valor);
    return costo.unidades > 0n ? ok(costo) : err("COSTO_INVALIDO");
  } catch (error) {
    if (error instanceof ErrorDeValor) return err("COSTO_INVALIDO");
    throw error;
  }
}

/** Los costos que declararon los renglones resueltos de una entrada a un depósito, por (depósito, artículo); los que no declararon no figuran. */
export function costosDeclaradosDe(
  depositoId: string,
  resueltos: readonly Readonly<{ articuloId: string; costoUnitario: PrecioUnitario | null }>[],
): CostosDeclarados {
  return new Map(
    resueltos.flatMap((r) =>
      r.costoUnitario === null
        ? []
        : [[llaveDeSaldo(depositoId, r.articuloId), r.costoUnitario] as const],
    ),
  );
}

export const estadoDesdeGuardado = (guardado: EstadoDeCostoGuardado): EstadoDeCosto => ({
  promedio: precioUnitarioDesdeTexto(guardado.costoUnitario),
  cantidadValorizada: cantidadDesdeTexto(guardado.cantidadValorizada),
});

const costoDesdeGuardado = (guardado: CostoDeRenglonGuardado | undefined): CostoDeRenglon =>
  guardado === undefined || guardado.estado === "SIN_COSTO" || guardado.costoUnitario === null
    ? SIN_COSTO
    : costoDefinitivo(precioUnitarioDesdeTexto(guardado.costoUnitario));

const llaveDelRenglon = (r: Pick<RenglonDeLibro, "depositoId" | "articuloId" | "composicionId">) =>
  JSON.stringify([r.depositoId, r.articuloId, r.composicionId]);

export type MovimientoParaCostear = Readonly<{
  movimientoId: string;
  clase: ClaseDeMovimiento;
  /** El movimiento que esta anulación espeja; `null` si no es una anulación. */
  anulaA: string | null;
  /** Los renglones en el orden en que se escribieron: el índice más uno es su número. */
  renglones: readonly RenglonDeLibro[];
  declarados: CostosDeclarados;
}>;

/**
 * Costea el movimiento ya escrito: calcula el costo de cada renglón y el estado nuevo de cada par, y los guarda.
 *  - Entrada: el costo declarado (o `SIN_COSTO`), que entra al promedio.
 *  - Salida: el promedio vigente, congelado (o `SIN_COSTO` si nunca entró nada con costo).
 *  - Transferencia: el promedio del depósito de origen; el destino lo incorpora al suyo.
 *  - Ajuste (también por conteo): lo que suma entra al promedio vigente y lo que resta sale como una salida.
 *  - Anulación: el MISMO costo congelado de cada renglón del original, no el vigente.
 * Los renglones de un movimiento anterior al tramo de costos no tienen costo cargado: su espejo es `SIN_COSTO` (nunca cero).
 */
export async function costearMovimiento(
  tx: Pick<TxDeStock, "costosDeStock" | "movimientosDeStock">,
  empresa: EmpresaId,
  movimiento: MovimientoParaCostear,
): Promise<void> {
  const { renglones } = movimiento;
  const pares = new Map(
    renglones.map((r) => [
      llaveDeSaldo(r.depositoId, r.articuloId),
      { depositoId: r.depositoId, articuloId: r.articuloId },
    ]),
  );
  const guardados = await tx.costosDeStock.bloquearEstados(empresa, [...pares.values()]);
  const estados = new Map<string, EstadoDeCosto>();
  const llave = (r: RenglonDeLibro): string => llaveDeSaldo(r.depositoId, r.articuloId);
  const estadoDe = (clave: string): EstadoDeCosto => {
    const puesto = estados.get(clave);
    if (puesto !== undefined) return puesto;
    const guardado = guardados.get(clave);
    return guardado === undefined ? ESTADO_DE_COSTO_INICIAL : estadoDesdeGuardado(guardado);
  };
  /** Los pares cuyo estado cambió: solo esos se escriben. */
  const cambiados = new Set<string>();
  const poner = (clave: string, nuevo: EstadoDeCosto): void => {
    if (nuevo === estadoDe(clave)) return;
    estados.set(clave, nuevo);
    cambiados.add(clave);
  };
  const costos = new Map<number, CostoDeRenglon>();
  const numeroDe = (indice: number): number => indice + 1;

  const costosDelOriginal =
    movimiento.clase === "ANULACION" && movimiento.anulaA !== null
      ? await costosDelMovimiento(tx, empresa, movimiento.anulaA)
      : new Map<string, CostoDeRenglon>();

  const destinoDe = (origen: RenglonDeLibro): number =>
    renglones.findIndex((r) => r.articuloId === origen.articuloId && r.cantidad.unidades > 0n);

  renglones.forEach((r, indice) => {
    const clave = llave(r);
    const cantidad = valorAbsolutoDe(r.cantidad);
    const suma = r.cantidad.unidades > 0n;
    switch (movimiento.clase) {
      case "ENTRADA": {
        const declarado = movimiento.declarados.get(clave);
        const costo = declarado === undefined ? SIN_COSTO : costoDefinitivo(declarado);
        poner(clave, entrar(estadoDe(clave), cantidad, costo));
        costos.set(numeroDe(indice), costo);
        break;
      }
      case "SALIDA": {
        const salida = salir(estadoDe(clave), cantidad);
        poner(clave, salida.estado);
        costos.set(numeroDe(indice), salida.costo);
        break;
      }
      case "TRANSFERENCIA": {
        // La pata de destino se costea junto con la de origen (el destino toma el costo de origen): acá solo se arma desde el origen.
        if (suma) break;
        const indiceDelDestino = destinoDe(r);
        const destino = renglones[indiceDelDestino];
        if (destino === undefined) {
          throw new RangeError("costo: la transferencia no tiene la pata de destino del artículo");
        }
        const claveDeDestino = llave(destino);
        const movida = transferir(estadoDe(clave), estadoDe(claveDeDestino), cantidad);
        poner(clave, movida.origen);
        poner(claveDeDestino, movida.destino);
        costos.set(numeroDe(indice), movida.costo);
        costos.set(numeroDe(indiceDelDestino), movida.costo);
        break;
      }
      case "AJUSTE":
      case "AJUSTE_POR_CONTEO": {
        if (suma) {
          const vigente = costoVigente(estadoDe(clave));
          poner(clave, entrar(estadoDe(clave), cantidad, vigente));
          costos.set(numeroDe(indice), vigente);
        } else {
          const salida = salir(estadoDe(clave), cantidad);
          poner(clave, salida.estado);
          costos.set(numeroDe(indice), salida.costo);
        }
        break;
      }
      case "ANULACION": {
        const original = costosDelOriginal.get(llaveDelRenglon(r)) ?? SIN_COSTO;
        if (suma) {
          poner(clave, entrar(estadoDe(clave), cantidad, original));
          costos.set(numeroDe(indice), original);
        } else {
          const salida = salir(estadoDe(clave), cantidad, original);
          poner(clave, salida.estado);
          costos.set(numeroDe(indice), salida.costo);
        }
        break;
      }
    }
  });

  for (const clave of [...cambiados].sort()) {
    const par = pares.get(clave);
    const estado = estadoDe(clave);
    // Un estado cambiado siempre tiene promedio (solo una entrada con costo lo crea) y su par sale de los renglones.
    if (par === undefined || estado.promedio === null) {
      throw new RangeError("costo: un estado cambiado sin par o sin promedio");
    }
    const nuevo = {
      costoUnitario: precioUnitarioATexto(estado.promedio),
      cantidadValorizada: cantidadATexto(estado.cantidadValorizada),
    };
    // El par que ya tenía fila (la leyó y bloqueó `bloquearEstados`) se actualiza; el que nunca tuvo costo se crea.
    if (guardados.has(clave)) await tx.costosDeStock.cambiarEstado(empresa, par, nuevo);
    else await tx.costosDeStock.crearEstado(empresa, par, nuevo);
  }
  await tx.costosDeStock.guardarCostosDeRenglones(
    empresa,
    movimiento.movimientoId,
    renglones.map((_, indice) => {
      const costo = costos.get(numeroDe(indice)) ?? SIN_COSTO;
      return {
        numero: numeroDe(indice),
        estado: costo.estado,
        costoUnitario:
          costo.estado === "DEFINITIVO" ? precioUnitarioATexto(costo.costoUnitario) : null,
      };
    }),
  );
}

/** El costo congelado de cada renglón de un movimiento, indexado por (depósito, artículo, composición): lo que espeja una anulación. */
async function costosDelMovimiento(
  tx: Pick<TxDeStock, "costosDeStock" | "movimientosDeStock">,
  empresa: EmpresaId,
  movimientoId: string,
): Promise<Map<string, CostoDeRenglon>> {
  const renglones = await tx.movimientosDeStock.renglonesDe(empresa, movimientoId);
  const costos = await tx.costosDeStock.costosDeRenglones(empresa, movimientoId);
  return new Map(
    renglones.map((r) => [llaveDelRenglon(r), costoDesdeGuardado(costos.get(r.numero))]),
  );
}
