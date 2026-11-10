import { esCodigoDeAlicuota } from "../../fiscal/publico";
import { descripcionDeCartaDesdeTexto } from "../../../primitivas/texto/descripcion-de-carta";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  codigoDeBarrasDesdeTexto,
  codigoDeProductoDesdeTexto,
} from "../../../primitivas/texto/codigo-de-producto";
import { nombreDeCocinaDesdeTexto } from "../../../primitivas/texto/nombre-de-cocina";
import {
  claveDeNombre,
  nombreDeProductoDesdeTexto,
} from "../../../primitivas/texto/nombre-de-producto";
import { vendeLaClase, type ClaseDeUso } from "./clases";
import { esUuid, seccionDeCartaId, type SeccionDeCartaId } from "./identificadores";

/** Lo que pide quien carga o edita la ficha (todo texto; vacío o ausente = no tiene). */
export type EntradaDeFicha = Readonly<{
  nombre: string;
  nombreDeCocina?: string | null | undefined;
  descripcionEnCarta?: string | null | undefined;
  codigo?: string | null | undefined;
  codigoDeBarras?: string | null | undefined;
  alicuota?: string | null | undefined;
  seccionDeCartaId?: string | null | undefined;
}>;

/** La ficha ya validada y en su forma canónica, lista para guardar. */
export type FichaValida = Readonly<{
  nombre: string;
  nombreClave: string;
  nombreDeCocina: string | null;
  descripcionEnCarta: string | null;
  codigo: string | null;
  codigoDeBarras: string | null;
  alicuota: string | null;
  seccionDeCartaId: SeccionDeCartaId | null;
}>;

export type CampoDeFicha =
  "nombreDeCocina" | "descripcionEnCarta" | "alicuota" | "seccionDeCartaId";

export type ErrorDeFicha =
  | "NOMBRE_DE_PRODUCTO_INVALIDO"
  | "NOMBRE_DE_COCINA_INVALIDO"
  | "DESCRIPCION_INVALIDA"
  | "CODIGO_INVALIDO"
  | "CODIGO_DE_BARRAS_INVALIDO"
  | "ALICUOTA_INVALIDA"
  | "ALICUOTA_REQUERIDA"
  | "SECCION_NO_ENCONTRADA"
  | Readonly<{ error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE"; campo: CampoDeFicha }>;

/** Vacío o ausente → `null`; un texto con blancos solamente también. */
function opcional(texto: string | null | undefined): string | null {
  if (texto === undefined || texto === null) return null;
  const recortado = texto.trim();
  return recortado === "" ? null : recortado;
}

/**
 * Valida la ficha según la clase (§3.3): el nombre siempre; código y código de barras si vienen; y, si la clase NO vende, nada de
 * alícuota, sección, nombre de cocina ni descripción (`CAMPO_NO_ADMITIDO_POR_LA_CLASE`). Si la clase vende, la alícuota es obligatoria
 * salvo en el alta rápida (`exigirAlicuota: false`), que deja el producto en «Falta completar». Un id de sección que no es uuid no puede
 * existir: `SECCION_NO_ENCONTRADA`; que exista en la empresa lo verifica el caso de uso.
 */
export function validarFicha(
  clase: ClaseDeUso,
  entrada: EntradaDeFicha,
  exigirAlicuota: boolean,
): Resultado<FichaValida, ErrorDeFicha> {
  const nombre = nombreDeProductoDesdeTexto(entrada.nombre);
  if (!nombre.ok) return err("NOMBRE_DE_PRODUCTO_INVALIDO");
  const vende = vendeLaClase(clase);

  const cocina = opcional(entrada.nombreDeCocina);
  const descripcion = opcional(entrada.descripcionEnCarta);
  const alicuota = opcional(entrada.alicuota);
  const seccion = opcional(entrada.seccionDeCartaId);
  if (!vende) {
    const ajenos: ReadonlyArray<[CampoDeFicha, string | null]> = [
      ["alicuota", alicuota],
      ["seccionDeCartaId", seccion],
      ["nombreDeCocina", cocina],
      ["descripcionEnCarta", descripcion],
    ];
    const presente = ajenos.find(([, valor]) => valor !== null);
    if (presente !== undefined) {
      return err({ error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo: presente[0] });
    }
  }

  let nombreDeCocina: string | null = null;
  if (cocina !== null) {
    const valida = nombreDeCocinaDesdeTexto(cocina);
    if (!valida.ok) return err("NOMBRE_DE_COCINA_INVALIDO");
    nombreDeCocina = valida.valor;
  }
  let descripcionEnCarta: string | null = null;
  if (descripcion !== null) {
    const valida = descripcionDeCartaDesdeTexto(descripcion);
    if (!valida.ok) return err("DESCRIPCION_INVALIDA");
    descripcionEnCarta = valida.valor;
  }
  let codigo: string | null = null;
  const codigoPedido = opcional(entrada.codigo);
  if (codigoPedido !== null) {
    const valido = codigoDeProductoDesdeTexto(codigoPedido);
    if (!valido.ok) return valido;
    codigo = valido.valor;
  }
  let codigoDeBarras: string | null = null;
  const barrasPedido = opcional(entrada.codigoDeBarras);
  if (barrasPedido !== null) {
    const valido = codigoDeBarrasDesdeTexto(barrasPedido);
    if (!valido.ok) return valido;
    codigoDeBarras = valido.valor;
  }
  if (alicuota !== null && !esCodigoDeAlicuota(alicuota)) return err("ALICUOTA_INVALIDA");
  if (vende && exigirAlicuota && alicuota === null) return err("ALICUOTA_REQUERIDA");
  if (seccion !== null && !esUuid(seccion)) return err("SECCION_NO_ENCONTRADA");

  return ok({
    nombre: nombre.valor,
    nombreClave: claveDeNombre(nombre.valor),
    nombreDeCocina,
    descripcionEnCarta,
    codigo,
    codigoDeBarras,
    alicuota,
    seccionDeCartaId: seccion === null ? null : seccionDeCartaId(seccion),
  });
}
