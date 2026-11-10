import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { negarConSigno, type CantidadConSigno } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeComando } from "../dominio/huella";
import type { RenglonDeLibro } from "../dominio/movimiento";
import { buscarMotivo, motivoExigeAjustar, motivoManualPermitido } from "../dominio/motivos";
import { autorizar } from "./comun";
import type { DependenciasDeStock } from "./contrato";
import type { DetalleDeNegativo, ErrorDeStock } from "./errores";
import { costosDeclaradosDe } from "./costos";
import { buscarRepeticion, registrarMovimientoEnTx } from "./movimiento-en-tx";
import {
  cargarDeposito,
  comprobarFecha,
  leerClave,
  leerConfirmaciones,
  leerDetalle,
  leerRenglones,
  renglonDeLibro,
  renglonesDeHuella,
  resolverRenglones,
  traducirMovimiento,
  type RenglonPedido,
} from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

export type EntradaDeRegistrarEntrada = Readonly<{
  /** UUID que genera la pantalla (idempotencia, D136): el mismo con el mismo contenido es el mismo pedido. */
  clave: string;
  depositoId: string;
  /** `COMPRA`, `CARGA_INICIAL`, `DEVOLUCION_DE_CLIENTE` u `OTRA_ENTRADA`. */
  motivo: string;
  detalle?: string | undefined;
  /** Cuándo ocurrió; sin él, el `ahora` del contexto. No puede ser anterior al inicio de la jornada vigente (S-2). */
  hechoEn?: Date | undefined;
  renglones: readonly RenglonPedido[];
}>;
export type SalidaDeRegistrarEntrada = Readonly<{ movimientoId: string; yaExistia: boolean }>;

export type EntradaDeRegistrarSalida = Readonly<
  Omit<EntradaDeRegistrarEntrada, "motivo"> & {
    /** `CONSUMO_INTERNO`, `MERMA`, `ROTURA`, `VENCIMIENTO` (exige además `stock.ajustar`, S-7) u `OTRA_SALIDA`. `VENTA` no: solo por el puerto de ventas. */
    motivo: string;
    /** `["stock.existencia_negativa"]` cuando la persona confirmó que va a quedar en negativo (nivel `AVISAR`). */
    confirmaciones?: readonly string[] | undefined;
  }
>;
export type SalidaDeRegistrarSalida = Readonly<{
  movimientoId: string;
  yaExistia: boolean;
  /** Los saldos que quedaron en negativo porque el control lo permitió o la persona lo confirmó (cada uno quedó auditado). */
  excepciones: readonly DetalleDeNegativo[];
}>;

export type EntradaDeTransferir = Readonly<{
  clave: string;
  origenId: string;
  destinoId: string;
  renglones: readonly RenglonPedido[];
  confirmaciones?: readonly string[] | undefined;
}>;
export type SalidaDeTransferir = SalidaDeRegistrarSalida;

export type RenglonDeAjuste = RenglonPedido & Readonly<{ sentido: "SUMA" | "RESTA" }>;
export type EntradaDeAjustar = Readonly<{
  clave: string;
  depositoId: string;
  /** Qué se corrige y por qué: obligatorio. */
  detalle: string;
  renglones: readonly RenglonDeAjuste[];
}>;
export type SalidaDeAjustar = SalidaDeRegistrarEntrada;

/** `hechoEn` entra a la huella SOLO si la persona lo mandó: el `ahora` del contexto no es parte del pedido (si no, un reintento daría otra huella). */
const hechoEnDelPedido = (hechoEn: unknown): string | null =>
  hechoEn instanceof Date && !Number.isNaN(hechoEn.getTime()) ? hechoEn.toISOString() : null;

/** Los pares (artículo, cantidad) del libro, sin composición. */
const renglonesDe = (
  depositoId: string,
  resueltos: readonly Readonly<{ articuloId: string; cantidad: CantidadConSigno }>[],
  signo: 1 | -1,
): RenglonDeLibro[] =>
  resueltos.map((r) =>
    renglonDeLibro(depositoId, r.articuloId, signo === 1 ? r.cantidad : negarConSigno(r.cantidad)),
  );

/**
 * Entrada y salida de un depósito comparten todo salvo el signo, el permiso, los motivos y el control de existencia negativa: una sola
 * función, dos casos de uso (una regla, un lugar).
 */
function armarEntradaOSalida<S extends SalidaDeRegistrarEntrada | SalidaDeRegistrarSalida>(
  dependencias: DependenciasDeStock,
  clase: "ENTRADA" | "SALIDA",
  conSalida: (
    movimientoId: string,
    yaExistia: boolean,
    excepciones: readonly DetalleDeNegativo[],
  ) => S,
) {
  const entrada = clase === "ENTRADA";
  const accion: ClaveAccion = entrada ? "stock.registrar_entrada" : "stock.registrar_salida";
  return async function registrar(
    contexto: ContextoOperativo,
    pedido: EntradaDeRegistrarSalida,
  ): Promise<R<S>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<S>> => {
        // `VENCIMIENTO` exige además `stock.ajustar` (S-7): el guard evalúa las dos y el primer rechazo es el que vuelve.
        const acciones: readonly [ClaveAccion, ...ClaveAccion[]] =
          !entrada && motivoExigeAjustar(pedido.motivo) ? [accion, "stock.ajustar"] : [accion];
        const permiso = await autorizar(tx, contexto, dependencias.reglas, acciones);
        if (!permiso.ok) return permiso;
        const clave = leerClave(pedido.clave);
        if (!clave.ok) return clave;
        if (typeof pedido.motivo !== "string" || !motivoManualPermitido(clase, pedido.motivo)) {
          return err("MOTIVO_NO_PERMITIDO");
        }
        const detalle = leerDetalle(pedido.detalle, false);
        if (!detalle.ok) return detalle;
        const confirmaciones = entrada ? ok([]) : leerConfirmaciones(pedido.confirmaciones);
        if (!confirmaciones.ok) return confirmaciones;
        // Solo una entrada con motivo que declara costo (compra, carga inicial) puede traer `costoUnitario`.
        const admiteCosto = entrada && buscarMotivo(clase, pedido.motivo)?.entraConCosto === true;
        const leidos = leerRenglones(pedido.renglones, admiteCosto);
        if (!leidos.ok) return leidos;
        const deposito = await cargarDeposito(tx, contexto, pedido.depositoId);
        if (!deposito.ok) return deposito;

        const huella = huellaDeComando(
          entrada ? "entrada" : "salida",
          [deposito.valor.id, pedido.motivo, detalle.valor, hechoEnDelPedido(pedido.hechoEn)],
          renglonesDeHuella(leidos.valor),
        );
        const repetido = await buscarRepeticion(tx, contexto, {
          clase,
          clave: clave.valor,
          huella,
          origen: null,
        });
        if (!repetido.ok) return repetido;
        if (repetido.valor !== null) return ok(conSalida(repetido.valor.id, true, []));

        if (!deposito.valor.activo) return err("DEPOSITO_INACTIVO");
        const hechoEn = await comprobarFecha(tx, contexto, deposito.valor, pedido.hechoEn);
        if (!hechoEn.ok) return hechoEn;
        const resueltos = await resolverRenglones(tx, contexto, leidos.valor);
        if (!resueltos.ok) return resueltos;

        const registrado = await registrarMovimientoEnTx(tx, contexto, {
          clase,
          motivo: pedido.motivo,
          detalle: detalle.valor,
          origen: null,
          depositoId: deposito.valor.id,
          accion,
          anulaA: null,
          conteoId: null,
          clave: clave.valor,
          huella,
          hechoEn: hechoEn.valor,
          fechaDeNegocio: null,
          renglones: renglonesDe(deposito.valor.id, resueltos.valor, entrada ? 1 : -1),
          confirmaciones: confirmaciones.valor,
          costos: costosDeclaradosDe(deposito.valor.id, resueltos.valor),
        });
        if (!registrado.ok) return registrado;
        return ok(
          conSalida(
            registrado.valor.movimiento.id,
            registrado.valor.yaExistia,
            registrado.valor.excepciones,
          ),
        );
      },
    );
    return traducirMovimiento(resultado);
  };
}

/**
 * Registrar una entrada (E5 §3.2): guard `stock.registrar_entrada`, el depósito en el alcance de quien pide (el operador, solo sus sucursales)
 * y activo, motivo de entrada sembrado (lista de permitidos), cantidades mayores que cero llevadas EXACTAS a la unidad de stock del artículo,
 * `hechoEn` dentro de la jornada vigente. Repetición (`CLAVE_DE_IDEMPOTENCIA`): la `clave` de la pantalla con la misma huella devuelve el
 * movimiento anterior con `yaExistia: true` sin escribir ni auditar; con otro contenido (también otro costo), `CLAVE_REUTILIZADA`. El movimiento es
 * su propio registro de auditoría. La cuarentena y el rechazo no reciben entradas (`MOTIVO_NO_PERMITIDO`: solo por transferencia, ajuste o
 * anulación). Costo (E5-T10): una entrada con motivo `COMPRA` o `CARGA_INICIAL` puede declarar `costoUnitario` por renglón (texto decimal de hasta
 * 6 decimales, mayor que cero, por UNIDAD DE STOCK del artículo: con otra unidad, o en otro motivo, o inválido, `COSTO_INVALIDO`); sin él el
 * renglón queda sin costo y no diluye el promedio. El promedio móvil y el costo del renglón se escriben en la misma transacción.
 */
export const armarRegistrarEntrada = (d: DependenciasDeStock) =>
  armarEntradaOSalida<SalidaDeRegistrarEntrada>(d, "ENTRADA", (movimientoId, yaExistia) => ({
    movimientoId,
    yaExistia,
  }));

/**
 * Registrar una salida (E5 §3.2): lo mismo que la entrada con guard `stock.registrar_salida`, motivos de salida (`VENTA` no se admite: solo
 * por el puerto de ventas; `VENCIMIENTO` exige además `stock.ajustar`, S-7) y el control `stock.existencia_negativa`: se lee su nivel de la
 * base (sin fila, `PERMITIR`) con los saldos ya bloqueados. `PERMITIR` deja pasar y audita cada renglón que queda en negativo; `AVISAR` sin
 * confirmar es `CONTROL_REQUIERE_CONFIRMACION` y con `confirmaciones: ["stock.existencia_negativa"]` pasa y se audita; `BLOQUEAR` es
 * `CONTROL_BLOQUEA`, con el detalle `[{ productoId, depositoId, existenciaResultante }]`.
 */
export const armarRegistrarSalida = (d: DependenciasDeStock) =>
  armarEntradaOSalida<SalidaDeRegistrarSalida>(
    d,
    "SALIDA",
    (movimientoId, yaExistia, excepciones) => ({
      movimientoId,
      yaExistia,
      excepciones,
    }),
  );

/**
 * Transferir entre dos depósitos (E5 §3.2, S-3): guard `stock.transferir` y alcance sobre LAS DOS sucursales (el operador necesita las dos).
 * Es UN movimiento con dos patas por artículo, una vez: sale de uno y entra en el otro, o no pasa nada. Los renglones se escriben en el orden
 * canónico `(depósito, artículo)`, así dos transferencias cruzadas toman los bloqueos en el mismo orden y no se traban. El control de
 * existencia negativa mira solo la pata de origen. Cuarentena y rechazo sí participan (la transferencia es una de sus vías).
 */
export function armarTransferir(dependencias: DependenciasDeStock) {
  return async function transferir(
    contexto: ContextoOperativo,
    entrada: EntradaDeTransferir,
  ): Promise<R<SalidaDeTransferir>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeTransferir>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["stock.transferir"]);
        if (!permiso.ok) return permiso;
        const clave = leerClave(entrada.clave);
        if (!clave.ok) return clave;
        const confirmaciones = leerConfirmaciones(entrada.confirmaciones);
        if (!confirmaciones.ok) return confirmaciones;
        const leidos = leerRenglones(entrada.renglones);
        if (!leidos.ok) return leidos;
        const origen = await cargarDeposito(tx, contexto, entrada.origenId);
        if (!origen.ok) return origen;
        const destino = await cargarDeposito(
          tx,
          contexto,
          entrada.destinoId,
          "DEPOSITO_DE_DESTINO_NO_ENCONTRADO",
        );
        if (!destino.ok) return destino;
        if (origen.valor.id === destino.valor.id) return err("TRANSFERENCIA_AL_MISMO_DEPOSITO");

        const huella = huellaDeComando(
          "transferencia",
          [origen.valor.id, destino.valor.id],
          renglonesDeHuella(leidos.valor),
        );
        const repetido = await buscarRepeticion(tx, contexto, {
          clase: "TRANSFERENCIA",
          clave: clave.valor,
          huella,
          origen: null,
        });
        if (!repetido.ok) return repetido;
        if (repetido.valor !== null) {
          return ok({ movimientoId: repetido.valor.id, yaExistia: true, excepciones: [] });
        }

        if (!origen.valor.activo || !destino.valor.activo) return err("DEPOSITO_INACTIVO");
        const resueltos = await resolverRenglones(tx, contexto, leidos.valor);
        if (!resueltos.ok) return resueltos;
        const registrado = await registrarMovimientoEnTx(tx, contexto, {
          clase: "TRANSFERENCIA",
          motivo: "TRANSFERENCIA",
          detalle: null,
          origen: null,
          depositoId: origen.valor.id,
          accion: "stock.transferir",
          anulaA: null,
          conteoId: null,
          clave: clave.valor,
          huella,
          hechoEn: contexto.ahora,
          fechaDeNegocio: null,
          renglones: [
            ...renglonesDe(origen.valor.id, resueltos.valor, -1),
            ...renglonesDe(destino.valor.id, resueltos.valor, 1),
          ],
          confirmaciones: confirmaciones.valor,
        });
        if (!registrado.ok) return registrado;
        return ok({
          movimientoId: registrado.valor.movimiento.id,
          yaExistia: registrado.valor.yaExistia,
          excepciones: registrado.valor.excepciones,
        });
      },
    );
    return traducirMovimiento(resultado);
  };
}

/**
 * Ajustar (corregir) la existencia de un depósito (E5 §3.2): guard `stock.ajustar` (administrador y gerente), detalle obligatorio
 * (`DETALLE_REQUERIDO`), cada renglón suma o resta. Un ajuste NUNCA se bloquea por existencia negativa: corrige la realidad. Sirve también en
 * cuarentena y rechazo. Repetición (`CLAVE_DE_IDEMPOTENCIA`).
 */
export function armarAjustar(dependencias: DependenciasDeStock) {
  return async function ajustar(
    contexto: ContextoOperativo,
    entrada: EntradaDeAjustar,
  ): Promise<R<SalidaDeAjustar>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAjustar>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["stock.ajustar"]);
        if (!permiso.ok) return permiso;
        const clave = leerClave(entrada.clave);
        if (!clave.ok) return clave;
        const detalle = leerDetalle(entrada.detalle, true);
        if (!detalle.ok) return detalle;
        const leidos = leerRenglones(entrada.renglones);
        if (!leidos.ok) return leidos;
        // El sentido es de la lista cerrada `SUMA`/`RESTA`: otro valor no se adivina.
        const sentidos: ("SUMA" | "RESTA")[] = [];
        for (const r of entrada.renglones) {
          if (r.sentido !== "SUMA" && r.sentido !== "RESTA") return err("RENGLONES_INVALIDOS");
          sentidos.push(r.sentido);
        }
        const deposito = await cargarDeposito(tx, contexto, entrada.depositoId);
        if (!deposito.ok) return deposito;

        const huella = huellaDeComando(
          "ajuste",
          [deposito.valor.id, detalle.valor],
          renglonesDeHuella(leidos.valor).map((r, i) => [...r, sentidos[i] ?? null]),
        );
        const repetido = await buscarRepeticion(tx, contexto, {
          clase: "AJUSTE",
          clave: clave.valor,
          huella,
          origen: null,
        });
        if (!repetido.ok) return repetido;
        if (repetido.valor !== null)
          return ok({ movimientoId: repetido.valor.id, yaExistia: true });

        if (!deposito.valor.activo) return err("DEPOSITO_INACTIVO");
        const resueltos = await resolverRenglones(tx, contexto, leidos.valor);
        if (!resueltos.ok) return resueltos;
        const registrado = await registrarMovimientoEnTx(tx, contexto, {
          clase: "AJUSTE",
          motivo: "CORRECCION",
          detalle: detalle.valor,
          origen: null,
          depositoId: deposito.valor.id,
          accion: "stock.ajustar",
          anulaA: null,
          conteoId: null,
          clave: clave.valor,
          huella,
          hechoEn: contexto.ahora,
          fechaDeNegocio: null,
          renglones: resueltos.valor.map((r, i) =>
            renglonDeLibro(
              deposito.valor.id,
              r.articuloId,
              sentidos[i] === "RESTA" ? negarConSigno(r.cantidad) : r.cantidad,
            ),
          ),
          confirmaciones: [],
        });
        if (!registrado.ok) return registrado;
        return ok({
          movimientoId: registrado.valor.movimiento.id,
          yaExistia: registrado.valor.yaExistia,
        });
      },
    );
    return traducirMovimiento(resultado);
  };
}
