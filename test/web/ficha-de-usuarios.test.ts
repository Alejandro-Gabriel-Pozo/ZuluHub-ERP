import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import { RUTAS_DE_CUENTA } from "../../apps/web/ui/plantillas/sesion/rutas-de-cuenta";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { FICHA_DE_USUARIOS } from "../../src/capacidades/pantallas/ficha-de-usuarios";
import { CATALOGO_DE_TEXTOS, type ClaveDeTexto } from "../../src/capacidades/vocabulario/catalogo";
import { TEXTOS_DE_USUARIOS } from "../../src/capacidades/vocabulario/catalogo-usuarios";

/**
 * La ficha de «Usuarios» no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con uso y fuente, su acción es `usuarios.ver` del módulo `administracion` y la fila del
 * menú coincide (acceso, rótulo, ruta y módulo). Sin botones: los de escritura son de otros tramos. Previene: un botón o un texto que nadie aprobó y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */
describe("ficha de la pantalla «Usuarios»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA_DE_USUARIOS.archivos) {
      expect(() => readFileSync(archivo)).not.toThrow();
    }
  });

  it("todo texto del catálogo que usa está declarado con usos y fuente de dueño, y cada clave existe", () => {
    const botones: readonly { texto: ClaveDeTexto }[] = FICHA_DE_USUARIOS.botones;
    const claves = [FICHA_DE_USUARIOS.titulo, ...botones.map((b) => b.texto)];
    for (const clave of claves) expect(Object.keys(FICHA_DE_USUARIOS.textos)).toContain(clave);
    for (const [clave, t] of Object.entries(FICHA_DE_USUARIOS.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.decidio).not.toMatch(/orquestador|SIN_APROBAR/i);
      expect(t.fuente.donde).toMatch(/Pedernal-docs|DDD/);
    }
  });

  it("todo texto propio del módulo está en la ficha y en el catálogo con su uso y su fuente (ningún `dato=pendiente`)", () => {
    for (const [clave, def] of Object.entries(TEXTOS_DE_USUARIOS)) {
      expect(Object.keys(FICHA_DE_USUARIOS.textos)).toContain(clave);
      expect(def.usos).not.toBe("pendiente");
      expect(def.usos.length).toBeGreaterThan(0);
      expect([{ decision: "DEC-0851" }, { decision: "DEC-0856" }]).toContainEqual(def.fuente);
    }
  });

  it("sus únicos botones son los de desactivar (U3): uno abre el cuadro y otro envía `usuarios.apagar`, y sin permiso no se dibujan; los dos estados son el mensaje genérico", () => {
    expect(FICHA_DE_USUARIOS.botones).toEqual([
      {
        id: "desactivar",
        texto: "caja.accion.desactivar",
        hace: "abre-el-cuadro",
        sinPermiso: "AUSENTE",
      },
      {
        id: "confirmar-desactivar",
        texto: "caja.accion.desactivar",
        hace: { envia: "usuarios.apagar" },
        sinPermiso: "AUSENTE",
      },
    ]);
    expect(Object.keys(CATALOGO_DE_MODULOS.administracion.acciones)).toContain("usuarios.apagar");
    expect(FICHA_DE_USUARIOS.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });

  it("su acción existe en el módulo administracion y es la de la fila del menú", () => {
    expect(Object.keys(CATALOGO_DE_MODULOS.administracion.acciones)).toContain(
      FICHA_DE_USUARIOS.acceso,
    );
    const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "usuarios");
    expect(fila).toMatchObject({
      area: "cuenta",
      grupo: "empresa",
      accion: FICHA_DE_USUARIOS.acceso,
      etiqueta: FICHA_DE_USUARIOS.titulo,
      href: FICHA_DE_USUARIOS.rutas[0],
      modulo: "administracion",
      perilla: null,
      departamento: null,
    });
    expect(RUTAS_DE_CUENTA.usuarios).toBe(FICHA_DE_USUARIOS.rutas[0]);
  });

  it("las rutas de la ficha existen como páginas", () => {
    for (const ruta of FICHA_DE_USUARIOS.rutas) {
      const pagina = `apps/web/app/s/app/(operacion)${ruta}/page.tsx`;
      expect(() => readFileSync(pagina)).not.toThrow();
    }
  });
});
