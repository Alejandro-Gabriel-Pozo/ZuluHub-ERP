import { describe, expect, it } from "vitest";
import {
  camposDeHuellaDeLaCorreccionDeLoRecibido,
  CAUSAS_DE_CORRECCION,
  claveDelMovimientoDeLaCorreccion,
  idDeLaCorreccionDeLoRecibido,
  leerCorreccionDeLoRecibido,
  MAXIMO_DE_LA_NOTA_DE_CORRECCION,
} from "./correccion-de-lo-recibido";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

const CLAVE = "11111111-1111-4111-8111-111111111111";
const RECEPCION = "22222222-2222-4222-8222-222222222222";
const pedido = (extra: Record<string, unknown> = {}) => ({
  clave: CLAVE,
  recepcionId: RECEPCION,
  linea: 1,
  correccionesVistas: 0,
  cantidad: "1500",
  causa: "ERROR_DE_CARGA",
  ...extra,
});
const error = (r: ReturnType<typeof leerCorreccionDeLoRecibido>) => (r.ok ? null : r.error);

describe("leerCorreccionDeLoRecibido: lo que se acepta", () => {
  it("normaliza la cantidad a 4 decimales, deja la nota en null si no viene y toma la causa y la versión vista", () => {
    expect(leerCorreccionDeLoRecibido(pedido())).toEqual({
      ok: true,
      valor: {
        clave: CLAVE,
        recepcionId: RECEPCION,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "1500.0000",
        causa: "ERROR_DE_CARGA",
        nota: null,
        confirmoExistenciaNegativa: false,
      },
    });
  });

  it("las tres causas de la lista cerrada pasan, y solo ellas", () => {
    expect([...CAUSAS_DE_CORRECCION]).toEqual([
      "ERROR_DE_CARGA",
      "REPARTO_INTERNO",
      "FALTANTE_DEL_PROVEEDOR",
    ]);
    for (const causa of CAUSAS_DE_CORRECCION) {
      expect(leerCorreccionDeLoRecibido(pedido({ causa })).ok).toBe(true);
    }
    for (const causa of ["", "OTRA", "error_de_carga", null, undefined, 1, ["ERROR_DE_CARGA"]]) {
      expect(error(leerCorreccionDeLoRecibido(pedido({ causa })))).toBe(
        "CAUSA_DE_CORRECCION_INVALIDA",
      );
    }
  });

  it("la nota es opcional (ausente, nula o vacía es «sin nota»), se limpia y vale hasta el máximo, con una letra", () => {
    for (const nota of [undefined, null, ""]) {
      expect(leerCorreccionDeLoRecibido(pedido({ nota }))).toMatchObject({
        ok: true,
        valor: { nota: null },
      });
    }
    expect(leerCorreccionDeLoRecibido(pedido({ nota: "  Faltaron   2 bolsas " }))).toMatchObject({
      ok: true,
      valor: { nota: "Faltaron 2 bolsas" },
    });
    expect(MAXIMO_DE_LA_NOTA_DE_CORRECCION).toBe(200);
    expect(
      leerCorreccionDeLoRecibido(pedido({ nota: "a".repeat(MAXIMO_DE_LA_NOTA_DE_CORRECCION) })).ok,
    ).toBe(true);
    for (const nota of [
      "a".repeat(MAXIMO_DE_LA_NOTA_DE_CORRECCION + 1),
      "   ",
      "123",
      "=1+1",
      "dos\nlíneas",
      5,
      true,
      {},
    ]) {
      expect(error(leerCorreccionDeLoRecibido(pedido({ nota })))).toBe(
        "NOTA_DE_CORRECCION_INVALIDA",
      );
    }
  });

  it("la confirmación de existencia negativa es opcional y solo booleana", () => {
    expect(leerCorreccionDeLoRecibido(pedido({ confirmoExistenciaNegativa: true }))).toMatchObject({
      ok: true,
      valor: { confirmoExistenciaNegativa: true },
    });
    expect(leerCorreccionDeLoRecibido(pedido({ confirmoExistenciaNegativa: false }))).toMatchObject(
      { ok: true, valor: { confirmoExistenciaNegativa: false } },
    );
    for (const confirmo of ["true", 1, null, {}]) {
      expect(
        error(leerCorreccionDeLoRecibido(pedido({ confirmoExistenciaNegativa: confirmo }))),
      ).toBe("IDENTIFICADOR_INVALIDO");
    }
  });
});

describe("leerCorreccionDeLoRecibido: lo que se rechaza, en el orden del pedido", () => {
  it("la clave y la recepción tienen que ser UUID", () => {
    for (const malo of [undefined, null, "", "x", 5, CLAVE.slice(1)]) {
      expect(error(leerCorreccionDeLoRecibido(pedido({ clave: malo })))).toBe(
        "IDENTIFICADOR_INVALIDO",
      );
      expect(error(leerCorreccionDeLoRecibido(pedido({ recepcionId: malo })))).toBe(
        "IDENTIFICADOR_INVALIDO",
      );
    }
    // Un objeto que se escribe como un UUID no es un UUID: tiene que ser texto.
    const comoTexto = { toString: () => CLAVE };
    expect(error(leerCorreccionDeLoRecibido(pedido({ clave: comoTexto })))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    expect(error(leerCorreccionDeLoRecibido(pedido({ recepcionId: comoTexto })))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    for (const crudo of [null, undefined, "texto", 5, [], [pedido()]]) {
      expect(error(leerCorreccionDeLoRecibido(crudo))).toBe("IDENTIFICADOR_INVALIDO");
    }
  });

  it("la línea es un entero de 1 hasta el máximo de renglones de una compra", () => {
    for (const linea of [1, 2, MAXIMO_DE_RENGLONES_DE_UNA_COMPRA]) {
      expect(leerCorreccionDeLoRecibido(pedido({ linea })).ok).toBe(true);
    }
    for (const linea of [0, -1, MAXIMO_DE_RENGLONES_DE_UNA_COMPRA + 1, 1.5, "1", null, undefined]) {
      expect(error(leerCorreccionDeLoRecibido(pedido({ linea })))).toBe("LINEA_NO_ENCONTRADA");
    }
  });

  it("la versión vista es un entero de 0 a un millón", () => {
    for (const correccionesVistas of [0, 1, 1_000_000]) {
      expect(leerCorreccionDeLoRecibido(pedido({ correccionesVistas })).ok).toBe(true);
    }
    for (const correccionesVistas of [-1, 1_000_001, 0.5, "0", null, undefined]) {
      expect(error(leerCorreccionDeLoRecibido(pedido({ correccionesVistas })))).toBe(
        "CORRECCION_DESACTUALIZADA",
      );
    }
  });

  it("la cantidad es un texto decimal mayor que cero de hasta 4 decimales", () => {
    for (const cantidad of ["0.0001", "1", "1500.5", "99999999999999"]) {
      expect(leerCorreccionDeLoRecibido(pedido({ cantidad })).ok).toBe(true);
    }
    for (const cantidad of [
      "0",
      "0.0000",
      "-1",
      "1.00001",
      "abc",
      "",
      "1e3",
      "100000000000000",
      1500,
      null,
      undefined,
    ]) {
      expect(error(leerCorreccionDeLoRecibido(pedido({ cantidad })))).toBe("CANTIDAD_INVALIDA");
    }
  });

  it("el primer error es el del orden del pedido: ids, línea, versión, cantidad, causa, nota", () => {
    const todoMalo = {
      clave: "x",
      recepcionId: "x",
      linea: 0,
      correccionesVistas: -1,
      cantidad: "x",
      causa: "x",
      nota: 5,
    };
    expect(error(leerCorreccionDeLoRecibido(todoMalo))).toBe("IDENTIFICADOR_INVALIDO");
    const sinIds = { ...todoMalo, clave: CLAVE, recepcionId: RECEPCION };
    expect(error(leerCorreccionDeLoRecibido(sinIds))).toBe("LINEA_NO_ENCONTRADA");
    expect(error(leerCorreccionDeLoRecibido({ ...sinIds, linea: 1 }))).toBe(
      "CORRECCION_DESACTUALIZADA",
    );
    expect(error(leerCorreccionDeLoRecibido({ ...sinIds, linea: 1, correccionesVistas: 0 }))).toBe(
      "CANTIDAD_INVALIDA",
    );
    expect(
      error(
        leerCorreccionDeLoRecibido({ ...sinIds, linea: 1, correccionesVistas: 0, cantidad: "1" }),
      ),
    ).toBe("CAUSA_DE_CORRECCION_INVALIDA");
    expect(
      error(
        leerCorreccionDeLoRecibido({
          ...sinIds,
          linea: 1,
          correccionesVistas: 0,
          cantidad: "1",
          causa: "ERROR_DE_CARGA",
        }),
      ),
    ).toBe("NOTA_DE_CORRECCION_INVALIDA");
  });
});

describe("la huella de la corrección y sus identificadores", () => {
  const leida = (extra: Record<string, unknown> = {}) => {
    const r = leerCorreccionDeLoRecibido(pedido(extra));
    if (!r.ok) throw new Error("pedido inválido");
    return r.valor;
  };

  it("cada campo del contenido cambia la huella; la clave y la confirmación de existencia negativa no (repetir el pedido es el mismo pedido)", () => {
    const base = camposDeHuellaDeLaCorreccionDeLoRecibido(leida());
    expect(base).toEqual([RECEPCION, 1, 0, "1500.0000", "ERROR_DE_CARGA", null]);
    for (const extra of [
      { recepcionId: "33333333-3333-4333-8333-333333333333" },
      { linea: 2 },
      { correccionesVistas: 1 },
      { cantidad: "1400" },
      { causa: "REPARTO_INTERNO" },
      { nota: "otra" },
    ]) {
      expect(camposDeHuellaDeLaCorreccionDeLoRecibido(leida(extra))).not.toEqual(base);
    }
    expect(
      camposDeHuellaDeLaCorreccionDeLoRecibido(
        leida({ clave: "44444444-4444-4444-8444-444444444444", confirmoExistenciaNegativa: true }),
      ),
    ).toEqual(base);
    // La misma cantidad escrita distinto es el mismo pedido.
    expect(camposDeHuellaDeLaCorreccionDeLoRecibido(leida({ cantidad: "1500.0" }))).toEqual(base);
  });

  it("el id de la corrección y la clave de su movimiento salen de la clave, son fijos (cambiar un espacio reescribiría el origen de lo ya guardado) y distintos entre sí", () => {
    const id = idDeLaCorreccionDeLoRecibido(CLAVE);
    expect(id).toBe("b03c73d8-bbd8-5c8d-a48c-8970ac932cdb");
    expect(claveDelMovimientoDeLaCorreccion(id)).toBe("d4417a8b-bb73-5d6c-872d-ab79052c887a");
    expect(idDeLaCorreccionDeLoRecibido(CLAVE)).toBe(id);
    expect(idDeLaCorreccionDeLoRecibido(RECEPCION)).not.toBe(id);
    expect(claveDelMovimientoDeLaCorreccion(id)).not.toBe(id);
    expect(claveDelMovimientoDeLaCorreccion(RECEPCION)).not.toBe(
      claveDelMovimientoDeLaCorreccion(id),
    );
  });
});
