import type { Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import {
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
  type TipoDeComprobanteDeProveedor,
} from "../dominio/comprobante";
import type { LetraDeComprobante } from "../dominio/comprobante";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type FichaDeCompra = Readonly<{
  parteId: string;
  letraEsperada: LetraDeComprobante | null;
  version: number;
  puntosDeVenta: readonly Readonly<{ numero: number; activo: boolean }>[];
  comprobantes: readonly Readonly<{ tipo: TipoDeComprobanteDeProveedor; activo: boolean }>[];
}>;

export type ObjetoDePedido = "PUNTO_DE_VENTA" | "COMPROBANTE";
export type EstadoDePedido = "PENDIENTE" | "APROBADO" | "RECHAZADO";

export type PedidoDeFicha = Readonly<{
  id: string;
  parteId: string;
  objeto: ObjetoDePedido;
  valor: string;
  estado: EstadoDePedido;
  pedidoPor: string;
  pedidoEn: Date;
  resueltoPor: string | null;
  resueltoEn: Date | null;
  version: number;
}>;

/**
 * La ficha de compra del proveedor (E9 §3.2): letra esperada (congelada), puntos de venta y comprobantes que emite, y los pedidos de cambio. `bloquear`
 * toma la fila de la ficha `FOR UPDATE`: dos cambios de la misma ficha se serializan. Los hijos se leen ordenados (puntos por número, comprobantes por tipo).
 */
export interface RepositorioDeFichas {
  obtener(empresa: EmpresaId, parteId: string): Promise<FichaDeCompra | null>;
  bloquear(empresa: EmpresaId, parteId: string): Promise<FichaDeCompra | null>;
  /** Crea la ficha si no existe (la primera vez que se usa); la letra queda congelada. */
  asegurar(empresa: EmpresaId, parteId: string, letra: LetraDeComprobante | null): Promise<void>;
  /** Alta o reactivación del punto de venta; `false` si ya estaba activo. */
  activarPuntoDeVenta(empresa: EmpresaId, parteId: string, numero: number): Promise<boolean>;
  /** `false` si no existía o ya estaba apagado. */
  apagarPuntoDeVenta(empresa: EmpresaId, parteId: string, numero: number): Promise<boolean>;
  activarComprobante(
    empresa: EmpresaId,
    parteId: string,
    tipo: TipoDeComprobanteDeProveedor,
  ): Promise<boolean>;
  apagarComprobante(
    empresa: EmpresaId,
    parteId: string,
    tipo: TipoDeComprobanteDeProveedor,
  ): Promise<boolean>;
  /** Un pedido pendiente: si ya había uno igual pendiente devuelve ese (`yaExistia`). */
  pedir(
    empresa: EmpresaId,
    entrada: Readonly<{
      parteId: string;
      objeto: ObjetoDePedido;
      valor: string;
      pedidoPor: PersonaId;
    }>,
  ): Promise<Readonly<{ pedido: PedidoDeFicha; yaExistia: boolean }>>;
  bloquearPedido(empresa: EmpresaId, id: string): Promise<PedidoDeFicha | null>;
  resolverPedido(
    empresa: EmpresaId,
    id: string,
    estado: "APROBADO" | "RECHAZADO",
    resueltoPor: PersonaId,
    resueltoEn: Date,
  ): Promise<void>;
  pedidosPendientes(empresa: EmpresaId, parteId: string): Promise<readonly PedidoDeFicha[]>;
}

const LETRAS: readonly string[] = ["A", "B", "C"];

function letraGuardada(texto: string | null): LetraDeComprobante | null {
  if (texto === null) return null;
  const letra = LETRAS.find((l) => l === texto.trim());
  if (letra === undefined) throw new RangeError(`letra esperada desconocida: ${texto}`);
  return letra as LetraDeComprobante;
}

function tipoGuardado(texto: string): TipoDeComprobanteDeProveedor {
  const tipo = TIPOS_DE_COMPROBANTE_DE_PROVEEDOR.find((t) => t === texto);
  if (tipo === undefined) throw new RangeError(`tipo de comprobante desconocido: ${texto}`);
  return tipo;
}

const COLUMNAS_DE_PEDIDO = [
  "id",
  "parte_id",
  "objeto",
  "valor",
  "estado",
  "pedido_por",
  "pedido_en",
  "resuelto_por",
  "resuelto_en",
  "version",
] as const;

type FilaDePedido = {
  id: string;
  parte_id: string;
  objeto: string;
  valor: string;
  estado: string;
  pedido_por: string;
  pedido_en: Date;
  resuelto_por: string | null;
  resuelto_en: Date | null;
  version: number;
};

function aPedido(fila: FilaDePedido): PedidoDeFicha {
  const objeto: ObjetoDePedido = fila.objeto === "COMPROBANTE" ? "COMPROBANTE" : "PUNTO_DE_VENTA";
  if (fila.objeto !== objeto) throw new RangeError(`objeto de pedido desconocido: ${fila.objeto}`);
  const estados: readonly EstadoDePedido[] = ["PENDIENTE", "APROBADO", "RECHAZADO"];
  const estado = estados.find((e) => e === fila.estado);
  if (estado === undefined) throw new RangeError(`estado de pedido desconocido: ${fila.estado}`);
  return {
    id: fila.id,
    parteId: fila.parte_id,
    objeto,
    valor: fila.valor,
    estado,
    pedidoPor: fila.pedido_por,
    pedidoEn: fila.pedido_en,
    resueltoPor: fila.resuelto_por,
    resueltoEn: fila.resuelto_en,
    version: fila.version,
  };
}

export function crearRepositorioDeFichas(db: Kysely<ComprasDb>): RepositorioDeFichas {
  async function leer(
    empresa: EmpresaId,
    parteId: string,
    bloquear: boolean,
  ): Promise<FichaDeCompra | null> {
    if (!esUuid(parteId)) return null;
    let consulta = db
      .selectFrom("ficha_de_compra_del_proveedor")
      .select(["parte_id", "letra_esperada", "version"])
      .where("empresa_id", "=", empresa)
      .where("parte_id", "=", parteId);
    if (bloquear) consulta = consulta.forUpdate();
    const ficha = await consulta.executeTakeFirst();
    if (ficha === undefined) return null;
    const puntos = await db
      .selectFrom("punto_de_venta_de_la_ficha")
      .select(["numero", "activo"])
      .where("empresa_id", "=", empresa)
      .where("parte_id", "=", parteId)
      .orderBy("numero")
      .execute();
    const comprobantes = await db
      .selectFrom("comprobante_de_la_ficha")
      .select(["tipo", "activo"])
      .where("empresa_id", "=", empresa)
      .where("parte_id", "=", parteId)
      .orderBy("tipo")
      .execute();
    return {
      parteId,
      letraEsperada: letraGuardada(ficha.letra_esperada),
      version: ficha.version,
      puntosDeVenta: puntos.map((p) => ({ numero: p.numero, activo: p.activo })),
      comprobantes: comprobantes.map((c) => ({ tipo: tipoGuardado(c.tipo), activo: c.activo })),
    };
  }

  return {
    obtener: (empresa, parteId) => leer(empresa, parteId, false),
    bloquear: (empresa, parteId) => leer(empresa, parteId, true),
    async asegurar(empresa, parteId, letra) {
      await db
        .insertInto("ficha_de_compra_del_proveedor")
        .values({ empresa_id: empresa, parte_id: parteId, letra_esperada: letra })
        .onConflict((oc) => oc.doNothing())
        .execute();
    },
    async activarPuntoDeVenta(empresa, parteId, numero) {
      const nueva = await db
        .insertInto("punto_de_venta_de_la_ficha")
        .values({ empresa_id: empresa, parte_id: parteId, numero })
        .onConflict((oc) => oc.doNothing())
        .returning("numero")
        .executeTakeFirst();
      if (nueva !== undefined) return true;
      const reactivado = await db
        .updateTable("punto_de_venta_de_la_ficha")
        .set({ activo: true })
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("numero", "=", numero)
        .where("activo", "=", false)
        .returning("numero")
        .executeTakeFirst();
      return reactivado !== undefined;
    },
    async apagarPuntoDeVenta(empresa, parteId, numero) {
      const apagado = await db
        .updateTable("punto_de_venta_de_la_ficha")
        .set({ activo: false })
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("numero", "=", numero)
        .where("activo", "=", true)
        .returning("numero")
        .executeTakeFirst();
      return apagado !== undefined;
    },
    async activarComprobante(empresa, parteId, tipo) {
      const nuevo = await db
        .insertInto("comprobante_de_la_ficha")
        .values({ empresa_id: empresa, parte_id: parteId, tipo })
        .onConflict((oc) => oc.doNothing())
        .returning("tipo")
        .executeTakeFirst();
      if (nuevo !== undefined) return true;
      const reactivado = await db
        .updateTable("comprobante_de_la_ficha")
        .set({ activo: true })
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("tipo", "=", tipo)
        .where("activo", "=", false)
        .returning("tipo")
        .executeTakeFirst();
      return reactivado !== undefined;
    },
    async apagarComprobante(empresa, parteId, tipo) {
      const apagado = await db
        .updateTable("comprobante_de_la_ficha")
        .set({ activo: false })
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("tipo", "=", tipo)
        .where("activo", "=", true)
        .returning("tipo")
        .executeTakeFirst();
      return apagado !== undefined;
    },
    async pedir(empresa, entrada) {
      const nuevo = await db
        .insertInto("pedido_de_ficha")
        .values({
          empresa_id: empresa,
          parte_id: entrada.parteId,
          objeto: entrada.objeto,
          valor: entrada.valor,
          pedido_por: entrada.pedidoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning(COLUMNAS_DE_PEDIDO)
        .executeTakeFirst();
      if (nuevo !== undefined) return { pedido: aPedido(nuevo), yaExistia: false };
      const existente = await db
        .selectFrom("pedido_de_ficha")
        .select(COLUMNAS_DE_PEDIDO)
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", entrada.parteId)
        .where("objeto", "=", entrada.objeto)
        .where("valor", "=", entrada.valor)
        .where("estado", "=", "PENDIENTE")
        .executeTakeFirstOrThrow();
      return { pedido: aPedido(existente), yaExistia: true };
    },
    async bloquearPedido(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("pedido_de_ficha")
        .select(COLUMNAS_DE_PEDIDO)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aPedido(fila);
    },
    async resolverPedido(empresa, id, estado, resueltoPor, resueltoEn) {
      await db
        .updateTable("pedido_de_ficha")
        .set({ estado, resuelto_por: resueltoPor, resuelto_en: resueltoEn })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PENDIENTE")
        .executeTakeFirstOrThrow();
    },
    async pedidosPendientes(empresa, parteId) {
      if (!esUuid(parteId)) return [];
      const filas = await db
        .selectFrom("pedido_de_ficha")
        .select(COLUMNAS_DE_PEDIDO)
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("estado", "=", "PENDIENTE")
        .orderBy("pedido_en")
        .orderBy("id")
        .execute();
      return filas.map(aPedido);
    },
  };
}
