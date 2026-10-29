import { describe, expect, it } from "vitest";
import { clasificarParametros } from "../adaptadores/arca/clasificar";
import { ID_DE_CONDICION_IVA } from "../adaptadores/arca/codigos";
import { CONDICIONES_DE_IVA } from "../modulos/fiscal/publico";
import { grabacion, respuestaHttp } from "../../test/utilidades/arca";
import { opcionesDeDatosFiscales } from "./opciones-de-datos-fiscales";

describe("opcionesDeDatosFiscales", () => {
  it("condiciones de IVA del emisor: las tres del dominio, en su orden, con el texto de D-44", () => {
    expect(opcionesDeDatosFiscales().condicionesDeIva).toEqual([
      { valor: "RESPONSABLE_INSCRIPTO", texto: "IVA Responsable Inscripto" },
      { valor: "MONOTRIBUTO", texto: "Responsable Monotributo" },
      { valor: "EXENTO", texto: "IVA Sujeto Exento" },
    ]);
  });

  it("ofrece exactamente las condiciones que el dominio acepta, ni una más ni una menos", () => {
    expect(opcionesDeDatosFiscales().condicionesDeIva.map((o) => o.valor)).toEqual([
      ...CONDICIONES_DE_IVA,
    ]);
  });

  it("cada texto es la descripción que ARCA contestó en homologación para esa condición (la fuente verificable)", () => {
    const r = clasificarParametros(
      respuestaHttp(grabacion(1, "016", "respuesta")),
      "FEParamGetCondicionIvaReceptor",
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    for (const { valor, texto } of opcionesDeDatosFiscales().condicionesDeIva) {
      const delManual = r.valor.find((f) => f["Id"] === String(ID_DE_CONDICION_IVA[valor]))?.[
        "Desc"
      ];
      expect(texto, valor).toBe(delManual);
    }
  });

  it("no ofrece condiciones de Ingresos Brutos (D-45: sin fuente verificable, quedan fuera de la primera versión)", () => {
    expect(Object.keys(opcionesDeDatosFiscales())).toEqual(["condicionesDeIva"]);
  });

  it("devuelve una lista nueva en cada llamada: quien la modifique no cambia la siguiente", () => {
    const primera = opcionesDeDatosFiscales();
    (primera.condicionesDeIva as { valor: string; texto: string }[]).pop();
    expect(opcionesDeDatosFiscales().condicionesDeIva).toHaveLength(3);
  });
});
