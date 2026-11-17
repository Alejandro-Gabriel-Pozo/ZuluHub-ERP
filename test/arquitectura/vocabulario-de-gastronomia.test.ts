import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validarVocabulario,
  type Vocabulario,
} from "../../src/capacidades/vocabulario/vocabulario";

/**
 * «Gastronomía» es una marca hija cargada como dato desde la consola, sin código de perfil
 * (e0-cimientos §3.5.2, opción A; PP-4 decidido el 09/11/2026 por la sesión padre). Previene dos fallos:
 * (1) que alguien cambie una clave o un marcador del catálogo y el vocabulario que el dueño va a cargar
 * deje de validar, y recién se note al guardar la marca; (2) que aparezca un «perfil» en código (concepto
 * que el modelo no tiene: `marcas-productos-y-planes.md:138`, «no es perfil»).
 */

/**
 * Los reemplazos de Gastronomía, por clave del catálogo real. Cada etapa suma los suyos junto a la
 * clave, con su fuente verificable (documento y línea, o decisión con su fecha y quién la tomó): sin
 * fuente no se agrega (CLAUDE.md, «Lo que el dueño no aprobó lleva su fuente»). Hoy no hay ninguno: el
 * catálogo de `catalogo`, `caja` y `ventas` nace vacío (E0-T4) y ningún reemplazo aprobado tiene fuente
 * (pregunta pendiente en el informe de E0-T5).
 */
const VOCABULARIO_DE_GASTRONOMIA: Vocabulario = {};

describe("perfil Gastronomía: un vocabulario cargado como dato (e0 §3.5.2)", () => {
  it("el vocabulario de ejemplo de Gastronomía lo acepta validarVocabulario contra el catálogo real, sin cambios", () => {
    const r = validarVocabulario(VOCABULARIO_DE_GASTRONOMIA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toEqual(VOCABULARIO_DE_GASTRONOMIA);
  });

  it("la validación no es vacía: una clave que el catálogo no tiene y un marcador de más se rechazan", () => {
    const desconocida = validarVocabulario({
      ...VOCABULARIO_DE_GASTRONOMIA,
      "caja.no.existe": "x",
    });
    expect(desconocida).toMatchObject({
      ok: false,
      error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA" },
    });
    const conMarcador = validarVocabulario({
      ...VOCABULARIO_DE_GASTRONOMIA,
      "rol.operador.nombre": "Mozo {x}",
    });
    expect(conMarcador).toMatchObject({ ok: false, error: { codigo: "MARCADORES_DISTINTOS" } });
  });

  it("no hay código de perfil: ningún archivo ni código fuente nombra «gastronomía» (solo comentarios)", () => {
    const raiz = join(__dirname, "..", "..");
    const hallazgos: string[] = [];
    const sinAcentos = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const recorrer = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
        const ruta = join(dir, e.name);
        if (e.isDirectory()) {
          recorrer(ruta);
          continue;
        }
        if (!/\.(ts|tsx|js|cjs|mjs|sql|json)$/.test(e.name)) continue;
        if (sinAcentos(e.name).includes("gastronomia"))
          hallazgos.push(`${relative(raiz, ruta)} (nombre)`);
        readFileSync(ruta, "utf8")
          .split("\n")
          .forEach((linea, i) => {
            const t = linea.trim();
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
            if (sinAcentos(t).includes("gastronomia"))
              hallazgos.push(`${relative(raiz, ruta)}:${i + 1}`);
          });
      }
    };
    for (const d of ["src", "apps", "scripts", "migraciones"]) recorrer(join(raiz, d));
    expect(hallazgos).toEqual([]);
  });
});
