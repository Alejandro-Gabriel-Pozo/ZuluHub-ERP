import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import {
  importeAJson,
  importeCero,
  importesIguales,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  multiplicarPrecioPorCantidad,
  sumarExactos,
} from "../../../primitivas/dinero/monto-exacto";
import type { MontoExacto } from "../../../primitivas/dinero/monto-exacto";
import {
  precioUnitarioDesdeTexto,
  type PrecioUnitario,
} from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE, redondear } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * La lista de precios de un producto para la carta (§3.1 y D3). Todo el dinero es TEXTO DECIMAL en la
 * frontera (ADR-006): entra como texto del catálogo (`numeric(18,6)`, IVA incluido), se suma exacto con
 * la primitiva de dinero y se redondea UNA sola vez, al final, a centavos de pesos con la política
 * vigente. Nunca `number`: ni un solo importe pasa por coma flotante.
 */

/** Una opción de un grupo: su nombre y su recargo sobre el precio base (texto decimal, ≥ 0). */
export type OpcionConRecargo = Readonly<{ nombre: string; recargo: string }>;

export type GrupoConRecargos = Readonly<{ titulo: string; opciones: readonly OpcionConRecargo[] }>;

export type ProductoParaPrecios = Readonly<{
  /** Precio base con IVA, texto decimal. */
  precioBase: string;
  /** Grupo obligatorio de una sola opción (el tamaño), en el orden que fijó el comerciante; `[]` si no hay. */
  tamanos: readonly OpcionConRecargo[];
  /** Otros grupos obligatorios (la guarnición, con recargo 0 o con él). */
  obligatorios: readonly GrupoConRecargos[];
  /** Grupos opcionales (adicionales). */
  adicionales: readonly GrupoConRecargos[];
}>;

export type OpcionDePrecio = Readonly<{
  nombre: string;
  /** `null` cuando el recargo es cero a la vista: se muestra solo el nombre, sin «+ $ 0». */
  recargo: ImporteJson | null;
}>;

export type GrupoDePrecios = Readonly<{ titulo: string; opciones: readonly OpcionDePrecio[] }>;

export type ListaDePrecios = Readonly<{
  /**
   * El precio que muestra la lista: el MÍNIMO exacto que se puede pagar (base + el menor recargo de cada
   * grupo obligatorio), con la moneda explícita.
   */
  precioDeLista: ImporteJson;
  /** Hay más de un precio posible a la vista: la lista dice «desde». */
  desde: boolean;
  /** Precio final de cada tamaño (base + recargo), en el MISMO orden en que llegaron. Vacío si no hay tamaños. */
  tamanos: readonly Readonly<{ nombre: string; precio: ImporteJson }>[];
  obligatorios: readonly GrupoDePrecios[];
  adicionales: readonly GrupoDePrecios[];
}>;

/** `ubicacion` dice dónde está el dato malo, por ejemplo `tamanos.1` o `adicionales.0.opciones.2`. */
export type ErrorDePrecios = Readonly<{
  codigo: "PRECIO_INVALIDO" | "GRUPO_SIN_OPCIONES";
  ubicacion: string;
}>;

const UNO = cantidadDesdeTexto("1");

type OpcionLeida = Readonly<{ nombre: string; recargo: PrecioUnitario }>;
type GrupoLeido = Readonly<{ titulo: string; opciones: readonly OpcionLeida[] }>;

function leerPrecio(texto: string, ubicacion: string): Resultado<PrecioUnitario, ErrorDePrecios> {
  try {
    return ok(precioUnitarioDesdeTexto(texto));
  } catch (e) {
    // Solo el rechazo del parser es un dato malo; cualquier otra cosa es un defecto y se lanza (ADR-004).
    if (e instanceof ErrorDeValor) return err({ codigo: "PRECIO_INVALIDO", ubicacion });
    throw e;
  }
}

function leerOpciones(
  opciones: readonly OpcionConRecargo[],
  ubicacion: string,
): Resultado<readonly OpcionLeida[], ErrorDePrecios> {
  const leidas: OpcionLeida[] = [];
  for (const [i, opcion] of opciones.entries()) {
    const recargo = leerPrecio(opcion.recargo, `${ubicacion}.${i}`);
    if (!recargo.ok) return recargo;
    leidas.push({ nombre: opcion.nombre, recargo: recargo.valor });
  }
  return ok(leidas);
}

function leerGrupos(
  grupos: readonly GrupoConRecargos[],
  ubicacion: string,
): Resultado<readonly GrupoLeido[], ErrorDePrecios> {
  const leidos: GrupoLeido[] = [];
  for (const [g, grupo] of grupos.entries()) {
    const donde = `${ubicacion}.${g}`;
    if (grupo.opciones.length === 0) return err({ codigo: "GRUPO_SIN_OPCIONES", ubicacion: donde });
    const opciones = leerOpciones(grupo.opciones, `${donde}.opciones`);
    if (!opciones.ok) return opciones;
    leidos.push({ titulo: grupo.titulo, opciones: opciones.valor });
  }
  return ok(leidos);
}

function exacto(precio: PrecioUnitario): MontoExacto {
  return multiplicarPrecioPorCantidad(ARS, precio, UNO);
}

function aImporte(precio: PrecioUnitario): Importe {
  return redondear(exacto(precio), POLITICA_VIGENTE);
}

/** Suma EXACTA (sin redondear) y un solo redondeo al final. */
function sumaRedondeada(partes: readonly [PrecioUnitario, ...PrecioUnitario[]]): Importe {
  return redondear(partes.map(exacto).reduce(sumarExactos), POLITICA_VIGENTE);
}

/** El menor y el mayor recargo de un grupo no vacío, comparados en unidades mínimas exactas. */
function extremos(opciones: readonly OpcionLeida[]): {
  menor: PrecioUnitario;
  mayor: PrecioUnitario;
} {
  const recargos = opciones.map((o) => o.recargo);
  // Stryker disable next-line EqualityOperator: con recargos iguales da lo mismo cuál de los dos se elige
  const menor = recargos.reduce((a, b) => (b.unidades < a.unidades ? b : a));
  // Stryker disable next-line EqualityOperator: con recargos iguales da lo mismo cuál de los dos se elige
  const mayor = recargos.reduce((a, b) => (b.unidades > a.unidades ? b : a));
  return { menor, mayor };
}

function mostrarGrupo(grupo: GrupoLeido): GrupoDePrecios {
  return {
    titulo: grupo.titulo,
    opciones: grupo.opciones.map((o) => {
      const recargo = aImporte(o.recargo);
      return {
        nombre: o.nombre,
        recargo: importesIguales(recargo, importeCero(ARS)) ? null : importeAJson(recargo),
      };
    }),
  };
}

/**
 * Lo que la carta muestra de los precios de un producto, listo para pintar (sin cuentas en la pantalla):
 * - sin grupos obligatorios con recargo: el precio base y nada más;
 * - con tamaños: la lista de precios finales y «desde» el menor (§3.1, D3);
 * - otros obligatorios y adicionales: sus opciones con «+ $ recargo», o solo el nombre si no cobra.
 * El orden de tamaños, grupos y opciones es el que llegó: no se reordena por precio.
 */
export function listaDePreciosDelProducto(
  producto: ProductoParaPrecios,
): Resultado<ListaDePrecios, ErrorDePrecios> {
  const base = leerPrecio(producto.precioBase, "precioBase");
  if (!base.ok) return base;
  const tamanos = leerOpciones(producto.tamanos, "tamanos");
  if (!tamanos.ok) return tamanos;
  const obligatorios = leerGrupos(producto.obligatorios, "obligatorios");
  if (!obligatorios.ok) return obligatorios;
  const adicionales = leerGrupos(producto.adicionales, "adicionales");
  if (!adicionales.ok) return adicionales;

  // Cada grupo obligatorio obliga a elegir una opción: el piso suma el menor recargo de cada uno, el techo el mayor.
  const obligados = [
    ...(tamanos.valor.length === 0 ? [] : [tamanos.valor]),
    ...obligatorios.valor.map((g) => g.opciones),
  ].map(extremos);
  const piso = sumaRedondeada([base.valor, ...obligados.map((e) => e.menor)]);
  const techo = sumaRedondeada([base.valor, ...obligados.map((e) => e.mayor)]);

  return ok({
    precioDeLista: importeAJson(piso),
    desde: !importesIguales(piso, techo),
    tamanos: tamanos.valor.map((t) => ({
      nombre: t.nombre,
      precio: importeAJson(sumaRedondeada([base.valor, t.recargo])),
    })),
    obligatorios: obligatorios.valor.map(mostrarGrupo),
    adicionales: adicionales.valor.map(mostrarGrupo),
  });
}
