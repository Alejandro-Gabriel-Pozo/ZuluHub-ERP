import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
} from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { renglonesDeConteo, type RegistroDeConteo } from "../dominio/conteo";
import { esUnidadConocida } from "../dominio/composicion";
import { huellaDeComando } from "../dominio/huella";
import type { Conteo, RegistroGuardado } from "../persistencia/modelo";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeStock, TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { registrarMovimientoEnTx } from "./movimiento-en-tx";
import {
  aUnidadDeStock,
  cargarDeposito,
  leerCantidad,
  leerDetalle,
  leerId,
  traducirMovimiento,
} from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

export type EntradaDeAbrirConteo = Readonly<{
  /** Lo manda la pantalla (idempotencia de abrirlo). */
  id: string;
  depositoId: string;
}>;
export type SalidaDeAbrirConteo = Readonly<{ conteoId: string; yaExistia: boolean }>;

export type EntradaDeRegistrarConteo = Readonly<{
  /** Lo manda la pantalla: recontar es un registro NUEVO (otro `id`) y vale el último. */
  id: string;
  conteoId: string;
  productoId: string;
  /** Lo que contó la persona, en texto decimal (cero es válido: no había nada), en la unidad `unidadId`. */
  cantidadContada: string;
  unidadId: string;
}>;
export type SalidaDeRegistrarConteo = Readonly<{ yaExistia: boolean }>;

export type EntradaDeAplicarConteo = Readonly<{ conteoId: string }>;
export type SalidaDeAplicarConteo = Readonly<{
  /** El ajuste por conteo; `null` si ningún artículo contado tenía diferencia (el conteo se resolvió sin escribir un ajuste). */
  movimientoId: string | null;
  /** `true`: el conteo ya estaba aplicado (misma aplicación repetida): no se escribió ni se auditó nada. */
  yaAplicado: boolean;
}>;

export type EntradaDeCancelarConteo = Readonly<{ conteoId: string; motivo: string }>;
export type SalidaDeCancelarConteo = Readonly<{ yaEstaba: boolean }>;

/**
 * La clave de idempotencia del ajuste por conteo: derivada de forma determinística del conteo, así que aplicar dos veces es una sola vez. No es
 * un UUID: lo que manda la pantalla (UUID) no puede ocuparla (`leerClave`).
 */
export const claveDelAjusteDeConteo = (conteoId: string): string => `conteo_${conteoId}`;

/**
 * El conteo de la persona, con el alcance de la sucursal de su depósito: inexistente (o de otra empresa) es `CONTEO_NO_ENCONTRADO`; un
 * depósito fuera del alcance de quien pide, `SUCURSAL_FUERA_DE_ALCANCE`. `bloquear`: con `SELECT … FOR UPDATE`, para serializar aplicar,
 * cancelar y registrar sobre el mismo conteo.
 */
async function cargarConteo(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  id: unknown,
  bloquear: boolean,
): Promise<R<Conteo>> {
  const conteoId = leerId(id);
  if (conteoId === null) return err("CONTEO_NO_ENCONTRADO");
  const conteo = bloquear
    ? await tx.conteosDeStock.bloquear(contexto.empresaId, conteoId)
    : await tx.conteosDeStock.obtener(contexto.empresaId, conteoId);
  if (conteo === null) return err("CONTEO_NO_ENCONTRADO");
  const deposito = await tx.depositos.obtener(contexto.empresaId, conteo.depositoId);
  if (deposito === null) throw new Error("el depósito de un conteo no existe");
  const alcance = await exigirAlcanceDeSucursal(tx, contexto, deposito.sucursalId);
  return alcance.ok ? ok(conteo) : alcance;
}

/** Lo que un registro guardado dice, para compararlo con lo que se pide (una repetición es el MISMO registro). */
const esElMismoRegistro = (
  guardado: RegistroGuardado,
  pedido: Readonly<{ conteoId: string; articuloId: string; unidades: bigint }>,
): boolean => {
  const cantidad = cantidadConSignoDesdeTexto(guardado.cantidadContada);
  return (
    guardado.conteoId === pedido.conteoId &&
    guardado.articuloId === pedido.articuloId &&
    cantidad.ok &&
    cantidad.valor.unidades === pedido.unidades
  );
};

/**
 * Abrir un conteo físico de un depósito (E5 §3.2, D125). Guard `conteos.abrir` (administrador y gerente); el depósito en el alcance de quien pide
 * y activo. Un solo conteo ABIERTO por depósito (`CONTEO_EN_CURSO`: lo impone el único parcial de la base, así que vale aunque dos lo abran a la
 * vez). Repetición (`CLAVE_DE_IDEMPOTENCIA`): el `id` lo manda la pantalla; el mismo `id` con el mismo depósito devuelve `yaExistia` sin escribir ni
 * auditar, con otro depósito, `ID_REUTILIZADO`. El conteo NO congela el depósito (S-11): lo que se mueva mientras se cuenta sigue moviéndose.
 */
export function armarAbrirConteo(dependencias: DependenciasDeStock) {
  return async function abrirConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeAbrirConteo,
  ): Promise<R<SalidaDeAbrirConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAbrirConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.abrir"]);
        if (!permiso.ok) return permiso;
        const id = leerId(entrada.id);
        if (id === null) return err("IDENTIFICADOR_INVALIDO");
        const deposito = await cargarDeposito(tx, contexto, entrada.depositoId);
        if (!deposito.ok) return deposito;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");

        const existente = await tx.conteosDeStock.obtener(empresaId, id);
        if (existente !== null) {
          return existente.depositoId === deposito.valor.id
            ? ok({ conteoId: id, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        if (!deposito.valor.activo) return err("DEPOSITO_INACTIVO");
        if ((await tx.conteosDeStock.abiertoDe(empresaId, deposito.valor.id)) !== null) {
          return err("CONTEO_EN_CURSO");
        }
        const insertado = await tx.conteosDeStock.insertar(empresaId, {
          id,
          depositoId: deposito.valor.id,
          abiertoPor: persona,
          abiertoEn: contexto.ahora,
        });
        if (!insertado) {
          // Dos pedidos iguales a la vez: el otro ya lo abrió.
          const guardado = await tx.conteosDeStock.obtener(empresaId, id);
          return guardado !== null && guardado.depositoId === deposito.valor.id
            ? ok({ conteoId: id, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CONTEO_ABIERTO",
          entidad: "conteo_fisico",
          entidadId: id,
          despues: { depositoId: deposito.valor.id, estado: "ABIERTO" },
        });
        return ok({ conteoId: id, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Registrar lo contado de un artículo (E5 §3.2). Guard `conteos.registrar` (también el operador: «cuenta»); el conteo en el alcance de quien pide
 * y ABIERTO (`CONTEO_CERRADO`); el artículo, controlado y activo (`ARTICULO_NO_CONTROLADO`); la cantidad contada, cero o más, llevada EXACTA a la
 * unidad de stock. La base fija en ese momento la existencia teórica del depósito (`existencia_al_registrar`), que esta respuesta NO muestra:
 * el conteo es a ciegas. Recontar es un registro nuevo (otro `id`): vale el último por artículo. Repetición (`CLAVE_DE_IDEMPOTENCIA`): el mismo
 * `id` con lo mismo devuelve `yaExistia` sin escribir; con otro contenido, `ID_REUTILIZADO`. Es su propio registro (solo inserción, con autor y
 * hora): no suma nada a la auditoría de la empresa.
 */
export function armarRegistrarConteo(dependencias: DependenciasDeStock) {
  return async function registrarConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarConteo,
  ): Promise<R<SalidaDeRegistrarConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeRegistrarConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.registrar"]);
        if (!permiso.ok) return permiso;
        const id = leerId(entrada.id);
        if (id === null) return err("IDENTIFICADOR_INVALIDO");
        const conteo = await cargarConteo(tx, contexto, entrada.conteoId, false);
        if (!conteo.ok) return conteo;
        const contada = leerCantidad(entrada.cantidadContada, true);
        if (!contada.ok) return contada;
        if (typeof entrada.unidadId !== "string" || !esUnidadConocida(entrada.unidadId)) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        const productoId = leerId(entrada.productoId);
        const articulo =
          productoId === null ? null : await tx.articulosDeStock.porProducto(empresaId, productoId);
        if (articulo === null) return err("ARTICULO_NO_CONTROLADO");
        const enStock = aUnidadDeStock(contada.valor, entrada.unidadId, articulo);
        if (!enStock.ok) return enStock;
        const pedido = {
          conteoId: conteo.valor.id,
          articuloId: articulo.id,
          unidades: enStock.valor.unidades,
        };

        const existente = await tx.conteosDeStock.obtenerRegistro(empresaId, id);
        if (existente !== null) {
          return esElMismoRegistro(existente, pedido)
            ? ok({ yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        if (conteo.valor.estado !== "ABIERTO") return err("CONTEO_CERRADO");
        if (!articulo.activo) return err("ARTICULO_NO_CONTROLADO");
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const insertado = await tx.conteosDeStock.insertarRegistro(empresaId, {
          id,
          conteoId: conteo.valor.id,
          articuloId: articulo.id,
          cantidadContada: cantidadATexto(enStock.valor),
          registradoPor: persona,
          registradoEn: contexto.ahora,
        });
        if (!insertado) {
          // Dos pedidos iguales a la vez: el otro ya lo registró.
          const guardado = await tx.conteosDeStock.obtenerRegistro(empresaId, id);
          return guardado !== null && esElMismoRegistro(guardado, pedido)
            ? ok({ yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        return ok({ yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/** Los registros del conteo como los entiende el dominio: lo contado (en unidad de stock) y la existencia que había al registrar. */
function registrosParaElDominio(guardados: readonly RegistroGuardado[]): RegistroDeConteo[] {
  return guardados.map((g) => {
    const teorica = cantidadConSignoDesdeTexto(g.existenciaAlRegistrar);
    if (!teorica.ok)
      throw new RangeError("stock: la existencia guardada de un registro no es una cantidad");
    return {
      articuloId: g.articuloId,
      orden: g.orden,
      cantidadContada: cantidadDesdeTexto(g.cantidadContada),
      existenciaAlRegistrar: teorica.valor,
    };
  });
}

/**
 * Aplicar un conteo (E5 §3.2, D125, D132). Guard `conteos.aplicar` (administrador y gerente). UNA transacción: `ABIERTO → APLICADO` con
 * `UPDATE … WHERE estado = 'ABIERTO'` (de dos aplicaciones, o de aplicar y cancelar, a la vez gana una) y un `AJUSTE_POR_CONTEO` con un renglón
 * por artículo con diferencia `contada − existencia_al_registrar`: lo que se vendió DESPUÉS de registrar queda intacto, lo no contado no cambia, y
 * como es un ajuste nunca se bloquea por existencia negativa. Sin registros no se aplica (`CONTEO_SIN_REGISTROS`); sin diferencias se resuelve sin
 * escribir un ajuste (`movimientoId: null`). Cancelado es `CONTEO_CANCELADO`. Repetición (`YA_ESTABA`): ya aplicado devuelve el ajuste que se hizo
 * con `yaAplicado: true`, sin escribir ni auditar; la clave del ajuste es derivada del conteo, así que la base tampoco admite dos.
 */
export function armarAplicarConteo(dependencias: DependenciasDeStock) {
  return async function aplicarConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeAplicarConteo,
  ): Promise<R<SalidaDeAplicarConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAplicarConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.aplicar"]);
        if (!permiso.ok) return permiso;
        const conteo = await cargarConteo(tx, contexto, entrada.conteoId, true);
        if (!conteo.ok) return conteo;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const clave = claveDelAjusteDeConteo(conteo.valor.id);

        if (conteo.valor.estado === "CANCELADO") return err("CONTEO_CANCELADO");
        if (conteo.valor.estado === "APLICADO") {
          const ajuste = await tx.movimientosDeStock.porClave(empresaId, clave);
          return ok({ movimientoId: ajuste === null ? null : ajuste.id, yaAplicado: true });
        }

        const guardados = await tx.conteosDeStock.registrosDe(empresaId, conteo.valor.id);
        const renglones = renglonesDeConteo(registrosParaElDominio(guardados));
        if (!renglones.ok) {
          return err(
            renglones.error === "CONTEO_SIN_REGISTROS"
              ? "CONTEO_SIN_REGISTROS"
              : "CANTIDAD_INVALIDA",
          );
        }
        const resuelto = await tx.conteosDeStock.resolver(empresaId, conteo.valor.id, {
          estado: "APLICADO",
          resueltoPor: persona,
          resueltoEn: contexto.ahora,
          motivo: null,
        });
        // El conteo está bloqueado y abierto: que ya no lo esté es un defecto, no una carrera.
        if (resuelto === null) throw new Error("el conteo bloqueado dejó de estar abierto");

        let movimientoId: string | null = null;
        if (renglones.valor.length > 0) {
          const registrado = await registrarMovimientoEnTx(tx, contexto, {
            clase: "AJUSTE_POR_CONTEO",
            motivo: "CONTEO",
            detalle: null,
            origen: null,
            depositoId: conteo.valor.depositoId,
            accion: "conteos.aplicar",
            anulaA: null,
            conteoId: conteo.valor.id,
            clave,
            huella: huellaDeComando(
              "aplicar_conteo",
              [conteo.valor.id],
              renglones.valor.map((r) => [r.articuloId, cantidadConSignoATexto(r.diferencia)]),
            ),
            hechoEn: contexto.ahora,
            fechaDeNegocio: null,
            renglones: renglones.valor.map((r) => ({
              depositoId: conteo.valor.depositoId,
              articuloId: r.articuloId,
              composicionId: null,
              cantidad: r.diferencia,
            })),
            confirmaciones: [],
          });
          if (!registrado.ok) return registrado;
          movimientoId = registrado.valor.movimiento.id;
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CONTEO_APLICADO",
          entidad: "conteo_fisico",
          entidadId: conteo.valor.id,
          antes: { estado: "ABIERTO" },
          despues: {
            estado: "APLICADO",
            movimientoId,
            renglonesConDiferencia: renglones.valor.length,
          },
        });
        return ok({ movimientoId, yaAplicado: false });
      },
    );
    return traducirMovimiento(resultado);
  };
}

/**
 * Cancelar un conteo abierto (E5 §3.2). Guard `conteos.cancelar` (administrador y gerente); el motivo es obligatorio (`MOTIVO_REQUERIDO`, lista
 * de permitidos de una línea) y no cambia nada del libro. Un conteo aplicado no se cancela (`CONTEO_CERRADO`). Repetición (`YA_ESTABA`): ya
 * cancelado devuelve `yaEstaba` sin escribir ni auditar.
 */
export function armarCancelarConteo(dependencias: DependenciasDeStock) {
  return async function cancelarConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeCancelarConteo,
  ): Promise<R<SalidaDeCancelarConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCancelarConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.cancelar"]);
        if (!permiso.ok) return permiso;
        const motivo = leerDetalle(entrada.motivo, true);
        if (!motivo.ok || motivo.valor === null) return err("MOTIVO_REQUERIDO");
        const conteo = await cargarConteo(tx, contexto, entrada.conteoId, true);
        if (!conteo.ok) return conteo;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (conteo.valor.estado === "CANCELADO") return ok({ yaEstaba: true });
        if (conteo.valor.estado === "APLICADO") return err("CONTEO_CERRADO");
        const resuelto = await tx.conteosDeStock.resolver(empresaId, conteo.valor.id, {
          estado: "CANCELADO",
          resueltoPor: persona,
          resueltoEn: contexto.ahora,
          motivo: motivo.valor,
        });
        if (resuelto === null) throw new Error("el conteo bloqueado dejó de estar abierto");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CONTEO_CANCELADO",
          entidad: "conteo_fisico",
          entidadId: conteo.valor.id,
          antes: { estado: "ABIERTO" },
          despues: { estado: "CANCELADO", motivo: motivo.valor },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
