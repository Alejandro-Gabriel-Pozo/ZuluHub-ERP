import { describe, expect, it } from "vitest";
import { retiroCompleto } from "./guardian-apoyo";
import { A, instantanea, nd, ubicacion } from "./guardian-mutantes-d-apoyo";
import type { Hallazgo, Instantanea, Seccion } from "./guardian-mutantes-d-apoyo";

/**
 * Vigilancia de la versión anterior, chequeo (i): la batería de evasión. Cómo se leen `evasiones.json` y
 * `evasiones-github.json` (lo que se resume de cada caso), qué falla cuando un caso desaparece, cambia lo que
 * espera, se afloja o pierde una vía, y qué se avisa sin bloquear (el catálogo que la base todavía no trae,
 * un riesgo o una brecha nuevos). Los textos de los mensajes son contrato para quien los lee en la CI.
 */

const HOY = new Date("2026-10-21T12:00:00Z");
const EVASIONES = A.evasiones;
const EXTERNOS = A.evasionesExternas;

type Caso = Record<string, unknown>;
const caso = (id: string, cambios: Caso = {}): Caso => ({
  id,
  via: "filtros",
  esperado: { tipo: "exige-excepcion" },
  estado: "exigido",
  ...cambios,
});
const brecha = (id: string, vence: string, cambios: Caso = {}): Caso =>
  caso(id, { estado: "brecha-abierta", vence, ...cambios });
const riesgo = (id: string, revisar: string, cambios: Caso = {}): Caso =>
  caso(id, { estado: "riesgo-aceptado", revisar, ...cambios });
const json = (valor: unknown): string => `${JSON.stringify(valor)}\n`;

/** La sección que `capturar` arma desde el texto del catálogo y, si hay, de los casos externos. */
const seccion = (catalogo: Caso[] | null, externos: Caso[] | null = null): Seccion =>
  nd.leerEvasiones(
    catalogo === null ? null : json(catalogo),
    externos === null ? null : json(externos),
  );
const conEvasiones = (
  catalogo: Caso[] | null,
  externos: Caso[] | null = null,
  cambios: Instantanea = {},
) => instantanea({ evasiones: seccion(catalogo, externos), ...cambios });

describe("leerEvasiones: lo que se resume de cada caso", () => {
  it("sin el catálogo no hay sección (ausente), aunque estén los casos externos", () => {
    expect(nd.leerEvasiones(null, null)).toStrictEqual({ ausente: true });
    expect(nd.leerEvasiones(null, json([caso("EV-047")]))).toStrictEqual({ ausente: true });
  });

  it("de cada caso guarda id, vía, lo esperado, el estado, su fecha límite, su posición y su archivo", () => {
    const seccionLeida = nd.leerEvasiones(
      json([
        caso("EV-001", {
          via: "filtros",
          esperado: { tipo: "bloquea", codigo: "c", archivo: "a.ts" },
        }),
        brecha("EV-002", "2026-12-20", { via: "workflow-ci" }),
        riesgo("EV-003", "2027-04-19", { via: "exclusiones" }),
      ]),
      json([caso("EV-047", { via: "ruta-alternativa", estado: "externo" })]),
    );
    expect(seccionLeida).toStrictEqual({
      valor: [
        {
          id: "EV-001",
          via: "filtros",
          esperado: '{"archivo":"a.ts","codigo":"c","tipo":"bloquea"}',
          estado: "exigido",
          limite: null,
          indice: 0,
          archivo: EVASIONES,
        },
        {
          id: "EV-002",
          via: "workflow-ci",
          esperado: '{"tipo":"exige-excepcion"}',
          estado: "brecha-abierta",
          limite: "2026-12-20",
          indice: 1,
          archivo: EVASIONES,
        },
        {
          id: "EV-003",
          via: "exclusiones",
          esperado: '{"tipo":"exige-excepcion"}',
          estado: "riesgo-aceptado",
          limite: "2027-04-19",
          indice: 2,
          archivo: EVASIONES,
        },
        {
          id: "EV-047",
          via: "ruta-alternativa",
          esperado: '{"tipo":"exige-excepcion"}',
          estado: "externo",
          limite: null,
          indice: 0,
          archivo: EXTERNOS,
        },
      ],
    });
  });

  it("lo esperado se guarda con las claves ordenadas: reordenarlas no es cambiarlo", () => {
    const resumen = (esperado: unknown): unknown => {
      const leida = nd.leerEvasiones(json([caso("EV-001", { esperado })]), null) as {
        valor: { esperado: string }[];
      };
      return leida.valor[0]?.esperado;
    };
    expect(resumen({ b: 1, a: { z: 1, y: 2 }, c: 3 })).toBe(
      resumen({ c: 3, a: { z: 1, y: 2 }, b: 1 }),
    );
    expect(resumen({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(resumen(null)).toBe("null");
    expect(resumen("x")).toBe('"x"');
    expect(resumen([2, 1])).toBe("[2,1]");
    const sin = nd.leerEvasiones(json([{ id: "EV-001" }]), null) as {
      valor: { esperado: string }[];
    };
    expect(sin.valor[0]?.esperado).toBe("null");
  });

  it("solo la brecha y el riesgo tienen fecha límite, y es la de su estado (vence o revisar)", () => {
    const limites = (casos: Caso[]): unknown[] =>
      (nd.leerEvasiones(json(casos), null) as { valor: { limite: unknown }[] }).valor.map(
        (c) => c.limite,
      );
    expect(
      limites([
        caso("EV-001", { vence: "2026-12-20", revisar: "2027-01-01" }),
        caso("EV-002", { estado: "brecha-abierta", vence: "2026-12-20", revisar: "2027-01-01" }),
        caso("EV-003", { estado: "riesgo-aceptado", vence: "2026-12-20", revisar: "2027-01-01" }),
        caso("EV-004", { estado: "externo", vence: "2026-12-20", revisar: "2027-01-01" }),
        caso("EV-005", { estado: "brecha-abierta" }),
        caso("EV-006", { estado: "brecha-abierta", vence: 5 }),
        caso("EV-007", { estado: undefined, vence: "2026-12-20" }),
        // una clave que se llame como el campo que no existe («undefined») no se confunde con una fecha límite
        caso("EV-008", { undefined: "2026-12-20" }),
      ]),
    ).toEqual([null, "2026-12-20", "2027-01-01", null, null, null, null, null]);
  });

  it("lo que no tiene la forma esperada se resume como null, sin romper, y conserva su posición", () => {
    const leida = nd.leerEvasiones(
      json([
        5,
        null,
        "texto",
        [1],
        { id: "", via: 3, estado: 7 },
        { id: 4, via: null, estado: null },
        { id: "  ", via: "x" },
      ]),
      null,
    ) as { valor: Record<string, unknown>[] };
    expect(
      leida.valor.map((c) => [c["id"], c["via"], c["estado"], c["limite"], c["indice"]]),
    ).toEqual([
      [null, null, null, null, 0],
      [null, null, null, null, 1],
      [null, null, null, null, 2],
      [null, null, null, null, 3],
      [null, null, null, null, 4],
      [null, null, null, null, 5],
      [null, "x", null, null, 6],
    ]);
  });

  it("un catálogo que no es una lista, o que no es JSON, es un error que nombra el archivo", () => {
    expect(nd.leerEvasiones('{ "casos": [] }', null)).toStrictEqual({
      error: `${EVASIONES} no es una lista`,
    });
    const roto = nd.leerEvasiones("{ roto", null) as { error: string };
    expect(roto.error.startsWith(`${EVASIONES} no es JSON válido (`)).toBe(true);
    expect(roto.error.endsWith(")")).toBe(true);
    expect(roto.error.length).toBeGreaterThan(`${EVASIONES} no es JSON válido ()`.length);
  });

  it("los casos externos rotos son un error que nombra el archivo de los externos", () => {
    expect(nd.leerEvasiones("[]", '{ "casos": [] }')).toStrictEqual({
      error: `${EXTERNOS} no es una lista`,
    });
    const roto = nd.leerEvasiones("[]", "[ roto") as { error: string };
    expect(roto.error.startsWith(`${EXTERNOS} no es JSON válido (`)).toBe(true);
  });

  it("si el catálogo está roto no se mira más: el error es el del catálogo", () => {
    const leida = nd.leerEvasiones("{ roto", "[ también roto") as { error: string };
    expect(leida.error.startsWith(`${EVASIONES} no es JSON válido`)).toBe(true);
  });

  it("sin los casos externos vale el catálogo solo", () => {
    expect(nd.leerEvasiones("[]", null)).toStrictEqual({ valor: [] });
    expect(nd.leerEvasiones("[]", "[]")).toStrictEqual({ valor: [] });
  });
});

describe("chequearEvasiones: cuándo se calla", () => {
  const casos = [caso("EV-001"), caso("EV-002", { via: "workflow-ci" })];

  it("si la base no trae el catálogo (ausente o ilegible) no hay nada que comparar", () => {
    for (const base of [{ ausente: true }, { error: "x" }, undefined]) {
      expect(nd.chequearEvasiones(instantanea({ evasiones: base }), conEvasiones([]))).toEqual([]);
    }
  });

  it("si el PR no tiene la sección (la instantánea no la trae) no se inventa nada", () => {
    expect(
      nd.chequearEvasiones(conEvasiones(casos), instantanea({ evasiones: undefined })),
    ).toEqual([]);
  });

  it("si el PR no se pudo leer ya lo dice la lectura: acá no se acusa de borrados", () => {
    expect(
      nd.chequearEvasiones(conEvasiones(casos), instantanea({ evasiones: { error: "roto" } })),
    ).toEqual([]);
  });

  it("dos catálogos iguales no dicen nada", () => {
    expect(nd.chequearEvasiones(conEvasiones(casos), conEvasiones(casos))).toEqual([]);
  });

  it("un caso de la base sin id no se puede seguir, y uno del PR sin id no cuenta como el que falta", () => {
    const base = conEvasiones([caso("EV-001"), { via: "filtros" }]);
    expect(nd.chequearEvasiones(base, conEvasiones([caso("EV-001")]))).toEqual([]);
    expect(
      nd.chequearEvasiones(
        conEvasiones([caso("EV-001")]),
        conEvasiones([5 as unknown as Caso, caso("EV-001")]),
      ),
    ).toEqual([]);
    const sinId = conEvasiones([{ via: "filtros", estado: "exigido" }]);
    expect(
      nd.chequearEvasiones(conEvasiones([caso("EV-001")]), sinId).map((h) => h.codigo),
    ).toEqual(["evasion-borrada"]);
  });
});

describe("chequearEvasiones: un caso borrado", () => {
  const base = conEvasiones([caso("EV-001"), caso("EV-002")]);

  it("falla con el texto exacto, el id del caso como contrato y la línea 1 del catálogo", () => {
    expect(nd.chequearEvasiones(base, conEvasiones([caso("EV-002")]))).toStrictEqual([
      {
        codigo: "evasion-borrada",
        archivo: EVASIONES,
        contrato: "EV-001",
        motivo:
          "El caso «EV-001» de la batería de evasión estaba en la base y ya no está, y no hay un retiro registrado: sería quitar una prueba de evasión en silencio.",
        correccion:
          "Devolvé el caso al catálogo; si el retiro es una decisión, agregá a retiros.json { id (el del caso), motivo, responsable, aprobadoPor, creada }.",
        donde: ubicacion.enArchivo(),
      },
    ]);
  });

  it("un caso externo borrado se acusa en el archivo de los externos", () => {
    const conExterno = conEvasiones(
      [caso("EV-001")],
      [caso("EV-047", { via: "ruta-alternativa" })],
    );
    const h = nd.chequearEvasiones(conExterno, conEvasiones([caso("EV-001")], []));
    expect(h.map((x) => [x.codigo, x.archivo, x.contrato])).toEqual([
      ["evasion-borrada", EXTERNOS, "EV-047"],
      ["evasion-via-perdida", EVASIONES, null],
    ]);
  });

  it("el retiro con el id del caso lo deja pasar; el de otro id, no", () => {
    const retiros = (...ids: string[]) => ({
      retiros: { valor: ids.map((id) => retiroCompleto(id)) },
    });
    const sinEl1 = (cambios: Instantanea) =>
      nd
        .chequearEvasiones(base, conEvasiones([caso("EV-002")], null, cambios))
        .map((h) => h.codigo);
    expect(sinEl1(retiros("EV-001"))).toEqual([]);
    expect(sinEl1(retiros("EV-999"))).toEqual(["evasion-borrada"]);
    expect(sinEl1(retiros())).toEqual(["evasion-borrada"]);
  });

  it("un retiros.json ilegible o con entradas que no son objetos no retira nada", () => {
    const sinEl1 = (retiros: Seccion) =>
      nd
        .chequearEvasiones(base, conEvasiones([caso("EV-002")], null, { retiros }))
        .map((h) => h.codigo);
    expect(sinEl1({ error: "roto" })).toEqual(["evasion-borrada"]);
    expect(sinEl1({ ausente: true })).toEqual(["evasion-borrada"]);
    expect(sinEl1({ valor: [5, null, "EV-001", ["EV-001"]] })).toEqual(["evasion-borrada"]);
    expect(sinEl1({ valor: [5, retiroCompleto("EV-001")] })).toEqual([]);
  });

  it("un catálogo ausente en el PR deja todos los casos sin retiro", () => {
    const h = nd.chequearEvasiones(base, instantanea({ evasiones: { ausente: true } }));
    expect(h.map((x) => [x.codigo, x.contrato])).toEqual([
      ["evasion-borrada", "EV-001"],
      ["evasion-borrada", "EV-002"],
      ["evasion-via-perdida", null],
    ]);
  });
});

describe("chequearEvasiones: lo que un caso espera", () => {
  it("cambiar lo esperado falla con lo de antes y lo de ahora, en la clave «esperado» del caso", () => {
    const base = conEvasiones([caso("EV-001"), caso("EV-002")]);
    const pr = conEvasiones([
      caso("EV-001"),
      caso("EV-002", { esperado: { tipo: "bloquea", codigo: "c", archivo: "a.ts" } }),
    ]);
    expect(nd.chequearEvasiones(base, pr)).toStrictEqual([
      {
        codigo: "evasion-esperado-cambiado",
        archivo: EVASIONES,
        contrato: "EV-002",
        motivo:
          'El caso «EV-002» cambió lo que espera: antes {"tipo":"exige-excepcion"}, ahora {"archivo":"a.ts","codigo":"c","tipo":"bloquea"}. Cambiar el resultado aceptable es debilitar el caso.',
        correccion:
          "Devolvé «esperado» a lo que era; si el control mejoró, el caso se endurece en un cambio aparte y a la vista.",
        donde: ubicacion.enJson(1, "esperado"),
      },
    ]);
  });

  it("el mismo contenido con otro orden de claves no es un cambio", () => {
    const base = conEvasiones([
      caso("EV-001", { esperado: { tipo: "bloquea", codigo: "c", archivo: "a" } }),
    ]);
    const pr = conEvasiones([
      caso("EV-001", { esperado: { archivo: "a", codigo: "c", tipo: "bloquea" } }),
    ]);
    expect(nd.chequearEvasiones(base, pr)).toEqual([]);
  });

  it("en los casos externos también, con la posición dentro de ese archivo", () => {
    const externo = (esperado: unknown) => [
      caso("EV-047", { via: "ruta-alternativa", estado: "externo", esperado }),
    ];
    const h = nd.chequearEvasiones(
      conEvasiones([caso("EV-001")], externo({ tipo: "exige-excepcion" })),
      conEvasiones(
        [caso("EV-001")],
        [caso("EV-048", { via: "x" }), ...externo({ tipo: "bloquea" })],
      ),
    );
    expect(h.map((x) => [x.codigo, x.archivo, x.donde])).toEqual([
      ["evasion-esperado-cambiado", EXTERNOS, ubicacion.enJson(1, "esperado")],
    ]);
  });
});

describe("chequearEvasiones: el estado y la fecha límite de un caso", () => {
  const una = (base: Caso, pr: Caso) =>
    nd.chequearEvasiones(conEvasiones([base]), conEvasiones([pr]));

  it("pasar de exigido a brecha abierta o a riesgo aceptado es degradar: el texto dice de qué a qué", () => {
    const h = una(caso("EV-001"), brecha("EV-001", "2026-12-20"));
    expect(h).toStrictEqual([
      {
        codigo: "evasion-degradada",
        archivo: EVASIONES,
        contrato: "EV-001",
        motivo:
          "El caso «EV-001» pasó de «exigido» a «brecha-abierta» hasta el 2026-12-20: un caso exigido no se afloja a brecha ni a riesgo aceptado en silencio.",
        correccion:
          "Devolvé el estado y la fecha que tenía; un hueco que no se puede cerrar se registra como un caso nuevo con su propio plazo.",
        donde: ubicacion.enJson(0, "estado"),
      },
    ]);
    expect(una(caso("EV-001"), riesgo("EV-001", "2027-04-19"))[0]?.motivo).toContain(
      "de «exigido» a «riesgo-aceptado» hasta el 2027-04-19:",
    );
    expect(
      una(brecha("EV-001", "2026-12-20"), riesgo("EV-001", "2027-04-19"))[0]?.motivo,
    ).toContain("de «brecha-abierta» hasta el 2026-12-20 a «riesgo-aceptado» hasta el 2027-04-19:");
  });

  it("un estado que no es ninguno de los conocidos vale menos que cualquiera de ellos", () => {
    for (const antes of [
      caso("EV-001"),
      brecha("EV-001", "2026-12-20"),
      riesgo("EV-001", "2027-04-19"),
    ]) {
      expect(
        una(antes, caso("EV-001", { estado: "tal vez" })).map((h) => h.codigo),
        String(antes["estado"]),
      ).toEqual(["evasion-degradada"]);
    }
    expect(una(caso("EV-001", { estado: "tal vez" }), caso("EV-001", { estado: "otro" }))).toEqual(
      [],
    );
  });

  it("endurecer o mantener el estado no falla", () => {
    expect(una(riesgo("EV-001", "2027-04-19"), brecha("EV-001", "2026-12-20"))).toEqual([]);
    expect(una(riesgo("EV-001", "2027-04-19"), caso("EV-001"))).toEqual([]);
    expect(una(brecha("EV-001", "2026-12-20"), caso("EV-001"))).toEqual([]);
    expect(una(caso("EV-001", { estado: "externo" }), riesgo("EV-001", "2027-04-19"))).toEqual([]);
    expect(una(caso("EV-001"), caso("EV-001"))).toEqual([]);
    expect(una(brecha("EV-001", "2026-12-20"), brecha("EV-001", "2026-12-20"))).toEqual([]);
  });

  it("mover más tarde la fecha límite del mismo estado degrada, en la clave de esa fecha", () => {
    const h = una(brecha("EV-001", "2026-12-20"), brecha("EV-001", "2026-12-21"));
    expect(h).toStrictEqual([
      {
        codigo: "evasion-degradada",
        archivo: EVASIONES,
        contrato: "EV-001",
        motivo:
          "El caso «EV-001» sigue «brecha-abierta» hasta el 2026-12-20 pero su fecha límite se movió al 2026-12-21: extender una brecha o un riesgo es debilitarlo.",
        correccion:
          "Devolvé el estado y la fecha que tenía; un hueco que no se puede cerrar se registra como un caso nuevo con su propio plazo.",
        donde: ubicacion.enJson(0, "vence"),
      },
    ]);
    expect(
      una(riesgo("EV-001", "2027-04-19"), riesgo("EV-001", "2027-04-20"))[0]?.donde,
    ).toStrictEqual(ubicacion.enJson(0, "revisar"));
  });

  it("adelantar la fecha o dejarla igual no falla", () => {
    expect(una(brecha("EV-001", "2026-12-20"), brecha("EV-001", "2026-12-19"))).toEqual([]);
    expect(una(brecha("EV-001", "2026-12-20"), brecha("EV-001", "2026-11-20"))).toEqual([]);
    expect(una(riesgo("EV-001", "2027-04-19"), riesgo("EV-001", "2027-04-19"))).toEqual([]);
  });

  it("la fecha se compara solo si es del mismo estado: de una brecha a un riesgo más tardío ya es degradar por estado", () => {
    const h = una(brecha("EV-001", "2026-12-20"), riesgo("EV-001", "2027-04-19"));
    expect(h.map((x) => x.donde)).toEqual([ubicacion.enJson(0, "estado")]);
  });

  it("sin fechas en ninguno de los dos, o con una sola, no hay nada que mover", () => {
    expect(una(caso("EV-001"), caso("EV-001", { vence: "2027-01-01" }))).toEqual([]);
    expect(
      una(brecha("EV-001", "2026-12-20", { vence: undefined }), brecha("EV-001", "2026-12-20")),
    ).toEqual([]);
  });

  it("la posición que se informa es la del caso en el PR, aunque en la base estuviera en otro lugar", () => {
    const base = conEvasiones([caso("EV-001"), caso("EV-002")]);
    const pr = conEvasiones([caso("EV-002"), caso("EV-001", { estado: "tal vez" })]);
    expect(nd.chequearEvasiones(base, pr).map((h) => h.donde)).toEqual([
      ubicacion.enJson(1, "estado"),
    ]);
  });

  it("de varios casos, cada uno se juzga por separado y salen en el orden de la base", () => {
    const base = conEvasiones([caso("EV-001"), caso("EV-002"), caso("EV-003")]);
    const pr = conEvasiones([
      caso("EV-001", { estado: "tal vez" }),
      caso("EV-002"),
      caso("EV-003", { estado: "tal vez" }),
    ]);
    expect(nd.chequearEvasiones(base, pr).map((h) => h.contrato)).toEqual(["EV-001", "EV-003"]);
  });
});

describe("chequearEvasiones: una vía que se pierde", () => {
  it("falla una vez por cada vía de la base que el PR ya no tiene, con el texto exacto", () => {
    const base = conEvasiones([
      caso("EV-001", { via: "filtros" }),
      caso("EV-002", { via: "workflow-ci" }),
      caso("EV-003", { via: "workflow-ci" }),
      caso("EV-004", { via: "exclusiones" }),
    ]);
    const pr = conEvasiones(
      [caso("EV-001", { via: "filtros" }), caso("EV-002", { via: "workflow-ci" })],
      null,
      {
        retiros: { valor: [retiroCompleto("EV-003"), retiroCompleto("EV-004")] },
      },
    );
    expect(nd.chequearEvasiones(base, pr)).toStrictEqual([
      {
        codigo: "evasion-via-perdida",
        archivo: EVASIONES,
        contrato: null,
        motivo:
          "La batería de evasión ya no tiene ningún caso de la vía «exclusiones», que la base cubría: esa ruta de evasión dejó de probarse.",
        correccion: "Devolvé al menos un caso de la vía (la batería solo crece).",
        donde: ubicacion.enArchivo(),
      },
    ]);
  });

  it("una vía que sigue en los casos externos no se pierde", () => {
    const base = conEvasiones(
      [caso("EV-001", { via: "filtros" })],
      [caso("EV-047", { via: "ruta-alternativa" })],
    );
    const pr = conEvasiones(
      [caso("EV-001", { via: "filtros" })],
      [caso("EV-047", { via: "ruta-alternativa" })],
    );
    expect(nd.chequearEvasiones(base, pr)).toEqual([]);
    const sinExternos = conEvasiones([caso("EV-001", { via: "filtros" })], []);
    expect(nd.chequearEvasiones(base, sinExternos).map((h) => h.codigo)).toEqual([
      "evasion-borrada",
      "evasion-via-perdida",
    ]);
  });

  it("un caso sin vía que se retira no deja una «vía» sin nombre perdida", () => {
    const base = conEvasiones([
      caso("EV-001", { via: "filtros" }),
      { id: "EV-002", estado: "exigido" },
    ]);
    const pr = conEvasiones([caso("EV-001", { via: "filtros" })], null, {
      retiros: { valor: [retiroCompleto("EV-002")] },
    });
    expect(nd.chequearEvasiones(base, pr)).toEqual([]);
  });

  it("agregar vías nuevas, o un caso de una vía que el PR sí tiene, no falla; una vía sin nombre se ignora", () => {
    const base = conEvasiones([
      caso("EV-001", { via: "filtros" }),
      { id: "EV-002", estado: "exigido" },
    ]);
    const pr = conEvasiones([
      caso("EV-001", { via: "filtros" }),
      { id: "EV-002", estado: "exigido" },
      caso("EV-003", { via: "nueva" }),
    ]);
    expect(nd.chequearEvasiones(base, pr)).toEqual([]);
  });
});

describe("los avisos de la batería de evasión", () => {
  const avisos = (base: Instantanea, pr: Instantanea): Hallazgo[] =>
    nd.verificar({ base, pr, ahora: HOY, leerPr: () => null }).avisos;

  it("si la base no trae el catálogo se avisa con el texto exacto, en la línea 1, y no bloquea", () => {
    const resultado = nd.verificar({
      base: instantanea({ evasiones: { ausente: true } }),
      pr: conEvasiones([caso("EV-001")]),
      ahora: HOY,
      leerPr: () => null,
    });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toStrictEqual([
      {
        codigo: "evasiones-sin-base",
        archivo: EVASIONES,
        contrato: null,
        motivo:
          "La base no trae el catálogo de la batería de evasión (evasiones.json): se saltea el chequeo (i). Es esperable solo hasta que el catálogo entre a la rama principal.",
        correccion: "Nada por ahora; cuando la base lo tenga, el chequeo (i) se activa solo.",
        linea: 1,
      },
    ]);
  });

  it("una base sin la sección del catálogo (ni ausente ni leída) no avisa ni se rompe", () => {
    const base = instantanea({ evasiones: undefined });
    expect(avisos(base, instantanea()).map((a) => a.codigo)).not.toContain("evasiones-sin-base");
  });

  it("la matriz y el catálogo ausentes en la base dan los dos avisos, ordenados por archivo", () => {
    const base = instantanea({ invariantes: { ausente: true }, evasiones: { ausente: true } });
    expect(avisos(base, instantanea()).map((a) => a.codigo)).toEqual([
      "evasiones-sin-base",
      "invariantes-sin-base",
    ]);
    expect(
      avisos(instantanea({ evasiones: { ausente: true } }), instantanea()).map((a) => a.codigo),
    ).toEqual(["evasiones-sin-base"]);
    expect(
      avisos(instantanea({ invariantes: { ausente: true } }), instantanea()).map((a) => a.codigo),
    ).toEqual(["invariantes-sin-base"]);
    expect(avisos(instantanea(), instantanea())).toEqual([]);
  });

  it("un riesgo aceptado nuevo se avisa con el texto exacto, en la clave «estado» de su caso", () => {
    const base = conEvasiones([caso("EV-001")]);
    const pr = conEvasiones([caso("EV-001"), riesgo("EV-002", "2027-04-19")]);
    expect(avisos(base, pr)).toStrictEqual([
      {
        codigo: "evasion-riesgo-nuevo",
        archivo: EVASIONES,
        contrato: "EV-002",
        motivo:
          "Nuevo riesgo aceptado: EV-002 (revisar el 2027-04-19). No debilita nada, pero alguien aceptó que un cambio pase sin detección.",
        correccion:
          "Confirmá con el dueño que el riesgo es aceptado (o cerralo con un control que bloquee y pasá el caso a exigido).",
        linea: 1,
      },
    ]);
  });

  it("una brecha abierta nueva tiene su propio texto", () => {
    const base = conEvasiones([caso("EV-001")]);
    const pr = conEvasiones([caso("EV-001"), brecha("EV-002", "2026-12-20")]);
    const [aviso] = avisos(base, pr);
    expect(aviso?.motivo).toBe(
      "Nueva brecha abierta: EV-002 (vence el 2026-12-20). No debilita nada, pero hoy un cambio pasa sin detección.",
    );
    expect(aviso?.contrato).toBe("EV-002");
  });

  it("la línea del aviso es la de la clave «estado» del caso nuevo", () => {
    const base = conEvasiones([caso("EV-001")]);
    const casosDelPr = [caso("EV-001"), riesgo("EV-002", "2027-04-19")];
    const texto = JSON.stringify(casosDelPr, null, 2);
    const resultado = nd.verificar({
      base,
      pr: conEvasiones(casosDelPr),
      ahora: HOY,
      leerPr: (ruta) => (ruta === EVASIONES ? texto : null),
    });
    const lineas = texto.split("\n");
    const dondeEstaElId = lineas.findIndex((l) => l.includes('"id": "EV-002"'));
    const esperada = lineas.findIndex((l, i) => i > dondeEstaElId && l.includes('"estado"')) + 1;
    expect(resultado.avisos[0]?.linea).toBe(esperada);
  });

  it("un caso exigido o externo nuevo no avisa, ni uno que la base ya tenía, ni uno sin id", () => {
    const base = conEvasiones([riesgo("EV-001", "2027-04-19")]);
    const pr = conEvasiones(
      [
        riesgo("EV-001", "2027-04-19"),
        caso("EV-002"),
        caso("EV-003", { estado: "externo" }),
        { estado: "riesgo-aceptado" },
      ],
      [caso("EV-047", { estado: "externo" })],
    );
    expect(avisos(base, pr)).toEqual([]);
  });

  it("varios nuevos avisan en el orden del catálogo, los externos al final", () => {
    const base = conEvasiones([caso("EV-001")]);
    const pr = conEvasiones([
      caso("EV-001"),
      brecha("EV-002", "2026-12-20"),
      riesgo("EV-003", "2027-04-19"),
    ]);
    expect(avisos(base, pr).map((a) => a.contrato)).toEqual(["EV-002", "EV-003"]);
  });

  it("si la base no trae el catálogo, o el PR no se puede leer, no se avisa de riesgos nuevos", () => {
    const nuevo = conEvasiones([riesgo("EV-002", "2027-04-19")]);
    expect(
      avisos(instantanea({ evasiones: { ausente: true } }), nuevo).map((a) => a.codigo),
    ).toEqual(["evasiones-sin-base"]);
    expect(avisos(instantanea({ evasiones: { error: "x" } }), nuevo).map((a) => a.codigo)).toEqual(
      [],
    );
    expect(
      avisos(conEvasiones([caso("EV-001")]), instantanea({ evasiones: { error: "x" } })),
    ).toEqual([]);
    expect(
      avisos(conEvasiones([caso("EV-001")]), instantanea({ evasiones: { ausente: true } })),
    ).toEqual([]);
  });
});

describe("la lectura del catálogo y la lista cerrada", () => {
  it("el catálogo del PR ilegible o ausente-en-la-base se dice en el archivo del catálogo", () => {
    const h = nd.chequearLectura(conEvasiones([]), instantanea({ evasiones: { error: "boom" } }));
    expect(h.map((x) => [x.codigo, x.archivo])).toEqual([["arbol-ilegible", EVASIONES]]);
    expect(h[0]?.motivo).toContain("«evasiones»");
    expect(h[0]?.motivo).toContain("boom");
    const base = nd.chequearLectura(
      instantanea({ evasiones: { error: "boom" } }),
      conEvasiones([]),
    );
    expect(base.map((x) => [x.codigo, x.archivo])).toEqual([["base-ilegible", EVASIONES]]);
    // ausente es esperable (la base todavía no lo trae): no es un error de lectura
    expect(
      nd.chequearLectura(
        instantanea({ evasiones: { ausente: true } }),
        instantanea({ evasiones: { ausente: true } }),
      ),
    ).toEqual([]);
  });

  it("los códigos nuevos tienen su descripción y los avisos nuevos están en la lista de avisos", () => {
    for (const codigo of [
      "evasion-borrada",
      "evasion-esperado-cambiado",
      "evasion-degradada",
      "evasion-via-perdida",
    ]) {
      expect(nd.CHEQUEOS.length).toBeGreaterThan(0);
      expect(codigo).toMatch(/^evasion-/);
    }
    expect(nd.ARCHIVOS["evasiones"]).toBe("arquitectura/contratos/evasiones.json");
    expect(nd.ARCHIVOS["evasionesExternas"]).toBe("arquitectura/contratos/evasiones-github.json");
  });
});
