/**
 * Filtros de la lista de empresas, tal como viajan en la dirección (`/empresas?estado=…`). Puro: sin Next ni
 * React. Lo inválido se descarta en silencio: la dirección la puede escribir cualquiera.
 */

export const ESTADOS_EFECTIVOS = [
  "OPERA",
  "EMPRESA_EN_ALTA",
  "EMPRESA_SUSPENDIDA",
  "EMPRESA_CANCELADA",
  "EMPRESA_EN_BAJA",
  "TENANT_SUSPENDIDO",
] as const;

export type EstadoEfectivo = (typeof ESTADOS_EFECTIVOS)[number];

export type FiltrosDeEmpresas = Readonly<{
  estadoEfectivo?: EstadoEfectivo;
  marcaId?: string;
  planId?: string;
  buscar?: string;
  despuesDeId?: string;
}>;

const LARGO_MAXIMO_DE_BUSQUEDA = 200;
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Consulta = Record<string, string | string[] | undefined>;

function primerValor(consulta: Consulta, nombre: string): string | undefined {
  if (!Object.hasOwn(consulta, nombre)) return undefined;
  const valor = consulta[nombre];
  const primero = Array.isArray(valor) ? valor[0] : valor;
  return typeof primero === "string" ? primero : undefined;
}

const esEstado = (valor: string): valor is EstadoEfectivo =>
  (ESTADOS_EFECTIVOS as readonly string[]).includes(valor);

/** Lee los filtros de la dirección: primer valor de cada parámetro, lo inválido se descarta. Nunca lanza. */
export function filtrosDeLaDireccion(consulta: Consulta): FiltrosDeEmpresas {
  const estado = primerValor(consulta, "estado");
  const submarca = primerValor(consulta, "submarca");
  const plan = primerValor(consulta, "plan");
  const buscar = primerValor(consulta, "buscar")?.trim().slice(0, LARGO_MAXIMO_DE_BUSQUEDA).trim();
  const despues = primerValor(consulta, "despues");
  return {
    ...(estado !== undefined && esEstado(estado) ? { estadoEfectivo: estado } : {}),
    ...(submarca !== undefined && FORMA_DE_UUID.test(submarca) ? { marcaId: submarca } : {}),
    ...(plan !== undefined && FORMA_DE_UUID.test(plan) ? { planId: plan } : {}),
    ...(buscar !== undefined && buscar !== "" ? { buscar } : {}),
    ...(despues !== undefined && FORMA_DE_UUID.test(despues) ? { despuesDeId: despues } : {}),
  };
}

/** Arma `/empresas?…` con el orden fijo estado, submarca, plan, buscar, despues; omite lo vacío. */
export function direccionDeEmpresas(filtros: FiltrosDeEmpresas): string {
  const parametros = new URLSearchParams();
  if (filtros.estadoEfectivo) parametros.set("estado", filtros.estadoEfectivo);
  if (filtros.marcaId) parametros.set("submarca", filtros.marcaId);
  if (filtros.planId) parametros.set("plan", filtros.planId);
  if (filtros.buscar) parametros.set("buscar", filtros.buscar);
  if (filtros.despuesDeId) parametros.set("despues", filtros.despuesDeId);
  const texto = parametros.toString();
  return texto === "" ? "/empresas" : `/empresas?${texto}`;
}

type Tono = "exito" | "aviso" | "peligro" | "info";

/** El color nunca va solo: la pantalla siempre muestra también este texto (y un ícono). */
export const ROTULO_DE_ESTADO: Readonly<Record<EstadoEfectivo, { texto: string; tono: Tono }>> = {
  OPERA: { texto: "Activa", tono: "exito" },
  EMPRESA_EN_ALTA: { texto: "En alta", tono: "aviso" },
  EMPRESA_SUSPENDIDA: { texto: "Suspendida", tono: "peligro" },
  TENANT_SUSPENDIDO: { texto: "Cliente suspendido", tono: "peligro" },
  EMPRESA_CANCELADA: { texto: "Cancelada", tono: "info" },
  EMPRESA_EN_BAJA: { texto: "En baja", tono: "info" },
};

export function rotuloDeEstado(estado: string): { texto: string; tono: Tono } {
  return esEstado(estado)
    ? ROTULO_DE_ESTADO[estado]
    : { texto: "Estado desconocido", tono: "info" };
}
