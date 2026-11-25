import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  DECLARACIONES_DE_CAJA,
  DECLARACIONES_DE_CONSULTAS_DE_CAJA,
} from "../../src/modulos/caja/publico";
import {
  DECLARACIONES_DE_CATALOGO,
  DECLARACIONES_DE_CONSULTAS_DE_CATALOGO,
} from "../../src/modulos/catalogo/publico";
import {
  DECLARACIONES_DE_CIERRE,
  DECLARACIONES_DE_CONSULTAS_DE_CIERRE,
} from "../../src/modulos/cierre/publico";
import {
  DECLARACIONES_DE_CLIENTES,
  DECLARACIONES_DE_CONSULTAS_DE_CLIENTES,
} from "../../src/modulos/clientes/publico";
import {
  DECLARACIONES_DE_COMANDAS,
  DECLARACIONES_DE_CONSULTAS_DE_COMANDAS,
} from "../../src/modulos/comandas/publico";
import {
  DECLARACIONES_DE_COMPRAS,
  DECLARACIONES_DE_CONSULTAS_DE_COMPRAS,
} from "../../src/modulos/compras/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
  DECLARACIONES_DE_EMPRESAS,
} from "../../src/modulos/empresas/publico";
import {
  DECLARACIONES_DE_CERTIFICADOS,
  DECLARACIONES_DE_CONFIGURACION_FISCAL,
  DECLARACIONES_DE_CONSULTAS_DE_FISCAL,
  DECLARACIONES_DE_FACTURACION,
  DECLARACIONES_DE_FISCAL,
} from "../../src/modulos/fiscal/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD,
  DECLARACIONES_DE_IDENTIDAD,
} from "../../src/modulos/identidad/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_PORTAL,
  DECLARACIONES_DE_PORTAL,
} from "../../src/modulos/portal/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_PRODUCCION,
  DECLARACIONES_DE_PRODUCCION,
} from "../../src/modulos/produccion/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_SALON,
  DECLARACIONES_DE_SALON,
} from "../../src/modulos/salon/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_STOCK,
  DECLARACIONES_DE_STOCK,
} from "../../src/modulos/stock/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_VENTAS,
  DECLARACIONES_DE_VENTAS,
} from "../../src/modulos/ventas/publico";
import { type IndiceDeDocs } from "../../scripts/indice-de-docs";
import {
  analizarGrafo,
  construirGrafo,
  type EntradaDeBrief,
  type EntradaDeFicha,
  type EntradaDelGrafo,
} from "./grafo-apoyo";
import {
  accionesExigidasDentroDeUnCaso,
  casosDeDeclaraciones,
  leerFuentes,
  leerMigraciones,
  leerRutas,
  maquetasCitadas,
  nombresAlcanzadosPorPagina,
  usoDeTablas,
} from "./grafo-lectores";

/**
 * EL GRAFO DEL SISTEMA, ETAPA 0: MIDE y NO falla por lo que mide (orden del dueño del 23/11/2026; diseño aprobado el 21/11/2026 en
 * `Pedernal-docs/11-especificaciones/diseno-del-grafo-del-sistema-2026-11-21.md`). Misma forma que `declaracion-de-pantallas.test.ts`:
 * escribe `arquitectura/grafo/informe.json` y `arquitectura/grafo/grafo.json` (no se commitean) y solo falla si el propio generador se
 * rompe (mira vacío, ficha ilegible, informe que no suma). Qué falle por categoría lo decide la etapa 1, con presupuesto que solo baja.
 * Cada categoría tiene su caso inyectado en `grafo-evasiones.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "../..");

/** Cifras medidas a mano el 21/11/2026 (`servidor-sin-pantalla-y-faltante-por-pack-2026-11-21.md`, resumen 1 y 2): solo se comparan, no se exigen. */
const REFERENCIA_DEL_21_11 = {
  acciones: 177,
  accionesConPantalla: 66,
  accionesSinPantalla: 110,
  accionesSinCasoDeUso: 12,
} as const;

const CASOS = [
  ...casosDeDeclaraciones("caja", "caso", DECLARACIONES_DE_CAJA),
  ...casosDeDeclaraciones("caja", "consulta", DECLARACIONES_DE_CONSULTAS_DE_CAJA),
  ...casosDeDeclaraciones("catalogo", "caso", DECLARACIONES_DE_CATALOGO),
  ...casosDeDeclaraciones("catalogo", "consulta", DECLARACIONES_DE_CONSULTAS_DE_CATALOGO),
  ...casosDeDeclaraciones("cierre", "caso", DECLARACIONES_DE_CIERRE),
  ...casosDeDeclaraciones("cierre", "consulta", DECLARACIONES_DE_CONSULTAS_DE_CIERRE),
  ...casosDeDeclaraciones("clientes", "caso", DECLARACIONES_DE_CLIENTES),
  ...casosDeDeclaraciones("clientes", "consulta", DECLARACIONES_DE_CONSULTAS_DE_CLIENTES),
  ...casosDeDeclaraciones("comandas", "caso", DECLARACIONES_DE_COMANDAS),
  ...casosDeDeclaraciones("comandas", "consulta", DECLARACIONES_DE_CONSULTAS_DE_COMANDAS),
  ...casosDeDeclaraciones("compras", "caso", DECLARACIONES_DE_COMPRAS),
  ...casosDeDeclaraciones("compras", "consulta", DECLARACIONES_DE_CONSULTAS_DE_COMPRAS),
  ...casosDeDeclaraciones("empresas", "caso", DECLARACIONES_DE_EMPRESAS),
  ...casosDeDeclaraciones("empresas", "consulta", DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS),
  ...casosDeDeclaraciones("fiscal", "caso", DECLARACIONES_DE_CERTIFICADOS),
  ...casosDeDeclaraciones("fiscal", "caso", DECLARACIONES_DE_CONFIGURACION_FISCAL),
  ...casosDeDeclaraciones("fiscal", "caso", DECLARACIONES_DE_FACTURACION),
  ...casosDeDeclaraciones("fiscal", "caso", DECLARACIONES_DE_FISCAL),
  ...casosDeDeclaraciones("fiscal", "consulta", DECLARACIONES_DE_CONSULTAS_DE_FISCAL),
  ...casosDeDeclaraciones("identidad", "caso", DECLARACIONES_DE_IDENTIDAD),
  ...casosDeDeclaraciones("identidad", "consulta", DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD),
  ...casosDeDeclaraciones("portal", "caso", DECLARACIONES_DE_PORTAL),
  ...casosDeDeclaraciones("portal", "consulta", DECLARACIONES_DE_CONSULTAS_DE_PORTAL),
  ...casosDeDeclaraciones("produccion", "caso", DECLARACIONES_DE_PRODUCCION),
  ...casosDeDeclaraciones("produccion", "consulta", DECLARACIONES_DE_CONSULTAS_DE_PRODUCCION),
  ...casosDeDeclaraciones("salon", "caso", DECLARACIONES_DE_SALON),
  ...casosDeDeclaraciones("salon", "consulta", DECLARACIONES_DE_CONSULTAS_DE_SALON),
  ...casosDeDeclaraciones("stock", "caso", DECLARACIONES_DE_STOCK),
  ...casosDeDeclaraciones("stock", "consulta", DECLARACIONES_DE_CONSULTAS_DE_STOCK),
  ...casosDeDeclaraciones("ventas", "caso", DECLARACIONES_DE_VENTAS),
  ...casosDeDeclaraciones("ventas", "consulta", DECLARACIONES_DE_CONSULTAS_DE_VENTAS),
];

/** Las fichas de `src/capacidades/pantallas/ficha-de-*.ts`: cada una exporta una constante `FICHA_DE_…` con `rutas` y `acceso`. */
async function leerFichas(): Promise<readonly EntradaDeFicha[]> {
  const carpeta = join(RAIZ, "src/capacidades/pantallas");
  const archivos = readdirSync(carpeta)
    .filter((a) => /^ficha-de-.*\.ts$/.test(a) && !a.endsWith(".test.ts"))
    .sort();
  const fichas: EntradaDeFicha[] = [];
  for (const archivo of archivos) {
    const base = archivo.replace(/\.ts$/, "");
    const modulo = (await import(`../../src/capacidades/pantallas/${base}.ts`)) as Record<
      string,
      unknown
    >;
    for (const [nombre, valor] of Object.entries(modulo)) {
      if (!nombre.startsWith("FICHA_DE_") || typeof valor !== "object" || valor === null) continue;
      const ficha = valor as { rutas?: unknown; acceso?: unknown };
      if (!Array.isArray(ficha.rutas)) continue;
      const acceso = typeof ficha.acceso === "string" ? ficha.acceso : null;
      const acciones = new Set<string>(acceso === null ? [] : [acceso]);
      const recorrer = (x: unknown): void => {
        if (Array.isArray(x)) x.forEach(recorrer);
        else if (typeof x === "object" && x !== null)
          for (const [k, v] of Object.entries(x)) {
            if (k === "envia" && typeof v === "string") acciones.add(v);
            else recorrer(v);
          }
      };
      recorrer(valor);
      fichas.push({
        id: base.replace(/^ficha-de-/, ""),
        archivo: `src/capacidades/pantallas/${archivo}`,
        rutas: ficha.rutas.filter((r): r is string => typeof r === "string"),
        acceso,
        acciones: [...acciones].sort(),
        maquetasCitadas: maquetasCitadas(readFileSync(join(carpeta, archivo), "utf8")),
      });
    }
  }
  return fichas;
}

function leerIndice(): IndiceDeDocs {
  return JSON.parse(
    readFileSync(join(RAIZ, "arquitectura/grafo/indice-de-docs.json"), "utf8"),
  ) as IndiceDeDocs;
}

async function armarLaEntrada(): Promise<EntradaDelGrafo> {
  const fuentes = leerFuentes(RAIZ);
  const rutas = leerRutas(fuentes);
  const migraciones = leerMigraciones(RAIZ);
  const indice = leerIndice();
  const briefs: EntradaDeBrief[] = indice.briefs
    .filter((b) => b.tipo === "brief")
    .map((b) => ({
      id: b.id,
      pack: b.pack,
      archivo: b.archivo,
      procedencia: b.procedencia,
      ramas: b.ramas,
      titulo: b.titulo,
      acciones: b.acciones,
      rutas: b.rutas,
      maquetas: b.maquetas,
      funciones: b.funciones,
      tablas: b.tablas,
    }));
  return {
    modulos: Object.entries(CATALOGO_DE_MODULOS).map(([clave, m]) => ({
      clave,
      estado: m.estado,
      acciones: Object.keys(m.acciones),
      implementadoPor: m.implementadoPor,
    })),
    casos: CASOS,
    rutas,
    nombresAlcanzadosPorRuta: nombresAlcanzadosPorPagina(fuentes, rutas),
    fichas: await leerFichas(),
    accionesExigidasDentroDeUnCaso: accionesExigidasDentroDeUnCaso(
      fuentes,
      Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
    ),
    migraciones: migraciones.migraciones,
    tablas: usoDeTablas(fuentes, migraciones),
    maquetas: indice.maquetas,
    briefs,
  };
}

describe("el grafo del sistema: el código real (solo mide)", async () => {
  const entrada = await armarLaEntrada();
  const grafo = construirGrafo(entrada);
  const informe = analizarGrafo(grafo, entrada);

  it("no pasa en vacío: lee módulos, acciones, casos de uso, páginas, fichas, tablas, maquetas y briefs reales", () => {
    expect(informe.medidas.acciones).toBeGreaterThan(150);
    expect(informe.medidas.casosDeUso).toBeGreaterThan(250);
    expect(informe.medidas.paginas).toBeGreaterThan(60);
    expect(informe.medidas.fichas).toBeGreaterThanOrEqual(10);
    expect(informe.medidas.tablas).toBeGreaterThan(40);
    expect(informe.medidas.maquetas).toBeGreaterThan(40);
    expect(informe.medidas.briefs).toBeGreaterThan(20);
    expect(informe.medidas.nodosPorTipo.modulo).toBe(Object.keys(CATALOGO_DE_MODULOS).length);
    expect(informe.medidas.aristasPorTipo.protege).toBeGreaterThan(250);
    expect(informe.medidas.aristasPorTipo.se_ve_en).toBeGreaterThan(50);
  });

  it("cada acción del catálogo es un nodo y toda arista une nodos que existen", () => {
    const ids = new Set(grafo.nodos.map((n) => n.id));
    expect(ids.size).toBe(grafo.nodos.length);
    for (const a of grafo.aristas) {
      expect(ids.has(a.de), a.de).toBe(true);
      expect(ids.has(a.hacia), a.hacia).toBe(true);
    }
  });

  it("escribe el informe y el grafo (no se commitean) y las categorías de briefs suman los briefs medidos", () => {
    const carpeta = join(RAIZ, "arquitectura/grafo");
    mkdirSync(carpeta, { recursive: true });
    const cuenta = (c: keyof typeof informe.categorias): number => informe.categorias[c].cuenta;
    const medidosContraLaReferencia = {
      acciones: { referencia: REFERENCIA_DEL_21_11.acciones, hoy: informe.medidas.acciones },
      accionesConPantalla: {
        referencia: REFERENCIA_DEL_21_11.accionesConPantalla,
        hoy: cuenta("accion_con_pantalla"),
      },
      accionesSinPantalla: {
        referencia: REFERENCIA_DEL_21_11.accionesSinPantalla,
        hoy: cuenta("accion_sin_pantalla"),
      },
      accionesSinCasoDeUso: {
        referencia: REFERENCIA_DEL_21_11.accionesSinCasoDeUso,
        hoy: cuenta("accion_sin_caso_de_uso"),
      },
    };
    writeFileSync(
      join(carpeta, "informe.json"),
      `${JSON.stringify(
        {
          medidas: informe.medidas,
          contraLaReferenciaDel21_11: medidosContraLaReferencia,
          categorias: informe.categorias,
          briefsPorPack: informe.briefsPorPack,
          briefsNoIntegradosPorPack: informe.briefsNoIntegradosPorPack,
          briefsContraElCodigo: informe.briefsContraElCodigo,
        },
        null,
        1,
      )}\n`,
    );
    writeFileSync(join(carpeta, "grafo.json"), `${JSON.stringify(grafo)}\n`);
    expect(
      cuenta("brief_con_codigo") +
        cuenta("brief_parcial") +
        cuenta("brief_sin_codigo") +
        cuenta("brief_sin_enlace"),
    ).toBe(informe.medidas.briefsEnMain);
    expect(
      cuenta("brief_no_integrado_con_codigo") +
        cuenta("brief_no_integrado_parcial") +
        cuenta("brief_no_integrado_sin_codigo") +
        cuenta("brief_no_integrado_sin_enlace"),
    ).toBe(informe.medidas.briefsSoloEnRama);
    expect(cuenta("accion_con_pantalla") + cuenta("accion_sin_pantalla")).toBe(
      informe.medidas.acciones,
    );
  });
});
