import { describe, expect, it } from "vitest";
import { clavesDe } from "../modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveModulo } from "../modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "./empresa";
import { PERMISOS_DE_ADMINISTRACION } from "./permisos-de-administracion";
import { PERMISOS_DE_CAJA } from "./permisos-de-caja";
import { PERMISOS_DE_CATALOGO } from "./permisos-de-catalogo";
import { PERMISOS_DE_CIERRE } from "./permisos-de-cierre";
import { PERMISOS_DE_CLIENTES } from "./permisos-de-clientes";
import { PERMISOS_DE_COMANDAS } from "./permisos-de-comandas";
import { PERMISOS_DE_COMPRAS } from "./permisos-de-compras";
import { PERMISOS_DE_CUENTA_CORRIENTE } from "./permisos-de-cuenta_corriente";
import { PERMISOS_DE_FACTURACION } from "./permisos-de-facturacion";
import { PERMISOS_DE_PRODUCCION } from "./permisos-de-produccion";
import { PERMISOS_DE_SALON } from "./permisos-de-salon";
import { PERMISOS_DE_STOCK } from "./permisos-de-stock";
import { PERMISOS_DE_VENTAS } from "./permisos-de-ventas";
import { PERMISOS_DE_VIDRIERA } from "./permisos-de-vidriera";
import type { RolDeEmpresa } from "./roles";

/**
 * La matriz de permisos se escribe por módulo (E-4). Estas pruebas cubren lo que el compilador no ve en ejecución: un
 * spread que pisa a otro en silencio (la segunda fila gana, sin error), una fila en el archivo de otro módulo y un
 * módulo nuevo sin su archivo de permisos.
 */
type Partes = Readonly<Record<string, Readonly<Record<string, readonly RolDeEmpresa[]>>>>;

/** Una parte por módulo del catálogo: si falta alguna, no compila. */
const PARTES = {
  administracion: PERMISOS_DE_ADMINISTRACION,
  facturacion: PERMISOS_DE_FACTURACION,
  catalogo: PERMISOS_DE_CATALOGO,
  vidriera: PERMISOS_DE_VIDRIERA,
  stock: PERMISOS_DE_STOCK,
  caja: PERMISOS_DE_CAJA,
  cierre: PERMISOS_DE_CIERRE,
  ventas: PERMISOS_DE_VENTAS,
  comandas: PERMISOS_DE_COMANDAS,
  salon: PERMISOS_DE_SALON,
  clientes: PERMISOS_DE_CLIENTES,
  compras: PERMISOS_DE_COMPRAS,
  cuenta_corriente: PERMISOS_DE_CUENTA_CORRIENTE,
  produccion: PERMISOS_DE_PRODUCCION,
} as const satisfies Record<ClaveModulo, Partes[string]>;

/** El mismo objeto sin una clave. */
function sin<V>(objeto: Readonly<Record<string, V>>, clave: string): Record<string, V> {
  return Object.fromEntries(Object.entries(objeto).filter(([k]) => k !== clave));
}

/** Las acciones que aparecen en más de una parte, con las partes que las traen. */
function enMasDeUnaParte(partes: Partes): Map<string, string[]> {
  const dueños = new Map<string, string[]>();
  for (const [parte, filas] of Object.entries(partes)) {
    for (const accion of Object.keys(filas)) {
      dueños.set(accion, [...(dueños.get(accion) ?? []), parte]);
    }
  }
  return new Map([...dueños].filter(([, lista]) => lista.length > 1));
}

/** Por módulo, las filas que sobran y las que faltan respecto de las acciones que declara el catálogo. */
function desajustes(
  partes: Partes,
  catalogo: Readonly<Record<string, { acciones: Readonly<Record<string, unknown>> }>>,
): Map<string, { sobran: string[]; faltan: string[] }> {
  const resultado = new Map<string, { sobran: string[]; faltan: string[] }>();
  for (const modulo of Object.keys(catalogo)) {
    const propias = new Set(Object.keys(partes[modulo] ?? {}));
    const declaradas = new Set(Object.keys(catalogo[modulo]?.acciones ?? {}));
    const sobran = [...propias].filter((a) => !declaradas.has(a));
    const faltan = [...declaradas].filter((a) => !propias.has(a));
    if (sobran.length > 0 || faltan.length > 0) resultado.set(modulo, { sobran, faltan });
  }
  return resultado;
}

describe("ninguna acción está en dos partes", () => {
  it("las partes reales no repiten ninguna, y la suma de sus filas es la de la matriz", () => {
    expect(enMasDeUnaParte(PARTES).size).toBe(0);
    const suma = Object.values(PARTES).reduce((n, filas) => n + Object.keys(filas).length, 0);
    expect(suma).toBe(Object.keys(PERMISOS_DE_EMPRESA).length);
    expect(suma).toBe(183);
  });

  it("violación inyectada: una acción en dos partes se detecta (la segunda pisaría a la primera)", () => {
    const rota: Partes = {
      ...PARTES,
      cierre: { ...PARTES.cierre, "ventas.ver": ["GERENTE"] },
    };
    expect(enMasDeUnaParte(rota)).toEqual(new Map([["ventas.ver", ["cierre", "ventas"]]]));
  });
});

describe("cada parte tiene exactamente las acciones de su módulo", () => {
  it("las partes reales coinciden con el catálogo", () => {
    expect(desajustes(PARTES, CATALOGO_DE_MODULOS)).toEqual(new Map());
  });

  it("violación inyectada: una fila en el archivo equivocado, o una que falta, se detecta", () => {
    const rota: Partes = {
      ...PARTES,
      ventas: { ...PARTES.ventas, "jornadas.ver": ["GERENTE"] },
      cierre: sin(PARTES.cierre, "jornadas.cerrar"),
    };
    expect(desajustes(rota, CATALOGO_DE_MODULOS)).toEqual(
      new Map([
        ["ventas", { sobran: ["jornadas.ver"], faltan: [] }],
        ["cierre", { sobran: [], faltan: ["jornadas.cerrar"] }],
      ]),
    );
  });
});

describe("hay una parte por módulo del catálogo", () => {
  it("los módulos con parte son exactamente los del catálogo", () => {
    expect(Object.keys(PARTES).sort()).toEqual([...clavesDe(CATALOGO_DE_MODULOS)].sort());
  });

  it("violación inyectada: un módulo sin parte aparece como desajuste", () => {
    expect(
      desajustes(sin(PARTES, "produccion"), CATALOGO_DE_MODULOS).get("produccion")?.faltan,
    ).toHaveLength(5);
  });
});
