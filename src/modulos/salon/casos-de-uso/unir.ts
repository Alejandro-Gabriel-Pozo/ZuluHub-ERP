import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { copiarEstadoDeComandaEnTx } from "../../comandas/publico";
import {
  anularLineaEnTx,
  bloquearCuentas,
  calcularLasLineas,
  copiarLineaEnTx,
  idDerivado,
  lineasDeCuenta,
  type Cuenta,
} from "../../ventas/publico";
import { decidirUnion, huellaDeUnion, type CuentaParaUnir } from "../dominio/union";
import { armarComando, exigirAlcance, exigirClave, exigirUuid } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import { claseDeCuenta, MOTIVO_TRASLADADA } from "./cuenta-de-mesa";
import type { ErrorDeSalon } from "./errores";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import { DECLARACIONES } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeSalon>;

export type EntradaDeUnirMesas = Readonly<{
  /** Lo manda la pantalla: es el id de la unión (idempotencia). */
  unionId: string;
  cuentaDestinoId: string;
  cuentaOrigenId: string;
  /** `^[A-Za-z0-9_-]{16,128}$`, por intento (idempotencia). */
  clave: string;
}>;

export type SalidaDeUnirMesas = Readonly<{
  unionId: string;
  lineasMovidas: number;
  /** El total de la cuenta destino después de la unión («Cuánto queda»). */
  totalDestino: ImporteJson;
  yaExistia: boolean;
}>;

/** Lo que la decisión pura necesita saber de una cuenta: sin ítems vigentes la mesa está libre; una cuenta ya cerrada tiene un cobro. */
async function paraUnir(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  cuenta: Cuenta,
): Promise<CuentaParaUnir | null> {
  const clase = await claseDeCuenta(tx, contexto, cuenta);
  const lineas = await lineasDeCuenta(tx, contexto.empresaId, cuenta.id);
  const conItems = lineas.some((l) => l.estado === "VIGENTE");
  if (cuenta.estado === "ANULADA" || (clase.clase !== "RESERVA_DE_UNION" && !conItems)) return null;
  return {
    cuentaId: cuenta.id,
    sucursalId: cuenta.sucursalId,
    conCobro: cuenta.estado === "CERRADA",
    dividida: clase.clase === "RESERVA_DE_DIVISION" || clase.clase === "HIJA",
    unida: clase.clase === "RESERVA_DE_UNION",
  };
}

/**
 * `unirMesas` (E7 §3.8, D116): pasa los ítems de la cuenta de ORIGEN a la de DESTINO (misma sucursal), en una transacción serializable. Guard de todas las
 * acciones que usa por dentro (`salon.unir`, `cuentas.anular_linea`, `cuentas.agregar_linea`). Bloquea las dos cuentas en ORDEN DE ID, así que «unir A con
 * B» y «B con A» a la vez no se traban: una gana y la otra encuentra la cuenta de origen ya unida. Cada caso se rechaza con su motivo (mesa libre, con cobro,
 * dividida, unida, sucursales distintas). Cada ítem vigente del origen se anula con el motivo interno `TRASLADADA` y se copia al destino SIN recotizar, con
 * un id derivado de la unión y de la línea (el reintento no crea otra), conservando su estado de comanda (lo enviado no se reimprime) y de qué mesa vino.
 * La cuenta de origen NO se anula: queda ABIERTA y sin ítems como cuenta de RESERVA que sigue ocupando el ancla de su mesa; es lo que impide, en la base,
 * tomar un pedido en la mesa unida mientras tanto. Se anula al cobrar o liberar el destino. No se deshace. Repetir devuelve lo hecho (`yaExistia`).
 */
async function unir(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeUnirMesas,
): Promise<R<SalidaDeUnirMesas>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.unionId, entrada.cuentaDestinoId, entrada.cuentaOrigenId);
  if (!ids.ok) return ids;
  const clave = exigirClave(entrada.clave);
  if (!clave.ok) return clave;

  // El orden de bloqueo es el de id, igual para todos: antes de leer nada de lo que se va a decidir.
  const bloqueadas = new Map(
    (await bloquearCuentas(tx, empresaId, [entrada.cuentaDestinoId, entrada.cuentaOrigenId])).map(
      (c) => [c.id as string, c],
    ),
  );
  const destino = bloqueadas.get(entrada.cuentaDestinoId) ?? null;
  const origen = bloqueadas.get(entrada.cuentaOrigenId) ?? null;
  if (destino === null || origen === null) return err("CUENTA_NO_ENCONTRADA");
  for (const c of [destino, origen]) {
    const alcance = await exigirAlcance(tx, contexto, c.sucursalId);
    if (!alcance.ok) return alcance;
  }

  // Idempotencia: la misma unión (mismo id o misma clave) con lo mismo devuelve lo hecho; con otra cosa, nunca se pisa.
  const previa =
    (await tx.unionesYDivisiones.unionPorId(empresaId, entrada.unionId)) ??
    (await tx.unionesYDivisiones.unionPorClave(empresaId, entrada.clave));
  if (previa !== null) {
    const igual =
      previa.id === entrada.unionId &&
      previa.clave === entrada.clave &&
      huellaDeUnion({
        cuentaDestinoId: previa.cuentaDestinoId,
        cuentaOrigenId: previa.cuentaOrigenId,
      }) ===
        huellaDeUnion({
          cuentaDestinoId: entrada.cuentaDestinoId,
          cuentaOrigenId: entrada.cuentaOrigenId,
        });
    if (!igual) return err("CLAVE_REUTILIZADA");
    const lineas = await lineasDeCuenta(tx, empresaId, destino.id);
    return ok({
      unionId: previa.id,
      lineasMovidas: 0,
      totalDestino: importeAJson(calcularLasLineas(lineas).total),
      yaExistia: true,
    });
  }

  const decision = decidirUnion(
    await paraUnir(tx, contexto, destino),
    await paraUnir(tx, contexto, origen),
  );
  if (!decision.ok) return decision;
  if (destino.estado !== "ABIERTA" || origen.estado !== "ABIERTA") return err("CUENTA_NO_ABIERTA");
  // A2c, Confirmado por el dueño el 13/11/2026 (DEC-0364): solo se unen cuentas del MISMO departamento; mezclar dos sería perder a cuál pertenece lo vendido.
  if (destino.departamentoId !== origen.departamentoId) return err("DEPARTAMENTO_DISTINTO");
  const claseDestino = await claseDeCuenta(tx, contexto, destino);
  const claseOrigen = await claseDeCuenta(tx, contexto, origen);
  if (claseDestino.clase !== "MESA" || claseOrigen.clase !== "MESA")
    return err("CUENTA_NO_ES_DE_MESA");

  const vigentes = (await lineasDeCuenta(tx, empresaId, origen.id)).filter(
    (l) => l.estado === "VIGENTE",
  );
  const insertada = await tx.unionesYDivisiones.insertarUnion(empresaId, {
    id: entrada.unionId,
    sucursalId: destino.sucursalId,
    cuentaDestinoId: destino.id,
    mesaDestinoId: claseDestino.mesaId,
    cuentaOrigenId: origen.id,
    mesaOrigenId: claseOrigen.mesaId,
    clave: entrada.clave,
    unidaPor: persona,
    unidaEn: contexto.ahora,
  });
  if (!insertada) return err("CLAVE_REUTILIZADA");
  for (const linea of vigentes) {
    const anulada = await anularLineaEnTx(tx, contexto, persona, {
      cuentaId: origen.id,
      lineaId: linea.id,
      motivo: MOTIVO_TRASLADADA,
    });
    if (!anulada.ok) return anulada;
    // Otra operación la movió antes: nada se traslada dos veces.
    if (anulada.valor.yaEstabaAnulada) return err("LINEA_YA_MOVIDA");
    const nuevaId = idDerivado("salon.union", entrada.unionId, linea.id);
    const copiada = await copiarLineaEnTx(tx, contexto, persona, {
      lineaOrigenId: linea.id,
      cuentaDestinoId: destino.id,
      lineaNuevaId: nuevaId,
      cantidad: linea.cantidad,
      modo: "COMPLETA",
    });
    if (!copiada.ok) return copiada;
    const comanda = await copiarEstadoDeComandaEnTx(tx, contexto, {
      lineaOrigenId: linea.id,
      lineaNuevaId: nuevaId,
      cuentaDestinoId: destino.id,
    });
    if (!comanda.ok) return comanda;
    await tx.unionesYDivisiones.insertarLineaUnida(empresaId, {
      lineaId: nuevaId,
      unionId: entrada.unionId,
      mesaOrigenId: claseOrigen.mesaId,
    });
  }
  const total = calcularLasLineas(await lineasDeCuenta(tx, empresaId, destino.id)).total;
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "MESAS_UNIDAS",
    entidad: "union_de_mesas",
    entidadId: entrada.unionId,
    despues: {
      cuentaDestinoId: destino.id,
      mesaDestinoId: claseDestino.mesaId,
      cuentaOrigenId: origen.id,
      mesaOrigenId: claseOrigen.mesaId,
      lineas: vigentes.length,
      total: importeAJson(total).monto,
    },
  });
  return ok({
    unionId: entrada.unionId,
    lineasMovidas: vigentes.length,
    totalDestino: importeAJson(total),
    yaExistia: false,
  });
}

export function armarUnion(dependencias: DependenciasDeSalon) {
  const dependenciasConReintentos: DependenciasDeSalon = {
    ...dependencias,
    transacciones: {
      ejecutar: (opciones, trabajo) =>
        dependencias.transacciones.ejecutar(
          { ...opciones, reintentos: REINTENTOS_AL_UNIR },
          trabajo,
        ),
    },
  };
  const comando = armarComando(dependenciasConReintentos);
  return {
    unirMesas: comando(accionesDeCaso(DECLARACIONES.unirMesas), unir),
  };
}

/** Unir choca con otras uniones, envíos y cobros sobre las mismas cuentas: ante un conflicto de serialización se repite entero (lo hecho es idempotente). */
const REINTENTOS_AL_UNIR = 20;
