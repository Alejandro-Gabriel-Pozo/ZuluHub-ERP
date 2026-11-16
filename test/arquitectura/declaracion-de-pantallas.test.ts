import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMINOS } from "../../src/capacidades/datos/caminos";
import { COMPONENTES_DE_CAMPO, REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  COMPONENTES_DE_BOTON,
  COMPONENTES_DE_MODAL,
} from "../../src/capacidades/pantallas/componentes-de-ficha";
import { FICHAS } from "../../src/capacidades/pantallas/fichas";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { EXTENSIONES_DE_CODIGO } from "./campos-con-dato-apoyo";
import {
  analizarDeclaraciones,
  type ContextoDeDeclaraciones,
} from "./declaracion-de-pantallas-apoyo";

/**
 * MIDE las declaraciones de textos y de pantallas (tramo U2; decisión del dueño, filas 173 y 174 de `decisiones-del-dueno-2026-11.md`):
 * reglas R1 a R4 (textos) y P1 a P4 (pantallas) de `test/arquitectura/declaracion-de-pantallas-apoyo.ts`. TODAVÍA NO EXIGE lo existente:
 * escribe el informe (`arquitectura/declaraciones/informe.json`, no se commitea) y solo falla si el propio chequeo se rompe (no mira nada,
 * una lista de componentes apunta a un archivo que no existe, o una ficha declarada no cumple). Lo que se exige y desde cuándo lo decide
 * el tramo que sigue (U4), con deuda con vencimiento y presupuesto por archivo que solo baja, como `campos-sin-dato`.
 * Cada regla tiene su violación inyectada en `declaracion-de-pantallas-evasiones.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "../..");
const ES_DE_PRUEBA = /\.(test|recorrido)\.[cm]?[jt]sx?$/;

/** Todo el código de `src/` y de `apps/` (todas las extensiones), sin las pruebas: las pruebas citan textos como ejemplo. */
function leerElCodigo(): Map<string, string> {
  const codigo = new Map<string, string>();
  for (const base of ["src", "apps"]) {
    for (const r of readdirSync(join(RAIZ, base), { recursive: true, encoding: "utf8" })) {
      const partes = r.split("/");
      if (partes.some((p) => p === "node_modules" || p === ".next" || p === ".vitest")) continue;
      if (!(EXTENSIONES_DE_CODIGO as readonly string[]).includes(r.split(".").pop() ?? ""))
        continue;
      if (ES_DE_PRUEBA.test(r)) continue;
      codigo.set(`${base}/${r}`, readFileSync(join(RAIZ, base, r), "utf8"));
    }
  }
  return codigo;
}

const MODULO_DE_ACCION = new Map<string, string>(
  Object.entries(CATALOGO_DE_MODULOS).flatMap(([modulo, definicion]) =>
    Object.keys(definicion.acciones).map((accion): [string, string] => [accion, modulo]),
  ),
);

const CONTEXTO = (codigo: ReadonlyMap<string, string>): ContextoDeDeclaraciones => ({
  catalogo: CATALOGO_DE_TEXTOS,
  datos: REGISTRO_DE_DATOS,
  caminos: CAMINOS,
  fichas: FICHAS,
  codigo,
  componentesDeBoton: COMPONENTES_DE_BOTON,
  componentesDeModal: COMPONENTES_DE_MODAL,
  componentesDeCampo: COMPONENTES_DE_CAMPO,
  moduloDeAccion: (accion) => MODULO_DE_ACCION.get(accion),
  // La tabla de frontera (tramo U0) todavía no existe: sin ella no se sabe el módulo de un archivo y P2 falla cerrado. Con `FICHAS`
  // vacío no se nota; la primera ficha obliga a cerrar U0 o a declarar el módulo.
  moduloDeArchivo: () => undefined,
});

describe("declaraciones de textos y pantallas: el código real (solo mide)", () => {
  const codigo = leerElCodigo();
  const informe = analizarDeclaraciones(CONTEXTO(codigo));

  it("no pasa en vacío: mira el catálogo, el código, los botones y los campos reales", () => {
    expect(informe.medidas.archivosAnalizados).toBeGreaterThan(500);
    expect(informe.medidas.clavesEnElCatalogo).toBeGreaterThan(800);
    expect(informe.medidas.citasLiterales).toBeGreaterThan(100);
    expect(informe.medidas.llamadasATexto).toBeGreaterThan(50);
    expect(informe.medidas.botones).toBeGreaterThan(50);
    expect(informe.medidas.camposConDato).toBeGreaterThan(20);
  });

  it("las listas de componentes vigilados apuntan a archivos que existen y que el analizador lee", () => {
    for (const ruta of [...COMPONENTES_DE_BOTON, ...COMPONENTES_DE_MODAL]) {
      expect(existsSync(join(RAIZ, ruta)), ruta).toBe(true);
      expect(codigo.has(ruta), ruta).toBe(true);
    }
  });

  it("escribe el informe de la medición (no se commitea) y lo hecho coincide con lo contado", () => {
    const carpeta = join(RAIZ, "arquitectura/declaraciones");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(
      join(carpeta, "informe.json"),
      `${JSON.stringify({ porRegla: informe.porRegla, medidas: informe.medidas, hallazgos: informe.hallazgos }, null, 1)}\n`,
    );
    const suma = Object.values(informe.porRegla).reduce((a, b) => a + b, 0);
    expect(suma).toBe(informe.hallazgos.length);
  });

  it("las fichas declaradas cumplen P1 a P4 (hoy no hay ninguna: nace vacío)", () => {
    const deFichas = informe.hallazgos.filter((h) => /^P[1-4]$/.test(h.regla));
    expect(deFichas).toEqual([]);
    expect(informe.medidas.fichas).toBe(Object.keys(FICHAS).length);
  });
});
