import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  PUNTO_DE_VENTA_MAXIMO,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
} from "../modulos/compras/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeComprobante,
  entradaDeProveedor,
  entradaDePuntoDeVenta,
  entradaDeResolverPedido,
} from "./entradas-de-ficha-de-proveedor";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * La ficha del proveedor de compras para la pantalla (Compras PR 4; maqueta `compra.html`, estados `proveedor` y `facturas-prov`): verla (4a, SOLO LECTURA) y editarla o pedir cambios (4b).
 *  - **Mirar no escribe**: una ficha que todavía no nació (nadie compró ni pidió nada de este proveedor) se ve vacía y NO se crea.
 *  - **El proveedor se busca en la empresa de la sesión** y tiene que ser una parte con el rol `PROVEEDOR`; una parte de otra empresa, inexistente o que no es proveedor es el mismo error.
 *  - **Quién puede qué lo decide el servidor** dentro de cada caso de uso: editar es `proveedores.editar_ficha` (gerente y administrador); pedir, `proveedores.pedir_ficha` (los tres roles). La pantalla solo
 *    ofrece o esconde botones (`acciones-de-la-ficha-del-proveedor.ts`).
 *  - **Repetir es seguro**: agregar o dejar de usar algo que ya está así no escribe ni audita (`YA_ESTABA`); pedir lo mismo dos veces es un pedido; resolver dos veces el mismo pedido en el mismo sentido no escribe.
 *  - Dinero como texto decimal con moneda ARS; instantes en ISO UTC; los ids de persona no salen.
 */

export type DependenciasDeFichaDeProveedorWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeCompras"]>,
    "fichaDelProveedorParaCompras" | "comprobantesDelProveedor"
  >;
  consultasDeClientes: () => Pick<ReturnType<Web["consultasDeClientes"]>, "fichaDeParte">;
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCompras"]>,
    | "agregarPuntoDeVenta"
    | "dejarDeUsarPuntoDeVenta"
    | "agregarComprobante"
    | "dejarDeUsarComprobante"
    | "pedirPuntoDeVenta"
    | "pedirComprobante"
    | "resolverPedido"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

const MONEDA = "ARS";

type Importe = Readonly<{ moneda: string; monto: string }>;

export type FichaDelProveedorParaLaPantalla = Readonly<{
  parteId: string;
  /** El nombre para mostrar (razón social, o apellido y nombre); `null` si no hay. */
  nombre: string | null;
  documento: Readonly<{ tipo: string; numero: string }> | null;
  /** La condición frente al IVA del directorio (`RESPONSABLE_INSCRIPTO`…); `null` si no la tiene. */
  condicionIva: string | null;
  /** La letra esperada congelada al crearse la ficha; `null` = se elige a mano. */
  letraEsperada: "A" | "B" | "C" | null;
  puntosDeVenta: readonly number[];
  comprobantes: readonly string[];
  pedidosPendientes: readonly Readonly<{
    id: string;
    objeto: "PUNTO_DE_VENTA" | "COMPROBANTE";
    valor: string;
    pedidoEn: string;
  }>[];
  queLeCompramos: readonly Readonly<{
    productoNombre: string | null;
    precioPor: string;
    unidadDePrecioId: string | null;
    ultimoPrecio: Importe;
    ultimaCompraEn: string;
  }>[];
  facturas: readonly Readonly<{
    clase: string;
    tipo: string | null;
    puntoDeVenta: number | null;
    numero: number | null;
    fecha: string | null;
    total: Importe;
    anulado: boolean;
  }>[];
  /** Los nueve tipos de comprobante que se pueden tener en la ficha (del dominio de compras). */
  tiposDeComprobante: readonly string[];
  /** El mayor número de punto de venta (del dominio de compras): la pantalla arma con él el largo del campo. */
  puntoDeVentaMaximo: number;
}>;

/** La ficha de un proveedor de la empresa de la sesión. Es una LECTURA: no escribe ni audita. */
export function verLaFichaDelProveedor(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  parteId: string,
): Promise<Respuesta<FichaDelProveedorParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { parteId },
    entradaDeProveedor,
    async (entrada) => {
      const parte = await d
        .consultasDeClientes()
        .fichaDeParte(contexto, { parteId: entrada.parteId });
      if (!parte.ok) return parte;
      if (parte.valor === null || !parte.valor.roles.includes("PROVEEDOR")) {
        return err("PROVEEDOR_NO_ENCONTRADO");
      }
      const ficha = await d.consultas().fichaDelProveedorParaCompras(contexto, {
        parteId: entrada.parteId,
      });
      if (!ficha.ok) return ficha;
      const facturas = await d.consultas().comprobantesDelProveedor(contexto, {
        parteId: entrada.parteId,
      });
      if (!facturas.ok) return facturas;
      return ok({ parte: parte.valor, ficha: ficha.valor, facturas: facturas.valor });
    },
    ({ parte, ficha, facturas }) => ({
      parteId: ficha.parteId,
      nombre:
        [parte.apellido, parte.nombre]
          .filter((x): x is string => x !== null && x !== "")
          .join(" ") || null,
      documento:
        parte.documento === null
          ? null
          : { tipo: parte.documento.tipo, numero: parte.documento.numero },
      condicionIva: parte.condicionIva,
      letraEsperada: ficha.letraEsperada,
      puntosDeVenta: ficha.puntosDeVenta.filter((p) => p.activo).map((p) => p.numero),
      comprobantes: ficha.comprobantes.filter((c) => c.activo).map((c) => c.tipo),
      pedidosPendientes: ficha.pedidosPendientes.map((p) => ({
        id: p.id,
        objeto: p.objeto === "PUNTO_DE_VENTA" ? "PUNTO_DE_VENTA" : "COMPROBANTE",
        valor: p.valor,
        pedidoEn: p.pedidoEn,
      })),
      queLeCompramos: ficha.queLeCompramos.map((o) => ({
        productoNombre: o.productoNombre,
        precioPor: o.precioPor,
        unidadDePrecioId: o.unidadDePrecioId,
        ultimoPrecio: { moneda: MONEDA, monto: o.ultimoPrecio },
        ultimaCompraEn: o.ultimaCompraEn,
      })),
      facturas: facturas.map((f) => ({
        clase: f.clase,
        tipo: f.tipo,
        puntoDeVenta: f.puntoDeVenta,
        numero: f.numero,
        fecha: f.fecha,
        total: { moneda: MONEDA, monto: f.totalSegunFactura },
        anulado: f.estado === "ANULADO",
      })),
      tiposDeComprobante: TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
      puntoDeVentaMaximo: PUNTO_DE_VENTA_MAXIMO,
    }),
  );
}

type Hecho = Readonly<{ yaEstaba: boolean }>;
const aHecho = (r: Readonly<{ yaEstaba: boolean }>): Hecho => ({ yaEstaba: r.yaEstaba });

/** Agregar un punto de venta a la ficha (solo `proveedores.editar_ficha`). */
export function agregarUnPuntoDeVenta(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDePuntoDeVenta,
    (e) => d.casosDeUso().agregarPuntoDeVenta(contexto, e),
    aHecho,
  );
}

/** Dejar de usar un punto de venta de la ficha (solo `proveedores.editar_ficha`). */
export function dejarDeUsarUnPuntoDeVenta(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDePuntoDeVenta,
    (e) => d.casosDeUso().dejarDeUsarPuntoDeVenta(contexto, e),
    aHecho,
  );
}

/** Agregar un comprobante que emite el proveedor (solo `proveedores.editar_ficha`). */
export function agregarUnComprobante(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeComprobante,
    (e) => d.casosDeUso().agregarComprobante(contexto, e),
    aHecho,
  );
}

/** Dejar de usar un comprobante de la ficha (solo `proveedores.editar_ficha`). */
export function dejarDeUsarUnComprobante(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeComprobante,
    (e) => d.casosDeUso().dejarDeUsarComprobante(contexto, e),
    aHecho,
  );
}

/** Pedir un punto de venta (`proveedores.pedir_ficha`, los tres roles): queda un pedido pendiente y la factura no puede usarlo hasta que se apruebe. */
export function pedirUnPuntoDeVenta(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDePuntoDeVenta,
    (e) => d.casosDeUso().pedirPuntoDeVenta(contexto, e),
    aHecho,
  );
}

/** Pedir un comprobante: igual que el punto de venta. */
export function pedirUnComprobante(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeComprobante,
    (e) => d.casosDeUso().pedirComprobante(contexto, e),
    aHecho,
  );
}

/** Aprobar o rechazar un pedido pendiente (solo `proveedores.editar_ficha`). Dos resoluciones a la vez del mismo pedido: gana una; la otra, en sentido contrario, es el genérico. */
export function resolverUnPedido(
  d: DependenciasDeFichaDeProveedorWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeResolverPedido,
    (e) => d.casosDeUso().resolverPedido(contexto, e),
    aHecho,
  );
}
