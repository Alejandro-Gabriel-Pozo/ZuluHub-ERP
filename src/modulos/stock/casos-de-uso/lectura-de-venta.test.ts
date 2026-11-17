import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { empresaId } from "../../../primitivas/identificadores/marca";
import { estadoDelModuloDeStock } from "./lectura-de-venta";

/**
 * `estadoDelModuloDeStock`: lo que los puertos de venta miran del módulo antes de descontar o recibir (E5-T7). Es el mismo veredicto del guard sobre
 * un módulo, sin rol ni acción: activo, solo lectura (activado y fuera del techo del plan), en desarrollo o no activo. Nace cerrado: lo que no es
 * «activo» no escribe nada.
 */

const reglasCon = (estado: "disponible" | "en_desarrollo"): ReglasDeEmpresa => ({
  catalogo: { ...CATALOGO_DE_MODULOS, stock: { ...CATALOGO_DE_MODULOS.stock, estado } },
  permisos: PERMISOS_DE_EMPRESA,
});
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("11111111-1111-4111-8111-111111111111"),
  personaId: null,
  marcaDeEntrada: null,
  ahora: new Date("2026-11-10T12:00:00Z"),
};
const conActor = (datos: DatosDelActor) => ({
  autorizacion: { delActor: () => Promise.resolve(datos) },
});
const estadoCon = (datos: DatosDelActor, estado: "disponible" | "en_desarrollo" = "disponible") =>
  estadoDelModuloDeStock(conActor(datos) as never, contexto, reglasCon(estado));

describe("estadoDelModuloDeStock", () => {
  it("activo: el módulo está disponible, la empresa lo activó y su plan lo incluye", async () => {
    expect(
      await estadoCon({
        rol: "GERENTE",
        modulosActivados: ["stock"],
        modulosHabilitados: ["stock"],
      }),
    ).toBe("ACTIVO");
  });

  it("solo lectura: lo activó la empresa pero el plan ya no lo incluye (baja de plan)", async () => {
    expect(
      await estadoCon({ rol: "GERENTE", modulosActivados: ["stock"], modulosHabilitados: [] }),
    ).toBe("MODULO_EN_SOLO_LECTURA");
  });

  it("no activo: el módulo existe pero la empresa no lo activó (aunque el plan lo incluya)", async () => {
    expect(
      await estadoCon({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: ["stock"] }),
    ).toBe("MODULO_NO_ACTIVO");
  });

  it("en desarrollo: no opera para nadie, esté activado y en el plan o no", async () => {
    expect(
      await estadoCon(
        { rol: "GERENTE", modulosActivados: ["stock"], modulosHabilitados: ["stock"] },
        "en_desarrollo",
      ),
    ).toBe("MODULO_EN_DESARROLLO");
    expect(
      await estadoCon(
        { rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] },
        "en_desarrollo",
      ),
    ).toBe("MODULO_EN_DESARROLLO");
  });

  it("sin rol (sin persona, sin membresía o suspendida) las listas vienen vacías y no opera: nunca se asume activo", async () => {
    expect(await estadoCon({ rol: null, modulosActivados: [], modulosHabilitados: [] })).toBe(
      "MODULO_NO_ACTIVO",
    );
  });
});
