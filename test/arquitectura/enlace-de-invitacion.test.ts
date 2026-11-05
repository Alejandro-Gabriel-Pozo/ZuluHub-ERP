import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armarEnlaceDeInvitacion } from "../../src/modulos/identidad/publico";

/**
 * El enlace del mail de invitación apunta a la pantalla que existe en la web. Falla que previene: backend y web
 * divergen en la ruta o en el parámetro (hecho real, 2026-11-05: el mail llevaba `/invitaciones/<token>` y la
 * pantalla es `/invitacion?t=<token>`; el gerente veía «No encontrado» y no podía entrar).
 * Se ata por archivo: el camino del enlace debe ser una carpeta con `page.tsx` bajo `(entrada)` y esa página debe leer
 * el parámetro con el mismo nombre. Las carpetas de grupo `s/app/(entrada)` no forman parte de la dirección pública.
 */

const RAIZ_DE_PANTALLAS = join(process.cwd(), "apps", "web", "app", "s", "app", "(entrada)");
const TOKEN = "tok_de-prueba123";

describe("enlace de invitación ↔ pantalla de la web", () => {
  const enlace = new URL(armarEnlaceDeInvitacion("https://app.ejemplo.test", TOKEN));
  const carpeta = join(RAIZ_DE_PANTALLAS, ...enlace.pathname.split("/").filter((p) => p !== ""));
  const pagina = join(carpeta, "page.tsx");
  const [parametro] = [...enlace.searchParams.keys()];

  it("el camino del enlace es una pantalla que existe", () => {
    expect(enlace.pathname).toBe("/invitacion");
    expect(existsSync(pagina)).toBe(true);
  });

  it("el token viaja en un único parámetro de la consulta y esa pantalla lo lee con el mismo nombre", () => {
    expect([...enlace.searchParams.keys()]).toEqual(["t"]);
    expect(enlace.searchParams.get("t")).toBe(TOKEN);
    expect(existsSync(pagina)).toBe(true);
    const fuente = readFileSync(pagina, "utf8");
    expect(fuente).toContain(`consulta["${parametro ?? ""}"]`);
  });
});
