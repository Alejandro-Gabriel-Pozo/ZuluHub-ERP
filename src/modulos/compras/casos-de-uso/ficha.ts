import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { esCondicionIva } from "../../../primitivas/identificacion-fiscal/condicion-iva";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes, type ParteParaOperacion } from "../../clientes/publico";
import {
  esPuntoDeVentaValido,
  esTipoDeComprobanteDeProveedor,
  letraEsperadaDesdeCondicion,
  type TipoDeComprobanteDeProveedor,
} from "../dominio/comprobante";
import type { ObjetoDePedido } from "../persistencia/repositorio-de-fichas";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

/**
 * El proveedor de la ficha: una parte de la empresa, activa y con el rol `PROVEEDOR` (el directorio dice por qué no sirve: acá todo es `PROVEEDOR_NO_ENCONTRADO`,
 * el mismo mensaje para la parte de otra empresa y la inactiva: no se filtra cuál). La ficha nace la PRIMERA VEZ que se usa y su letra esperada sale de la
 * condición frente al IVA en ese momento y queda congelada (D113): cambiar la condición en el directorio no la toca.
 */
export async function proveedorConFicha(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  parteId: string,
): Promise<R<ParteParaOperacion>> {
  const parte = await directorio.parteParaOperacion(tx, empresaId, parteId, "PROVEEDOR");
  if (!parte.ok) return err("PROVEEDOR_NO_ENCONTRADO");
  const condicion = parte.valor.condicionIva;
  await tx.fichasDeCompra.asegurar(
    empresaId,
    parte.valor.id,
    letraEsperadaDesdeCondicion(condicion !== null && esCondicionIva(condicion) ? condicion : null),
  );
  return ok(parte.valor);
}

export type EntradaDePuntoDeVenta = Readonly<{ parteId: string; numero: number }>;
export type EntradaDeComprobanteDeFicha = Readonly<{ parteId: string; tipo: string }>;
export type SalidaDeCambioDeFicha = Readonly<{ yaEstaba: boolean }>;

type PedidoLeido = Readonly<{ objeto: ObjetoDePedido; valor: string }>;

/** Aplica un cambio de lista de la ficha, con su auditoría; si la lista ya estaba así no escribe ni audita (`YA_ESTABA`). */
async function cambiarLista(
  dependencias: DependenciasDeCompras,
  contexto: ContextoOperativo,
  parteId: string,
  accion: "proveedores.editar_ficha",
  auditoria: string,
  valor: Readonly<Record<string, string | number>>,
  aplicar: (tx: TxDeCompras) => Promise<boolean>,
): Promise<R<SalidaDeCambioDeFicha>> {
  const { empresaId } = contexto;
  return traducir(
    await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambioDeFicha>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [accion]);
        if (!permiso.ok) return permiso;
        const proveedor = await proveedorConFicha(tx, empresaId, parteId);
        if (!proveedor.ok) return proveedor;
        // Bloquea la ficha: dos cambios de la misma lista se serializan.
        await tx.fichasDeCompra.bloquear(empresaId, proveedor.valor.id);
        if (!(await aplicar(tx))) return ok({ yaEstaba: true });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: auditoria,
          entidad: "ficha_de_compra",
          entidadId: proveedor.valor.id,
          despues: valor,
        });
        return ok({ yaEstaba: false });
      },
    ),
  );
}

function puntoDeVentaValido(numero: number): R<number> {
  return esPuntoDeVentaValido(numero) ? ok(numero) : err("PUNTO_DE_VENTA_INVALIDO");
}

function tipoValido(tipo: string): R<TipoDeComprobanteDeProveedor> {
  return esTipoDeComprobanteDeProveedor(tipo) ? ok(tipo) : err("TIPO_DE_COMPROBANTE_INVALIDO");
}

/**
 * Agregar un punto de venta a la ficha del proveedor (E9 §3.2, D111). Guard `proveedores.editar_ficha` (gerente y administrador). Repetición (`YA_ESTABA`):
 * uno ya activo no escribe ni audita; uno apagado se reactiva. Las facturas ya cargadas no cambian (copian lo impreso).
 */
export function armarAgregarPuntoDeVenta(dependencias: DependenciasDeCompras) {
  return async function agregarPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDePuntoDeVenta,
  ): Promise<R<SalidaDeCambioDeFicha>> {
    const numero = puntoDeVentaValido(entrada.numero);
    if (!numero.ok) return numero;
    return cambiarLista(
      dependencias,
      contexto,
      entrada.parteId,
      "proveedores.editar_ficha",
      "FICHA_PUNTO_DE_VENTA_AGREGADO",
      { numero: numero.valor },
      (tx) =>
        tx.fichasDeCompra.activarPuntoDeVenta(contexto.empresaId, entrada.parteId, numero.valor),
    );
  };
}

/** Dejar de usar un punto de venta de la ficha. Repetición (`YA_ESTABA`): uno ya apagado, o que nunca estuvo, no escribe ni audita. */
export function armarDejarDeUsarPuntoDeVenta(dependencias: DependenciasDeCompras) {
  return async function dejarDeUsarPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDePuntoDeVenta,
  ): Promise<R<SalidaDeCambioDeFicha>> {
    const numero = puntoDeVentaValido(entrada.numero);
    if (!numero.ok) return numero;
    return cambiarLista(
      dependencias,
      contexto,
      entrada.parteId,
      "proveedores.editar_ficha",
      "FICHA_PUNTO_DE_VENTA_APAGADO",
      { numero: numero.valor },
      (tx) =>
        tx.fichasDeCompra.apagarPuntoDeVenta(contexto.empresaId, entrada.parteId, numero.valor),
    );
  };
}

/** Agregar un comprobante que emite el proveedor (uno de los nueve tipos). Repetición (`YA_ESTABA`) como el punto de venta. */
export function armarAgregarComprobante(dependencias: DependenciasDeCompras) {
  return async function agregarComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeComprobanteDeFicha,
  ): Promise<R<SalidaDeCambioDeFicha>> {
    const tipo = tipoValido(entrada.tipo);
    if (!tipo.ok) return tipo;
    return cambiarLista(
      dependencias,
      contexto,
      entrada.parteId,
      "proveedores.editar_ficha",
      "FICHA_COMPROBANTE_AGREGADO",
      { tipo: tipo.valor },
      (tx) => tx.fichasDeCompra.activarComprobante(contexto.empresaId, entrada.parteId, tipo.valor),
    );
  };
}

/** Dejar de usar un comprobante de la ficha. Repetición (`YA_ESTABA`) como el punto de venta. */
export function armarDejarDeUsarComprobante(dependencias: DependenciasDeCompras) {
  return async function dejarDeUsarComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeComprobanteDeFicha,
  ): Promise<R<SalidaDeCambioDeFicha>> {
    const tipo = tipoValido(entrada.tipo);
    if (!tipo.ok) return tipo;
    return cambiarLista(
      dependencias,
      contexto,
      entrada.parteId,
      "proveedores.editar_ficha",
      "FICHA_COMPROBANTE_APAGADO",
      { tipo: tipo.valor },
      (tx) => tx.fichasDeCompra.apagarComprobante(contexto.empresaId, entrada.parteId, tipo.valor),
    );
  };
}

export type SalidaDePedirFicha = Readonly<{
  /** `null` si lo pedido ya estaba en la ficha (no hay nada que pedir). */
  pedidoId: string | null;
  yaEstaba: boolean;
}>;

async function pedir(
  dependencias: DependenciasDeCompras,
  contexto: ContextoOperativo,
  parteId: string,
  pedido: PedidoLeido,
  yaEnLaFicha: (tx: TxDeCompras) => Promise<boolean>,
): Promise<R<SalidaDePedirFicha>> {
  const { empresaId } = contexto;
  return traducir(
    await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDePedirFicha>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "proveedores.pedir_ficha",
        ]);
        if (!permiso.ok) return permiso;
        // El sistema (sin persona) no pide nada: el guard ya lo rechaza; esto es el cierre por defecto y el estrechamiento del tipo.
        if (contexto.personaId === null) return err("SIN_PERMISO");
        const proveedor = await proveedorConFicha(tx, empresaId, parteId);
        if (!proveedor.ok) return proveedor;
        await tx.fichasDeCompra.bloquear(empresaId, proveedor.valor.id);
        if (await yaEnLaFicha(tx)) return ok({ pedidoId: null, yaEstaba: true });
        const pedido_ = await tx.fichasDeCompra.pedir(empresaId, {
          parteId: proveedor.valor.id,
          objeto: pedido.objeto,
          valor: pedido.valor,
          pedidoPor: contexto.personaId,
        });
        if (pedido_.yaExistia) return ok({ pedidoId: pedido_.pedido.id, yaEstaba: true });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "FICHA_PEDIDO_CREADO",
          entidad: "pedido_de_ficha",
          entidadId: pedido_.pedido.id,
          despues: { parteId: proveedor.valor.id, objeto: pedido.objeto, valor: pedido.valor },
        });
        return ok({ pedidoId: pedido_.pedido.id, yaEstaba: false });
      },
    ),
  );
}

/**
 * Pedir un punto de venta (E9 §3.2, D111): quien carga compras no edita la ficha, la PIDE. Guard `proveedores.pedir_ficha`. Repetición (`YA_ESTABA`): lo que ya
 * está activo en la ficha no se pide; un pedido igual todavía pendiente devuelve ese (único parcial de la base): pedir dos veces es un pedido. Mientras el
 * pedido está pendiente, la factura NO puede usar ese punto de venta.
 */
export function armarPedirPuntoDeVenta(dependencias: DependenciasDeCompras) {
  return async function pedirPuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDePuntoDeVenta,
  ): Promise<R<SalidaDePedirFicha>> {
    const numero = puntoDeVentaValido(entrada.numero);
    if (!numero.ok) return numero;
    return pedir(
      dependencias,
      contexto,
      entrada.parteId,
      { objeto: "PUNTO_DE_VENTA", valor: String(numero.valor) },
      async (tx) =>
        (await tx.fichasDeCompra.obtener(contexto.empresaId, entrada.parteId))?.puntosDeVenta.some(
          (p) => p.numero === numero.valor && p.activo,
        ) === true,
    );
  };
}

/** Pedir un comprobante: igual que el punto de venta. */
export function armarPedirComprobante(dependencias: DependenciasDeCompras) {
  return async function pedirComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeComprobanteDeFicha,
  ): Promise<R<SalidaDePedirFicha>> {
    const tipo = tipoValido(entrada.tipo);
    if (!tipo.ok) return tipo;
    return pedir(
      dependencias,
      contexto,
      entrada.parteId,
      { objeto: "COMPROBANTE", valor: tipo.valor },
      async (tx) =>
        (await tx.fichasDeCompra.obtener(contexto.empresaId, entrada.parteId))?.comprobantes.some(
          (c) => c.tipo === tipo.valor && c.activo,
        ) === true,
    );
  };
}

export type EntradaDeResolverPedido = Readonly<{
  pedidoId: string;
  decision: "APROBAR" | "RECHAZAR";
}>;
export type SalidaDeResolverPedido = Readonly<{ yaEstaba: boolean }>;

/**
 * Aprobar o rechazar un pedido de la ficha (E9 §3.2). Guard `proveedores.editar_ficha`. El pedido se bloquea: aprobar y rechazar el mismo pedido a la vez se
 * serializan (gana uno; el otro ve el pedido ya resuelto). Aprobar agrega el punto de venta o el comprobante a la ficha en la misma transacción. Repetición
 * (`YA_ESTABA`): resolver un pedido ya resuelto en el MISMO sentido no escribe ni audita; en el sentido contrario es `PEDIDO_YA_RESUELTO`.
 */
export function armarResolverPedido(dependencias: DependenciasDeCompras) {
  return async function resolverPedido(
    contexto: ContextoOperativo,
    entrada: EntradaDeResolverPedido,
  ): Promise<R<SalidaDeResolverPedido>> {
    const { empresaId } = contexto;
    if (entrada.decision !== "APROBAR" && entrada.decision !== "RECHAZAR") {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const estado = entrada.decision === "APROBAR" ? "APROBADO" : "RECHAZADO";
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeResolverPedido>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "proveedores.editar_ficha",
          ]);
          if (!permiso.ok) return permiso;
          if (contexto.personaId === null) return err("SIN_PERMISO");
          const pedido = await tx.fichasDeCompra.bloquearPedido(empresaId, entrada.pedidoId);
          if (pedido === null) return err("PEDIDO_NO_ENCONTRADO");
          if (pedido.estado !== "PENDIENTE") {
            return pedido.estado === estado ? ok({ yaEstaba: true }) : err("PEDIDO_YA_RESUELTO");
          }
          if (estado === "APROBADO") {
            await tx.fichasDeCompra.bloquear(empresaId, pedido.parteId);
            if (pedido.objeto === "PUNTO_DE_VENTA") {
              await tx.fichasDeCompra.activarPuntoDeVenta(
                empresaId,
                pedido.parteId,
                Number(pedido.valor),
              );
            } else {
              const tipo = tipoValido(pedido.valor);
              if (!tipo.ok) return tipo;
              await tx.fichasDeCompra.activarComprobante(empresaId, pedido.parteId, tipo.valor);
            }
          }
          await tx.fichasDeCompra.resolverPedido(
            empresaId,
            pedido.id,
            estado,
            contexto.personaId,
            contexto.ahora,
          );
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: estado === "APROBADO" ? "FICHA_PEDIDO_APROBADO" : "FICHA_PEDIDO_RECHAZADO",
            entidad: "pedido_de_ficha",
            entidadId: pedido.id,
            despues: { parteId: pedido.parteId, objeto: pedido.objeto, valor: pedido.valor },
          });
          return ok({ yaEstaba: false });
        },
      ),
    );
  };
}
