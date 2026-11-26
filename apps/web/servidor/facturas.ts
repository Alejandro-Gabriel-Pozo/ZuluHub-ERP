import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import {
  anularLaConciliacion,
  conciliacionesDeLaFactura,
  conciliarLaFactura,
  datosParaConciliar,
  fichaDeLaFactura,
  listarLasFacturas,
  registrarLaFactura,
  tomarElCostoDeLaFactura,
  type CostoTomadoParaLaPantalla,
  type DatosParaConciliarParaLaPantalla,
  type DependenciasDeFacturasWeb,
  type FacturaConciliadaParaLaPantalla,
  type FacturaRegistradaParaLaPantalla,
  type ListaDeFacturasParaLaPantalla,
} from "../../../src/composicion/facturas-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  SIN_ACCIONES_DE_LA_FACTURA,
  type AccionesDeLaFactura,
  type FichaDeFacturaParaLaPantalla,
  type SucursalConNombre,
} from "../ui/plantillas/compras/facturas/modelo-de-facturas";
import type { ResultadoDeLaFactura } from "../ui/plantillas/compras/facturas/resultado-de-factura";
import { rutaDeLaFactura } from "../ui/plantillas/compras/rutas-de-compras";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { permisosDeLaPersona, puedeLaAccion } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";
import { sucursalesParaElegir } from "./sucursal-elegida";

/**
 * «Facturas» (Compras 4, la factura de la empresa y su conciliación): las lecturas para las páginas y las acciones para los formularios. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (la empresa y
 * la persona salen de la SESIÓN, nunca del formulario ni de la dirección) y llaman a `src/composicion/facturas-web.ts`, donde se prueba todo lo demás. La factura NO tiene sucursal; lo que se concilia sí, y el
 * alcance de sucursales de quien pide lo aplica el servidor dentro de cada consulta y caso de uso. El permiso, la perilla del plan, la idempotencia y toda cuenta los decide el servidor dentro de su transacción.
 * Ninguna acción redirige (un `redirect` dentro de una acción pierde el host): devuelven el resultado y la pantalla navega.
 */

export type {
  CostoTomadoParaLaPantalla,
  DatosParaConciliarParaLaPantalla,
  FichaDeFacturaParaLaPantalla,
  FacturaConciliadaParaLaPantalla,
  FacturaRegistradaParaLaPantalla,
  ListaDeFacturasParaLaPantalla,
};

const dependencias: DependenciasDeFacturasWeb = {
  consultas: web.consultasDeCompras,
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

const NO_PERMITIDO = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/** Las facturas de la empresa; `parametros` es lo que trae la dirección (la consulta toma solo el cursor). */
export function cargarLasFacturas(
  contexto: ContextoOperativo,
  parametros: unknown,
): Promise<Respuesta<ListaDeFacturasParaLaPantalla>> {
  return listarLasFacturas(dependencias, contexto, parametros);
}

/**
 * El detalle de una factura de la empresa con sus conciliaciones; una que no existe, es de otra empresa o no es de recepción separada sale igual (el genérico). Las conciliaciones se leen SOLO si la persona puede
 * verlas (`conciliaciones.ver`): sin permiso no se piden y la lista va vacía (la consulta además lo rechazaría).
 */
export async function cargarLaFichaDeFactura(
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<FichaDeFacturaParaLaPantalla>> {
  const ficha = await fichaDeLaFactura(dependencias, contexto, comprobanteId);
  if (!ficha.ok) return ficha;
  if (!(await accionesDeLaFactura(contexto)).verConciliaciones) {
    return { ok: true, dato: { ...ficha.dato, conciliaciones: [] } };
  }
  const hechas = await conciliacionesDeLaFactura(dependencias, contexto, comprobanteId);
  if (!hechas.ok) return hechas;
  return { ok: true, dato: { ...ficha.dato, conciliaciones: hechas.dato } };
}

/**
 * Lo que necesita «Conciliar»: la propuesta y lo recibido de las sucursales del alcance de la persona. Sin permiso para conciliar la pantalla no se abre (el genérico): nace cerrada; el guard de la
 * acción vuelve a decidir.
 */
export async function cargarLosDatosParaConciliar(
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<DatosParaConciliarParaLaPantalla>> {
  if (!(await puedeLaAccion(contexto, "conciliaciones.conciliar"))) return NO_PERMITIDO;
  return datosParaConciliar(dependencias, contexto, comprobanteId);
}

/** Las sucursales que el alcance de la persona deja ver, con su nombre (para rotular lo recibido). Sin poder leerlas, ninguna: nunca se inventa un nombre. */
export async function cargarLasSucursalesConNombre(
  contexto: ContextoOperativo,
): Promise<readonly SucursalConNombre[]> {
  const lista = await sucursalesParaElegir(contexto);
  return lista.ok ? lista.dato.map((s) => ({ id: s.id, nombre: s.nombre })) : [];
}

/** Lo que la persona puede hacer con una factura: solo ayuda para ofrecer o esconder botones (cada acción vuelve a pasar por el guard dentro de su transacción). Sin permisos leídos, todo cerrado. */
export async function accionesDeLaFactura(
  contexto: ContextoOperativo,
): Promise<AccionesDeLaFactura> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return SIN_ACCIONES_DE_LA_FACTURA;
  const puede = (accion: ClaveAccion): boolean => permisos.acciones.includes(accion);
  return {
    cargar: puede("comprobantes_de_proveedor.registrar"),
    verConciliaciones: puede("conciliaciones.ver"),
    conciliar: puede("conciliaciones.conciliar"),
    anularConciliacion: puede("conciliaciones.anular"),
    tomarElCosto: puede("compras.corregir") && puede("stock.ajustar"),
    verNotas:
      puede("notas_de_credito_de_proveedor.ver") && puede("notas_de_debito_de_proveedor.ver"),
  };
}

/** Si la persona puede abrir «Cargar factura» (`comprobantes_de_proveedor.registrar`) y dar de alta un proveedor no hace falta acá: sin permiso la pantalla nace cerrada (el genérico). Ocultar no es autorizar. */
export async function cargarLoDeCargarFactura(
  contexto: ContextoOperativo,
): Promise<Respuesta<null>> {
  return (await puedeLaAccion(contexto, "comprobantes_de_proveedor.registrar"))
    ? { ok: true, dato: null }
    : NO_PERMITIDO;
}

/** «Cargar factura»: registra la factura de la empresa. La clave de idempotencia viaja en el pedido y la valida la composición. */
export function registrarLaFacturaDelFormulario(
  pedido: unknown,
): Promise<Respuesta<FacturaRegistradaParaLaPantalla>> {
  return conLaEmpresa((contexto) => registrarLaFactura(dependencias, contexto, pedido));
}

/** «Confirmar conciliación»: guarda el reparto. La clave de idempotencia viaja en el pedido; el alcance de cada sucursal y los topes los decide el servidor. */
export function conciliarLaFacturaDelFormulario(
  pedido: unknown,
): Promise<Respuesta<FacturaConciliadaParaLaPantalla>> {
  return conLaEmpresa((contexto) => conciliarLaFactura(dependencias, contexto, pedido));
}

/** Anular una conciliación; la factura y la conciliación las liga la página con `.bind`: ningún id viaja en el formulario. */
export async function anularLaConciliacionDeLaPantalla(
  comprobanteId: string,
  conciliacionId: string,
): Promise<ResultadoDeLaFactura> {
  const r = await conLaEmpresa((contexto) =>
    anularLaConciliacion(dependencias, contexto, { conciliacionId }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaFactura(comprobanteId) }
    : { estado: "ERROR", error: r.error };
}

/** «Tomar el costo de la factura»: la clave de idempotencia, la recepción y la línea viajan en el pedido; el precio lo lee el servidor de la factura conciliada y la sucursal y el permiso los decide él. */
export function tomarElCostoDelFormulario(
  pedido: unknown,
): Promise<Respuesta<CostoTomadoParaLaPantalla>> {
  return conLaEmpresa((contexto) => tomarElCostoDeLaFactura(dependencias, contexto, pedido));
}
