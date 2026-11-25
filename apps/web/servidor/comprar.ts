import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  buscarLosProductosParaComprar,
  cotizarLaCompra,
  cotizarLaFactura,
  leerElNivelParaComprar,
  registrarLaCompra,
  type CompraCotizadaParaLaPantalla,
  type FacturaCotizadaParaLaPantalla,
  type CompraRegistradaParaLaPantalla,
  type DependenciasDeComprarWeb,
  type DependenciasDeRegistrarCompraWeb,
  type ProductosParaComprarEnLaPantalla,
} from "../../../src/composicion/comprar-web";
import type { ResultadoDeGuardar } from "../../../src/composicion/directorio-web";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { altaRapidaDeProveedor, cargarLasPartes } from "./directorio";
import { cargarLosDepositos } from "./depositos-de-stock";
import { puedeLaAccion } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * «Nueva compra»: la lectura de los productos que se pueden comprar. Fina a propósito (ADR-015, punto 2): resuelve QUIÉN actúa (la empresa y la persona salen de la sesión, nunca del
 * pedido) y llama a `src/composicion/comprar-web.ts`. El permiso, qué se compra, el tope y el orden los decide el servidor dentro de su transacción; la pantalla no replica ninguna regla.
 */

const dependencias: DependenciasDeComprarWeb = {
  consultas: web.consultasDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los productos para comprar que coinciden con lo escrito (`texto`; vacío = todos hasta el tope). Se vuelve a validar en la composición. */
export function buscarProductosParaComprar(
  texto?: string,
): Promise<Respuesta<ProductosParaComprarEnLaPantalla>> {
  return conLaEmpresa((contexto) =>
    buscarLosProductosParaComprar(dependencias, contexto, texto === undefined ? {} : { texto }),
  );
}

/** Cuánto entra al stock y cuánto cuesta cada renglón de lo que se está cargando, antes de guardar. No escribe; se vuelve a validar en la composición. */
export function cotizarLaCompraDelFormulario(
  renglones: unknown,
): Promise<Respuesta<CompraCotizadaParaLaPantalla>> {
  return conLaEmpresa((contexto) => cotizarLaCompra(dependencias, contexto, { renglones }));
}

/** Las cuentas de la factura que se está cargando, antes de guardar: la misma función del dominio que el alta. No escribe; se vuelve a validar en la composición. */
export function cotizarLaFacturaDelFormulario(
  factura: unknown,
): Promise<Respuesta<FacturaCotizadaParaLaPantalla>> {
  return conLaEmpresa((contexto) => cotizarLaFactura(dependencias, contexto, factura));
}

const dependenciasDeRegistrar: DependenciasDeRegistrarCompraWeb = {
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/**
 * «Comprar y recibir»: registra la compra en la sucursal con la que trabaja la persona (la elegida en este dispositivo y validada contra su alcance; nunca la que diga el navegador; sin ninguna, el
 * genérico, nunca «todas»). La clave de idempotencia viaja en el pedido y la valida la composición. El permiso, el depósito y toda cuenta los decide el caso de uso dentro de su transacción.
 */
export function registrarLaCompraDelFormulario(
  pedido: unknown,
): Promise<Respuesta<CompraRegistradaParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return sucursal;
    if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
    return registrarLaCompra(dependenciasDeRegistrar, contexto, sucursal.dato.efectiva, pedido);
  });
}

/** Un proveedor de la lista de «Nueva compra»: solo el id y el nombre. */
export type ProveedorParaElegir = Readonly<{
  id: string;
  nombre: string;
  /** Si ya tiene su CUIT: sin él, la primera factura lo pide en la misma pantalla (y queda guardado en su ficha). */
  tieneCuit: boolean;
}>;

export type {
  CompraCotizadaParaLaPantalla,
  FacturaCotizadaParaLaPantalla,
  CompraRegistradaParaLaPantalla,
  ProductosParaComprarEnLaPantalla,
  ResultadoDeGuardar,
};

/** Los proveedores activos que coinciden con lo escrito (la primera página del directorio, con su rol y su permiso). Se vuelve a validar en la composición del directorio. */
export async function buscarProveedoresParaComprar(
  texto: string,
): Promise<Respuesta<readonly ProveedorParaElegir[]>> {
  const r = await cargarLasPartes({ texto, rol: "proveedor" });
  if (!r.ok) return r;
  return {
    ok: true,
    dato: r.dato.partes
      .filter((p) => p.activa)
      .map((p) => ({ id: p.id, nombre: p.nombre, tieneCuit: p.documento?.tipo === "CUIT" })),
  };
}

/** El alta rápida de un proveedor (el mismo alta del directorio): ver `altaRapidaDeProveedor`. */
export function agregarUnProveedorParaComprar(
  clave: string,
  naturaleza: string,
  nombre: string,
  guardarIgual: boolean,
): Promise<Respuesta<ResultadoDeGuardar>> {
  return altaRapidaDeProveedor(clave, naturaleza, nombre, guardarIgual);
}

/** Lo que la página de «Nueva compra» necesita saber antes de dibujar. */
export type LoDeNuevaCompra = Readonly<{
  /** Los depósitos de uso normal y activos de la sucursal, SOLO si hay más de uno (con uno, la compra lo toma sola; con ninguno o sin poder leerlos, no se ofrece elegir). */
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  puedeAgregarProveedor: boolean;
  /** La empresa compra «Con factura»: la pantalla dibuja el bloque de la factura. Lo dice el servidor (`nivelParaComprar`); la pantalla no lo decide. */
  conFactura: boolean;
}>;

/**
 * Lo de «Nueva compra» que se lee al abrir: si la persona puede registrar una compra (sin permiso, el genérico: la pantalla nace cerrada), si puede dar de alta un proveedor (solo ayuda para ofrecer o
 * esconder el botón: el alta vuelve a pedir el permiso) y los depósitos entre los que hay que elegir. Ocultar no es autorizar: «Comprar y recibir» vuelve a pasar por el guard dentro de su transacción.
 */
export async function cargarLoDeNuevaCompra(
  contexto: ContextoOperativo,
): Promise<Respuesta<LoDeNuevaCompra>> {
  if (!(await puedeLaAccion(contexto, "recepciones.registrar"))) return SIN_SUCURSAL;
  const nivel = await leerElNivelParaComprar(dependencias, contexto);
  if (!nivel.ok) return nivel;
  const puedeAgregarProveedor = await puedeLaAccion(contexto, "partes.crear");
  const lista = await cargarLosDepositos(contexto);
  const normales = lista.ok
    ? lista.dato.depositos
        .filter((d) => d.activo && d.uso === "NORMAL")
        .map((d) => ({ id: d.id, nombre: d.nombre }))
    : [];
  return {
    ok: true,
    dato: {
      depositos: normales.length > 1 ? normales : [],
      puedeAgregarProveedor,
      conFactura: nivel.dato.conFactura,
    },
  };
}

/**
 * Lo que «Recibir» (recepción separada) necesita saber antes de dibujar: si la persona puede registrar (sin permiso, el genérico: la pantalla nace cerrada) y si puede dar de alta un proveedor (solo ayuda para
 * ofrecer o esconder el botón: el alta vuelve a pedir el permiso). No hay depósito que elegir (se elige al confirmar), ni nivel ni factura. Ocultar no es autorizar: «Recibir» vuelve a pasar por el guard.
 */
export async function cargarLoDeRecibir(
  contexto: ContextoOperativo,
): Promise<Respuesta<Readonly<{ puedeAgregarProveedor: boolean }>>> {
  if (!(await puedeLaAccion(contexto, "recepciones.registrar"))) return SIN_SUCURSAL;
  return {
    ok: true,
    dato: { puedeAgregarProveedor: await puedeLaAccion(contexto, "partes.crear") },
  };
}
