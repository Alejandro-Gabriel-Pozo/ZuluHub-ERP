import { describe, expect, it } from "vitest";
import {
  AHORA,
  EXCLUSIONES_BASE,
  LINEA_DE_USO,
  codigos,
  contrato,
  correr,
  huellaDe,
  huellaDelArchivo,
  type Opciones,
} from "./guardian-apoyo";

/**
 * Excepciones gobernadas y exclusiones del análisis. Una excepción silencia SOLO el hallazgo cuyo
 * archivo y huella coinciden, y falla ante cada forma de quedar vieja, vencida, ampliada o mal armada.
 * Escenario común: la web declara «noUsa» pero un CSS usa el separador → un hallazgo `no-usa-falso`.
 */

const RUTA = "apps/web/ui/Linea.module.css";
const OTRA_RUTA = "apps/web/ui/Otra.module.css";
const BASE_DE_EXCEPCION = {
  id: "exc-1",
  contrato: "color-separador",
  ruta: RUTA,
  huella: huellaDe(LINEA_DE_USO),
  motivo: "Migración pendiente: el componente viejo se reemplaza en el próximo sprint.",
  responsable: "Ingeniería",
  aprobadoPor: "Dueño",
  creada: "2026-10-21",
  vence: "2026-12-20",
};
type Excepcion = Record<string, unknown>;
const conExcepciones = (excepciones: unknown, extra: Opciones = {}): Opciones => ({
  contratos: [contrato()],
  excepciones,
  ...extra,
  archivos: { [RUTA]: `${LINEA_DE_USO}\n`, ...extra.archivos },
});
const excepcion = (cambios: Excepcion = {}): Excepcion => ({ ...BASE_DE_EXCEPCION, ...cambios });

describe("hallazgo sin excepción (control del escenario)", () => {
  it("sin excepciones, el uso con noUsa falla y trae la huella sugerida", () => {
    const resultado = correr(conExcepciones([]));
    expect(codigos(resultado)).toEqual(["no-usa-falso"]);
    expect(resultado.fallas[0]?.huella).toBe(BASE_DE_EXCEPCION.huella);
    expect(resultado.fallas[0]?.correccion).toContain(BASE_DE_EXCEPCION.huella);
  });
});

describe("excepciones: lo que silencian", () => {
  it("una excepción válida silencia exactamente su hallazgo", () => {
    const resultado = correr(conExcepciones([excepcion()]));
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.excepcionesAplicadas.map((e) => e.id)).toEqual(["exc-1"]);
  });

  it("no silencia el mismo texto en OTRO archivo", () => {
    const resultado = correr(
      conExcepciones([excepcion()], { archivos: { [OTRA_RUTA]: `${LINEA_DE_USO}\n` } }),
    );
    expect(resultado.fallas.map((f) => [f.codigo, f.archivo])).toEqual([
      ["no-usa-falso", OTRA_RUTA],
    ]);
  });

  it("no silencia otra línea distinta del mismo archivo", () => {
    const resultado = correr(
      conExcepciones([excepcion()], {
        archivos: { [RUTA]: `${LINEA_DE_USO}\n.otra { border-color: var(--color-separador); }\n` },
      }),
    );
    expect(resultado.fallas.map((f) => [f.codigo, f.linea])).toEqual([["no-usa-falso", 2]]);
  });

  it("una excepción silencia UN hallazgo: la misma línea repetida necesita una excepción por cada una", () => {
    const repetida = { [RUTA]: `${LINEA_DE_USO}\n.x {}\n${LINEA_DE_USO}\n` };
    const una = correr(conExcepciones([excepcion()], { archivos: repetida }));
    expect(una.fallas.map((f) => [f.codigo, f.linea])).toEqual([["no-usa-falso", 3]]);
    const dos = correr(
      conExcepciones([excepcion(), excepcion({ id: "exc-2" })], { archivos: repetida }),
    );
    expect(dos.fallas).toEqual([]);
  });

  it("la huella ignora los espacios de los extremos: reindentar la línea no rompe la excepción", () => {
    const resultado = correr(
      conExcepciones([excepcion()], { archivos: { [RUTA]: `    ${LINEA_DE_USO}  \n` } }),
    );
    expect(resultado.fallas).toEqual([]);
  });

  it("si la línea solo se mueve dentro del mismo archivo, la excepción sigue calzando", () => {
    const resultado = correr(
      conExcepciones([excepcion()], { archivos: { [RUTA]: `.antes {}\n\n${LINEA_DE_USO}\n` } }),
    );
    expect(resultado.fallas).toEqual([]);
  });

  it("una excepción de otro contrato no silencia el hallazgo de este", () => {
    const otro = contrato({ id: "otro-contrato" });
    const resultado = correr(
      conExcepciones([excepcion({ contrato: "otro-contrato" })], { contratos: [contrato(), otro] }),
    );
    expect(resultado.fallas.map((f) => [f.codigo, f.contrato])).toEqual([
      ["no-usa-falso", "color-separador"],
    ]);
  });
});

describe("excepciones: cada forma de fallar (violaciones inyectadas)", () => {
  const CAMPOS = [
    "id",
    "contrato",
    "ruta",
    "huella",
    "motivo",
    "responsable",
    "aprobadoPor",
    "vence",
  ];

  it.each(CAMPOS)("sin el campo «%s» falla y el hallazgo sigue vivo", (campo) => {
    const rota = excepcion();
    delete rota[campo];
    const resultado = correr(conExcepciones([rota]));
    expect(codigos(resultado)).toContain("excepcion-invalida");
    expect(codigos(resultado)).toContain("no-usa-falso");
    expect(resultado.fallas.find((f) => f.codigo === "excepcion-invalida")?.motivo).toContain(
      campo,
    );
  });

  it.each(CAMPOS)("con el campo «%s» vacío falla y el hallazgo sigue vivo", (campo) => {
    for (const vacio of ["", "   "]) {
      const resultado = correr(conExcepciones([excepcion({ [campo]: vacio })]));
      expect(codigos(resultado)).toContain("excepcion-invalida");
      expect(codigos(resultado)).toContain("no-usa-falso");
    }
  });

  it.each([
    ["mes 13", "2026-13-01"],
    ["día inexistente", "2026-02-30"],
    ["formato con barras", "31/12/2026"],
    ["sin ceros", "2026-1-5"],
    ["texto", "mañana"],
  ])("vence que no es una fecha válida (%s) falla", (_nombre, vence) => {
    const resultado = correr(conExcepciones([excepcion({ vence })]));
    expect(codigos(resultado).sort()).toEqual(["excepcion-invalida", "no-usa-falso"]);
  });

  it("vencida (ayer) falla y deja el hallazgo vivo", () => {
    const resultado = correr(
      conExcepciones([excepcion({ creada: "2026-09-01", vence: "2026-10-20" })]),
    );
    expect(codigos(resultado).sort()).toEqual(["excepcion-vencida", "no-usa-falso"]);
  });

  it("vence hoy todavía vale; mañana ya no (el reloj es inyectable)", () => {
    const [creada, vence] = ["2026-11-01", "2026-12-31"];
    const ultimoDia = correr(
      conExcepciones([excepcion({ creada, vence })], {
        ahora: new Date("2026-12-31T23:59:59Z"),
        exclusiones: [],
      }),
    );
    expect(ultimoDia.fallas).toEqual([]);
    const despues = correr(
      conExcepciones([excepcion({ creada, vence })], {
        ahora: new Date("2027-01-01T00:00:00Z"),
        exclusiones: [],
      }),
    );
    expect(codigos(despues).sort()).toEqual(["excepcion-vencida", "no-usa-falso"]);
  });

  describe("plazo máximo de 60 días entre «creada» y «vence»", () => {
    it("60 días exactos pasa", () => {
      // 2026-10-21 + 60 días = 2026-12-20.
      const resultado = correr(
        conExcepciones([excepcion({ creada: "2026-10-21", vence: "2026-12-20" })]),
      );
      expect(resultado.fallas).toEqual([]);
    });

    it("61 días falla y el hallazgo sigue vivo", () => {
      const resultado = correr(
        conExcepciones([excepcion({ creada: "2026-10-21", vence: "2026-12-21" })]),
      );
      expect(codigos(resultado).sort()).toEqual(["excepcion-plazo-excesivo", "no-usa-falso"]);
      expect(
        resultado.fallas.find((f) => f.codigo === "excepcion-plazo-excesivo")?.motivo,
      ).toContain("61 días");
    });

    it("una excepción casi eterna falla", () => {
      const resultado = correr(conExcepciones([excepcion({ vence: "2030-01-01" })]));
      expect(codigos(resultado).sort()).toEqual(["excepcion-plazo-excesivo", "no-usa-falso"]);
    });

    it("«creada» en el futuro (respecto del reloj inyectado) falla", () => {
      const resultado = correr(
        conExcepciones([excepcion({ creada: "2026-10-22", vence: "2026-11-30" })]),
      );
      expect(codigos(resultado).sort()).toEqual(["excepcion-creada-futura", "no-usa-falso"]);
    });

    it("«creada» es hoy: vale", () => {
      const resultado = correr(
        conExcepciones([excepcion({ creada: "2026-10-21", vence: "2026-10-21" })]),
      );
      expect(resultado.fallas).toEqual([]);
    });

    it("«vence» anterior a «creada» falla", () => {
      const resultado = correr(
        conExcepciones([excepcion({ creada: "2026-10-21", vence: "2026-10-20" })]),
      );
      expect(codigos(resultado).sort()).toEqual([
        "excepcion-vence-antes-de-creada",
        "excepcion-vencida",
        "no-usa-falso",
      ]);
    });

    it("sin «creada» falla y el hallazgo sigue vivo", () => {
      const sinCreada = excepcion();
      delete sinCreada["creada"];
      const resultado = correr(conExcepciones([sinCreada]));
      expect(codigos(resultado).sort()).toEqual(["excepcion-invalida", "no-usa-falso"]);
      expect(resultado.fallas.find((f) => f.codigo === "excepcion-invalida")?.motivo).toContain(
        "creada",
      );
    });

    it("«creada» con formato inválido falla", () => {
      const resultado = correr(conExcepciones([excepcion({ creada: "2026-02-30" })]));
      expect(codigos(resultado).sort()).toEqual(["excepcion-invalida", "no-usa-falso"]);
    });
  });

  it.each([
    ["comodín *", "apps/web/ui/*.css"],
    ["comodín **", "apps/web/**"],
    ["comodín ?", "apps/web/ui/Linea.module.cs?"],
    ["carpeta", "apps/web/ui/"],
    ["llaves", "apps/web/ui/{Linea,Otra}.module.css"],
    ["punto punto", "apps/web/ui/../ui/Linea.module.css"],
    ["todo el repo", "**"],
  ])("ruta ampliada con %s falla y no silencia nada", (_nombre, ruta) => {
    const resultado = correr(conExcepciones([excepcion({ ruta })]));
    expect(codigos(resultado).sort()).toEqual(["excepcion-ruta-no-exacta", "no-usa-falso"]);
  });

  it("la huella cambió (la línea se editó): la excepción ya no calza y el hallazgo nuevo falla", () => {
    const editada = ".linea { border-color: var(--color-separador); margin: 1px; }";
    const resultado = correr(
      conExcepciones([excepcion()], { archivos: { [RUTA]: `${editada}\n` } }),
    );
    expect(codigos(resultado).sort()).toEqual(["excepcion-huella-cambiada", "no-usa-falso"]);
    expect(resultado.fallas.find((f) => f.codigo === "no-usa-falso")?.huella).toBe(
      huellaDe(editada),
    );
  });

  it("la línea se movió a OTRO archivo: la excepción del archivo viejo no la cubre", () => {
    const resultado = correr(
      conExcepciones([excepcion()], {
        archivos: { [RUTA]: ".nada {}\n", [OTRA_RUTA]: `${LINEA_DE_USO}\n` },
      }),
    );
    // La excepción obsoleta se señala en excepciones.json (la entrada a borrar) y nombra la ruta.
    expect(resultado.fallas.map((f) => [f.codigo, f.archivo]).sort()).toEqual([
      ["excepcion-obsoleta", "arquitectura/contratos/excepciones.json"],
      ["no-usa-falso", OTRA_RUTA],
    ]);
    expect(resultado.fallas.find((f) => f.codigo === "excepcion-obsoleta")?.motivo).toContain(RUTA);
  });

  it("obsoleta: el archivo ya no tiene el problema", () => {
    const resultado = correr(conExcepciones([excepcion()], { archivos: { [RUTA]: ".caja {}\n" } }));
    expect(codigos(resultado)).toEqual(["excepcion-obsoleta"]);
  });

  it("obsoleta: el archivo ya no existe", () => {
    const resultado = correr(conExcepciones([excepcion()], { archivos: { [RUTA]: null } }));
    expect(codigos(resultado)).toEqual(["excepcion-obsoleta"]);
  });

  it("apunta a un contrato que no existe en el registro", () => {
    const resultado = correr(conExcepciones([excepcion({ contrato: "fantasma" })]));
    expect(codigos(resultado).sort()).toEqual(["excepcion-contrato-inexistente", "no-usa-falso"]);
  });

  it("con el registro vacío, cualquier excepción apunta a un contrato inexistente", () => {
    const resultado = correr({ excepciones: [excepcion()] });
    expect(codigos(resultado)).toEqual(["excepcion-contrato-inexistente"]);
  });

  it.each([
    ["alcance", "carpeta"],
    ["rutas", ["a.css", "b.css"]],
    ["linea", 1],
  ])("un campo de más («%s») es una ampliación escondida y falla", (campo, valor) => {
    const resultado = correr(conExcepciones([excepcion({ [campo]: valor })]));
    expect(codigos(resultado).sort()).toEqual(["excepcion-invalida", "no-usa-falso"]);
  });

  it("una huella que no es un SHA-256 falla", () => {
    const resultado = correr(conExcepciones([excepcion({ huella: "abc" })]));
    expect(codigos(resultado).sort()).toEqual(["excepcion-invalida", "no-usa-falso"]);
  });

  it("dos excepciones con el mismo id: la segunda es inválida", () => {
    const resultado = correr(conExcepciones([excepcion(), excepcion()]));
    expect(codigos(resultado)).toEqual(["excepcion-invalida"]);
  });

  it.each([
    ["un objeto en vez de una lista", {}],
    ["texto", "excepciones"],
    ["un elemento que no es un objeto", ["exc-1"]],
  ])("el archivo de excepciones con %s falla", (_nombre, contenido) => {
    const resultado = correr(conExcepciones(contenido));
    expect(codigos(resultado)).toContain("excepcion-invalida");
  });
});

describe("exclusiones del análisis (mismo formato y rigor)", () => {
  const excluida = (cambios: Excepcion = {}): Excepcion => ({ ...EXCLUSIONES_BASE[1], ...cambios });

  it("generado y docs quedan excluidos de forma explícita en el informe", () => {
    const { informe } = correr();
    expect(informe.exclusiones.porClase.map((e) => [e.id, e.clase])).toEqual([
      ["excl-generado", "generado"],
      ["excl-docs", "docs"],
    ]);
    expect(informe.clases["generado"]).toMatchObject({
      rutas: 1,
      excluidas: 1,
      exclusionPorClase: "excl-generado",
    });
    expect(informe.clases["docs"]).toMatchObject({
      rutas: 1,
      excluidas: 1,
      exclusionPorClase: "excl-docs",
    });
    expect(informe.clases["backend"]).toMatchObject({ excluidas: 0, exclusionPorClase: null });
  });

  it("los archivos de las clases excluidas no se leen", () => {
    const leidos: string[] = [];
    correr({ contratos: [contrato()], alLeer: (ruta) => leidos.push(ruta) });
    expect(leidos).not.toContain("README.md");
    expect(leidos).not.toContain("package-lock.json");
    expect(leidos).toContain("apps/web/ui/tokens.css");
  });

  it("un detector que apunta a una clase excluida falla: nunca vería nada", () => {
    const registro = contrato({
      deteccion: [{ tipo: "uso", clases: ["docs"], nombre: "en docs", reconoce: () => [] }],
    });
    const resultado = correr({ contratos: [registro] });
    expect(codigos(resultado)).toEqual(["detector-en-clase-excluida"]);
  });

  it.each(["id", "alcance", "clase", "motivo", "responsable", "aprobadoPor", "creada", "vence"])(
    "una exclusión sin «%s» falla",
    (campo) => {
      const rota = excluida();
      delete rota[campo];
      const resultado = correr({ exclusiones: [EXCLUSIONES_BASE[0], rota] });
      expect(codigos(resultado).length).toBeGreaterThan(0);
      expect(codigos(resultado)).toContain("excepcion-invalida");
    },
  );

  it.each(["motivo", "responsable", "aprobadoPor"])(
    "una exclusión con «%s» vacío falla",
    (campo) => {
      const resultado = correr({ exclusiones: [EXCLUSIONES_BASE[0], excluida({ [campo]: "  " })] });
      expect(codigos(resultado)).toContain("excepcion-invalida");
    },
  );

  it("una exclusión vencida falla y esa clase vuelve a analizarse", () => {
    const resultado = correr({
      exclusiones: [EXCLUSIONES_BASE[0], excluida({ creada: "2026-09-01", vence: "2026-10-20" })],
    });
    expect(codigos(resultado)).toEqual(["excepcion-vencida"]);
    expect(resultado.informe.clases["docs"]?.excluidas).toBe(0);
  });

  describe("las exclusiones también respetan el plazo de 60 días", () => {
    const con = (cambios: Excepcion) =>
      correr({ exclusiones: [EXCLUSIONES_BASE[0], excluida(cambios)] });

    it("60 días exactos pasa", () => {
      expect(con({ creada: "2026-10-21", vence: "2026-12-20" }).fallas).toEqual([]);
    });

    it("61 días falla y esa clase no queda excluida", () => {
      const resultado = con({ creada: "2026-10-21", vence: "2026-12-21" });
      expect(codigos(resultado)).toEqual(["excepcion-plazo-excesivo"]);
      expect(resultado.informe.clases["docs"]?.excluidas).toBe(0);
    });

    it("«creada» futura falla", () => {
      expect(codigos(con({ creada: "2026-10-22", vence: "2026-11-30" }))).toEqual([
        "excepcion-creada-futura",
      ]);
    });

    it("«vence» anterior a «creada» falla", () => {
      expect(codigos(con({ creada: "2026-10-21", vence: "2026-10-20" })).sort()).toEqual([
        "excepcion-vence-antes-de-creada",
        "excepcion-vencida",
      ]);
    });

    it("sin «creada» falla", () => {
      const sinCreada = excluida();
      delete sinCreada["creada"];
      const resultado = correr({ exclusiones: [EXCLUSIONES_BASE[0], sinCreada] });
      expect(codigos(resultado)).toEqual(["excepcion-invalida"]);
    });
  });

  it.each(["backend", "frontend", "config", "pruebas", "migraciones"])(
    "no se puede excluir la clase «%s»",
    (clase) => {
      const resultado = correr({
        exclusiones: [...EXCLUSIONES_BASE, excluida({ id: "excl-x", clase })],
      });
      expect(codigos(resultado)).toEqual(["excepcion-invalida"]);
      expect(resultado.informe.clases[clase]?.excluidas).toBe(0);
    },
  );

  it("dos exclusiones de la misma clase: la segunda es inválida", () => {
    const resultado = correr({ exclusiones: [...EXCLUSIONES_BASE, excluida({ id: "excl-x" })] });
    expect(codigos(resultado)).toEqual(["excepcion-invalida"]);
  });

  it("excluir una clase que no tiene archivos es una exclusión obsoleta (y la clase vacía también falla)", () => {
    const resultado = correr({ archivos: { "package-lock.json": null } });
    expect(codigos(resultado).sort()).toEqual(["clase-sin-rutas", "excepcion-obsoleta"]);
  });

  it("exclusión de un archivo exacto con la huella del archivo completo: no se analiza", () => {
    const contenido = `${LINEA_DE_USO}\n`;
    const exclusion = {
      id: "excl-linea",
      alcance: "ruta",
      ruta: RUTA,
      huella: huellaDelArchivo(contenido),
      motivo: "Archivo heredado que se borra en el próximo sprint.",
      responsable: "Ingeniería",
      aprobadoPor: "Dueño",
      creada: "2026-10-21",
      vence: "2026-12-20",
    };
    const sin = correr(conExcepciones([], { exclusiones: EXCLUSIONES_BASE }));
    expect(codigos(sin)).toEqual(["no-usa-falso"]);
    const con = correr(conExcepciones([], { exclusiones: [...EXCLUSIONES_BASE, exclusion] }));
    expect(con.fallas).toEqual([]);
    expect(con.informe.exclusiones.porRuta.map((e) => e.ruta)).toEqual([RUTA]);
    expect(con.informe.clases["frontend"]?.excluidas).toBe(1);
  });

  it.each([
    [
      "el archivo cambió desde que se aprobó",
      { huella: huellaDe("otro contenido") },
      "excepcion-huella-cambiada",
    ],
    ["ruta con comodín", { ruta: "apps/web/ui/*.css" }, "excepcion-ruta-no-exacta"],
    ["el archivo no existe", { ruta: "apps/web/ui/Nada.module.css" }, "excepcion-obsoleta"],
    ["vencida", { creada: "2026-09-01", vence: "2026-10-20" }, "excepcion-vencida"],
    ["sin motivo", { motivo: "" }, "excepcion-invalida"],
  ])("exclusión de archivo: %s", (_nombre, cambios, codigo) => {
    const exclusion = {
      id: "excl-linea",
      alcance: "ruta",
      ruta: RUTA,
      huella: huellaDelArchivo(`${LINEA_DE_USO}\n`),
      motivo: "Archivo heredado.",
      responsable: "Ingeniería",
      aprobadoPor: "Dueño",
      creada: "2026-10-21",
      vence: "2026-12-20",
      ...cambios,
    };
    const resultado = correr(conExcepciones([], { exclusiones: [...EXCLUSIONES_BASE, exclusion] }));
    expect(codigos(resultado)).toContain(codigo);
    expect(codigos(resultado)).toContain("no-usa-falso");
  });

  it("con el reloj 400 días más tarde, las dos exclusiones de clase están vencidas", () => {
    const resultado = correr({ ahora: new Date(AHORA.getTime() + 400 * 86_400_000) });
    expect(codigos(resultado).sort()).toEqual(["excepcion-vencida", "excepcion-vencida"]);
  });
});
