import {
  leerDireccionPegada,
  type PartesDeDireccion,
} from "../../../capacidades/activos/direccion-externa";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { telefonoDesdeTexto } from "../../../primitivas/contacto/telefono";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  lineaDelPortalDesdeTexto,
  nombreDeTarjetaDesdeTexto,
  tituloDelPortalDesdeTexto,
} from "../../../primitivas/texto/datos-de-portal";
import type { MotivoDeTextoInvalido } from "../../../primitivas/texto/texto-de-una-linea";
import { esColorDeMarca } from "../../../capacidades/experiencia/tema-css";

/**
 * El portal de la empresa (migración 0078; diseño `carta-identidad-y-portal-datos-diseno.md` §2.3 a §2.5): la hoja que el QR de la empresa abre y desde la que
 * el comensal elige un restaurante. Dominio PURO: valida y compara; no lee la base ni el reloj. Todo lo opcional vacío es `null` («usa el valor por defecto»).
 */

export const VARIANTES_DE_PORTAL = ["A", "B"] as const;
export type VarianteDePortal = (typeof VARIANTES_DE_PORTAL)[number];

/**
 * El tope de la imagen del portal: 3 MB (decimales, como `KB` de `activos/validacion.ts`), decisión del orquestador (DDD 54, SUPUESTO (DEC-0482)). Se comprueba SOLO cuando el
 * servidor pide los bytes al proveedor; guardar el portal no los pide (se guardan las partes de la dirección, nunca la imagen). Costo de revertir: la constante.
 */
export const TOPE_DE_BYTES_DE_LA_IMAGEN_DEL_PORTAL = 3_000_000;

/** ¿Una imagen de este tamaño entra en el portal? Falla cerrado: cero, negativo o no entero no entra. */
export const imagenEntraEnElPortal = (bytes: number): boolean =>
  Number.isSafeInteger(bytes) && bytes > 0 && bytes <= TOPE_DE_BYTES_DE_LA_IMAGEN_DEL_PORTAL;

/** Porcentajes de la imagen con dos decimales, guardados como enteros en CENTÉSIMAS (10000 = 100 %): sin decimales flotantes. */
export const CENTESIMAS_DEL_TOTAL = 10_000;
const PORCENTAJE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function centesimasDesdeTexto(texto: string): number | null {
  const m = PORCENTAJE.exec(texto);
  if (m === null) return null;
  const valor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return valor <= CENTESIMAS_DEL_TOTAL ? valor : null;
}

export const textoDesdeCentesimas = (c: number): string =>
  `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export type ErrorDePortal =
  | "VARIANTE_INVALIDA"
  | "LINEA_DEL_PORTAL_INVALIDA"
  | "TITULO_DEL_PORTAL_INVALIDO"
  | "COLOR_INVALIDO"
  | "IMAGEN_DEL_PORTAL_INVALIDA"
  | "TARJETA_INVALIDA"
  | "NOMBRE_DE_TARJETA_INVALIDO"
  | "TELEFONO_DE_TARJETA_INVALIDO"
  | "FOTO_DE_TARJETA_INVALIDA"
  | "ORDEN_INVALIDO"
  | "ZONA_INVALIDA"
  | "TARJETA_REPETIDA"
  | "ZONA_REPETIDA"
  | "IDENTIFICADOR_INVALIDO"
  | "SUCURSAL_NO_ENCONTRADA";

export type Imagen = PartesDeDireccion;

export type EntradaDeTarjeta = Readonly<{
  sucursalId: string;
  orden: number;
  visible: boolean;
  nombre?: string | null;
  telefono?: string | null;
  /** La dirección que pegó el comerciante; vacío o ausente = sin foto. */
  foto?: string | null;
}>;

export type EntradaDeZona = Readonly<{
  id: string;
  sucursalId: string;
  /** Porcentajes de la imagen, texto decimal con hasta dos decimales (`"12.5"`). */
  x: string;
  y: string;
  ancho: string;
  alto: string;
  visible: boolean;
}>;

export type EntradaDePortal = Readonly<{
  variante: string;
  lineaSuperior?: string | null;
  titulo?: string | null;
  colorEncabezado?: string | null;
  colorPagina?: string | null;
  colorDetras?: string | null;
  logoVisible: boolean;
  imagen?: string | null;
  tarjetas?: readonly EntradaDeTarjeta[];
  zonas?: readonly EntradaDeZona[];
}>;

export type Tarjeta = Readonly<{
  sucursalId: string;
  orden: number;
  visible: boolean;
  nombre: string | null;
  telefono: string | null;
  foto: Imagen | null;
}>;

/** Un rectángulo en centésimas de porcentaje de la imagen. */
export type Zona = Readonly<{
  id: string;
  sucursalId: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  visible: boolean;
}>;

export type DatosDelPortal = Readonly<{
  variante: VarianteDePortal;
  lineaSuperior: string | null;
  titulo: string | null;
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  logoVisible: boolean;
  imagen: Imagen | null;
}>;

export type PortalValidado = Readonly<{
  datos: DatosDelPortal;
  tarjetas: readonly Tarjeta[];
  zonas: readonly Zona[];
}>;

type R<S> = Resultado<S, ErrorDePortal>;

/** Un texto opcional: ausente o en blanco es «sin él» (`null`); si trae algo tiene que ser válido. */
function opcional(
  texto: string | null | undefined,
  convertir: (t: string) => Resultado<string, MotivoDeTextoInvalido | "TELEFONO_INVALIDO">,
  error: ErrorDePortal,
): R<string | null> {
  if (texto === undefined || texto === null || texto.trim() === "") return ok(null);
  const valido = convertir(texto);
  return valido.ok ? ok(valido.valor) : err(error);
}

const color = (texto: string | null | undefined): R<string | null> =>
  texto === undefined || texto === null || texto === ""
    ? ok(null)
    : esColorDeMarca(texto)
      ? ok(texto)
      : err("COLOR_INVALIDO");

/** La dirección pegada se lee contra la lista cerrada de proveedores (`leerDireccionPegada`); lo que se guarda son sus partes, nunca el texto pegado. */
function imagen(texto: string | null | undefined, error: ErrorDePortal): R<Imagen | null> {
  if (texto === undefined || texto === null || texto.trim() === "") return ok(null);
  const leida = leerDireccionPegada(texto);
  return leida.ok ? ok(leida.valor.partes) : err(error);
}

function validarTarjeta(t: EntradaDeTarjeta): R<Tarjeta> {
  if (!esUuidCanonico(t.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
  if (!Number.isSafeInteger(t.orden) || t.orden < 0) return err("ORDEN_INVALIDO");
  if (typeof t.visible !== "boolean") return err("TARJETA_INVALIDA");
  const nombre = opcional(t.nombre, nombreDeTarjetaDesdeTexto, "NOMBRE_DE_TARJETA_INVALIDO");
  if (!nombre.ok) return nombre;
  const telefono = opcional(t.telefono, telefonoDesdeTexto, "TELEFONO_DE_TARJETA_INVALIDO");
  if (!telefono.ok) return telefono;
  const foto = imagen(t.foto, "FOTO_DE_TARJETA_INVALIDA");
  if (!foto.ok) return foto;
  return ok({
    sucursalId: t.sucursalId,
    orden: t.orden,
    visible: t.visible,
    nombre: nombre.valor,
    telefono: telefono.valor,
    foto: foto.valor,
  });
}

function validarZona(z: EntradaDeZona): R<Zona> {
  if (!esUuidCanonico(z.id)) return err("IDENTIFICADOR_INVALIDO");
  if (!esUuidCanonico(z.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
  if (typeof z.visible !== "boolean") return err("ZONA_INVALIDA");
  const x = centesimasDesdeTexto(z.x);
  const y = centesimasDesdeTexto(z.y);
  const ancho = centesimasDesdeTexto(z.ancho);
  const alto = centesimasDesdeTexto(z.alto);
  if (x === null || y === null || ancho === null || alto === null) return err("ZONA_INVALIDA");
  // Mismas reglas que los CHECK de `portal_zona`: ancho y alto positivos y el rectángulo entero dentro de la imagen.
  if (
    ancho <= 0 ||
    alto <= 0 ||
    x + ancho > CENTESIMAS_DEL_TOTAL ||
    y + alto > CENTESIMAS_DEL_TOTAL
  )
    return err("ZONA_INVALIDA");
  return ok({ id: z.id, sucursalId: z.sucursalId, x, y, ancho, alto, visible: z.visible });
}

/** Validación completa de lo que pide guardar el administrador: la lista de lo PERMITIDO (conjuntos, largos, formas); lo demás se rechaza. */
export function validarPortal(entrada: EntradaDePortal): R<PortalValidado> {
  const variante = VARIANTES_DE_PORTAL.find((v) => v === entrada.variante);
  if (variante === undefined) return err("VARIANTE_INVALIDA");
  if (typeof entrada.logoVisible !== "boolean") return err("TARJETA_INVALIDA");
  const linea = opcional(
    entrada.lineaSuperior,
    lineaDelPortalDesdeTexto,
    "LINEA_DEL_PORTAL_INVALIDA",
  );
  if (!linea.ok) return linea;
  const titulo = opcional(entrada.titulo, tituloDelPortalDesdeTexto, "TITULO_DEL_PORTAL_INVALIDO");
  if (!titulo.ok) return titulo;
  const colores = [entrada.colorEncabezado, entrada.colorPagina, entrada.colorDetras].map(color);
  for (const c of colores) if (!c.ok) return c;
  const portada = imagen(entrada.imagen, "IMAGEN_DEL_PORTAL_INVALIDA");
  if (!portada.ok) return portada;
  const tarjetas: Tarjeta[] = [];
  for (const t of entrada.tarjetas ?? []) {
    const v = validarTarjeta(t);
    if (!v.ok) return v;
    tarjetas.push(v.valor);
  }
  if (new Set(tarjetas.map((t) => t.sucursalId)).size !== tarjetas.length)
    return err("TARJETA_REPETIDA");
  const zonas: Zona[] = [];
  for (const z of entrada.zonas ?? []) {
    const v = validarZona(z);
    if (!v.ok) return v;
    zonas.push(v.valor);
  }
  if (
    new Set(zonas.map((z) => z.id)).size !== zonas.length ||
    new Set(zonas.map((z) => z.sucursalId)).size !== zonas.length
  )
    return err("ZONA_REPETIDA");
  const [encabezado, pagina, detras] = colores.map((c) => (c.ok ? c.valor : null));
  return ok({
    datos: {
      variante,
      lineaSuperior: linea.valor,
      titulo: titulo.valor,
      colorEncabezado: encabezado ?? null,
      colorPagina: pagina ?? null,
      colorDetras: detras ?? null,
      logoVisible: entrada.logoVisible,
      imagen: portada.valor,
    },
    tarjetas,
    zonas,
  });
}

const mismaImagen = (a: Imagen | null, b: Imagen | null): boolean =>
  a === null || b === null
    ? a === b
    : a.proveedor === b.proveedor &&
      a.cuenta === b.cuenta &&
      a.idPublico === b.idPublico &&
      a.version === b.version &&
      a.extension === b.extension;

export const mismosDatosDelPortal = (a: DatosDelPortal, b: DatosDelPortal): boolean =>
  a.variante === b.variante &&
  a.lineaSuperior === b.lineaSuperior &&
  a.titulo === b.titulo &&
  a.colorEncabezado === b.colorEncabezado &&
  a.colorPagina === b.colorPagina &&
  a.colorDetras === b.colorDetras &&
  a.logoVisible === b.logoVisible &&
  mismaImagen(a.imagen, b.imagen);

export const mismaTarjeta = (a: Tarjeta, b: Tarjeta): boolean =>
  a.sucursalId === b.sucursalId &&
  a.orden === b.orden &&
  a.visible === b.visible &&
  a.nombre === b.nombre &&
  a.telefono === b.telefono &&
  mismaImagen(a.foto, b.foto);

export const mismaZona = (a: Zona, b: Zona): boolean =>
  a.id === b.id &&
  a.sucursalId === b.sucursalId &&
  a.x === b.x &&
  a.y === b.y &&
  a.ancho === b.ancho &&
  a.alto === b.alto &&
  a.visible === b.visible;

/** El portal tal como lo guarda la base (con identidad, código y versión). */
export type Portal = Readonly<{
  id: string;
  empresaId: string;
  /** La llave pública del QR; no cambia nunca. */
  codigo: string;
  version: number;
  datos: DatosDelPortal;
  tarjetas: readonly Tarjeta[];
  zonas: readonly Zona[];
}>;
