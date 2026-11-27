import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import {
  anularLaNota,
  notasDeLaFactura,
  registrarLaNota,
  type ClaseDeNotaWeb,
  type DependenciasDeNotasWeb,
  type NotaRegistradaParaLaPantalla,
} from "../../../src/composicion/notas-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  SIN_ACCIONES_DE_LAS_NOTAS,
  type AccionesDeLasNotas,
  type NotasParaLaPantalla,
} from "../ui/plantillas/compras/notas/modelo-de-notas";
import type { ResultadoDeAnularPago } from "../ui/plantillas/compras/pago/resultado-de-pago";
import { rutaDeLasNotas } from "../ui/plantillas/compras/rutas-de-compras";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { permisosDeLaPersona } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";

/**
 * Las notas del proveedor (NOTAS-2c-1): las lecturas para las páginas y las acciones para los formularios. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (la empresa y la persona salen de la SESIÓN, nunca del
 * formulario ni de la dirección) y llaman a `src/composicion/notas-web.ts`, donde se prueba todo lo demás. El proveedor de la nota es el de la factura que corrige (lo lee el servidor). El permiso, el alcance, el tope de lo
 * acreditable y la idempotencia los decide el servidor dentro de su transacción. Ninguna acción redirige (un `redirect` dentro de una acción pierde el host): devuelven el resultado y la pantalla navega.
 */

export type { NotaRegistradaParaLaPantalla, NotasParaLaPantalla };

const dependencias: DependenciasDeNotasWeb = {
  consultas: web.consultasDeCompras,
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

const NO_PERMITIDO = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/** Lo que la persona puede hacer con las notas: solo ayuda para ofrecer o esconder botones (cada acción vuelve a pasar por el guard dentro de su transacción). Sin permisos leídos, todo cerrado. */
export async function accionesDeLasNotas(contexto: ContextoOperativo): Promise<AccionesDeLasNotas> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return SIN_ACCIONES_DE_LAS_NOTAS;
  const puede = (accion: ClaveAccion): boolean => permisos.acciones.includes(accion);
  return {
    registrarCredito: puede("notas_de_credito_de_proveedor.registrar"),
    registrarDebito: puede("notas_de_debito_de_proveedor.registrar"),
    anularCredito: puede("notas_de_credito_de_proveedor.anular"),
    anularDebito: puede("notas_de_debito_de_proveedor.anular"),
  };
}

/** Si la persona puede ver las notas (las dos acciones de ver: la lectura las pide): sin permiso el enlace no se ofrece. */
export async function puedeVerLasNotas(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return false;
  return (
    permisos.acciones.includes("notas_de_credito_de_proveedor.ver") &&
    permisos.acciones.includes("notas_de_debito_de_proveedor.ver")
  );
}

/** Las notas de una factura de la empresa con lo que se acredita, lo que se debita y el neto a pagar; una factura que no existe o es de otra empresa sale igual (el genérico). */
export function cargarLasNotasDeLaFactura(
  contexto: ContextoOperativo,
  facturaId: string,
): Promise<Respuesta<NotasParaLaPantalla>> {
  return notasDeLaFactura(dependencias, contexto, facturaId);
}

/**
 * Lo que necesita «Cargar una nota del proveedor»: la lectura de la factura (para el tope de lo acreditable) y nada más. Sin permiso para registrar la nota de esa clase la pantalla no se abre (el genérico): nace
 * cerrada; el guard de la acción vuelve a decidir.
 */
export async function cargarLoDeCargarUnaNota(
  contexto: ContextoOperativo,
  clase: ClaseDeNotaWeb,
  facturaId: string,
): Promise<Respuesta<NotasParaLaPantalla>> {
  const acciones = await accionesDeLasNotas(contexto);
  if (!(clase === "CREDITO" ? acciones.registrarCredito : acciones.registrarDebito)) {
    return NO_PERMITIDO;
  }
  return notasDeLaFactura(dependencias, contexto, facturaId);
}

/** «Guardar» la nota: la clave de idempotencia, la factura y la nota viajan en el pedido; el proveedor, la empresa y la persona los decide el servidor. */
export function registrarLaNotaDelFormulario(
  clase: ClaseDeNotaWeb,
  pedido: unknown,
): Promise<Respuesta<NotaRegistradaParaLaPantalla>> {
  return conLaEmpresa((contexto) => registrarLaNota(dependencias, contexto, clase, pedido));
}

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/** Anular una nota con el motivo del formulario; la factura, la nota y su clase las liga la página con `.bind`: ningún id viaja en el formulario. */
export async function anularLaNotaDeLaPantalla(
  facturaId: string,
  notaId: string,
  clase: ClaseDeNotaWeb,
  datos: FormData,
): Promise<ResultadoDeAnularPago> {
  const r = await conLaEmpresa((contexto) =>
    anularLaNota(dependencias, contexto, clase, { notaId, motivo: textoDe(datos, "motivo") }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLasNotas(facturaId) }
    : { estado: "ERROR", error: r.error };
}
