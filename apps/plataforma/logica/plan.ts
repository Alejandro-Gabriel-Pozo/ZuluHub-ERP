/**
 * Textos de la pantalla «Plan de una empresa». Puro: sin Next ni React. Nada lanza: lo que no se conoce
 * vuelve tal cual (clave) o como raya, y las pruebas exigen rótulo propio para cada perilla y módulo reales.
 */

/** Las claves con rótulo propio: una prueba exige que todas existan en los catálogos reales. */
export const ROTULO_DE_PERILLA: Readonly<Record<string, string>> = {
  empresas_por_tenant: "Empresas por cliente",
  composiciones_con_perdida: "Composiciones con pérdida",
  subcomposiciones: "Subcomposiciones",
  conjuntos: "Conjuntos",
  composiciones_por_tamano: "Composiciones por tamaño",
  // Decisión 175 (09/11/2026, textos delegados: lo más corto) + clave de la perilla (decisión 124).
  cajas_por_sucursal: "Cajas por sucursal",
};

export const ROTULO_DE_MODULO: Readonly<Record<string, string>> = {
  administracion: "Administración",
  facturacion: "Facturación",
  catalogo: "Catálogo",
  stock: "Stock",
  vidriera: "Vidriera",
  // Fuente de los tres rótulos: decisión 175 del dueño (09/11/2026, textos delegados: reutilizar lo aprobado, lo más corto).
  // `caja`: nombre del módulo en los prototipos aprobados caja.html y medios.html. `ventas`: palabra del módulo y de las
  // pantallas de venta aprobadas. `cierre`: nombre aprobado en las decisiones 158 y 163 y en la pantalla «Cierre del día».
  caja: "Caja",
  cierre: "Cierre del día",
  ventas: "Ventas",
  // Fuente de los dos rótulos (DEC-0314): los nombres de los módulos en `e9-compras-especificacion.md` §3.0 y en `clientes-y-proveedores.md` («Clientes y
  // proveedores», el directorio) y `compras.md` («Compras»); decisión 175 (textos delegados: lo más corto).
  clientes: "Clientes y proveedores",
  compras: "Compras",
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

/** Lo que se dice cuando un dato no se pudo leer (no se omite la línea ni se inventa un valor). */
const DATO_NO_DISPONIBLE = "dato no disponible";

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

/** «Empresas del cliente: 2 de 3.»; lo que no se pudo leer se dice, no se omite. */
export function textoDeEmpresasDelCliente(
  datos: { enUso: number; limite: number | "ILIMITADO" | null } | null,
): string {
  if (datos === null) return `Empresas del cliente: ${DATO_NO_DISPONIBLE}.`;
  if (datos.limite === null) {
    return `Empresas del cliente: ${String(datos.enUso)} en uso; el tope es ${DATO_NO_DISPONIBLE}.`;
  }
  const tope = datos.limite === "ILIMITADO" ? "sin límite" : String(datos.limite);
  return `Empresas del cliente: ${String(datos.enUso)} en uso, tope ${tope}.`;
}
