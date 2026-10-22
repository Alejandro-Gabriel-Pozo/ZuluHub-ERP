import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_MODULOS,
  type CatalogoComercial,
  type DefinicionDeAccion,
  type DefinicionDeModulo,
  EFECTOS_DE_ACCION,
} from "../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import {
  DECLARACIONES_DE_EMPRESAS,
  DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
} from "../../src/modulos/empresas/publico";
import {
  DECLARACIONES_DE_CONFIGURACION_FISCAL,
  DECLARACIONES_DE_CONSULTAS_DE_FISCAL,
  DECLARACIONES_DE_CERTIFICADOS,
  DECLARACIONES_DE_FACTURACION,
  DECLARACIONES_DE_FISCAL,
} from "../../src/modulos/fiscal/publico";
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
 *  X5  Toda acción declara uno de los tres efectos para la solo lectura (corrección 16). El tipo ya lo
 *      exige al compilar; este cruce cubre lo que llega sin pasar por el tipo (un `as`, un dato).
 *  Además: una acción pertenece a un solo módulo; un módulo obligatorio está disponible y solo
 *  requiere obligatorios.
 *
 *  Módulos sin construir (T0 de catálogo y stock): `catalogo`, `carta` y `stock` declaran sus acciones
 *  antes de que existan sus carpetas y sus casos de uso (los traen T2 a T10). Mientras figuren en
 *  `SIN_CONSTRUIR` se les perdonan DOS cosas, y solo esas: que ningún caso de uso exija todavía una
 *  acción (X1 inverso) y que su carpeta no exista (X4). Todo lo demás rige igual. Previene: tener que
 *  inventar casos de uso falsos para pasar el gate, o aflojar X1 y X4 para todos los módulos. Lo
 *  impone la regla «sin construir»: solo cabe un módulo `en_desarrollo`, así que el cierre (T12,
 *  pasarlo a `disponible`) obliga a sacarlo de la lista y X1 y X4 pasan a regir completos.
 */

const RAIZ = join(import.meta.dirname, "../..");
const carpetaExiste = (carpeta: string): boolean => {
  const ruta = join(RAIZ, "src", carpeta);
  return existsSync(ruta) && statSync(ruta).isDirectory();
};

/** Las acciones que exige cada carpeta de `src/` por sus casos de uso y sus consultas. */
type AccionesPorCarpeta = Readonly<Record<string, readonly string[]>>;

/** Los módulos declarados en el catálogo cuyas carpetas y casos de uso todavía no existen (T0). */
const SIN_CONSTRUIR: readonly string[] = ["catalogo", "carta", "stock"];

function crucesDelCatalogo(
  catalogo: CatalogoComercial,
  declaradas: AccionesPorCarpeta,
  existe: (carpeta: string) => boolean = carpetaExiste,
  sinConstruir: readonly string[] = [],
): string[] {
  const problemas: string[] = [];
  const modulos = Object.entries(catalogo);

  // Sin construir: la lista solo admite módulos que existen y siguen en desarrollo.
  for (const clave of sinConstruir) {
    const modulo = catalogo[clave];
    if (modulo === undefined) {
      problemas.push(`sin construir: ${clave} no existe en el catálogo`);
    } else if (modulo.estado !== "en_desarrollo") {
      problemas.push(`sin construir: ${clave} figura sin construir pero ya está disponible`);
    }
  }

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
  for (const [accion, claves] of duenos) {
    const pendiente = claves.some((clave) => sinConstruir.includes(clave));
    if (!exigidas.has(accion) && !pendiente) {
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
      if (!existe(carpeta) && !sinConstruir.includes(clave))
        problemas.push(`X4: ${clave} dice que lo implementa ${carpeta}, que no existe en src/`);
    }
    if (modulo.estado === "disponible" && modulo.implementadoPor.length === 0) {
      problemas.push(`X4: ${clave} está disponible pero ninguna carpeta lo implementa`);
    }
  }

  // X5
  const efectos: readonly unknown[] = EFECTOS_DE_ACCION;
  for (const [clave, modulo] of modulos) {
    for (const [nombre, definicion] of Object.entries(modulo.acciones)) {
      if (!efectos.includes(definicion.efecto)) {
        problemas.push(`X5: la acción ${nombre} de ${clave} no declara un efecto válido`);
      }
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

const accion: DefinicionDeAccion = { capacidad: null, efecto: "LECTURA" };

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
    "modulos/fiscal": accionesDe(
      DECLARACIONES_DE_FISCAL,
      DECLARACIONES_DE_CONSULTAS_DE_FISCAL,
      DECLARACIONES_DE_FACTURACION,
      DECLARACIONES_DE_CERTIFICADOS,
      DECLARACIONES_DE_CONFIGURACION_FISCAL,
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

  it("fiscal exige emitir comprobantes (reservar, cerrar y numerar) y verlos (consultas), la configuración fiscal del gerente (T5); reconciliar es de sistema y no pasa por el guard", () => {
    expect([...new Set(declaradas["modulos/fiscal"])]).toEqual([
      "comprobantes.emitir",
      "comprobantes.ver",
      "comprobantes.emitir_manual",
      "notas_de_credito.emitir",
      "comprobantes.descartar",
      "comprobantes.reintentar",
      "series.resincronizar",
      "puntos_de_venta.cambiar_ambiente",
      "certificados.gestionar",
      "datos_fiscales.editar",
      "datos_fiscales.confirmar",
      "puntos_de_venta.crear",
      "puntos_de_venta.editar",
      "puntos_de_venta.activar",
      "puntos_de_venta.desactivar",
      "emisores.confirmar_regla",
    ]);
    expect(DECLARACIONES_DE_FISCAL.reconciliarSerie).toHaveProperty("sinGuard");
    expect(DECLARACIONES_DE_FISCAL.reconciliarSeriesVencidas).toHaveProperty("sinGuard");
    // F5: los dos trabajos de la facturación corren sin persona (ADR-007).
    expect(DECLARACIONES_DE_FACTURACION.validarComprobante).toHaveProperty("sinGuard");
    expect(DECLARACIONES_DE_FACTURACION.reconciliarComprobantes).toHaveProperty("sinGuard");
  });

  it("facturacion lo implementa fiscal, y es el único módulo que fiscal exige", () => {
    expect(CATALOGO_DE_MODULOS.facturacion.implementadoPor).toEqual(["modulos/fiscal"]);
  });

  it("administracion lo implementan exactamente las carpetas que exigen alguna de sus acciones", () => {
    const deAdministracion = Object.keys(CATALOGO_DE_MODULOS.administracion.acciones);
    expect([...CATALOGO_DE_MODULOS.administracion.implementadoPor].sort()).toEqual(
      Object.keys(declaradas)
        .filter((carpeta) => declaradas[carpeta]?.some((a) => deAdministracion.includes(a)))
        .sort(),
    );
  });

  it("la configuración fiscal del gerente (T5) es de administracion y no de facturacion: así se puede dejar lista antes de que la facturación exista", () => {
    const acciones = Object.values(DECLARACIONES_DE_CONFIGURACION_FISCAL).flatMap((d) =>
      "accion" in d ? [d.accion] : [],
    );
    expect(acciones).toHaveLength(7);
    for (const accion of acciones) {
      expect(Object.keys(CATALOGO_DE_MODULOS.administracion.acciones), accion).toContain(accion);
      expect(Object.keys(CATALOGO_DE_MODULOS.facturacion.acciones), accion).not.toContain(accion);
    }
    expect(CATALOGO_DE_MODULOS.administracion.implementadoPor).toContain("modulos/fiscal");
  });

  it("no tiene ningún problema de X1, X3, X4 ni de obligatorios", () => {
    expect(
      crucesDelCatalogo(CATALOGO_DE_MODULOS, declaradas, carpetaExiste, SIN_CONSTRUIR),
    ).toEqual([]);
  });

  it("catálogo, carta y stock son los únicos módulos sin construir, y siguen en desarrollo (T0)", () => {
    expect([...SIN_CONSTRUIR]).toEqual(["catalogo", "carta", "stock"]);
    for (const clave of SIN_CONSTRUIR) {
      expect(CATALOGO_DE_MODULOS[clave as keyof typeof CATALOGO_DE_MODULOS].estado, clave).toBe(
        "en_desarrollo",
      );
    }
  });

  it("sin la lista de módulos sin construir, X1 SÍ reclama sus acciones (el perdón es solo de ellos)", () => {
    const problemas = crucesDelCatalogo(CATALOGO_DE_MODULOS, declaradas);
    const exigidas = new Set(Object.values(declaradas).flat());
    const pendientes = SIN_CONSTRUIR.flatMap((clave) =>
      Object.keys(CATALOGO_DE_MODULOS[clave as keyof typeof CATALOGO_DE_MODULOS].acciones),
    ).filter((accion) => !exigidas.has(accion));
    expect(pendientes.length).toBeGreaterThan(0);
    for (const accion of pendientes) {
      expect(problemas, accion).toContain(`X1: la acción ${accion} no la exige ningún caso de uso`);
    }
  });

  it("X5: cada acción del catálogo real de empresa declara su efecto, y se usan los tres", () => {
    const efectos = Object.values(CATALOGO_DE_MODULOS.administracion.acciones).map((a) => a.efecto);
    expect(new Set(efectos)).toEqual(new Set(EFECTOS_DE_ACCION));
  });

  it("X1 se dispara si empresas deja de exigir una acción del catálogo (violación inyectada)", () => {
    const sinPermisosPropios: AccionesPorCarpeta = {
      ...declaradas,
      "modulos/empresas":
        declaradas["modulos/empresas"]?.filter((a) => a !== "permisos.ver_propios") ?? [],
    };
    expect(
      crucesDelCatalogo(CATALOGO_DE_MODULOS, sinPermisosPropios, carpetaExiste, SIN_CONSTRUIR),
    ).toEqual(["X1: la acción permisos.ver_propios no la exige ningún caso de uso"]);
  });

  it("X1 se dispara si fiscal deja de exigir todo lo que exige (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(
        CATALOGO_DE_MODULOS,
        { ...declaradas, "modulos/fiscal": [] },
        carpetaExiste,
        SIN_CONSTRUIR,
      ),
    ).toEqual([
      "X1: la acción datos_fiscales.editar no la exige ningún caso de uso",
      "X1: la acción datos_fiscales.confirmar no la exige ningún caso de uso",
      "X1: la acción puntos_de_venta.crear no la exige ningún caso de uso",
      "X1: la acción puntos_de_venta.editar no la exige ningún caso de uso",
      "X1: la acción puntos_de_venta.activar no la exige ningún caso de uso",
      "X1: la acción puntos_de_venta.desactivar no la exige ningún caso de uso",
      "X1: la acción emisores.confirmar_regla no la exige ningún caso de uso",
      "X1: la acción comprobantes.emitir no la exige ningún caso de uso",
      "X1: la acción comprobantes.ver no la exige ningún caso de uso",
      "X1: la acción comprobantes.emitir_manual no la exige ningún caso de uso",
      "X1: la acción notas_de_credito.emitir no la exige ningún caso de uso",
      "X1: la acción comprobantes.descartar no la exige ningún caso de uso",
      "X1: la acción comprobantes.reintentar no la exige ningún caso de uso",
      "X1: la acción series.resincronizar no la exige ningún caso de uso",
      "X1: la acción puntos_de_venta.cambiar_ambiente no la exige ningún caso de uso",
      "X1: la acción certificados.gestionar no la exige ningún caso de uso",
    ]);
  });

  it("X1 se dispara si fiscal deja de exigir comprobantes.ver, la de sus consultas (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(
        CATALOGO_DE_MODULOS,
        {
          ...declaradas,
          "modulos/fiscal":
            declaradas["modulos/fiscal"]?.filter((a) => a !== "comprobantes.ver") ?? [],
        },
        carpetaExiste,
        SIN_CONSTRUIR,
      ),
    ).toEqual(["X1: la acción comprobantes.ver no la exige ningún caso de uso"]);
  });

  it("X1 se dispara si fiscal deja de exigir una acción de la configuración fiscal (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(
        CATALOGO_DE_MODULOS,
        {
          ...declaradas,
          "modulos/fiscal":
            declaradas["modulos/fiscal"]?.filter((a) => a !== "datos_fiscales.confirmar") ?? [],
        },
        carpetaExiste,
        SIN_CONSTRUIR,
      ),
    ).toEqual(["X1: la acción datos_fiscales.confirmar no la exige ningún caso de uso"]);
  });

  it("X1 se dispara si una carpeta que el catálogo no lista exige una acción (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(
        CATALOGO_DE_MODULOS,
        { ...declaradas, "modulos/tenants": ["usuarios.ver"] },
        carpetaExiste,
        SIN_CONSTRUIR,
      ),
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

  it("X5: una acción sin efecto (un dato que esquivó el tipo)", () => {
    const sinEfecto = { capacidad: null } as unknown as DefinicionDeAccion;
    const p = crucesDelCatalogo(
      con({ base: modulo({ obligatorio: true, acciones: { "base.ver": sinEfecto } }) }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["X5: la acción base.ver de base no declara un efecto válido"]);
  });

  it("X5: una acción con un efecto que no existe", () => {
    const inventado = { capacidad: null, efecto: "ESCRITURA" } as unknown as DefinicionDeAccion;
    const p = crucesDelCatalogo(
      con({
        stock: modulo({
          implementadoPor: ["modulos/empresas"],
          acciones: { "stock.mover": inventado },
        }),
      }),
      DECLARADAS_SANAS,
      todasExisten,
    );
    expect(p).toEqual(["X5: la acción stock.mover de stock no declara un efecto válido"]);
  });

  it("X5: los tres efectos válidos no dan problemas", () => {
    const p = crucesDelCatalogo(
      con({
        base: modulo({
          obligatorio: true,
          acciones: {
            "base.ver": { capacidad: null, efecto: "LECTURA" },
            "base.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
            "base.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          },
        }),
      }),
      {
        ...DECLARADAS_SANAS,
        "modulos/identidad": ["base.ver", "base.crear", "base.cerrar"],
      },
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

describe("módulos sin construir: el perdón de X1 inverso y de X4 es solo de la lista y solo de esas dos cosas", () => {
  const enDesarrollo = (cambios: Partial<DefinicionDeModulo> = {}) =>
    modulo({ estado: "en_desarrollo", implementadoPor: ["modulos/catalogo"], ...cambios });
  const conVentasEnDesarrollo = (cambios: Partial<DefinicionDeModulo> = {}): CatalogoComercial => ({
    ...SANO,
    ventas: enDesarrollo({
      requiere: ["base"],
      acciones: { "ventas.vender": accion },
      ...cambios,
    }),
  });
  const declaradas: AccionesPorCarpeta = {
    "modulos/identidad": ["base.ver"],
    "modulos/empresas": ["stock.mover"],
  };
  const soloVentasExiste = (carpeta: string) => carpeta !== "modulos/catalogo";

  it("un módulo de la lista, en desarrollo, sin carpeta y sin casos de uso, no da problemas", () => {
    expect(
      crucesDelCatalogo(conVentasEnDesarrollo(), declaradas, soloVentasExiste, ["ventas"]),
    ).toEqual([]);
  });

  it("sin la lista, el mismo módulo da X1 y X4: el perdón no es automático por estar en desarrollo", () => {
    expect(crucesDelCatalogo(conVentasEnDesarrollo(), declaradas, soloVentasExiste)).toEqual([
      "X1: la acción ventas.vender no la exige ningún caso de uso",
      "X4: ventas dice que lo implementa modulos/catalogo, que no existe en src/",
    ]);
  });

  it("el perdón no alcanza a los demás módulos", () => {
    expect(
      crucesDelCatalogo(
        conVentasEnDesarrollo(),
        { "modulos/identidad": ["base.ver"] },
        soloVentasExiste,
        ["ventas"],
      ),
    ).toEqual(["X1: la acción stock.mover no la exige ningún caso de uso"]);
  });

  it("un módulo de la lista que ya está disponible se reclama: el cierre obliga a sacarlo", () => {
    expect(crucesDelCatalogo(SANO, DECLARADAS_SANAS, todasExisten, ["ventas"])).toEqual([
      "sin construir: ventas figura sin construir pero ya está disponible",
    ]);
  });

  it("un módulo de la lista que no existe en el catálogo se reclama", () => {
    expect(crucesDelCatalogo(SANO, DECLARADAS_SANAS, todasExisten, ["fantasma"])).toEqual([
      "sin construir: fantasma no existe en el catálogo",
    ]);
  });

  it("lo que un módulo de la lista SÍ declara se sigue verificando (X1: una acción en otra carpeta)", () => {
    expect(
      crucesDelCatalogo(
        conVentasEnDesarrollo(),
        { ...declaradas, "modulos/tenants": ["ventas.vender"] },
        soloVentasExiste,
        ["ventas"],
      ),
    ).toEqual([
      "X1: modulos/tenants exige ventas.vender, pero ventas no figura implementado por esa carpeta",
    ]);
  });

  it("lo que un módulo de la lista SÍ declara se sigue verificando (X3: requiere un módulo inexistente)", () => {
    expect(
      crucesDelCatalogo(
        conVentasEnDesarrollo({ requiere: ["fantasma"] }),
        declaradas,
        soloVentasExiste,
        ["ventas"],
      ),
    ).toEqual(["X3: ventas requiere fantasma, que no existe"]);
  });

  it("lo que un módulo de la lista SÍ declara se sigue verificando (X5: un efecto inválido)", () => {
    const inventado = { capacidad: null, efecto: "ESCRITURA" } as unknown as DefinicionDeAccion;
    expect(
      crucesDelCatalogo(
        conVentasEnDesarrollo({ acciones: { "ventas.vender": inventado } }),
        declaradas,
        soloVentasExiste,
        ["ventas"],
      ),
    ).toEqual(["X5: la acción ventas.vender de ventas no declara un efecto válido"]);
  });
});

describe("H5 P3: el catálogo de plataforma cumple los cruces", () => {
  const acciones = Object.keys(CATALOGO_DE_PLATAFORMA.plataforma.acciones);

  it("X5: cada acción del catálogo de plataforma declara su efecto, y se usan los tres", () => {
    const efectos = Object.values(CATALOGO_DE_PLATAFORMA.plataforma.acciones).map((a) => a.efecto);
    expect(new Set(efectos)).toEqual(new Set(EFECTOS_DE_ACCION));
  });

  it("X3, X4 y los obligatorios: sin problemas (X1 se completa cuando P5 y P6 declaren los casos de uso)", () => {
    // Acá se presenta cada acción como exigida por su carpeta: lo que se comprueba de verdad es el
    // resto de los cruces (módulos que existen, sin ciclos, carpeta real, obligatorio disponible).
    expect(crucesDelCatalogo(CATALOGO_DE_PLATAFORMA, { plataforma: acciones })).toEqual([]);
  });

  it("lo implementa exactamente la carpeta src/plataforma, que existe", () => {
    expect(CATALOGO_DE_PLATAFORMA.plataforma.implementadoPor).toEqual(["plataforma"]);
    expect(carpetaExiste("plataforma")).toBe(true);
  });

  it("X4 se dispara si la carpeta de plataforma no existe (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(
        CATALOGO_DE_PLATAFORMA,
        { plataforma: acciones },
        (carpeta) => carpeta !== "plataforma",
      ),
    ).toEqual(["X4: plataforma dice que lo implementa plataforma, que no existe en src/"]);
  });

  it("X1 se dispara si una acción de plataforma no la exige ningún caso de uso (violación inyectada)", () => {
    expect(
      crucesDelCatalogo(CATALOGO_DE_PLATAFORMA, {
        plataforma: acciones.filter((a) => a !== "empresas.alta"),
      }),
    ).toEqual(["X1: la acción empresas.alta no la exige ningún caso de uso"]);
  });
});
