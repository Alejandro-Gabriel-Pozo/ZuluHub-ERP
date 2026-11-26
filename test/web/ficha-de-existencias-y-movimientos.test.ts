import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";
import {
  CLAVE_DE_TEXTO_DE_LA_CLASE,
  CLAVE_DE_TEXTO_DEL_MOTIVO,
} from "../../apps/web/ui/plantillas/stock/movimientos/modelo-de-movimientos";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import type { FichaDePantalla } from "../../src/capacidades/pantallas/ficha-de-mesas";
import { FICHA_DE_EXISTENCIAS } from "../../src/capacidades/pantallas/ficha-de-existencias";
import { FICHA_DE_LOTES_DE_STOCK } from "../../src/capacidades/pantallas/ficha-de-lotes-de-stock";
import { FICHA_DE_MOVIMIENTOS } from "../../src/capacidades/pantallas/ficha-de-movimientos";
import {
  FICHA_DE_AJUSTAR,
  FICHA_DE_ANULAR,
  FICHA_DE_ENTRADA,
  FICHA_DE_SALIDA,
  FICHA_DE_TRANSFERIR,
} from "../../src/capacidades/pantallas/ficha-de-movimientos-de-stock";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { CLASES_DE_MOVIMIENTO } from "../../src/modulos/stock/publico";

/**
 * Las fichas de «Existencias» y «Movimientos» de stock no se desfasan de la realidad: sus archivos existen, sus textos están en el catálogo con sus usos y su fuente, el acceso es el de la fila del menú
 * y todo texto de stock que citan las páginas y los modelos está declarado en la ficha. Previene: un botón o un texto que nadie aprobó, y una ruta que se mueve sin que la ficha lo note.
 */
/** `citas`: la ficha tiene archivos propios que se pueden cotejar texto por texto (los formularios comparten una pantalla armadora que cita los de todos los tipos). */
const FICHAS: readonly {
  nombre: string;
  ficha: FichaDePantalla;
  pagina: string;
  citas: boolean;
  /** `false`: el acceso es el de la consulta de la pantalla y no el de la fila «Stock» del menú (`stock.ver`). */
  accesoDelMenu?: boolean;
}[] = [
  { nombre: "Existencias", ficha: FICHA_DE_EXISTENCIAS, pagina: "existencias", citas: true },
  { nombre: "Movimientos", ficha: FICHA_DE_MOVIMIENTOS, pagina: "movimientos", citas: true },
  {
    nombre: "Lotes",
    ficha: FICHA_DE_LOTES_DE_STOCK,
    pagina: "lotes",
    citas: true,
    accesoDelMenu: false,
  },
  { nombre: "Entrada", ficha: FICHA_DE_ENTRADA, pagina: "movimientos/entrada", citas: false },
  { nombre: "Salida", ficha: FICHA_DE_SALIDA, pagina: "movimientos/salida", citas: false },
  {
    nombre: "Transferir",
    ficha: FICHA_DE_TRANSFERIR,
    pagina: "movimientos/transferir",
    citas: false,
  },
  { nombre: "Ajustar", ficha: FICHA_DE_AJUSTAR, pagina: "movimientos/ajustar", citas: false },
  { nombre: "Anular", ficha: FICHA_DE_ANULAR, pagina: "movimientos/[id]/anular", citas: false },
];

describe.each(FICHAS)(
  "ficha de la pantalla «$nombre» de stock",
  ({ ficha, pagina, accesoDelMenu }) => {
    it("sus archivos existen", () => {
      for (const archivo of ficha.archivos) expect(() => readFileSync(archivo)).not.toThrow();
    });

    it("su ruta es la de su página y cada botón declara su texto, y la acción de permiso que envía existe en el módulo", () => {
      expect(ficha.rutas).toEqual([`/stock/${pagina}`]);
      const acciones = Object.keys(CATALOGO_DE_MODULOS.stock.acciones);
      for (const b of ficha.botones) {
        expect(Object.keys(ficha.textos), b.id).toContain(b.texto);
        if ("envia" in b.hace) expect(acciones).toContain(b.hace.envia);
      }
    });

    it("todo texto está declarado con usos y fuente, y cada clave existe con su fuente en el catálogo cuando es nueva", () => {
      expect(Object.keys(ficha.textos)).toContain(ficha.titulo);
      for (const [clave, t] of Object.entries(ficha.textos)) {
        expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
        expect(t.usos.length).toBeGreaterThan(0);
        expect(t.fuente.decidio).toMatch(/dueño/);
        expect(t.fuente.donde).toMatch(/Pedernal-docs|arquitectura\/decisiones/);
      }
    });

    it("el acceso existe en el módulo stock y, salvo Lotes, es el de la fila del menú", () => {
      expect(Object.keys(CATALOGO_DE_MODULOS.stock.acciones)).toContain(ficha.acceso);
      if (accesoDelMenu === false) return;
      const fila = FILAS_DEL_MENU.find((f) => f.tipo === "pantalla" && f.clave === "stock");
      expect(fila).toMatchObject({ accion: ficha.acceso });
    });
  },
);

describe.each(FICHAS.filter((f) => f.citas))(
  "la ficha de «$nombre» cita solo textos declarados",
  ({ ficha }) => {
    it("todo texto de stock que citan la página y el modelo está en la ficha", () => {
      const codigo = ficha.archivos
        .filter((a) => /page\.tsx$|modelo-de-[a-z]+\.ts$|Pantalla/.test(a))
        .map((a) => readFileSync(a, "utf8"))
        .join("\n");
      const citadas = [
        ...new Set(
          [...codigo.matchAll(/"(stock\.(?:[a-z_]+\.)+[a-z_]+)"/g)].map((m) => m[1] ?? ""),
        ),
      ];
      for (const clave of citadas) expect(Object.keys(ficha.textos), clave).toContain(clave);
    });
  },
);

describe("«Movimientos» rotula todas las clases y solo los motivos con texto aprobado", () => {
  it("cada clase del libro tiene su rótulo y cada rótulo es una clase del libro", () => {
    expect(Object.keys(CLAVE_DE_TEXTO_DE_LA_CLASE).sort()).toEqual(
      [...CLASES_DE_MOVIMIENTO].sort(),
    );
  });

  it("cada texto de clase y de motivo que usa el modelo está declarado en la ficha", () => {
    const declaradas = Object.keys(FICHA_DE_MOVIMIENTOS.textos);
    for (const clave of [
      ...Object.values(CLAVE_DE_TEXTO_DE_LA_CLASE),
      ...Object.values(CLAVE_DE_TEXTO_DEL_MOTIVO),
    ]) {
      expect(declaradas, clave).toContain(clave);
    }
  });
});
