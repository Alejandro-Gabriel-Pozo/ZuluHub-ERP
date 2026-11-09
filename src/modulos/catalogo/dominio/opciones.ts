import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";
import { nombreDeEleccionDesdeTexto } from "../../../primitivas/texto/nombre-de-eleccion";
import { leerCantidad } from "./forma-de-venta";
import { esUuid } from "./identificadores";
import type { ClaseDeGrupo } from "./modelo";

/**
 * Validación del CONJUNTO FINAL de grupos y opciones de un producto (`editarOpciones`, E2 mínimo §3.5): decisiones 82, 133, 138, 139,
 * 157 y 159. Pura: no mira la base; que los ids pertenezcan al producto y qué cambió respecto de lo guardado lo ve el caso de uso.
 */
export type OpcionPedida = Readonly<{
  id: string;
  nombre: string;
  /** Recargo de la empresa, texto decimal exacto en ARS con IVA incluido. */
  recargo: string;
  orden: number;
  activa: boolean;
  /** Solo en las opciones de la variante de tamaño; omitido = 1. */
  factorDeTamano?: string | undefined;
}>;

export type GrupoPedido = Readonly<{
  id: string;
  clase: string;
  nombre: string;
  esTamano?: boolean | undefined;
  esObligatorio: boolean;
  admiteVarias: boolean;
  seMuestraEnCarta: boolean;
  orden: number;
  activo: boolean;
  opciones: readonly OpcionPedida[];
}>;

export type OpcionValida = Readonly<{
  id: string;
  nombre: string;
  nombreClave: string;
  recargo: string;
  factorDeTamano: string;
  orden: number;
  activa: boolean;
}>;

export type GrupoValido = Readonly<{
  id: string;
  clase: ClaseDeGrupo;
  esTamano: boolean;
  nombre: string;
  nombreClave: string;
  esObligatorio: boolean;
  admiteVarias: boolean;
  seMuestraEnCarta: boolean;
  orden: number;
  activo: boolean;
  opciones: readonly OpcionValida[];
}>;

export type ErrorDeOpciones =
  | "IDENTIFICADOR_INVALIDO"
  | "ID_REPETIDO"
  | "CLASE_DE_GRUPO_INVALIDA"
  | "TAMANO_SOLO_EN_VARIANTE"
  | "ORDEN_INVALIDO"
  | "NOMBRE_DE_GRUPO_INVALIDO"
  | "GRUPO_DUPLICADO"
  | "NOMBRE_DE_OPCION_INVALIDO"
  | "OPCION_DUPLICADA"
  | "GRUPO_SIN_OPCIONES"
  | "SEGUNDA_VARIANTE"
  | "INCLUIDA_CON_RECARGO"
  | "ELECCION_OCULTA_CON_PRECIO"
  | "RECARGO_INVALIDO"
  | "FACTOR_DE_TAMANO_INVALIDO";

const CLASES_DE_GRUPO: readonly ClaseDeGrupo[] = ["VARIANTE", "INCLUIDA", "ADICIONAL"];
const MAXIMO_DEL_ORDEN = 100_000;
const ordenValido = (orden: number): boolean =>
  Number.isInteger(orden) && orden >= 0 && orden <= MAXIMO_DEL_ORDEN;
/** El factor de tamaño va de más de 0 a 100 (CHECK `version_de_opcion_factor_ck`). */
const FACTOR_MAXIMO = leerCantidad("100");

function opcionValida(
  opcion: OpcionPedida,
  grupo: Readonly<{ clase: ClaseDeGrupo; esTamano: boolean; seMuestraEnCarta: boolean }>,
): Resultado<OpcionValida, ErrorDeOpciones> {
  if (!esUuid(opcion.id)) return err("IDENTIFICADOR_INVALIDO");
  if (!ordenValido(opcion.orden)) return err("ORDEN_INVALIDO");
  const nombre = nombreDeEleccionDesdeTexto(opcion.nombre);
  if (!nombre.ok) return err("NOMBRE_DE_OPCION_INVALIDO");
  const recargo = precioDeVentaDesdeTexto(opcion.recargo);
  if (!recargo.ok) return err("RECARGO_INVALIDO");
  const conRecargo = recargo.valor.unidades !== 0n;
  if (conRecargo && grupo.clase !== "ADICIONAL") return err("INCLUIDA_CON_RECARGO");
  if (conRecargo && !grupo.seMuestraEnCarta) return err("ELECCION_OCULTA_CON_PRECIO");
  const factorTexto = opcion.factorDeTamano ?? "1";
  const factor = leerCantidad(factorTexto);
  if (
    factor === null ||
    factor.unidades <= 0n ||
    (FACTOR_MAXIMO !== null && factor.unidades > FACTOR_MAXIMO.unidades)
  ) {
    return err("FACTOR_DE_TAMANO_INVALIDO");
  }
  const esUno = factor.unidades === (leerCantidad("1")?.unidades ?? 0n);
  if (!esUno && !(grupo.clase === "VARIANTE" && grupo.esTamano)) {
    return err("FACTOR_DE_TAMANO_INVALIDO");
  }
  return ok({
    id: opcion.id,
    nombre: nombre.valor,
    nombreClave: claveDeNombre(nombre.valor),
    recargo: precioUnitarioATexto(recargo.valor),
    factorDeTamano: cantidadATexto(factor),
    orden: opcion.orden,
    activa: opcion.activa,
  });
}

/**
 * Valida el conjunto final: ids uuid y sin repetir; clase conocida; nombres válidos y únicos (grupos entre sí, opciones dentro de su
 * grupo, comparados por clave); a lo sumo UNA variante activa (138); un grupo activo con al menos una opción activa; sin recargo en
 * incluidas ni en la variante; sin recargo en una elección que no se muestra en la carta (82); recargo decimal exacto ≥ 0.
 * La variante es siempre obligatoria, de una sola elección y se muestra en la carta (el CHECK de la base): se fija acá.
 */
export function validarConjuntoDeOpciones(
  grupos: readonly GrupoPedido[],
): Resultado<readonly GrupoValido[], ErrorDeOpciones> {
  const ids = new Set<string>();
  const clavesDeGrupo = new Set<string>();
  let variantesActivas = 0;
  const validos: GrupoValido[] = [];
  for (const pedido of grupos) {
    if (!esUuid(pedido.id)) return err("IDENTIFICADOR_INVALIDO");
    if (ids.has(pedido.id)) return err("ID_REPETIDO");
    ids.add(pedido.id);
    const clase = CLASES_DE_GRUPO.find((c) => c === pedido.clase);
    if (clase === undefined) return err("CLASE_DE_GRUPO_INVALIDA");
    const esTamano = pedido.esTamano === true;
    if (esTamano && clase !== "VARIANTE") return err("TAMANO_SOLO_EN_VARIANTE");
    if (!ordenValido(pedido.orden)) return err("ORDEN_INVALIDO");
    const nombre = nombreDeEleccionDesdeTexto(pedido.nombre);
    if (!nombre.ok) return err("NOMBRE_DE_GRUPO_INVALIDO");
    const clave = claveDeNombre(nombre.valor);
    if (clavesDeGrupo.has(clave)) return err("GRUPO_DUPLICADO");
    clavesDeGrupo.add(clave);
    if (clase === "VARIANTE" && pedido.activo) {
      variantesActivas += 1;
      if (variantesActivas > 1) return err("SEGUNDA_VARIANTE");
    }
    const esVariante = clase === "VARIANTE";
    const forma = {
      clase,
      esTamano,
      seMuestraEnCarta: esVariante ? true : pedido.seMuestraEnCarta,
    };
    const clavesDeOpcion = new Set<string>();
    const opciones: OpcionValida[] = [];
    for (const opcionPedida of pedido.opciones) {
      if (ids.has(opcionPedida.id)) return err("ID_REPETIDO");
      const valida = opcionValida(opcionPedida, forma);
      if (!valida.ok) return valida;
      ids.add(valida.valor.id);
      if (clavesDeOpcion.has(valida.valor.nombreClave)) return err("OPCION_DUPLICADA");
      clavesDeOpcion.add(valida.valor.nombreClave);
      opciones.push(valida.valor);
    }
    if (pedido.activo && !opciones.some((o) => o.activa)) return err("GRUPO_SIN_OPCIONES");
    validos.push({
      id: pedido.id,
      clase,
      esTamano,
      nombre: nombre.valor,
      nombreClave: clave,
      esObligatorio: esVariante ? true : pedido.esObligatorio,
      admiteVarias: esVariante ? false : pedido.admiteVarias,
      seMuestraEnCarta: forma.seMuestraEnCarta,
      orden: pedido.orden,
      activo: pedido.activo,
      opciones,
    });
  }
  return ok(validos);
}
