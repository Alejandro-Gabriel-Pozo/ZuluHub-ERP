import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_MODULOS,
  type CatalogoComercial,
  type DefinicionDeModulo,
} from "../../src/capacidades/modulos/catalogo";
import {
  DECLARACIONES_DE_EMPRESAS,
  DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
} from "../../src/modulos/empresas/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD,
  DECLARACIONES_DE_IDENTIDAD,
} from "../../src/modulos/identidad/publico";

/**
 * P6: los cruces del catálogo comercial (ADR-003), cada uno con su violación inyectada.
 *
 *  X1  Cada acción declarada por un caso de uso pertenece a un módulo cuya ficha dice que esa
 *      carpeta lo implementa; y toda acción del catálogo la exige algún caso de uso.
 *  X3  `requiere` y `usaSiExiste` nombran módulos que existen, y `requiere` no tiene ciclos.
 *  X4  Cada carpeta de `implementadoPor` existe en `src/`; un módulo disponible tiene al menos una.
 *  Además: una acción pertenece a un solo módulo; un módulo obligatorio está disponible y solo
 *  requiere obligatorios.
 */

const RAIZ = join(import.meta.dirname, "../..");
const carpetaExiste = (carpeta: string): boolean => {
  const ruta = join(RAIZ, "src", carpeta);
  return existsSync(ruta) && statSync(ruta).isDirectory();
};

/** Las acciones que exige cada carpeta de `src/` por sus casos de uso y sus consultas. */
type AccionesPorCarpeta = Readonly<Record<string, readonly string[]>>;

function crucesDelCatalogo(
  catalogo: CatalogoComercial,
  declaradas: AccionesPorCarpeta,
  existe: (carpeta: string) => boolean = carpetaExiste,
): string[] {
  const problemas: string[] = [];
  const modulos = Object.entries(catalogo);

  // Una acción pertenece a un solo módulo.
  const duenos = new Map<string, string[]>();
  for (const [clave, modulo] of modulos) {
    for (const accion of Object.keys(modulo.acciones)) {
      duenos.set(accion, [...(duenos.get(accion) ?? []), clave]);
    }
  }
  for (const [accion, claves] of duenos) {
    if (claves.length > 1) {
      problemas.push(`acción repetida: ${accion} está en ${claves.join(" y ")}`);
    }
  }

  // X1
  for (const [carpeta, acciones] of Object.entries(declaradas)) {
    for (const accion of acciones) {
      const dueno = duenos.get(accion)?.[0];
      if (dueno === undefined) {
        problemas.push(`X1: ${carpeta} exige ${accion}, que ningún módulo declara`);
      } else if (!catalogo[dueno]?.implementadoPor.includes(carpeta)) {
        problemas.push(
          `X1: ${carpeta} exige ${accion}, pero ${dueno} no figura implementado por esa carpeta`,
        );
      }
    }
  }
  const exigidas = new Set(Object.values(declaradas).flat());
  for (const accion of duenos.keys()) {
    if (!exigidas.has(accion)) {
      problemas.push(`X1: la acción ${accion} no la exige ningún caso de uso`);
    }
  }

  // X3
  for (const [clave, modulo] of modulos) {
    for (const otro of modulo.requiere) {
      if (!Object.hasOwn(catalogo, otro))
        problemas.push(`X3: ${clave} requiere ${otro}, que no existe`);
    }
    for (const otro of modulo.usaSiExiste) {
      if (!Object.hasOwn(catalogo, otro)) problemas.push(`X3: ${clave} usa ${otro}, que no existe`);
    }
  }
  const visitados = new Set<string>();
  const enCurso: string[] = [];
  const recorrer = (clave: string): void => {
    const indice = enCurso.indexOf(clave);
    if (indice >= 0) {
      problemas.push(`X3: ciclo de requiere: ${[...enCurso.slice(indice), clave].join(" → ")}`);
      return;
    }
    if (visitados.has(clave)) return;
    visitados.add(clave);
    enCurso.push(clave);
    for (const otro of catalogo[clave]?.requiere ?? []) {
      if (Object.hasOwn(catalogo, otro)) recorrer(otro);
    }
    enCurso.pop();
  };
  for (const [clave] of modulos) recorrer(clave);

  // X4
  for (const [clave, modulo] of modulos) {
    for (const carpeta of modulo.implementadoPor) {
      if (!existe(carpeta))
        problemas.push(`X4: ${clave} dice que lo implementa ${carpeta}, que no existe en src/`);
    }
    if (modulo.estado === "disponible" && modulo.implementadoPor.length === 0) {
      problemas.push(`X4: ${clave} está disponible pero ninguna carpeta lo implementa`);
    }
  }

  // Obligatorios
  for (const [clave, modulo] of modulos) {
    if (!modulo.obligatorio) continue;
    if (modulo.estado !== "disponible") {
      problemas.push(`obligatorio: ${clave} es obligatorio pero no está disponible`);
    }
    for (const otro of modulo.requiere) {
      if (catalogo[otro]?.obligatorio === false) {
        problemas.push(`obligatorio: ${clave} es obligatorio pero requiere ${otro}, que no lo es`);
      }
    }
  }
  return problemas;
}

const modulo = (parcial: Partial<DefinicionDeModulo> = {}): DefinicionDeModulo => ({
  estado: "disponible",
  obligatorio: false,
  requiere: [],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/identidad"],
  acciones: {},
  ...parcial,
});

const accion = { capacidad: null };

/** Un catálogo de prueba sano: dos módulos, cada uno con su acción. */
const SANO: CatalogoComercial = {
  base: modulo({ obligatorio: true, acciones: { "base.ver": accion } }),
  ventas: modulo({
    requiere: ["base"],
    usaSiExiste: ["stock"],
    implementadoPor: ["modulos/empresas"],
    acciones: { "ventas.vender": accion },
  }),
  stock: modulo({ implementadoPor: ["modulos/empresas"], acciones: { "stock.mover": accion } }),
};
const DECLARADAS_SANAS: AccionesPorCarpeta = {
  "modulos/identidad": ["base.ver"],
  "modulos/empresas": ["ventas.vender", "stock.mover"],
};
const todasExisten = () => true;

describe("P6: el catálogo REAL cumple los cruces", () => {
  const accionesDe = (...declaraciones: Record<string, object>[]): string[] =>
    declaraciones
      .flatMap((d) => Object.values(d))
      .flatMap((d) => ("accion" in d ? [d.accion] : [])) as string[];

  const declaradas: AccionesPorCarpeta = {
    "modulos/identidad": accionesDe(
      DECLARACIONES_DE_IDENTIDAD,
      DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD,
    ),
    "modulos/empresas": accionesDe(
      DECLARACIONES_DE_EMPRESAS,
      DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
    ),
  };

  it("identidad exige las acciones de usuarios y de gerencia (casos de uso y consultas)", () => {
    expect([...new Set(declaradas["modulos/identidad"])].sort()).toEqual([
      "gerencia.aceptar_traspaso",
      "gerencia.cancelar_traspaso",
      "gerencia.proponer_traspaso",
      "gerencia.rechazar_traspaso",
      "gerencia.ver_traspaso",
      "usuarios.apagar",
      "usuarios.asignar_sucursales",
      "usuarios.invitar",
      "usuarios.reenviar_invitacion",
      "usuarios.revocar_invitacion",
      "usuarios.ver",
    ]);
  });

  it("empresas exige las acciones de sucursales, módulos y permisos propios (casos de uso y consultas)", () => {
    expect([...new Set(declaradas["modulos/empresas"])].sort()).toEqual([
      "modulos.ver",
      "permisos.ver_propios",
      "sucursales.crear",
      "sucursales.desactivar",
      "sucursales.editar",
      "sucursales.reactivar",
      "sucursales.ver",
    ]);
  });

  it("administracion lo implementan exactamente las carpetas que exigen sus acciones", () => {
    expect([...CATALOGO_DE_MODULOS.administracion.implementadoPor].sort()).toEqual(
      Object.keys(declaradas).sort(),
    );
  });

  it("no tiene ningún problema de X1, X3, X4 ni de obligatorios", () => {
    expect(crucesDelCatalogo(CATALOGO_DE_MODULOS, declaradas)).toEqual([]);
  });

  it("X1 se dispara si empresas deja de exigir una acción del catálogo (violación inyectada)", () => {
    const sinPermisosPropios: AccionesPorCarpeta = {
      ...declaradas,
      "modulos/empresas":
        declaradas["modulos/empresas"]?.filter((a) => a !== "permisos.ver_propios") ?? [],
    };
    expect(crucesDelCatalogo(CATALOGO_DE_MODULOS, sinPermisosPropios)).toEqual([
      "X1: la acción permisos.ver_propios no la exige ningún caso de uso",
    ]);
  });

  it("X1 se dispara si una carpeta que el catálogo no lista exige una acción (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(CATALOGO_DE_MODULOS, {
        ...declaradas,
        "modulos/tenants": ["usuarios.ver"],
      }),
    ).toEqual([
      "X1: modulos/tenants exige usuarios.ver, pero administracion no figura implementado por esa carpeta",
    ]);
  });
});

describe("P6: el catálogo de prueba sano no da problemas (la base de las violaciones)", () => {
  it("sin violaciones", () => {
    expect(crucesDelCatalogo(SANO, DECLARADAS_SANAS, todasExisten)).toEqual([]);
  });
});

describe("P6: cada cruce se dispara con su violación inyectada", () => {
  const con = (cambios: Partial<Record<string, DefinicionDeModulo>>): CatalogoComercial => ({
    ...SANO,
    ...(cambios as CatalogoComercial),
  });

  it("X1: una carpeta exige una acción que ningún módulo declara", () => {
    const p = crucesDelCatalogo(
      SANO,
      { ...DECLARADAS_SANAS, "modulos/identidad": ["base.ver", "base.fantasma"] },
      todasExisten,
    );
    expect(p).toEqual(["X1: modulos/identidad exige base.fantasma, que ningún módulo declara"]);
  });

  it("X1: una carpeta exige una acción de un módulo que no figura implementado por ella", () => {
    const p = crucesDelCatalogo(
      SANO,
      { ...DECLARADAS_SANAS, "modulos/tenants": ["base.ver"] },
      todasExisten,
    );
    expect(p).toEqual([
      "X1: modulos/tenants exige base.ver, pero base no figura implementado por esa carpeta",
    ]);
  });

  it("X1: una acción del catálogo que ningún caso de uso exige", () => {
    const p = crucesDelCatalogo(SANO, { "modulos/identidad": ["base.ver"] }, todasExisten);
    expect(p).toEqual([
      "X1: la acción ventas.vender no la exige ningún caso de uso",
      "X1: la acción stock.mover no la exige ningún caso de uso",
    ]);
  });

  it("una acción repetida en dos módulos", () => {
    const p = crucesDelCatalogo(
      con({
        stock: modulo({ implementadoPor: ["modulos/empresas"], acciones: { "base.ver": accion } }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toContain("acción repetida: base.ver está en base y stock");
  });

  it("X3: requiere un módulo que no existe", () => {
    const p = crucesDelCatalogo(
      con({
        ventas: modulo({
          requiere: ["fantasma"],
          implementadoPor: ["modulos/empresas"],
          acciones: { "ventas.vender": accion },
        }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["X3: ventas requiere fantasma, que no existe"]);
  });

  it("X3: usa un módulo que no existe", () => {
    const p = crucesDelCatalogo(
      con({
        ventas: modulo({
          usaSiExiste: ["fantasma"],
          implementadoPor: ["modulos/empresas"],
          acciones: { "ventas.vender": accion },
        }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["X3: ventas usa fantasma, que no existe"]);
  });

  it("X3: un ciclo de requiere", () => {
    const p = crucesDelCatalogo(
      con({
        ventas: modulo({
          requiere: ["stock"],
          implementadoPor: ["modulos/empresas"],
          acciones: { "ventas.vender": accion },
        }),
        stock: modulo({
          requiere: ["ventas"],
          implementadoPor: ["modulos/empresas"],
          acciones: { "stock.mover": accion },
        }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["X3: ciclo de requiere: ventas → stock → ventas"]);
  });

  it("X3: un módulo que se requiere a sí mismo", () => {
    const p = crucesDelCatalogo(
      con({
        stock: modulo({
          requiere: ["stock"],
          implementadoPor: ["modulos/empresas"],
          acciones: { "stock.mover": accion },
        }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["X3: ciclo de requiere: stock → stock"]);
  });

  it("X3: una cadena que no es ciclo (diamante) no da problemas", () => {
    const p = crucesDelCatalogo(
      {
        a: modulo({ requiere: ["b", "c"], obligatorio: false, acciones: { "a.x": accion } }),
        b: modulo({ requiere: ["d"], acciones: { "b.x": accion } }),
        c: modulo({ requiere: ["d"], acciones: { "c.x": accion } }),
        d: modulo({ acciones: { "d.x": accion } }),
      },
      { "modulos/identidad": ["a.x", "b.x", "c.x", "d.x"] },
      todasExisten,
    );
    expect(p).toEqual([]);
  });

  it("X4: una carpeta de implementadoPor que no existe en src/", () => {
    const p = crucesDelCatalogo(SANO, DECLARADAS_SANAS, (c) => c !== "modulos/empresas");
    expect(p).toEqual([
      "X4: ventas dice que lo implementa modulos/empresas, que no existe en src/",
      "X4: stock dice que lo implementa modulos/empresas, que no existe en src/",
    ]);
  });

  it("X4: la carpeta se busca de verdad en src/ (no existe una carpeta inventada)", () => {
    expect(carpetaExiste("modulos/identidad")).toBe(true);
    expect(carpetaExiste("capacidades/modulos")).toBe(true);
    expect(carpetaExiste("modulos/inventada")).toBe(false);
    // Un archivo no es una carpeta.
    expect(carpetaExiste("modulos/identidad/publico.ts")).toBe(false);
    const p = crucesDelCatalogo(
      {
        base: modulo({ acciones: { "base.ver": accion }, implementadoPor: ["modulos/inventada"] }),
      },
      { "modulos/inventada": ["base.ver"] },
    );
    expect(p).toEqual(["X4: base dice que lo implementa modulos/inventada, que no existe en src/"]);
  });

  it("X4: un módulo disponible sin ninguna carpeta que lo implemente", () => {
    const p = crucesDelCatalogo(
      con({ stock: modulo({ implementadoPor: [], acciones: { "stock.mover": accion } }) }),
      { ...DECLARADAS_SANAS, "modulos/empresas": ["ventas.vender"] },
      todasExisten,
    );
    expect(p).toContain("X4: stock está disponible pero ninguna carpeta lo implementa");
  });

  it("un módulo en desarrollo puede no tener carpeta todavía", () => {
    const p = crucesDelCatalogo(
      con({ stock: modulo({ estado: "en_desarrollo", implementadoPor: [], acciones: {} }) }),
      { ...DECLARADAS_SANAS, "modulos/empresas": ["ventas.vender"] },
      todasExisten,
    );
    expect(p).toEqual([]);
  });

  it("un obligatorio que no está disponible", () => {
    const p = crucesDelCatalogo(
      con({
        base: modulo({
          obligatorio: true,
          estado: "en_desarrollo",
          acciones: { "base.ver": accion },
        }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["obligatorio: base es obligatorio pero no está disponible"]);
  });

  it("un obligatorio que requiere un módulo que no es obligatorio", () => {
    const p = crucesDelCatalogo(
      con({
        base: modulo({ obligatorio: true, requiere: ["stock"], acciones: { "base.ver": accion } }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["obligatorio: base es obligatorio pero requiere stock, que no lo es"]);
  });

  it("un obligatorio puede requerir a otro obligatorio", () => {
    const p = crucesDelCatalogo(
      {
        ...SANO,
        ventas: modulo({
          obligatorio: true,
          requiere: ["base"],
          implementadoPor: ["modulos/empresas"],
          acciones: { "ventas.vender": accion },
        }),
      },
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual([]);
  });
});
