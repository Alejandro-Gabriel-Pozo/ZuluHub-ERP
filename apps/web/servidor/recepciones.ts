import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import {
  anularLaRecepcion,
  confirmarLaRecepcion,
  corregirLoRecibidoDeLaRecepcion,
  fichaDeLaRecepcion,
  listarLasRecepciones,
  registrarLaRecepcion,
  type DependenciasDeRecepcionesWeb,
  type FichaDeRecepcionParaLaPantalla,
  type ListaDeRecepcionesParaLaPantalla,
  type LoRecibidoCorregidoParaLaPantalla,
  type RecepcionRegistradaParaLaPantalla,
} from "../../../src/composicion/recepciones-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  SIN_ACCIONES_DE_LA_RECEPCION,
  type AccionesDeLaRecepcion,
} from "../ui/plantillas/compras/recepciones/modelo-de-recepciones";
import type { ResultadoDeLaRecepcion } from "../ui/plantillas/compras/recepciones/resultado-de-recepcion";
import { rutaDeLaRecepcion } from "../ui/plantillas/compras/rutas-de-compras";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { cargarLosDepositos } from "./depositos-de-stock";
import { permisosDeLaPersona, puedeLaAccion } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * «Recepciones» (Compras 4, recepción separada): las lecturas para las páginas y las acciones para los formularios. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (la empresa y la persona salen de
 * la SESIÓN, nunca del formulario ni de la dirección) y DÓNDE (la sucursal elegida en este dispositivo y validada contra las que la persona puede elegir; nunca la que diga el navegador; sin ninguna, el genérico,
 * nunca «todas»); y llaman a `src/composicion/recepciones-web.ts`, donde se prueba todo lo demás. El permiso, el alcance, la perilla del plan, la idempotencia y toda cuenta los decide el servidor dentro de su
 * transacción. Ninguna acción redirige (un `redirect` dentro de una acción pierde el host): devuelven el resultado y la pantalla navega.
 */

export { CAUSAS_DE_CORRECCION } from "../../../src/composicion/recepciones-web";
export type {
  FichaDeRecepcionParaLaPantalla,
  ListaDeRecepcionesParaLaPantalla,
  LoRecibidoCorregidoParaLaPantalla,
  RecepcionRegistradaParaLaPantalla,
};

const dependencias: DependenciasDeRecepcionesWeb = {
  consultas: web.consultasDeCompras,
  casosDeUso: web.casosDeUsoDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/** Las recepciones de la sucursal con la que trabaja la persona; `parametros` es lo que trae la dirección (la consulta toma solo el cursor). */
export async function cargarLasRecepciones(
  contexto: ContextoOperativo,
  parametros: unknown,
): Promise<Respuesta<ListaDeRecepcionesParaLaPantalla>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
  return listarLasRecepciones(dependencias, contexto, sucursal.dato.efectiva, parametros);
}

/** El detalle de una recepción de la sucursal con la que trabaja la persona; una de otra sucursal es indistinguible de una que no existe. */
export async function cargarLaFichaDeRecepcion(
  contexto: ContextoOperativo,
  recepcionId: string,
): Promise<Respuesta<FichaDeRecepcionParaLaPantalla>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
  return fichaDeLaRecepcion(dependencias, contexto, sucursal.dato.efectiva, recepcionId);
}

/** Lo que la persona puede hacer con una recepción: solo ayuda para ofrecer o esconder botones (cada acción vuelve a pasar por el guard dentro de su transacción). Sin permisos leídos, todo cerrado. */
export async function accionesDeLaRecepcion(
  contexto: ContextoOperativo,
): Promise<AccionesDeLaRecepcion> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return SIN_ACCIONES_DE_LA_RECEPCION;
  const puede = (accion: ClaveAccion): boolean => permisos.acciones.includes(accion);
  return {
    registrar: puede("recepciones.registrar"),
    confirmar: puede("recepciones.confirmar"),
    anular: puede("recepciones.anular"),
    corregir: puede("compras.corregir"),
  };
}

/** Si la persona puede abrir «Recibir» (`recepciones.registrar`): sin permiso la pantalla nace cerrada (el genérico). Ocultar no es autorizar: «Recibir» vuelve a pasar por el guard. */
export async function puedeRecibir(contexto: ContextoOperativo): Promise<boolean> {
  return puedeLaAccion(contexto, "recepciones.registrar");
}

/** Los depósitos de uso normal y activos de la sucursal, SOLO si hay más de uno (con uno, la confirmación lo toma sola; con ninguno o sin poder leerlos, no se ofrece elegir). */
export async function cargarLosDepositosParaConfirmar(
  contexto: ContextoOperativo,
): Promise<readonly Readonly<{ id: string; nombre: string }>[]> {
  const lista = await cargarLosDepositos(contexto);
  const normales = lista.ok
    ? lista.dato.depositos
        .filter((d) => d.activo && d.uso === "NORMAL")
        .map((d) => ({ id: d.id, nombre: d.nombre }))
    : [];
  return normales.length > 1 ? normales : [];
}

/**
 * «Recibir»: registra la recepción en la sucursal con la que trabaja la persona. La clave de idempotencia viaja en el pedido y la valida la composición. SIN precio: la frontera lo rechaza. El permiso, la
 * perilla del plan y toda cuenta los decide el caso de uso dentro de su transacción.
 */
export function registrarLaRecepcionDelFormulario(
  pedido: unknown,
): Promise<Respuesta<RecepcionRegistradaParaLaPantalla>> {
  return conLaEmpresa(async (contexto) => {
    const sucursal = await sucursalDelPedido(contexto);
    if (!sucursal.ok) return sucursal;
    if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
    return registrarLaRecepcion(dependencias, contexto, sucursal.dato.efectiva, pedido);
  });
}

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/** Confirmar la recepción: el depósito (si había que elegir) sale del formulario; la recepción la liga la página con `.bind` (no viaja en un campo). Repetir es seguro en el servidor. */
export async function confirmarLaRecepcionDeLaPantalla(
  recepcionId: string,
  datos: FormData,
): Promise<ResultadoDeLaRecepcion> {
  const deposito = textoDe(datos, "depositoId");
  const r = await conLaEmpresa((contexto) =>
    confirmarLaRecepcion(dependencias, contexto, {
      recepcionId,
      ...(deposito === "" ? {} : { depositoId: deposito }),
    }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaRecepcion(recepcionId) }
    : { estado: "ERROR", error: r.error };
}

/** Anular una recepción «Por confirmar» con el motivo del formulario; la recepción la liga la página con `.bind`. */
export async function anularLaRecepcionDeLaPantalla(
  recepcionId: string,
  datos: FormData,
): Promise<ResultadoDeLaRecepcion> {
  const r = await conLaEmpresa((contexto) =>
    anularLaRecepcion(dependencias, contexto, { recepcionId, motivo: textoDe(datos, "motivo") }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaRecepcion(recepcionId) }
    : { estado: "ERROR", error: r.error };
}

/**
 * «Corregir lo recibido»: el pedido (con la clave del intento, la recepción, la línea, lo que se vio, la cantidad, la causa y la nota) lo valida la composición con su lista de permitidos. La empresa y la persona salen
 * de la sesión. El permiso, el alcance de la sucursal de la recepción, la idempotencia y toda cuenta los decide el caso de uso dentro de su transacción.
 */
export function corregirLoRecibidoDelFormulario(
  pedido: unknown,
): Promise<Respuesta<LoRecibidoCorregidoParaLaPantalla>> {
  return conLaEmpresa((contexto) =>
    corregirLoRecibidoDeLaRecepcion(dependencias, contexto, pedido),
  );
}
