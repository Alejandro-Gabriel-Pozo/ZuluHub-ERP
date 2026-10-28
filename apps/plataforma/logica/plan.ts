/**
 * Textos de la pantalla «Plan de una empresa». Puro: sin Next ni React. Nada lanza: lo que no se conoce
 * vuelve tal cual (clave) o como raya, y las pruebas exigen rótulo propio para cada perilla y módulo reales.
 */

const ROTULO_DE_PERILLA: Readonly<Record<string, string>> = {
  empresas_por_tenant: "Empresas por cliente",
  recetas_con_merma: "Recetas con merma",
  sub_recetas: "Sub-recetas",
  variantes_y_grupos_de_precio: "Variantes y grupos de precio",
  combos: "Combos",
  elecciones_reutilizables: "Elecciones reutilizables",
  recetas_por_tamano: "Recetas por tamaño",
  composiciones_con_perdida: "Composiciones con pérdida",
  subcomposiciones: "Subcomposiciones",
  conjuntos: "Conjuntos",
  composiciones_por_tamano: "Composiciones por tamaño",
};

const ROTULO_DE_MODULO: Readonly<Record<string, string>> = {
  administracion: "Administración",
  facturacion: "Facturación",
  catalogo: "Catálogo",
  carta: "Carta",
  stock: "Stock",
  vidriera: "Vidriera",
};

const buscar = (tabla: Readonly<Record<string, string>>, clave: string): string =>
  Object.hasOwn(tabla, clave) ? (tabla[clave] ?? clave) : clave;

/** Nombre en castellano de una perilla; una clave desconocida vuelve igual. */
export function rotuloDePerilla(clave: string): string {
  return buscar(ROTULO_DE_PERILLA, clave);
}

/** Nombre en castellano de un módulo; una clave desconocida vuelve igual. */
export function rotuloDeModulo(clave: string): string {
  return buscar(ROTULO_DE_MODULO, clave);
}

const SIN_DATO = "—";

/** «Sí»/«No» para un interruptor; el límite con punto de miles, o «Sin límite». */
export function textoDeValor(
  valor:
    { tipo: "INTERRUPTOR"; encendida: boolean } | { tipo: "LIMITE"; limite: number | "ILIMITADO" },
): string {
  const v = valor as unknown;
  if (typeof v !== "object" || v === null) return SIN_DATO;
  const { tipo, encendida, limite } = v as Record<string, unknown>;
  if (tipo === "INTERRUPTOR" && typeof encendida === "boolean") return encendida ? "Sí" : "No";
  if (tipo === "LIMITE") {
    if (limite === "ILIMITADO") return "Sin límite";
    if (typeof limite === "number" && Number.isInteger(limite) && limite >= 0) {
      return String(limite).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
  }
  return SIN_DATO;
}

const ROTULO_DE_ORIGEN: Readonly<Record<string, string>> = {
  BASE: "Valor base",
  PLAN: "Del plan",
  AJUSTE: "Ajuste manual",
};

export function rotuloDeOrigen(origen: string): string {
  return Object.hasOwn(ROTULO_DE_ORIGEN, origen)
    ? (ROTULO_DE_ORIGEN[origen] ?? SIN_DATO)
    : SIN_DATO;
}

type EstadoRotulado = { texto: string; tono: "exito" | "aviso" | "info" };

const ROTULO_DE_ESTADO: Readonly<Record<string, EstadoRotulado>> = {
  ACTIVO: { texto: "Activo", tono: "exito" },
  SOLO_LECTURA: { texto: "Solo lectura", tono: "aviso" },
  NO_ACTIVO: { texto: "No activo", tono: "info" },
};

export function rotuloDeEstadoDeModulo(estado: string): EstadoRotulado {
  if (!Object.hasOwn(ROTULO_DE_ESTADO, estado)) return { texto: SIN_DATO, tono: "info" };
  const r = ROTULO_DE_ESTADO[estado];
  return r === undefined ? { texto: SIN_DATO, tono: "info" } : { ...r };
}
