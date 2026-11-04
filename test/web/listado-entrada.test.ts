import { describe, expect, it } from "vitest";
import {
  conElPeriodoFijo,
  entradaDelListado,
  hoyEnArgentina,
  rangoDelPeriodo,
  ZONA_DE_ARGENTINA,
} from "../../apps/web/pantallas/entrada-del-listado";
import {
  ESTADOS_DEL_FILTRO,
  FILTROS_POR_DEFECTO,
  type FiltrosDelListado,
} from "../../apps/web/ui/plantillas/facturacion/filtros-del-listado";
import { entradaDeListar } from "../../src/composicion/entradas-de-facturacion";
import { ZONA_DE_ARGENTINA as ZONA_DE_LA_CONSULTA } from "../../src/modulos/fiscal/persistencia/lecturas-de-comprobantes";

/**
 * Del período a las fechas del pedido: fechas civiles de Argentina (UTC-3, sin horario de verano), no la hora del servidor.
 */

const con = (cambios: Partial<FiltrosDelListado>): FiltrosDelListado => ({
  ...FILTROS_POR_DEFECTO,
  ...cambios,
});
/** Un instante dado en hora de Argentina («2026-10-28 23:30» es UTC-3). */
const enArgentina = (fecha: string, hora: string): Date => new Date(`${fecha}T${hora}:00-03:00`);

describe("hoy en Argentina", () => {
  it("cerca de la medianoche, el día de Argentina y no el del servidor (UTC)", () => {
    // 23:30 en Argentina del 28 ya es 02:30 UTC del 29.
    expect(hoyEnArgentina(new Date("2026-10-29T02:30:00Z"))).toBe("2026-10-28");
    // 00:00 en Argentina del 29 son las 03:00 UTC.
    expect(hoyEnArgentina(new Date("2026-10-29T02:59:59Z"))).toBe("2026-10-28");
    expect(hoyEnArgentina(new Date("2026-10-29T03:00:00Z"))).toBe("2026-10-29");
    expect(hoyEnArgentina(enArgentina("2026-12-31", "23:59"))).toBe("2026-12-31");
  });

  it("un instante que no es una fecha es un error, no un día cualquiera", () => {
    expect(() => hoyEnArgentina(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("la zona es la misma que usa la consulta para la fecha de un comprobante", () => {
    expect(ZONA_DE_ARGENTINA).toBe(ZONA_DE_LA_CONSULTA);
  });
});

describe("el rango de cada período", () => {
  it("«Hoy»: el día de hoy", () => {
    expect(rangoDelPeriodo(con({ periodo: "hoy" }), enArgentina("2026-10-28", "23:30"))).toEqual({
      desde: "2026-10-28",
      hasta: "2026-10-28",
    });
  });

  it("«Este mes»: del 1.º a hoy, también el último día del mes y el 1.º", () => {
    const mes = (fecha: string, hora = "12:00") =>
      rangoDelPeriodo(con({ periodo: "mes" }), enArgentina(fecha, hora));
    expect(mes("2026-10-14")).toEqual({ desde: "2026-10-01", hasta: "2026-10-14" });
    expect(mes("2026-10-31", "23:59")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(mes("2026-11-01", "00:00")).toEqual({ desde: "2026-11-01", hasta: "2026-11-01" });
    expect(mes("2028-02-29")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });

  it("«Este mes» a las 00:30 de Argentina del 1.º (03:30 UTC) ya es el mes nuevo", () => {
    expect(rangoDelPeriodo(con({ periodo: "mes" }), new Date("2026-11-01T03:30:00Z"))).toEqual({
      desde: "2026-11-01",
      hasta: "2026-11-01",
    });
    // Y a las 23:30 del 31 (02:30 UTC del 1.º) todavía es octubre.
    expect(rangoDelPeriodo(con({ periodo: "mes" }), new Date("2026-11-01T02:30:00Z"))).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
    });
  });

  it("«Últimos 7 días»: hoy y los 6 anteriores, cruzando mes y año", () => {
    const sem = (fecha: string, hora = "12:00") =>
      rangoDelPeriodo(con({ periodo: "7dias" }), enArgentina(fecha, hora));
    expect(sem("2026-10-14")).toEqual({ desde: "2026-10-08", hasta: "2026-10-14" });
    expect(sem("2026-10-03")).toEqual({ desde: "2026-09-27", hasta: "2026-10-03" });
    expect(sem("2027-01-01", "00:05")).toEqual({ desde: "2026-12-26", hasta: "2027-01-01" });
    expect(sem("2028-03-02")).toEqual({ desde: "2028-02-25", hasta: "2028-03-02" });
    expect(sem("2026-10-28", "23:30")).toEqual({ desde: "2026-10-22", hasta: "2026-10-28" });
  });

  it("D-54: el jueves 29 de octubre de 2026 es del viernes 23 al jueves 29 (siete días, con hoy)", () => {
    const jueves = enArgentina("2026-10-29", "12:00");
    expect(new Date("2026-10-29T12:00:00-03:00").getUTCDay()).toBe(4);
    expect(rangoDelPeriodo(con({ periodo: "7dias" }), jueves)).toEqual({
      desde: "2026-10-23",
      hasta: "2026-10-29",
    });
  });

  it("«Todo»: sin fechas", () => {
    expect(rangoDelPeriodo(con({ periodo: "todo" }), new Date())).toEqual({});
  });

  it("«Personalizado»: las fechas que se escribieron, y un lado vacío es sin límite", () => {
    const ahora = new Date();
    expect(
      rangoDelPeriodo(
        con({ periodo: "personalizado", desde: "2026-09-30", hasta: "2026-10-02" }),
        ahora,
      ),
    ).toEqual({ desde: "2026-09-30", hasta: "2026-10-02" });
    expect(rangoDelPeriodo(con({ periodo: "personalizado", desde: "2026-09-30" }), ahora)).toEqual({
      desde: "2026-09-30",
    });
    expect(rangoDelPeriodo(con({ periodo: "personalizado" }), ahora)).toEqual({});
  });
});

describe("el período fijo de «Página siguiente»", () => {
  it("«Hoy», «Últimos 7 días» y «Este mes» pasan a «Personalizado» con las fechas efectivas del momento del pedido", () => {
    const ahora = enArgentina("2026-10-28", "23:59");
    expect(conElPeriodoFijo(con({ periodo: "hoy", estado: "RECHAZADO" }), ahora)).toEqual(
      con({
        periodo: "personalizado",
        desde: "2026-10-28",
        hasta: "2026-10-28",
        estado: "RECHAZADO",
      }),
    );
    expect(conElPeriodoFijo(con({ periodo: "7dias" }), ahora)).toMatchObject({
      periodo: "personalizado",
      desde: "2026-10-22",
      hasta: "2026-10-28",
    });
    expect(conElPeriodoFijo(con({ periodo: "mes" }), ahora)).toMatchObject({
      periodo: "personalizado",
      desde: "2026-10-01",
      hasta: "2026-10-28",
    });
  });

  it("«Todo» y «Personalizado» ya son fijos: no cambian", () => {
    const ahora = enArgentina("2026-10-28", "12:00");
    const todo = con({ periodo: "todo" });
    const personalizado = con({ periodo: "personalizado", desde: "2026-09-01" });
    expect(conElPeriodoFijo(todo, ahora)).toBe(todo);
    expect(conElPeriodoFijo(personalizado, ahora)).toBe(personalizado);
  });

  it("pedir con el período fijo da el mismo rango que se pidió, aunque ya haya pasado la medianoche", () => {
    const antes = enArgentina("2026-10-28", "23:59");
    const despues = enArgentina("2026-10-29", "00:01");
    for (const periodo of ["hoy", "7dias", "mes"] as const) {
      const fijo = conElPeriodoFijo(con({ periodo }), antes);
      expect(rangoDelPeriodo(fijo, despues), periodo).toEqual(
        rangoDelPeriodo(con({ periodo }), antes),
      );
    }
  });
});

describe("el pedido a la consulta", () => {
  const ahora = enArgentina("2026-10-14", "12:00");

  it("por defecto: solo «Este mes»", () => {
    expect(entradaDelListado(FILTROS_POR_DEFECTO, ahora, null)).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-14",
    });
  });

  it("con todos los filtros, el pedido que la consulta acepta (punto de venta como número)", () => {
    const pedido = entradaDelListado(
      con({ periodo: "hoy", estado: "INCIERTO", letra: "A", puntoDeVenta: "12", texto: "Sur" }),
      ahora,
      "2026-10-12T10:00:00.000000Z|0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
    );
    expect(pedido).toEqual({
      desde: "2026-10-14",
      hasta: "2026-10-14",
      estado: "INCIERTO",
      letra: "A",
      puntoDeVenta: 12,
      texto: "Sur",
      despuesDe: "2026-10-12T10:00:00.000000Z|0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
    });
    expect(entradaDeListar(pedido).ok).toBe(true);
  });

  it("cada uno de los siete estados del filtro (D-52) es un pedido que la consulta acepta", () => {
    for (const estado of ESTADOS_DEL_FILTRO) {
      const pedido = entradaDelListado(con({ estado }), ahora, null);
      expect(pedido).toMatchObject({ estado });
      expect(entradaDeListar(pedido).ok, estado).toBe(true);
    }
  });

  it("cada período, con cada filtro, es una entrada válida de la consulta", () => {
    for (const periodo of ["hoy", "7dias", "mes", "todo", "personalizado"] as const) {
      const pedido = entradaDelListado(
        con({ periodo, desde: periodo === "personalizado" ? "2026-10-01" : "" }),
        ahora,
        null,
      );
      expect(entradaDeListar(pedido).ok, periodo).toBe(true);
    }
  });

  it("rango invertido: la pantalla lo pide tal cual (no lo corrige) y la consulta lo acepta como forma; el rechazo es de la consulta", () => {
    const pedido = entradaDelListado(
      con({ periodo: "personalizado", desde: "2026-10-10", hasta: "2026-10-01" }),
      ahora,
      null,
    );
    // Si la pantalla lo diera vuelta en silencio, el error «La fecha «desde» es posterior a «hasta».» nunca se vería.
    expect(pedido).toEqual({ desde: "2026-10-10", hasta: "2026-10-01" });
    expect(entradaDeListar(pedido).ok).toBe(true);
  });

  it("fecha inexistente (2026-02-31): tiene forma de fecha, pero la consulta la rechaza señalando el campo", () => {
    for (const campo of ["desde", "hasta"] as const) {
      const pedido = entradaDelListado(
        con({ periodo: "personalizado", [campo]: "2026-02-31" }),
        ahora,
        null,
      );
      expect(pedido).toMatchObject({ [campo]: "2026-02-31" });
      expect(entradaDeListar(pedido)).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_DATOS_INVALIDOS", campo },
      });
    }
  });

  it("sin origen, ambiente ni límite: la pantalla no los pide (D-33)", () => {
    const pedido = entradaDelListado(con({ estado: "RECHAZADO" }), ahora, null);
    for (const ajeno of ["origenTipo", "origenId", "ambiente", "limite", "tipo"]) {
      expect(pedido).not.toHaveProperty(ajeno);
    }
  });
});
