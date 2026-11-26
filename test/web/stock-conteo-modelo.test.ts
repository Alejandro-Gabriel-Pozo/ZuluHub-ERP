import { describe, expect, it } from "vitest";
import {
  CLAVE_DE_TEXTO_DEL_MOTIVO_DE_DIFERENCIA,
  armarLaRevision,
  hayQueGuardar,
  hrefDeRevisar,
  hrefDelConteo,
  idDelRegistro,
  leerElConteo,
  puedeAplicar,
  sinCerosDeSobra,
  type FilaDeLaCarga,
  type RevisionDeLaComposicion,
} from "../../apps/web/ui/plantillas/stock/conteo/modelo-de-conteo";
import { MOTIVOS_DE_DIFERENCIA } from "../../src/modulos/stock/publico";

/** El modelo de «Conteo» (STK-D): direcciones, qué se guarda, ids de reintento, revisión a ciegas y motivos con texto aprobado. */
const fila = (extra: Partial<FilaDeLaCarga> = {}): FilaDeLaCarga => ({
  articuloId: "a1",
  contado: "",
  hora: "",
  guardado: null,
  intento: null,
  ...extra,
});
const textoDe = (clave: string, valores?: Readonly<Record<string, string>>) =>
  valores === undefined ? clave : `${clave}|${JSON.stringify(valores)}`;

describe("direcciones", () => {
  it("el depósito y el conteo viajan escapados en la dirección y se leen de vuelta", () => {
    expect(hrefDelConteo()).toBe("/stock/conteo");
    expect(hrefDelConteo("d 1&x")).toBe("/stock/conteo?deposito=d+1%26x");
    expect(hrefDeRevisar("c1")).toBe("/stock/conteo/revisar?conteo=c1");
    expect(leerElConteo({ deposito: "d1", conteo: "c1" })).toEqual({
      depositoId: "d1",
      conteoId: "c1",
    });
  });

  it("un valor vacío o repetido se descarta (la forma la valida la composición)", () => {
    expect(leerElConteo({ deposito: "", conteo: ["a", "b"] })).toEqual({});
    expect(leerElConteo({})).toEqual({});
  });
});

describe("qué fila se guarda y con qué id", () => {
  it("sin nada contado no se guarda; cero SÍ es una cantidad contada", () => {
    expect(hayQueGuardar(fila())).toBe(false);
    expect(hayQueGuardar(fila({ contado: "0" }))).toBe(true);
  });

  it("lo ya guardado no se vuelve a guardar; cambiar la cantidad o la hora, sí", () => {
    const guardado = { contado: "5", hora: "" };
    expect(hayQueGuardar(fila({ contado: "5", guardado }))).toBe(false);
    expect(hayQueGuardar(fila({ contado: "6", guardado }))).toBe(true);
    expect(hayQueGuardar(fila({ contado: "5", hora: "10:00", guardado }))).toBe(true);
  });

  it("reintentar el MISMO valor reusa el id (no duplica); recontar usa uno nuevo", () => {
    const intento = { id: "viejo", contado: "5", hora: "" };
    expect(idDelRegistro(fila({ contado: "5", intento }), () => "nuevo")).toBe("viejo");
    expect(idDelRegistro(fila({ contado: "6", intento }), () => "nuevo")).toBe("nuevo");
    expect(idDelRegistro(fila({ contado: "5", hora: "09:00", intento }), () => "nuevo")).toBe(
      "nuevo",
    );
    expect(idDelRegistro(fila({ contado: "5" }), () => "nuevo")).toBe("nuevo");
  });

  it("lo guardado vuelve sin ceros de sobra, texto a texto", () => {
    expect(sinCerosDeSobra("18.0000")).toBe("18");
    expect(sinCerosDeSobra("17.5000")).toBe("17.5");
    expect(sinCerosDeSobra("0.0000")).toBe("0");
    expect(sinCerosDeSobra("100")).toBe("100");
  });
});

describe("motivos de diferencia", () => {
  it("todo motivo del módulo tiene su texto aprobado (lo que no, no se ofrece)", () => {
    for (const m of MOTIVOS_DE_DIFERENCIA) {
      expect(Object.keys(CLAVE_DE_TEXTO_DEL_MOTIVO_DE_DIFERENCIA), m.codigo).toContain(m.codigo);
    }
  });
});

const revision = (extra: Partial<RevisionDeLaComposicion> = {}): RevisionDeLaComposicion => ({
  conteoId: "c1",
  estado: "ABIERTO",
  huella: "h",
  filas: [
    {
      articuloId: "a1",
      nombre: "Harina",
      unidadId: "KILOGRAMO",
      contada: "18.0000",
      contadoEn: "2026-10-11T13:10:00.000Z",
      sistema: "20.0000",
      movido: "-1.0000",
      diferencia: "-1.0000",
      motivos: [
        { codigo: "MERMA", pideDetalle: false },
        { codigo: "OTRA_SALIDA", pideDetalle: true },
        { codigo: "INVENTADO", pideDetalle: false },
      ],
    },
    {
      articuloId: "a2",
      nombre: "Sal",
      unidadId: "KILOGRAMO",
      contada: "3.0000",
      contadoEn: "2026-10-11T13:10:00.000Z",
      sistema: "3.0000",
      movido: "0.0000",
      diferencia: "0.0000",
      motivos: [],
    },
  ],
  aplicadas: [],
  ...extra,
});

describe("la revisión", () => {
  it("solo la fila con diferencia pide motivo, y un motivo sin texto aprobado no se ofrece", () => {
    const { filas } = armarLaRevision(revision(), textoDe);
    expect(filas.map((f) => f.conDiferencia)).toEqual([true, false]);
    expect(filas[0]?.motivos.map((m) => m.codigo)).toEqual(["MERMA", "OTRA_SALIDA"]);
    expect(filas[0]?.rotuloDeMovido).toContain("stock.conteo.movido_desde");
  });

  it("a ciegas: sin lo que el sistema creía, lo movido ni la diferencia, esos campos no existen", () => {
    const ciega = revision({
      huella: null,
      filas: [
        {
          articuloId: "a1",
          nombre: "Harina",
          unidadId: "KILOGRAMO",
          contada: "18.0000",
          contadoEn: "2026-10-11T13:10:00.000Z",
        },
      ],
    });
    const { filas } = armarLaRevision(ciega, textoDe);
    expect(filas[0]).toMatchObject({
      sistema: null,
      movido: null,
      diferencia: null,
      conDiferencia: false,
    });
  });

  it("el resultado aplicado muestra el motivo con su texto y el detalle", () => {
    const { aplicadas } = armarLaRevision(
      revision({
        estado: "APLICADO",
        aplicadas: [
          {
            articuloId: "a1",
            nombre: "Harina",
            unidadId: "KILOGRAMO",
            contada: "18.0000",
            diferencia: "-1.0000",
            motivo: "MERMA",
            detalle: null,
          },
          {
            articuloId: "a2",
            nombre: "Sal",
            unidadId: "KILOGRAMO",
            contada: "3.0000",
            diferencia: "0.0000",
            motivo: "INVENTADO",
            detalle: "x",
          },
        ],
      }),
      textoDe,
    );
    expect(aplicadas[0]?.motivo).toBe("stock.motivo.merma");
    expect(aplicadas[1]?.motivo).toBeNull();
  });
});

describe("«Aplicar» se ofrece cuando todo está explicado", () => {
  const { filas } = armarLaRevision(revision(), textoDe);
  it("sin motivo para la fila con diferencia, no", () => {
    expect(puedeAplicar(filas, {})).toBe(false);
  });
  it("con motivo, sí; si el motivo pide detalle, hace falta el detalle", () => {
    expect(puedeAplicar(filas, { a1: { motivo: "MERMA", detalle: "" } })).toBe(true);
    expect(puedeAplicar(filas, { a1: { motivo: "OTRA_SALIDA", detalle: "  " } })).toBe(false);
    expect(puedeAplicar(filas, { a1: { motivo: "OTRA_SALIDA", detalle: "se cayó" } })).toBe(true);
  });
  it("un motivo que no es de la fila no vale", () => {
    expect(puedeAplicar(filas, { a1: { motivo: "DEVOLUCION_DE_CLIENTE", detalle: "" } })).toBe(
      false,
    );
  });
});
