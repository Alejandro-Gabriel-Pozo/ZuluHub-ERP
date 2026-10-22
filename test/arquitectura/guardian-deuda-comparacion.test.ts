import { describe, expect, it } from "vitest";
import {
  REGISTRO,
  SIN_DEUDA,
  codigosDe,
  conMarcadores,
  correr,
  entrada,
  excepcion,
  json,
  lineas,
  mundo,
  type Hallazgo,
} from "./guardian-deuda-apoyo";

/**
 * La deuda ANTES y DESPUÉS de un cambio (`arquitectura/deuda/antes-y-despues.cjs`, a través de
 * `deuda.ejecutar`): los cuatro casos que bloquean (a-d) y el que nunca bloquea (pagar deuda), cada uno con su
 * código, su archivo:línea y su texto.
 */

type Mundo = Record<string, string>;
type Opciones = { bloquea?: boolean };

/** Un árbol de a.ts con `n` marcadores y esas entradas. */
const arbol = (
  n: number,
  entradas: unknown[],
  extra: Record<string, string> = {},
  o: Opciones = {},
): Mundo =>
  mundo({ "a.ts": conMarcadores(n), ...extra }, entradas, {
    bloqueaDeudaEnArchivoTocado: o.bloquea ?? true,
  });

const lineaDe = (texto: string | undefined, buscado: string, n = 1): number =>
  (texto ?? "")
    .split("\n")
    .map((renglon, i) => ({ renglon, linea: i + 1 }))
    .filter(({ renglon }) => renglon.includes(buscado))[n - 1]?.linea ?? -1;

const fallasDe = (pr: Mundo, base: Mundo): Hallazgo[] => correr(pr, base).fallas;
/** Lo que dice la comparación sin lo que ya dice la evaluación del árbol solo. */
const soloLaComparacion = (lista: Hallazgo[]): Hallazgo[] =>
  lista.filter((h) => /^deuda-(en-archivo|nueva|total|entrada-borrada|borrada)/.test(h.codigo));

describe("pagar deuda nunca bloquea", () => {
  const DEUDA = [entrada()];

  it("dos árboles iguales no dicen nada", () => {
    const resultado = correr(arbol(2, DEUDA), arbol(2, DEUDA));
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.informe.tendencia).toMatchObject({ diferencia: 0 });
  });

  it("resolver toda la deuda de un archivo (y borrar su entrada) pasa, y la tendencia baja", () => {
    const resultado = correr(arbol(0, []), arbol(3, DEUDA));
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.informe.tendencia?.diferencia).toBe(-3);
  });

  it("borrar el archivo con deuda y su entrada pasa", () => {
    const base = arbol(2, DEUDA);
    const pr = mundo({}, [], {});
    pr["arquitectura/deuda/configuracion.json"] = base[
      "arquitectura/deuda/configuracion.json"
    ] as string;
    expect(correr(pr, base).fallas).toEqual([]);
  });

  it("pagar parte de la deuda de un archivo que NO se toca (otro cambio) pasa; tocarlo sin pagar todo avisa o bloquea", () => {
    const base = arbol(3, DEUDA);
    // el archivo es el mismo en la base y en el cambio: no está tocado
    expect(correr(base, base).fallas).toEqual([]);
  });

  it("agregar una entrada de deuda sin que cambie nada más (registrar lo ya existente) no bloquea", () => {
    const base = arbol(1, [entrada({ id: "x", tipo: "ts-expect-error" })]);
    const pr = arbol(1, [entrada({ id: "x", tipo: "ts-expect-error" })]);
    expect(correr(pr, base).fallas).toEqual([]);
  });

  it("si la base todavía no trae el registro, avisa y no compara", () => {
    const base = { "a.ts": conMarcadores(1) };
    const resultado = correr(arbol(5, [entrada()]), base);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([
      {
        codigo: "deuda-base-sin-registro",
        archivo: REGISTRO,
        linea: 1,
        contrato: "deuda",
        motivo:
          "La rama base todavía no trae el registro de deuda (es la primera vez que se incorpora): no hay con qué comparar.",
        correccion: "Nada por ahora: cuando la base lo tenga, la comparación se activa sola.",
      },
    ]);
    expect(resultado.informe.tendencia).toBeNull();
    expect(resultado.informe.conBase).toBe(false);
  });
});

describe("(a) un archivo tocado no conserva la deuda que ya tenía", () => {
  const base = arbol(3, [entrada()]);
  const tocado = (
    n: number,
    entradas: unknown[] = [entrada()],
    extra: Record<string, string> = {},
    o: Opciones = {},
  ) => arbol(n, entradas, { "a.ts": `${conMarcadores(n)}export const nuevo = 1;\n`, ...extra }, o);

  it("tocar el archivo y dejarle marcadores bloquea, en la línea del primero que queda", () => {
    const pr = tocado(2);
    expect(soloLaComparacion(fallasDe(pr, base))).toEqual([
      {
        codigo: "deuda-en-archivo-tocado",
        archivo: "a.ts",
        linea: 1,
        contrato: "deuda",
        motivo:
          "El cambio toca este archivo y conserva su deuda «ts-expect-error» (2 marcadores): la regla es resolverla en el mismo cambio.",
        correccion:
          "Pagá la deuda en este cambio, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      },
    ]);
  });

  it("aunque la deuda baje (de 3 a 1) el archivo tocado sigue con deuda: hay que resolverla toda", () => {
    expect(codigosDe(soloLaComparacion(fallasDe(tocado(1), base)))).toEqual([
      "deuda-en-archivo-tocado",
    ]);
  });

  it("un archivo que no se toca, aunque tenga deuda, no bloquea", () => {
    expect(fallasDe(base, base)).toEqual([]);
  });

  it("tocar un archivo sin deuda, aunque haya otros con deuda, no bloquea", () => {
    const antes = arbol(2, [entrada()], { "c.ts": SIN_DEUDA });
    const despues = arbol(2, [entrada()], { "c.ts": `${SIN_DEUDA}export const y = 2;\n` });
    expect(correr(despues, antes).fallas).toEqual([]);
  });

  it("con `bloqueaDeudaEnArchivoTocado: false` solo avisa, con su propio código", () => {
    const resultado = correr(tocado(2, [entrada()], {}, { bloquea: false }), base);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([
      expect.objectContaining({
        codigo: "deuda-en-archivo-tocado-sin-bloqueo",
        archivo: "a.ts",
        linea: 1,
        contrato: "deuda",
      }),
    ]);
  });

  it("la opción que vale es la del cambio, no la de la base", () => {
    const baseSinBloqueo = arbol(3, [entrada()], {}, { bloquea: false });
    expect(codigosDe(correr(tocado(2), baseSinBloqueo).fallas)).toEqual([
      "deuda-en-archivo-tocado",
    ]);
    expect(correr(tocado(2, [entrada()], {}, { bloquea: false }), base).fallas).toEqual([]);
  });

  it("una excepción vigente de ese tipo y archivo lo permite", () => {
    const pr = tocado(2, [entrada(), excepcion({ id: "exc" })]);
    expect(correr(pr, base).fallas).toEqual([]);
  });

  it("una excepción vencida o de otro tipo u otro archivo no lo permite", () => {
    const vencida = excepcion({ id: "exc", creada: "2026-08-01", vence: "2026-09-01" });
    expect(codigosDe(fallasDe(tocado(2, [entrada(), vencida]), base))).toEqual([
      "deuda-en-archivo-tocado",
      "excepcion-vencida",
    ]);
    const deOtroTipo = excepcion({ id: "exc", tipo: "todo" });
    expect(
      codigosDe(soloLaComparacion(fallasDe(tocado(2, [entrada(), deOtroTipo]), base))),
    ).toEqual(["deuda-en-archivo-tocado"]);
    const deOtroArchivo = excepcion({ id: "exc", archivos: ["b.ts"] });
    const pr = tocado(2, [entrada(), deOtroArchivo], { "b.ts": conMarcadores(1) });
    expect(soloLaComparacion(fallasDe(pr, base)).map((h) => [h.codigo, h.archivo])).toEqual([
      ["deuda-en-archivo-tocado", "a.ts"],
    ]);
  });

  it("dos tipos de deuda en un archivo tocado dan un hallazgo por cada tipo", () => {
    const antes = arbol(1, [entrada(), entrada({ id: "t", tipo: "todo" })], {
      "a.ts": "// @ts-expect-error x\n// TODO: y\n",
    });
    const despues = arbol(1, [entrada(), entrada({ id: "t", tipo: "todo" })], {
      "a.ts": "// @ts-expect-error x\n// TODO: y\nexport {};\n",
    });
    expect(
      soloLaComparacion(fallasDe(despues, antes)).map((h) => [
        h.archivo,
        h.linea,
        /«([^»]+)»/.exec(h.motivo)?.[1],
      ]),
    ).toEqual([
      ["a.ts", 1, "ts-expect-error"],
      ["a.ts", 2, "todo"],
    ]);
  });

  describe("un hallazgo con verificación que sigue abierto en un archivo tocado", () => {
    const hallazgo = (cambios: Record<string, unknown> = {}) =>
      entrada({
        id: "h",
        tipo: "backlog",
        archivos: ["x.ts"],
        verificacion: { contiene: "PENDIENTE" },
        ...cambios,
      });
    const conX = (texto: string, entradas: unknown[]) =>
      mundo({ "x.ts": texto }, entradas, { bloqueaDeudaEnArchivoTocado: true });

    it("bloquea, en la línea del id de la entrada del cambio", () => {
      const antes = conX("// PENDIENTE de extraer\n", [hallazgo()]);
      const despues = conX("// PENDIENTE de extraer\nexport {};\n", [hallazgo()]);
      expect(fallasDe(despues, antes)).toEqual([
        {
          codigo: "deuda-en-archivo-tocado",
          archivo: REGISTRO,
          linea: lineaDe(despues[REGISTRO], '"id"'),
          contrato: "deuda",
          motivo:
            "El cambio toca «x.ts» y la deuda «h» sigue abierta (el archivo todavía contiene «PENDIENTE»): la regla es resolverla en el mismo cambio.",
          correccion:
            "Resolvela en este cambio, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
        },
      ]);
    });

    it("si el archivo no se toca, o el texto ya no está, o una excepción vigente lo cubre, no bloquea", () => {
      const antes = conX("// PENDIENTE de extraer\n", [hallazgo()]);
      expect(fallasDe(antes, antes)).toEqual([]);
      const resuelto = conX("export {};\n", [hallazgo()]);
      expect(fallasDe(resuelto, antes)).toEqual([]);
      const conExcepcion = conX("// PENDIENTE de extraer\nexport {};\n", [
        hallazgo(),
        excepcion({
          id: "e",
          tipo: "backlog",
          archivos: ["x.ts"],
          verificacion: { contiene: "PENDIENTE" },
        }),
      ]);
      expect(fallasDe(conExcepcion, antes)).toEqual([]);
    });

    it("de varios archivos, mira el primero que se tocó y todavía tiene el texto", () => {
      const dos = (a: string, b: string) =>
        mundo({ "x.ts": a, "y.ts": b }, [hallazgo({ archivos: ["x.ts", "y.ts"] })], {
          bloqueaDeudaEnArchivoTocado: true,
        });
      const antes = dos("// PENDIENTE\n", "// PENDIENTE\n");
      // x.ts cambió y ya no tiene el texto; y.ts tiene el texto pero no cambió; ninguno cumple las dos cosas
      expect(fallasDe(dos("export {};\n", "// PENDIENTE\n"), antes)).toEqual([]);
      // y.ts cambió y sigue con el texto
      const [falla] = fallasDe(dos("export {};\n", "// PENDIENTE\nexport {};\n"), antes);
      expect(falla?.motivo).toContain("toca «y.ts»");
    });

    it("un archivo de la lista que el cambio borra, o agrega, cuenta como tocado y no rompe la lectura", () => {
      const lista = (archivos: Record<string, string>) =>
        mundo(archivos, [hallazgo({ archivos: ["viejo.ts", "x.ts"] })], {
          bloqueaDeudaEnArchivoTocado: true,
        });
      const antes = lista({ "viejo.ts": "// PENDIENTE\n", "x.ts": "// PENDIENTE\n" });
      // viejo.ts desaparece (tocado, pero sin texto que mirar) y x.ts cambia y sigue con el texto
      const [falla] = fallasDe(lista({ "x.ts": "// PENDIENTE\nexport {};\n" }), antes);
      expect(falla?.codigo).toBe("deuda-en-archivo-tocado");
      expect(falla?.motivo).toContain("toca «x.ts»");
      // x.ts no existía en la base: es un archivo nuevo, tocado, y trae el texto
      const nuevo = lista({ "viejo.ts": "export {};\n", "x.ts": "// PENDIENTE\n" });
      const sinX = lista({ "viejo.ts": "export {};\n" });
      const [deNuevo] = fallasDe(nuevo, sinX);
      expect(deNuevo?.codigo).toBe("deuda-en-archivo-tocado");
      expect(deNuevo?.motivo).toContain("toca «x.ts»");
    });

    it("si la entrada ya no está en el cambio, lo dice (d) y no (a)", () => {
      const antes = conX("// PENDIENTE de extraer\n", [hallazgo()]);
      const despues = conX("// PENDIENTE de extraer\nexport {};\n", []);
      expect(codigosDe(fallasDe(despues, antes))).toEqual(["deuda-entrada-borrada"]);
    });

    it("un hallazgo sin verificación no puede estar «abierto en un archivo tocado»: la máquina no lo sabe", () => {
      const sin = hallazgo({ verificacion: undefined });
      const antes = conX("// x\n", [sin]);
      const despues = conX("// x\nexport {};\n", [sin]);
      expect(fallasDe(despues, antes)).toEqual([]);
    });

    it("sin verificación no se busca el texto «null» (ni ninguno) en el archivo tocado", () => {
      const sin = hallazgo({ verificacion: undefined });
      const antes = conX("// null\n", [sin]);
      const despues = conX("// null\nexport {};\n", [sin]);
      expect(fallasDe(despues, antes)).toEqual([]);
      expect(correr(despues, antes).avisos).toEqual([]);
    });
  });
});

describe("(b) deuda nueva sin excepción", () => {
  const base = arbol(0, [], { "b.ts": SIN_DEUDA });

  it("un marcador nuevo en un archivo sin deuda bloquea, en su línea, aunque esté registrado", () => {
    const pr = arbol(0, [entrada({ archivos: ["b.ts"], id: "n" })], {
      "b.ts": lineas("export {};", "// @ts-expect-error x"),
    });
    expect(soloLaComparacion(fallasDe(pr, base))).toEqual([
      {
        codigo: "deuda-nueva-sin-excepcion",
        archivo: "b.ts",
        linea: 2,
        contrato: "deuda",
        motivo:
          "Aparece deuda nueva «ts-expect-error» (1 marcadores) que la base no tenía en este archivo, sin una excepción vigente.",
        correccion:
          "No la introduzcas, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      },
    ]);
  });

  it("un tipo nuevo en un archivo que ya tenía deuda de otro tipo también es deuda nueva", () => {
    const antes = arbol(1, [entrada()]);
    const despues = arbol(1, [entrada(), entrada({ id: "t", tipo: "todo" })], {
      "a.ts": `${conMarcadores(1)}// TODO: y\n`,
    });
    const nueva = soloLaComparacion(fallasDe(despues, antes)).filter(
      (h) => h.codigo === "deuda-nueva-sin-excepcion",
    );
    expect(nueva.map((h) => [h.archivo, h.linea])).toEqual([["a.ts", 3]]);
  });

  it("con una excepción vigente de ese tipo y archivo, pasa", () => {
    const pr = arbol(0, [excepcion({ archivos: ["b.ts"], id: "n" })], {
      "b.ts": "// @ts-expect-error x\n",
    });
    expect(correr(pr, base).fallas).toEqual([]);
  });

  it("una excepción que no es vigente (vencida) no alcanza", () => {
    const vencida = excepcion({
      archivos: ["b.ts"],
      id: "n",
      creada: "2026-08-01",
      vence: "2026-09-01",
    });
    const pr = arbol(0, [vencida], { "b.ts": "// @ts-expect-error x\n" });
    expect(codigosDe(fallasDe(pr, base))).toEqual([
      "excepcion-vencida",
      "deuda-nueva-sin-excepcion",
    ]);
  });

  it("la deuda que ya estaba en la base, aunque cambie de entrada, no es nueva", () => {
    const antes = arbol(2, [entrada({ id: "vieja" })]);
    const despues = arbol(2, [entrada({ id: "renombrada" })]);
    expect(correr(despues, antes).fallas).toEqual([]);
  });

  it("una entrada de hallazgo nueva sin excepción bloquea, en la línea de su id", () => {
    const nuevo = entrada({ id: "h-nuevo", tipo: "backlog", archivos: ["b.ts"] });
    const pr = arbol(0, [nuevo], { "b.ts": SIN_DEUDA });
    expect(fallasDe(pr, base)).toEqual([
      {
        codigo: "deuda-nueva-sin-excepcion",
        archivo: REGISTRO,
        linea: lineaDe(pr[REGISTRO], '"id"'),
        contrato: "deuda",
        motivo:
          "La entrada «h-nuevo» es deuda nueva (la base no la tenía) y no lleva excepción: motivo, aprobadoPor y vence.",
        correccion: "Una deuda nueva necesita una excepción (≤ 60 días) aprobada por el dueño.",
      },
    ]);
  });

  it("un hallazgo nuevo con su excepción, o uno que ya estaba, pasan", () => {
    const conExcepcion = arbol(
      0,
      [excepcion({ id: "h-nuevo", tipo: "backlog", archivos: ["b.ts"] })],
      {
        "b.ts": SIN_DEUDA,
      },
    );
    expect(correr(conExcepcion, base).fallas).toEqual([]);
    const viejo = entrada({ id: "h", tipo: "backlog", archivos: ["b.ts"] });
    expect(
      correr(arbol(0, [viejo], { "b.ts": SIN_DEUDA }), arbol(0, [viejo], { "b.ts": SIN_DEUDA }))
        .fallas,
    ).toEqual([]);
  });

  it("una entrada nueva de un marcador (sin marcador nuevo) no es deuda nueva: registra lo que ya había", () => {
    const antes = arbol(1, [entrada({ id: "vieja" })]);
    const despues = arbol(1, [entrada({ id: "vieja" }), entrada({ id: "duplicada" })]);
    expect(correr(despues, antes).fallas).toEqual([]);
  });
});

describe("(c) el total sube", () => {
  it("más marcadores del mismo tipo en el mismo archivo, sin excepción: bloquea en el primero de más", () => {
    const antes = arbol(2, [entrada()]);
    const despues = arbol(4, [entrada()], {}, { bloquea: false });
    expect(correr(despues, antes).fallas).toEqual([
      {
        codigo: "deuda-total-sube",
        archivo: "a.ts",
        linea: 3,
        contrato: "deuda",
        motivo:
          "El total de «ts-expect-error» en este archivo sube de 2 a 4 sin una excepción vigente.",
        correccion:
          "Sacá el marcador de más, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      },
    ]);
  });

  it("el mismo total, o menos, no sube", () => {
    expect(
      correr(arbol(2, [entrada()], {}, { bloquea: false }), arbol(2, [entrada()])).fallas,
    ).toEqual([]);
    expect(
      correr(arbol(1, [entrada()], {}, { bloquea: false }), arbol(2, [entrada()])).fallas,
    ).toEqual([]);
  });

  it("con una excepción vigente pasa", () => {
    const despues = arbol(4, [entrada(), excepcion({ id: "e" })], {}, { bloquea: false });
    expect(correr(despues, arbol(2, [entrada()])).fallas).toEqual([]);
  });

  it("en un archivo tocado con `bloquea: true` también dice (a), además de (c)", () => {
    const codigos = codigosDe(fallasDe(arbol(3, [entrada()]), arbol(2, [entrada()])));
    expect(codigos.sort()).toEqual(["deuda-en-archivo-tocado", "deuda-total-sube"]);
  });
});

describe("(d) una entrada del registro no desaparece mientras el problema sigue", () => {
  const verificada = (cambios: Record<string, unknown> = {}) =>
    entrada({
      id: "h",
      tipo: "backlog",
      archivos: ["x.ts", "y.ts"],
      verificacion: { contiene: "PENDIENTE" },
      ...cambios,
    });
  const conXY = (x: string, y: string, entradas: unknown[]) =>
    mundo({ "x.ts": x, "y.ts": y }, entradas, { bloqueaDeudaEnArchivoTocado: true });

  it("borrar la entrada de un marcador que sigue está, falla en el marcador (además de quedar sin registrar)", () => {
    const antes = arbol(2, [entrada()]);
    const despues = arbol(2, [], {}, { bloquea: false });
    expect(correr(despues, antes).fallas).toEqual([
      {
        codigo: "deuda-entrada-borrada",
        archivo: "a.ts",
        linea: 1,
        contrato: "deuda",
        motivo:
          "La entrada «ts-expect-error--a-ts» ya no está en el registro y el marcador «ts-expect-error» sigue acá: se borró la deuda sin pagarla.",
        correccion: "Devolvé la entrada al registro, o resolvé el marcador.",
      },
      expect.objectContaining({ codigo: "deuda-sin-registrar", linea: 1 }),
      expect.objectContaining({ codigo: "deuda-sin-registrar", linea: 2 }),
    ]);
  });

  it("otra entrada del cambio, de otro tipo o de otro archivo, no cubre la que se borró", () => {
    const deB = entrada({ id: "b", archivos: ["b.ts"] });
    const deOtroTipo = entrada({ id: "c", tipo: "todo", archivos: ["a.ts"] });
    const antes = arbol(1, [entrada(), deB], { "b.ts": conMarcadores(1) });
    // misma clase de marcador, otro archivo
    const conB = arbol(1, [deB], { "b.ts": conMarcadores(1) }, { bloquea: false });
    expect(soloLaComparacion(correr(conB, antes).fallas).map((f) => f.codigo)).toEqual([
      "deuda-entrada-borrada",
    ]);
    // el mismo archivo, otro tipo de marcador
    const conC = arbol(1, [deOtroTipo, deB], { "b.ts": conMarcadores(1) }, { bloquea: false });
    expect(soloLaComparacion(correr(conC, antes).fallas).map((f) => f.codigo)).toEqual([
      "deuda-entrada-borrada",
    ]);
  });

  it("borrar la entrada pagando el marcador pasa", () => {
    expect(correr(arbol(0, []), arbol(2, [entrada()])).fallas).toEqual([]);
  });

  it("si otra entrada del cambio registra el mismo tipo y archivo, no se perdió la deuda", () => {
    const antes = arbol(1, [entrada()]);
    const despues = arbol(1, [entrada({ id: "otra" })], {}, { bloquea: false });
    expect(correr(despues, antes).fallas).toEqual([]);
  });

  it("un hallazgo con verificación que sigue abierto: falla en el archivo y la línea donde está su texto", () => {
    const antes = conXY("// PENDIENTE\n", "export {};\n", [verificada()]);
    const despues = conXY("export {};\n", "a;\nb; // PENDIENTE aquí\n", []);
    expect(fallasDe(despues, antes)).toEqual([
      {
        codigo: "deuda-entrada-borrada",
        archivo: "y.ts",
        linea: 2,
        contrato: "deuda",
        motivo:
          "La entrada «h» ya no está en el registro y el problema sigue (acá todavía está «PENDIENTE»): se borró la deuda sin pagarla.",
        correccion: "Devolvé la entrada al registro, o resolvé el problema.",
      },
    ]);
  });

  it("un hallazgo cuya verificación ya no encuentra su texto se borra sin problema", () => {
    const antes = conXY("// PENDIENTE\n", "export {};\n", [verificada()]);
    expect(fallasDe(conXY("export {};\n", "export {};\n", []), antes)).toEqual([]);
  });

  it("un archivo del hallazgo que ya no existe cuenta como resuelto", () => {
    const antes = conXY("// PENDIENTE\n", "// PENDIENTE\n", [verificada()]);
    const despues = mundo({ "x.ts": "export {};\n" }, [], { bloqueaDeudaEnArchivoTocado: true });
    expect(fallasDe(despues, antes)).toEqual([]);
  });

  it("un hallazgo sin verificación que desaparece avisa que nadie puede comprobarlo", () => {
    const sin = verificada({ verificacion: undefined });
    const antes = conXY("// x\n", "// y\n", [sin]);
    const resultado = correr(conXY("// x\n", "// y\n", []), antes);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([
      {
        codigo: "deuda-borrada-sin-verificar",
        archivo: REGISTRO,
        linea: 1,
        contrato: "deuda",
        motivo:
          "La entrada «h» ya no está en el registro y no tiene verificación: la máquina no puede saber si se pagó.",
        correccion: "Que quien revisa el cambio confirme que la deuda se resolvió de verdad.",
      },
    ]);
  });

  it("una entrada que sigue (aunque se edite) no es una entrada borrada", () => {
    const antes = conXY("// PENDIENTE\n", "// x\n", [verificada()]);
    const despues = conXY("// PENDIENTE\n", "// x\n", [
      verificada({ descripcion: "Otra redacción." }),
    ]);
    expect(codigosDe(fallasDe(despues, antes))).not.toContain("deuda-entrada-borrada");
  });

  it("una entrada mal formada de la base (que no se pudo normalizar) no se reclama", () => {
    const rota = { ...entrada(), archivos: "a.ts" };
    const antes = arbol(0, [rota]);
    expect(codigosDe(correr(arbol(0, []), antes).fallas)).toEqual([]);
  });
});

describe("el trinquete de los archivos grandes contra la base", () => {
  const deLineas = (n: number): string =>
    lineas(...Array.from({ length: n }, (_, i) => `export const x${String(i)} = ${String(i)};`));
  const registro = (archivo: string, tamano: number, cambios: Record<string, unknown> = {}) =>
    entrada({
      id: `archivo-grande--${archivo.replace(/\W+/g, "-")}`,
      tipo: "archivo-grande",
      archivos: [archivo],
      tamano,
      ...cambios,
    });
  const excepcionDe = (archivo: string, tamano: number) =>
    registro(archivo, tamano, {
      motivo: "Se parte en la próxima entrega.",
      aprobadoPor: "Dueño del producto",
      creada: "2026-10-22",
      vence: "2026-11-21",
    });
  const mundoDe = (archivos: Record<string, string>, entradas: unknown[]): Mundo =>
    mundo(archivos, entradas, { bloqueaDeudaEnArchivoTocado: false });
  const base = mundoDe({ "src/a.ts": deLineas(450) }, [registro("src/a.ts", 450)]);
  const deLaComparacion = (pr: Mundo) => soloLaComparacion(correr(pr, base).fallas);

  it("el mismo tamaño no dice nada, y achicarse tampoco bloquea", () => {
    expect(correr(base, base).fallas).toEqual([]);
    const achicado = mundoDe({ "src/a.ts": deLineas(420) }, [registro("src/a.ts", 420)]);
    const resultado = correr(achicado, base);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.tendencia?.diferencia).toBe(0);
  });

  it("crecer bloquea, en la primera línea de más sobre el tamaño de la base, aunque el libro se actualice", () => {
    const crecido = mundoDe({ "src/a.ts": deLineas(455) }, [registro("src/a.ts", 455)]);
    expect(deLaComparacion(crecido)).toEqual([
      {
        codigo: "deuda-total-sube",
        archivo: "src/a.ts",
        linea: 451,
        contrato: "deuda",
        motivo:
          "El tamaño de este archivo (deuda «archivo-grande») sube de 450 a 455 líneas sin una excepción vigente.",
        correccion:
          "Achicalo (el trinquete solo baja), o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      },
    ]);
  });

  it("crecer un solo renglón ya bloquea; achicar un renglón y volver a crecer, no", () => {
    const uno = mundoDe({ "src/a.ts": deLineas(451) }, [registro("src/a.ts", 451)]);
    expect(deLaComparacion(uno).map((f) => f.linea)).toEqual([451]);
    const menos = mundoDe({ "src/a.ts": deLineas(449) }, [registro("src/a.ts", 449)]);
    expect(deLaComparacion(menos)).toEqual([]);
  });

  it("con una excepción vigente de ese archivo, crecer pasa", () => {
    const crecido = mundoDe({ "src/a.ts": deLineas(470) }, [excepcionDe("src/a.ts", 470)]);
    expect(deLaComparacion(crecido)).toEqual([]);
  });

  it("crecer y dejar el libro viejo falla por el libro (el trinquete del registro), no solo por la base", () => {
    const crecido = mundoDe({ "src/a.ts": deLineas(455) }, [registro("src/a.ts", 450)]);
    expect(codigosDe(correr(crecido, base).fallas)).toEqual([
      "deuda-archivo-crece",
      "deuda-total-sube",
    ]);
  });

  it("un archivo nuevo que pasa del tope es deuda nueva, en la línea siguiente al tope", () => {
    const pr = mundoDe({ "src/a.ts": deLineas(450), "src/b.ts": deLineas(500) }, [
      registro("src/a.ts", 450),
      registro("src/b.ts", 500),
    ]);
    expect(deLaComparacion(pr)).toEqual([
      {
        codigo: "deuda-nueva-sin-excepcion",
        archivo: "src/b.ts",
        linea: 401,
        contrato: "deuda",
        motivo:
          "Aparece deuda nueva «archivo-grande» (1 marcadores) que la base no tenía en este archivo, sin una excepción vigente.",
        correccion:
          "No la introduzcas, o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      },
    ]);
  });

  it("un archivo de 400 líneas que cruza el tope también es deuda nueva; con excepción vigente, pasa", () => {
    const antes = mundoDe({ "src/a.ts": deLineas(400) }, []);
    const cruza = mundoDe({ "src/a.ts": deLineas(401) }, [registro("src/a.ts", 401)]);
    expect(soloLaComparacion(correr(cruza, antes).fallas).map((f) => [f.codigo, f.linea])).toEqual([
      ["deuda-nueva-sin-excepcion", 401],
    ]);
    const conExcepcion = mundoDe({ "src/a.ts": deLineas(401) }, [excepcionDe("src/a.ts", 401)]);
    expect(correr(conExcepcion, antes).fallas).toEqual([]);
  });

  it("borrar la entrada de un archivo que sigue grande falla en la línea siguiente al tope", () => {
    const pr = mundoDe({ "src/a.ts": deLineas(450) }, []);
    expect(soloLaComparacion(correr(pr, base).fallas)).toEqual([
      {
        codigo: "deuda-entrada-borrada",
        archivo: "src/a.ts",
        linea: 401,
        contrato: "deuda",
        motivo:
          "La entrada «archivo-grande--src-a-ts» ya no está en el registro y el marcador «archivo-grande» sigue acá: se borró la deuda sin pagarla.",
        correccion: "Devolvé la entrada al registro, o resolvé el marcador.",
      },
    ]);
  });

  it("partir el archivo por debajo del tope y borrar su entrada es pagar: pasa", () => {
    const pr = mundoDe({ "src/a.ts": deLineas(380), "src/b.ts": deLineas(70) }, []);
    expect(correr(pr, base).fallas).toEqual([]);
  });

  it("la tendencia cuenta un marcador por archivo grande", () => {
    const resultado = correr(base, base);
    expect(resultado.informe.tendencia?.base.porTipo).toEqual({ "archivo-grande": 1 });
  });
});

describe("la tendencia y el informe de la comparación", () => {
  it("compara el total de la base con el del cambio, por tipo", () => {
    const antes = arbol(3, [entrada(), entrada({ id: "h", tipo: "backlog", archivos: ["a.ts"] })]);
    const despues = arbol(
      1,
      [entrada(), entrada({ id: "h", tipo: "backlog", archivos: ["a.ts"] })],
      {},
      { bloquea: false },
    );
    const { informe } = correr(despues, antes);
    expect(informe.conBase).toBe(true);
    expect(informe.tendencia).toEqual({
      base: {
        marcadores: 3,
        hallazgos: 1,
        total: 4,
        archivosConDeuda: 1,
        porTipo: { "ts-expect-error": 3, backlog: 1 },
      },
      pr: {
        marcadores: 1,
        hallazgos: 1,
        total: 2,
        archivosConDeuda: 1,
        porTipo: { "ts-expect-error": 1, backlog: 1 },
      },
      diferencia: -2,
    });
  });

  it("no mira la base si no se la dan", () => {
    const { informe, avisos } = correr(arbol(1, [entrada()]));
    expect(informe.tendencia).toBeNull();
    expect(informe.conBase).toBe(false);
    expect(avisos).toEqual([]);
  });

  it("las fallas de la base misma (una entrada inválida allá) no se le cargan al cambio", () => {
    const base = arbol(1, [entrada(), entrada({ id: "otra", sobrante: 1 })]);
    expect(correr(arbol(1, [entrada()], {}, { bloquea: false }), base).fallas).toEqual([]);
    expect(json([]).length).toBeGreaterThan(0);
  });
});
